# Changelog

All notable changes to The Boring Camera Card are documented here.

## [1.0.0]

First public release.

- **Setup assistant in the card editor:** pick the camera, everything else is found and
  filled in automatically (live stream, lower-quality stream, recordings folder,
  detection sensors, doorbell settings). No YAML needed. Your own entries are never
  overwritten.
- Live view directly through go2rtc (WebRTC), Push-to-Talk, fullscreen, auto live
  stream, SD/HD switch with a lower-quality stream.
- Thumbnail strip of past recordings with a fixed "Today" button, day picker, download
  and delete via long press.
- **Detections:** a coloured dot on the thumbnails shows person, animal or vehicle
  (Reolink detection sensors, found automatically).
- **Faces:** round avatars from `<clip>__face__<Name>.jpg` (e.g. from TheBoringFace).
- Optional settings page `the-boring-camera-settings` for central defaults.
- The former card name `portal-camera-card` keeps working.
