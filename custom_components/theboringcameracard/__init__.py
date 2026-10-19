"""The Boring Camera Card: camera setup for the Lovelace card of the same name.

One config entry holds the global go2rtc settings; every camera is a config
subentry. The integration serves the card's JavaScript itself (no dashboard
resource needed) and tells the card about the configured cameras through a
websocket command.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import frontend, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import (
    CARD_FILE,
    CONF_ENTITY,
    CONF_TITLE,
    DOMAIN,
    GLOBAL_KEYS,
    SUBENTRY_CAMERA,
    URL_BASE,
    VERSION,
)

_LOGGER = logging.getLogger(__name__)

_FRONTEND_KEY = f"{DOMAIN}_frontend_registered"

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Serve the card and register the websocket API."""
    if not hass.data.get(_FRONTEND_KEY):
        hass.data[_FRONTEND_KEY] = True
        card = Path(__file__).parent / "frontend" / CARD_FILE
        await hass.http.async_register_static_paths(
            [StaticPathConfig(f"{URL_BASE}/{CARD_FILE}", str(card), cache_headers=False)]
        )
        # Loaded in every frontend session, so no Lovelace resource is needed.
        frontend.add_extra_js_url(hass, f"{URL_BASE}/{CARD_FILE}?v={VERSION}")
        websocket_api.async_register_command(hass, ws_cameras)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up from a config entry (nothing to run, the data is read on demand)."""
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    return True


def camera_list(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Return all configured cameras in the form the card uses."""
    cameras: list[dict[str, Any]] = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        shared = {k: entry.options[k] for k in GLOBAL_KEYS if entry.options.get(k)}
        for sub in entry.subentries.values():
            if sub.subentry_type != SUBENTRY_CAMERA:
                continue
            config = {k: v for k, v in sub.data.items() if v not in (None, "")}
            config.update(shared)
            cameras.append(
                {
                    "id": sub.subentry_id,
                    "title": sub.data.get(CONF_TITLE) or sub.title,
                    "entity": sub.data.get(CONF_ENTITY),
                    "config": config,
                }
            )
    return cameras


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/cameras"})
@callback
def ws_cameras(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return the configured cameras to the card and its editor."""
    connection.send_result(msg["id"], camera_list(hass))
