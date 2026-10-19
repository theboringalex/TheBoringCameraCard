"""Constants for The Boring Camera Card."""

from __future__ import annotations

DOMAIN = "theboringcameracard"
VERSION = "1.0.0"

SUBENTRY_CAMERA = "camera"

# Global settings (config entry options)
CONF_GO2RTC_LAN = "go2rtc_server_lan"
CONF_GO2RTC_INGRESS = "go2rtc_ingress"
CONF_GO2RTC_SERVER = "go2rtc_server"
CONF_GO2RTC_TOKEN = "go2rtc_token"
GLOBAL_KEYS = (CONF_GO2RTC_LAN, CONF_GO2RTC_INGRESS, CONF_GO2RTC_SERVER, CONF_GO2RTC_TOKEN)

# Per camera settings (subentry data); the names match the card's own options
CONF_ENTITY = "entity"
CONF_TITLE = "title"
CONF_STREAM = "go2rtc_url"
CONF_STREAM_SUB = "go2rtc_url_sub"
CONF_MEDIA = "media_folder"
CONF_MIC = "mic"
CONF_ASPECT = "aspect_ratio"
CONF_FACES = "faces"

ASPECTS = ["16/9", "4/3", "1/1", "3/4"]

URL_BASE = "/theboringcameracard"
CARD_FILE = "the-boring-camera-card.js"
