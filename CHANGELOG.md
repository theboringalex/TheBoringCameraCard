# Changelog

All notable changes to The Boring Camera Card are documented here.

## [1.0.0]

First public release.

- **Home Assistant integration:** set up cameras under *Settings → Devices & services*.
  One integration, one camera after the other. Streams, lower-quality stream, recordings
  folder and doorbell settings are found automatically and can be corrected.
- **The integration delivers the card itself** — no dashboard resource needed.
- In the dashboard editor you simply pick one of the cameras you set up.
- Live view directly through go2rtc (WebRTC), push-to-talk, fullscreen, auto live stream,
  lower-quality stream to save data.
- Thumbnail strip of past recordings with a fixed "Today" button, day picker, download and
  delete via long press.
- **Detections:** a coloured dot on the thumbnails shows person, animal or vehicle
  (Reolink detection sensors, found automatically).
- **Faces:** round avatars from `<clip>__face__<Name>.jpg` (e.g. from TheBoringFace).
- The card still works without the integration (manual setup with its own form).
