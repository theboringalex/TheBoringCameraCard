"""Config flow: one integration, every camera is a subentry."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    ConfigSubentryFlow,
    OptionsFlow,
    SubentryFlowResult,
)
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    BooleanSelector,
    EntitySelector,
    EntitySelectorConfig,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from .const import (
    ASPECTS,
    CONF_ASPECT,
    CONF_ENTITY,
    CONF_FACES,
    CONF_GO2RTC_INGRESS,
    CONF_GO2RTC_LAN,
    CONF_GO2RTC_SERVER,
    CONF_GO2RTC_TOKEN,
    CONF_MEDIA,
    CONF_MIC,
    CONF_STREAM,
    CONF_STREAM_SUB,
    CONF_TITLE,
    DOMAIN,
    SUBENTRY_CAMERA,
)
from .discovery import Found, device_name, discover, find_media_folders

_TEXT = TextSelector(TextSelectorConfig(type=TextSelectorType.TEXT))
_PASSWORD = TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD))


def _global_schema(defaults: dict[str, Any]) -> vol.Schema:
    """Optional global go2rtc settings (empty = automatic)."""

    def opt(key: str, selector: TextSelector) -> tuple[vol.Optional, TextSelector]:
        return vol.Optional(key, description={"suggested_value": defaults.get(key)}), selector

    return vol.Schema(
        dict(
            [
                opt(CONF_GO2RTC_LAN, _TEXT),
                opt(CONF_GO2RTC_INGRESS, _TEXT),
                opt(CONF_GO2RTC_SERVER, _TEXT),
                opt(CONF_GO2RTC_TOKEN, _PASSWORD),
            ]
        )
    )


def _clean(data: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in data.items() if v not in (None, "")}


class TheBoringCameraCardConfigFlow(ConfigFlow, domain=DOMAIN):
    """Create the single integration entry."""

    VERSION = 1

    @classmethod
    @callback
    def async_get_supported_subentry_types(
        cls, config_entry: ConfigEntry
    ) -> dict[str, type[ConfigSubentryFlow]]:
        """Cameras are added as subentries."""
        return {SUBENTRY_CAMERA: CameraSubentryFlow}

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        """Global go2rtc settings."""
        return GlobalOptionsFlow()

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Ask for the optional global settings, then create the entry."""
        if user_input is not None:
            return self.async_create_entry(
                title="The Boring Camera Card", data={}, options=_clean(user_input)
            )
        return self.async_show_form(step_id="user", data_schema=_global_schema({}))


class GlobalOptionsFlow(OptionsFlow):
    """Edit the global go2rtc settings."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Show and save the settings."""
        if user_input is not None:
            return self.async_create_entry(data=_clean(user_input))
        return self.async_show_form(
            step_id="init", data_schema=_global_schema(dict(self.config_entry.options))
        )


class CameraSubentryFlow(ConfigSubentryFlow):
    """Add or edit one camera."""

    def __init__(self) -> None:
        """Initialize."""
        self._entity: str = ""
        self._found: Found | None = None

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> SubentryFlowResult:
        """Pick the camera entity, then look everything up automatically."""
        entry = self._get_entry()
        if user_input is not None:
            self._entity = user_input[CONF_ENTITY]
            self._found = await discover(self.hass, self._entity, dict(entry.options))
            return await self.async_step_details()

        used = [
            s.data.get(CONF_ENTITY)
            for s in entry.subentries.values()
            if s.subentry_type == SUBENTRY_CAMERA and s.data.get(CONF_ENTITY)
        ]
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_ENTITY): EntitySelector(
                        EntitySelectorConfig(domain="camera", exclude_entities=used)
                    )
                }
            ),
        )

    async def async_step_details(
        self, user_input: dict[str, Any] | None = None
    ) -> SubentryFlowResult:
        """Show what was found, let the user correct it, and save."""
        found = self._found
        assert found is not None
        if user_input is not None:
            data = _clean(user_input)
            data[CONF_ENTITY] = self._entity
            return self.async_create_entry(
                title=data[CONF_TITLE], data=data, unique_id=self._entity
            )

        defaults = {
            CONF_TITLE: found.name,
            CONF_STREAM: found.stream,
            CONF_STREAM_SUB: found.sub,
            CONF_MEDIA: found.folders[0][0] if len(found.folders) == 1 else "",
            CONF_MIC: found.doorbell,
            CONF_ASPECT: "3/4" if found.doorbell else "16/9",
            CONF_FACES: False,
        }
        return self.async_show_form(
            step_id="details",
            data_schema=self._details_schema(defaults, found.folders),
            description_placeholders={
                "found": "\n".join(f"- {line}" for line in found.info)
            },
        )

    async def async_step_reconfigure(
        self, user_input: dict[str, Any] | None = None
    ) -> SubentryFlowResult:
        """Edit an existing camera."""
        subentry = self._get_reconfigure_subentry()
        if user_input is not None:
            data = _clean(user_input)
            data[CONF_ENTITY] = subentry.data[CONF_ENTITY]
            return self.async_update_and_abort(
                self._get_entry(), subentry, title=data[CONF_TITLE], data=data
            )
        defaults = dict(subentry.data)
        folders = await self._folder_choices(defaults)
        return self.async_show_form(
            step_id="reconfigure",
            data_schema=self._details_schema(defaults, folders),
            description_placeholders={"entity": subentry.data[CONF_ENTITY]},
        )

    async def _folder_choices(self, defaults: dict[str, Any]) -> list[tuple[str, str]]:
        """Current folder plus matching folders found in the media browser."""
        choices: list[tuple[str, str]] = []
        current = defaults.get(CONF_MEDIA)
        if isinstance(current, str) and current:
            choices.append((current, current))
        entity = defaults.get(CONF_ENTITY)
        if entity:
            for folder in await find_media_folders(
                self.hass, device_name(self.hass, entity)
            ):
                if folder[0] != current:
                    choices.append(folder)
        return choices

    @staticmethod
    def _details_schema(
        defaults: dict[str, Any], folders: list[tuple[str, str]]
    ) -> vol.Schema:
        """The form for one camera; values are pre-filled, not forced."""

        def sv(key: str) -> dict[str, Any]:
            return {"suggested_value": defaults.get(key)}

        return vol.Schema(
            {
                vol.Required(CONF_TITLE, default=defaults.get(CONF_TITLE, "")): _TEXT,
                vol.Required(CONF_STREAM, default=defaults.get(CONF_STREAM, "")): _TEXT,
                vol.Optional(CONF_STREAM_SUB, description=sv(CONF_STREAM_SUB)): _TEXT,
                vol.Optional(CONF_MEDIA, description=sv(CONF_MEDIA)): SelectSelector(
                    SelectSelectorConfig(
                        options=[SelectOptionDict(value=v, label=p) for v, p in folders],
                        custom_value=True,
                        mode=SelectSelectorMode.DROPDOWN,
                    )
                ),
                vol.Optional(CONF_MIC, default=bool(defaults.get(CONF_MIC))): BooleanSelector(),
                vol.Optional(
                    CONF_ASPECT, default=defaults.get(CONF_ASPECT) or "16/9"
                ): SelectSelector(
                    SelectSelectorConfig(
                        options=[
                            SelectOptionDict(value=a, label=a.replace("/", ":"))
                            for a in ASPECTS
                        ],
                        mode=SelectSelectorMode.DROPDOWN,
                    )
                ),
                vol.Optional(
                    CONF_FACES, default=bool(defaults.get(CONF_FACES))
                ): BooleanSelector(),
            }
        )
