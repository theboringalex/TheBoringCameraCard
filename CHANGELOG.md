# Changelog

All notable changes to The Boring Camera Card are documented here.

## [1.2.0]

- New **Auto live stream** switch next to the SD/HD button, stored per camera
  (in the browser, default: on). When on, the live stream starts by itself as
  soon as the card becomes visible, e.g. when a pop-up opens.
- When the card is no longer visible (pop-up closed, card scrolled off-screen),
  the stream is closed automatically. A pop-up that is only moved off-screen is
  detected as well.
- When the switch is off, the stream only starts when you press play, as before.
- Closing the stream manually (X) does not restart it right away; auto start
  re-arms once the card has been hidden and shown again.

## [1.1.0]

- Initial public release under this name (rebranded/renamed from the
  earlier "Portal Camera Card" project — same card, new name and repository).
- Apple-Home-style camera card for Home Assistant: live view via go2rtc
  (WebRTC), Push-to-Talk, thumbnail strip and 24h timeline of recordings
  from a `media_source` folder, long-press to download/delete.
- Double-click/double-tap a thumbnail to download the recording directly,
  without going through the long-press context menu.
- Reolink-style main-stream/sub-stream switching: the card connects to a
  configured sub-stream (`go2rtc_url_sub`) by default to save bandwidth/CPU
  and automatically switches to the main stream in fullscreen; a small
  manual toggle button below the timeline lets you override this at any time.
- Adjustable video aspect ratio (16:9 / 4:3 / 1:1 / 3:4) and a full visual
  config editor — no YAML required.
