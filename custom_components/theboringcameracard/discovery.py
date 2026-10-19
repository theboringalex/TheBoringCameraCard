"""Automatic lookup of everything a camera needs: streams, recordings folder, doorbell."""

from __future__ import annotations

from dataclasses import dataclass, field
import logging
import re
from urllib.parse import urlparse

from aiohttp import ClientError, ClientTimeout

from homeassistant.components import media_source
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.network import NoURLAvailableError, get_url
from homeassistant.util import slugify

from .const import CONF_GO2RTC_LAN

_LOGGER = logging.getLogger(__name__)

# Detection sensors of the Reolink integration (language independent first).
_DET_KEYS = {
    "person": ("person", "people"),
    "animal": ("pet", "animal", "dog_cat"),
    "vehicle": ("vehicle",),
}
_DOORBELL_RE = re.compile(r"doorbell|klingel", re.IGNORECASE)

_TEXT = {
    "en": {
        "stream_ok": "Live stream \"{n}\" found in go2rtc",
        "stream_unchecked": "go2rtc could not be queried, using \"{n}\"",
        "stream_missing": "Stream \"{n}\" is not in go2rtc, please enter the right name",
        "sub_ok": "Lower quality stream: {n}",
        "sub_none": "No second stream found (optional)",
        "folder_one": "Recordings folder: {n}",
        "folder_many": "Several matching recordings folders found, please choose",
        "folder_none": "No matching recordings folder found (without one only the live view works)",
        "bell": "Doorbell recognised: push-to-talk and tall format preselected",
        "det_ok": "Detection: {n} (found automatically by the card)",
        "det_none": "Detection: no sensors found on the device",
    },
    "de": {
        "stream_ok": "Live-Stream „{n}“ in go2rtc gefunden",
        "stream_unchecked": "go2rtc nicht abfragbar, verwende „{n}“",
        "stream_missing": "Stream „{n}“ fehlt in go2rtc, bitte den richtigen Namen eintragen",
        "sub_ok": "Stream mit niedrigerer Qualität: {n}",
        "sub_none": "Kein zweiter Stream gefunden (optional)",
        "folder_one": "Aufzeichnungsordner: {n}",
        "folder_many": "Mehrere passende Aufzeichnungsordner gefunden, bitte wählen",
        "folder_none": "Kein passender Aufzeichnungsordner gefunden (ohne Ordner nur Live-Bild)",
        "bell": "Türklingel erkannt: Sprechen und Hochformat vorausgewählt",
        "det_ok": "Erkennung: {n} (die Karte findet sie automatisch)",
        "det_none": "Erkennung: keine Sensoren am Gerät gefunden",
    },
}


@dataclass
class Found:
    """Result of the automatic lookup for one camera."""

    name: str
    stream: str
    sub: str = ""
    folders: list[tuple[str, str]] = field(default_factory=list)
    doorbell: bool = False
    info: list[str] = field(default_factory=list)


def cam_rank(entry: er.RegistryEntry) -> int:
    """Rank Reolink camera entities: 0 main, 1 balanced, 2 sub, 3 unknown."""
    key = entry.translation_key or ""
    eid = entry.entity_id
    if key == "main" or re.search(r"(hochaufl|_clear|_main)", eid):
        return 0
    if key == "ext" or re.search(r"(ausgewogen|balanced|_ext)", eid):
        return 1
    if key == "sub" or re.search(r"(standardaufl|fluent|_sub)", eid):
        return 2
    return 3


def _norm(text: str) -> str:
    return slugify(text).replace("_", "")


def device_name(hass: HomeAssistant, entity_id: str) -> str:
    """Name of the device a camera belongs to, else the entity's name."""
    ent_reg = er.async_get(hass)
    entry = ent_reg.async_get(entity_id)
    if entry and entry.device_id:
        device = dr.async_get(hass).async_get(entry.device_id)
        if device:
            return device.name_by_user or device.name or entity_id
    state = hass.states.get(entity_id)
    if state and state.name:
        return state.name
    return entity_id.split(".", 1)[1]


def _device_model(hass: HomeAssistant, entity_id: str) -> str:
    entry = er.async_get(hass).async_get(entity_id)
    if entry and entry.device_id:
        device = dr.async_get(hass).async_get(entry.device_id)
        if device and device.model:
            return device.model
    return ""


def find_sub_entity(hass: HomeAssistant, entity_id: str) -> str | None:
    """Return the lower quality camera entity of the same device, if any."""
    ent_reg = er.async_get(hass)
    me = ent_reg.async_get(entity_id)
    if not me or not me.device_id:
        return None
    sibs = [
        e
        for e in er.async_entries_for_device(ent_reg, me.device_id)
        if e.domain == "camera" and e.entity_id != entity_id
    ]
    my_rank = cam_rank(me)
    if my_rank > 1:
        return None
    sub = next((e for e in sibs if cam_rank(e) == 2), None)
    if sub is None and my_rank == 0:
        sub = next((e for e in sibs if cam_rank(e) == 1), None)
    return sub.entity_id if sub else None


def find_detection(hass: HomeAssistant, entity_id: str) -> list[str]:
    """Names of the detection kinds (person/animal/vehicle) the device offers."""
    ent_reg = er.async_get(hass)
    me = ent_reg.async_get(entity_id)
    if not me or not me.device_id:
        return []
    sensors = [
        e
        for e in er.async_entries_for_device(ent_reg, me.device_id)
        if e.domain == "binary_sensor"
    ]
    found = []
    for kind, keys in _DET_KEYS.items():
        if any(s.translation_key in keys for s in sensors):
            found.append(kind)
    return found


async def list_go2rtc_streams(
    hass: HomeAssistant, configured: str | None
) -> list[str] | None:
    """Ask go2rtc for its stream names; None if it cannot be reached."""
    candidates: list[str] = []
    if configured:
        candidates.append(configured)
    try:
        host = urlparse(get_url(hass, prefer_external=False)).hostname
    except NoURLAvailableError:
        host = None
    if host:
        candidates.append(f"http://{host}:1984")
    candidates += ["http://localhost:1984", "http://localhost:11984"]
    session = async_get_clientsession(hass)
    for base in candidates:
        try:
            async with session.get(
                base.rstrip("/") + "/api/streams", timeout=ClientTimeout(total=3)
            ) as resp:
                if resp.status == 200:
                    data = await resp.json(content_type=None)
                    if isinstance(data, dict):
                        return sorted(data)
        except (ClientError, TimeoutError, ValueError):
            continue
    return None


async def _browse_dirs(hass: HomeAssistant, media_id: str | None):
    try:
        item = await media_source.async_browse_media(hass, media_id)
    except Exception:  # noqa: BLE001 - any browse problem just means "no match"
        return []
    return [c for c in (item.children or []) if c.can_expand]


async def find_media_folders(hass: HomeAssistant, name: str) -> list[tuple[str, str]]:
    """Find folders in the media browser whose name matches the camera (2 levels)."""
    want = _norm(name)
    if len(want) < 3:
        return []

    def match(title: str) -> bool:
        n = _norm(title)
        return bool(n) and (n == want or want in n or (n in want and len(n) >= 4))

    out: list[tuple[str, str]] = []
    seen: set[str] = set()

    def add(child, path: str) -> None:
        if child.media_content_id not in seen:
            seen.add(child.media_content_id)
            out.append((child.media_content_id, path))

    for root in await _browse_dirs(hass, None):
        level1 = await _browse_dirs(hass, root.media_content_id)
        for c in level1:
            if match(c.title):
                add(c, f"{root.title}/{c.title}")
        if out:
            continue
        for d in level1[:15]:
            for c in await _browse_dirs(hass, d.media_content_id):
                if match(c.title):
                    add(c, f"{root.title}/{d.title}/{c.title}")
    return out[:6]


async def discover(hass: HomeAssistant, entity_id: str, options: dict) -> Found:
    """Look up everything that can be found automatically for a camera entity."""
    t = _TEXT["de" if str(hass.config.language).startswith("de") else "en"]
    name = device_name(hass, entity_id)
    found = Found(name=name, stream=entity_id)

    streams = await list_go2rtc_streams(hass, options.get(CONF_GO2RTC_LAN))
    has = (lambda n: bool(streams) and n in streams)  # noqa: E731
    if streams is not None and not has(found.stream):
        alt = next(
            (n for n in (slugify(name), name, entity_id.split(".", 1)[1]) if has(n)), None
        )
        if alt:
            found.stream = alt
    if streams is None:
        found.info.append(t["stream_unchecked"].format(n=found.stream))
    elif has(found.stream):
        found.info.append(t["stream_ok"].format(n=found.stream))
    else:
        found.info.append(t["stream_missing"].format(n=found.stream))

    sub_entity = find_sub_entity(hass, entity_id)
    candidates = [c for c in (sub_entity, f"{found.stream}_sub", f"{slugify(name)}_sub") if c]
    sub = next((c for c in candidates if has(c)), None) if streams is not None else sub_entity
    if sub:
        found.sub = sub
        found.info.append(t["sub_ok"].format(n=sub))
    else:
        found.info.append(t["sub_none"])

    found.folders = await find_media_folders(hass, name)
    if len(found.folders) == 1:
        found.info.append(t["folder_one"].format(n=found.folders[0][1]))
    elif found.folders:
        found.info.append(t["folder_many"])
    else:
        found.info.append(t["folder_none"])

    found.doorbell = bool(_DOORBELL_RE.search(f"{_device_model(hass, entity_id)} {name}"))
    if found.doorbell:
        found.info.append(t["bell"])

    det = find_detection(hass, entity_id)
    labels = {"person": "Person", "animal": "Tier" if t is _TEXT["de"] else "Animal",
              "vehicle": "Fahrzeug" if t is _TEXT["de"] else "Vehicle"}
    found.info.append(
        t["det_ok"].format(n=", ".join(labels[d] for d in det)) if det else t["det_none"]
    )
    return found
