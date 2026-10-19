# The Boring Camera Card

*[Deutsche Version](README.de.md)*

[![Add this repository to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=theboringalex&repository=TheBoringCameraCard&category=integration)
[![Add the integration](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=theboringcameracard)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-FFDD00?logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/theboringalex)

A camera card for your Home Assistant dashboard that looks and feels like the
camera view in Apple Home: smooth live video, a button to talk through the
camera's speaker, and a strip of past recordings you can scroll through and
tap to play.

You set up your cameras **once, in Home Assistant's own settings** — one camera after
the other, with a form that fills in most of it for you. No YAML, and nothing to copy
around. Afterwards you just pick a camera in the dashboard editor.

<p align="center"><img src="docs/screenshot.jpg" width="320" alt="The Boring Camera Card in a Home Assistant dashboard"></p>

## Download

| | |
|---|---|
| **HACS (recommended)** | [Add this repository to HACS](https://my.home-assistant.io/redirect/hacs_repository/?owner=theboringalex&repository=TheBoringCameraCard&category=integration) |
| **Manual download** | [Repository as ZIP](https://github.com/theboringalex/TheBoringCameraCard/archive/refs/heads/main.zip) · [Releases](https://github.com/theboringalex/TheBoringCameraCard/releases/latest) |
| **Set up the integration** | [Add the integration to Home Assistant](https://my.home-assistant.io/redirect/config_flow_start/?domain=theboringcameracard) (after installing) |
| **Support the project** | [Buy me a coffee](https://www.buymeacoffee.com/theboringalex) |

## What it does

- Live view of your camera through [go2rtc](https://github.com/AlexxIT/go2rtc), which Home Assistant already includes — fast, at home and away
- Push-to-talk, if your camera can play sound back (most video doorbells can)
- A row of thumbnails of past recordings with a fixed "Today" button; press and hold to download or delete
- Person / animal / vehicle markers on the thumbnails (Reolink AI detection) and round face avatars (e.g. from TheBoringFace)
- A lower-quality stream in the normal view to save data, full quality in fullscreen
- Auto live stream: starts by itself when the card becomes visible, stops when it is hidden
- Shapes to fit your camera: 16:9, 4:3, 1:1, or tall 3:4 for doorbells

## Installing

### With HACS (the easy way)

1. Click **"Add this repository to HACS"** above, then **Download**.
2. Restart Home Assistant.
3. Open **Settings → Devices & services → Add integration → "The Boring Camera Card"**
   (or use the *Add the integration* button above).

The integration delivers the card to your dashboards by itself — no dashboard
resource to add, no browser cache to fight with (just refresh once).

### By hand (without HACS)

1. [Download the repository](https://github.com/theboringalex/TheBoringCameraCard/archive/refs/heads/main.zip) and unzip it.
2. Copy the folder `custom_components/theboringcameracard` into the `custom_components`
   folder of your Home Assistant (create it if it does not exist).
3. Restart Home Assistant, then add the integration as described above.

## Setting up your cameras

1. **Settings → Devices & services → The Boring Camera Card → Add camera**
2. Pick the camera. That's the only thing you have to choose.
3. The next page shows what was **found automatically** and lets you correct it:

| What | How it is found |
|---|---|
| Live stream | The stream that belongs to the camera in go2rtc (checked against go2rtc) |
| Lower-quality stream | The camera's second stream (e.g. Reolink "Fluent"), saves data |
| Recordings folder | Looked up in Home Assistant's media browser by the camera's name; if several match you pick one |
| Detection (person / animal / vehicle) | The AI sensors on the camera's device (Reolink) — found by the card itself |
| Doorbell | Recognised by name/model: push-to-talk and the tall 3:4 shape are preselected |

Repeat **Add camera** for every camera — one integration, as many cameras as you like.
Change a camera later with the "⋮" menu next to it → **Reconfigure**.

The integration's **Configure** button holds the optional go2rtc settings (see below);
most people never touch them.

## Adding the card to your dashboard

Edit a dashboard → **Add card → "The Boring Camera Card"** → choose one of the cameras
you set up. Done.

## go2rtc settings (only if you need them)

The card assumes go2rtc runs on the same machine as Home Assistant, on its usual
port 1984. If your setup is different, open the integration and click **Configure**:

| Setting | When you'd need it |
|---|---|
| go2rtc server in your network | go2rtc runs on a *different* device than Home Assistant, e.g. `http://192.168.1.50:1984` |
| go2rtc ingress path | Remote access through Home Assistant's own proxy (go2rtc add-on) |
| go2rtc external address | A separate web address for go2rtc when you are away from home |
| go2rtc access token | Your own reverse proxy in front of go2rtc requires one |

## Detections & faces

- **Person / animal / vehicle:** if your camera has AI detection (e.g. Reolink), a coloured
  dot appears at the bottom right of each thumbnail: blue = person, orange = animal,
  purple = vehicle. The sensors are found automatically from the camera's device.
- **Faces:** images next to a recording named `<recording>__face__<Name>.jpg` (e.g. from
  TheBoringFace) are shown as a round avatar at the top right. Switch it on per camera
  with **Show faces** when you add or reconfigure the camera.

## Without the integration (advanced)

The card also works on its own: copy `custom_components/theboringcameracard/frontend/the-boring-camera-card.js`
into `config/www/`, add it as a dashboard resource (`/local/the-boring-camera-card.js`, type *JavaScript module*),
and fill in the card's own form (camera, recordings folder, …) in the dashboard editor. Its **Advanced**
section has `go2rtc_url`, `go2rtc_url_sub`, `go2rtc_server_lan`, `go2rtc_ingress`, `go2rtc_server`,
`go2rtc_token`, `bitrate_entity` and `debug`.

## A couple of things to know

- **Push-to-talk needs a secure connection (HTTPS), or "localhost".** Browsers only allow
  microphone access on secure connections — a browser rule, not something this card can work
  around. Over plain `http://` the button simply won't respond. Make Home Assistant reachable
  over HTTPS at home too (for example a local DNS entry for your usual HTTPS address).
- Connections through Home Assistant's built-in proxy (ingress) can occasionally drop — a known
  Home Assistant quirk. A dedicated reverse proxy in front of go2rtc tends to be more reliable
  for access from outside your home.

## Support this project

If this card made your dashboard nicer, you can [buy me a coffee](https://www.buymeacoffee.com/theboringalex) — totally optional,
and always appreciated.

## Found a problem, or have an idea?

This is a small side project built in my spare time — [issues](https://github.com/theboringalex/TheBoringCameraCard/issues)
and pull requests are welcome, just please be patient waiting for a reply.

## License

MIT — see [LICENSE](LICENSE).
