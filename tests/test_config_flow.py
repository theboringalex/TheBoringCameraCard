"""Tests for the config flow and the automatic camera lookup."""

from unittest.mock import AsyncMock, MagicMock, patch

from homeassistant.components.frontend import DATA_EXTRA_MODULE_URL
from homeassistant.config_entries import ConfigSubentry
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import device_registry as dr, entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.theboringcameracard import camera_list
from custom_components.theboringcameracard.const import DOMAIN, SUBENTRY_CAMERA

DISC = "custom_components.theboringcameracard.discovery"


def _prepare(hass: HomeAssistant) -> None:
    """Pretend the dependencies are already set up."""
    for comp in ("frontend", "http", "media_source", "websocket_api"):
        hass.config.components.add(comp)
    hass.http = MagicMock(async_register_static_paths=AsyncMock())
    hass.data[DATA_EXTRA_MODULE_URL] = set()


def _add_reolink_doorbell(hass: HomeAssistant, entry: MockConfigEntry) -> None:
    dev_reg = dr.async_get(hass)
    ent_reg = er.async_get(hass)
    device = dev_reg.async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={("reolink", "bell")},
        name="Haustuer",
        model="Reolink Video Doorbell WiFi",
    )
    for key, eid in (
        ("main", "camera.haustuer_hochaufloesend"),
        ("sub", "camera.haustuer_standardaufloesung"),
    ):
        ent_reg.async_get_or_create(
            "camera",
            "reolink",
            f"bell_{key}",
            suggested_object_id=eid.split(".")[1],
            device_id=device.id,
            translation_key=key,
        )
        hass.states.async_set(eid, "idle", {"friendly_name": eid})
    for key in ("person", "vehicle"):
        ent_reg.async_get_or_create(
            "binary_sensor",
            "reolink",
            f"bell_{key}",
            suggested_object_id=f"haustuer_{key}",
            device_id=device.id,
            translation_key=key,
        )


async def _create_entry(hass: HomeAssistant) -> MockConfigEntry:
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": "user"}
    )
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    return result["result"]


async def test_add_camera_with_autodiscovery(hass: HomeAssistant) -> None:
    """One entry, a camera is added as a subentry with everything pre-filled."""
    _prepare(hass)
    holder = MockConfigEntry(domain="reolink")
    holder.add_to_hass(hass)
    _add_reolink_doorbell(hass, holder)

    entry = await _create_entry(hass)
    assert entry.state.name == "LOADED"

    streams = [
        "camera.haustuer_hochaufloesend",
        "camera.haustuer_standardaufloesung",
    ]
    tree = {
        None: [("media-source://media_source", "Eigene Medien")],
        "media-source://media_source": [("media-source://media_source/local/NAS", "NAS")],
        "media-source://media_source/local/NAS": [
            ("media-source://media_source/local/NAS/Haustuer", "Haustuer"),
            ("media-source://media_source/local/NAS/Garten", "Garten"),
        ],
    }

    async def fake_browse(_hass, media_id):
        return [
            MagicMock(media_content_id=i, title=t, can_expand=True)
            for i, t in tree.get(media_id, [])
        ]

    with (
        patch(f"{DISC}.list_go2rtc_streams", AsyncMock(return_value=streams)),
        patch(f"{DISC}._browse_dirs", fake_browse),
    ):
        result = await hass.config_entries.subentries.async_init(
            (entry.entry_id, SUBENTRY_CAMERA), context={"source": "user"}
        )
        assert result["type"] is FlowResultType.FORM
        assert result["step_id"] == "user"
        result = await hass.config_entries.subentries.async_configure(
            result["flow_id"], {"entity": "camera.haustuer_hochaufloesend"}
        )

    assert result["step_id"] == "details"
    found = result["description_placeholders"]["found"]
    assert "camera.haustuer_standardaufloesung" in found
    assert "Haustuer" in found
    keys = {str(k): k for k in result["data_schema"].schema}
    assert keys["go2rtc_url"].default() == "camera.haustuer_hochaufloesend"
    assert keys["mic"].default() is True
    assert keys["aspect_ratio"].default() == "3/4"
    assert keys["go2rtc_url_sub"].description["suggested_value"] == (
        "camera.haustuer_standardaufloesung"
    )
    assert keys["media_folder"].description["suggested_value"].endswith("/Haustuer")

    user_input = {
        "title": "Haustuer",
        "go2rtc_url": "camera.haustuer_hochaufloesend",
        "go2rtc_url_sub": "camera.haustuer_standardaufloesung",
        "media_folder": "media-source://media_source/local/NAS/Haustuer",
        "mic": True,
        "aspect_ratio": "3/4",
        "faces": False,
    }
    result = await hass.config_entries.subentries.async_configure(
        result["flow_id"], user_input
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY

    cams = camera_list(hass)
    assert len(cams) == 1
    assert cams[0]["title"] == "Haustuer"
    assert cams[0]["entity"] == "camera.haustuer_hochaufloesend"
    assert cams[0]["config"]["go2rtc_url_sub"] == "camera.haustuer_standardaufloesung"
    assert cams[0]["config"]["mic"] is True


async def test_second_camera_excludes_first_and_reconfigure(hass: HomeAssistant) -> None:
    """A second camera can be added; an existing one can be edited."""
    _prepare(hass)
    holder = MockConfigEntry(domain="reolink")
    holder.add_to_hass(hass)
    _add_reolink_doorbell(hass, holder)
    hass.states.async_set("camera.garten", "idle", {"friendly_name": "Garten"})
    entry = await _create_entry(hass)

    with (
        patch(f"{DISC}.list_go2rtc_streams", AsyncMock(return_value=None)),
        patch(f"{DISC}._browse_dirs", AsyncMock(return_value=[])),
    ):
        for entity in ("camera.garten", "camera.haustuer_hochaufloesend"):
            r = await hass.config_entries.subentries.async_init(
                (entry.entry_id, SUBENTRY_CAMERA), context={"source": "user"}
            )
            r = await hass.config_entries.subentries.async_configure(
                r["flow_id"], {"entity": entity}
            )
            assert r["step_id"] == "details"
            r = await hass.config_entries.subentries.async_configure(
                r["flow_id"],
                {
                    "title": entity,
                    "go2rtc_url": entity,
                    "mic": False,
                    "aspect_ratio": "16/9",
                    "faces": False,
                },
            )
            assert r["type"] is FlowResultType.CREATE_ENTRY

        assert len(entry.subentries) == 2

        sub = next(iter(entry.subentries.values()))
        r = await hass.config_entries.subentries.async_init(
            (entry.entry_id, SUBENTRY_CAMERA),
            context={"source": "reconfigure", "subentry_id": sub.subentry_id},
        )
        assert r["step_id"] == "reconfigure"
        r = await hass.config_entries.subentries.async_configure(
            r["flow_id"],
            {
                "title": "Neuer Name",
                "go2rtc_url": "x",
                "mic": True,
                "aspect_ratio": "4/3",
                "faces": True,
            },
        )
        assert r["type"] is FlowResultType.ABORT
        assert r["reason"] == "reconfigure_successful"

    assert any(c["title"] == "Neuer Name" for c in camera_list(hass))


async def test_global_options_are_passed_to_cameras(hass: HomeAssistant) -> None:
    """Global go2rtc settings show up in every camera's config."""
    _prepare(hass)
    entry = await _create_entry(hass)
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"go2rtc_server_lan": "http://192.168.1.50:1984"}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY

    hass.config_entries.async_add_subentry(
        entry,
        ConfigSubentry(
            data={"entity": "camera.x", "title": "X", "go2rtc_url": "camera.x"},
            subentry_type=SUBENTRY_CAMERA,
            title="X",
            unique_id="camera.x",
        ),
    )
    cam = camera_list(hass)[0]
    assert cam["config"]["go2rtc_server_lan"] == "http://192.168.1.50:1984"


async def test_single_instance(hass: HomeAssistant) -> None:
    """Only one integration entry is allowed."""
    _prepare(hass)
    await _create_entry(hass)
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": "user"}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "single_instance_allowed"
