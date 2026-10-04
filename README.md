# The Boring Camera Card

*[Deutsche Version](README.de.md)*

[![Add this repository to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=theboringalex&repository=TheBoringCameraCard&category=plugin)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-FFDD00?logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/theboringalex)

A camera card for your Home Assistant dashboard that looks and feels like the
camera view in Apple Home: smooth live video, a button to talk through the
camera's speaker, and a strip of past recordings you can scroll through and
tap to play. No coding and no YAML needed to set it up — just pick your
camera from a dropdown.

<p align="center"><img src="docs/screenshot.png" width="320" alt="The Boring Camera Card in a Home Assistant dashboard"></p>

## What it does

- Shows a live view of your camera (uses [go2rtc](https://github.com/AlexxIT/go2rtc), which most Home Assistant setups already have — fast and works both at home and away)
- A push-to-talk button, if your camera can play sound back (most video doorbells can)
- A row of thumbnails and a 24-hour timeline of your camera's past recordings, picked up automatically from Home Assistant
- Press and hold a recording to download or delete it, or just double-click/double-tap it to download it right away
- Choose the video shape that fits your camera: wide (16:9), classic (4:3), square (1:1), or tall (3:4, great for doorbells)
- If your camera offers two video qualities (common on Reolink cameras), the card can use the lower-quality one to save data while you're just glancing at it, and automatically switch to full quality the moment you go fullscreen
- An **Auto live stream** switch next to the SD/HD button (per camera): on = the live view starts by itself as soon as the card is visible (e.g. when a pop-up opens) and stops when it closes; off = it starts when you press play
- A simple, visual settings screen — fill in a form, no code

## Before you start

- Home Assistant with the [go2rtc Add-on](https://github.com/AlexxIT/go2rtc) (or your own go2rtc server) already showing your camera's live feed
- Your camera already added to go2rtc as a stream (Home Assistant's go2rtc Add-on usually does this by itself for cameras it already knows about)
- *(Optional)* A folder of this camera's recordings in Home Assistant's media library, if you want the thumbnail strip and timeline. Without one, the card still works — it just shows the live view.

## Installing it

### With HACS (the easy way)

1. Click the **"Add this repository to HACS"** button at the top of this page — it opens Home Assistant and fills in the details for you.
2. Click "Download" in HACS to install the card.
3. Refresh your browser (Ctrl+Shift+R, or Cmd+Shift+R on a Mac) so Home Assistant picks up the new card.

If the button doesn't work for some reason, you can also add it by hand:
**HACS → the "⋮" menu (top right) → Custom repositories**, paste this
repository's URL, pick category **Dashboard**, then search for
"The Boring Camera Card" in HACS and install it.

### By hand (without HACS)

1. Download `the-boring-camera-card.js` from this repository's [latest release](../../releases)
2. Copy it into the `www` folder inside your Home Assistant's `config` folder
3. Go to **Settings → Dashboards → the "⋮" menu → Resources → Add Resource**
   - URL: `/local/the-boring-camera-card.js`
   - Resource type: **JavaScript Module**
4. Refresh your browser

## Adding a camera to your dashboard

1. Edit a dashboard, then **Add Card → search for "The Boring Camera Card"**
2. Fill in the form:
   - **Camera** — pick your camera from the dropdown
   - **Title** — whatever name you want shown
   - **Recordings folder** — optional; opens Home Assistant's media browser so you can point it at your camera's recordings
   - **Push-to-Talk** — turn this on if your camera can play sound
   - **Aspect ratio** — pick the video shape from the dropdown
3. Only open **Advanced** if something below doesn't match your setup

That's everything most people need — no YAML required.

### Advanced settings (only if you need them)

The card assumes go2rtc runs on the same machine as Home Assistant, on its
usual port, 1984. If your setup is different, open **Advanced** in the card's
settings:

| Setting | When you'd need it |
|---|---|
| `go2rtc_url` | Your camera's stream has a different name in go2rtc than its entity ID |
| `go2rtc_url_sub` | Your camera offers a second, lower-quality video stream in go2rtc (common on Reolink cameras, often named `<camera>_sub`). When set, the card uses this one by default to save data, and switches to the full-quality stream automatically in fullscreen. A small button below the timeline also lets you switch between the two by hand at any time. |
| `go2rtc_server_lan` | go2rtc runs on a *different* device than Home Assistant, on your home network |
| `go2rtc_ingress` | You want remote access to work through Home Assistant's own built-in proxy, without setting up anything extra. You'll find this address on the go2rtc Add-on's info page. |
| `go2rtc_server` | A separate web address for go2rtc, if you're not using the option above |
| `go2rtc_token` | Your own reverse proxy in front of go2rtc requires an access code |
| `bitrate_entity` | A number helper that the card should fill in with the live video's data rate (handy if you want to show that elsewhere on your dashboard) |
| `debug` | Prints detailed connection info to the browser's console (press F12), useful if something isn't working and you want to see why |

## A couple of things to know

- **Push-to-Talk needs a secure connection (HTTPS), or "localhost".** Browsers
  only allow microphone access on secure connections — this is a browser
  rule, not something this card can work around. If you reach Home Assistant
  at home over plain `http://`, the push-to-talk button simply won't respond,
  with no error shown. The fix is to make Home Assistant reachable over
  HTTPS at home too (for example, a local DNS entry that points your usual
  HTTPS address at your home network as well).
- Connections that go through Home Assistant's built-in proxy (`go2rtc_ingress`)
  can occasionally drop — that's a known Home Assistant quirk, not something
  specific to this card. A dedicated reverse proxy in front of go2rtc tends
  to be more reliable for access from outside your home.

## Support this project

If this card made your dashboard nicer and you'd like to say thanks, you can
[buy me a coffee](https://www.buymeacoffee.com/theboringalex) — totally
optional, and always appreciated.

## Found a problem, or have an idea?

This is a small side project built in my spare time — issues and pull
requests are welcome, just please be patient waiting for a reply.

## License

MIT — see [LICENSE](LICENSE).
