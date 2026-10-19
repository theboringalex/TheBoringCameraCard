# YAML configuration

*[Deutsche Version](yaml-konfiguration.md)* · [Back to the README](../README.md)

The card can be set up entirely through its form. If you prefer YAML (or run a dashboard in YAML mode), this page lists every option.

## 1. Add the resource

HACS normally adds the resource for you. For a YAML-mode dashboard or a manual install you need it in your dashboard configuration:

```yaml
resources:
  - url: /hacsfiles/TheBoringCameraCard/the-boring-camera-card.js   # HACS
    type: module
  # by hand (file in config/www/):
  # - url: /local/the-boring-camera-card.js
  #   type: module
```

## 2. Add the card

Edit the dashboard → menu (⋮) top right → **Raw configuration editor**. Or: Add card → *The Boring Camera Card* → **Show code editor**.

### Minimal

```yaml
type: custom:the-boring-camera-card
entity: camera.front_door
```

This shows the live view. Without `media_folder` there is no recordings strip.

### With recordings

```yaml
type: custom:the-boring-camera-card
entity: camera.front_door
title: Front door
media_folder: media-source://media_source/local/Cameras/FrontDoor
aspect_ratio: 16/9
```

### Doorbell with push-to-talk

```yaml
type: custom:the-boring-camera-card
entity: camera.doorbell
title: Doorbell
media_folder: media-source://media_source/local/Cameras/Doorbell
mic: true
aspect_ratio: 3/4
```

### Full example (Reolink, go2rtc on another device)

```yaml
type: custom:the-boring-camera-card
entity: camera.garden_fluent
title: Garden
media_folder: media-source://media_source/local/Cameras/Garden
aspect_ratio: 4/3
mic: false
# Streams in go2rtc
go2rtc_url: garden            # main stream (default: the camera entity)
go2rtc_url_sub: garden_sub    # lower-quality stream
go2rtc_server_lan: http://192.168.1.50:1984
go2rtc_ingress: /api/hassio_ingress/<YOUR_INGRESS_TOKEN>
# Detection & faces
detection_badges: true
detection:
  person: binary_sensor.garden_person
  animal: binary_sensor.garden_animal
  vehicle: binary_sensor.garden_vehicle
  pre: 5
  post: 60
faces: true
faces_show_unknown: false
```

## 3. All options

| Option | Default | Meaning |
|---|---|---|
| `type` | – | Required: `custom:the-boring-camera-card` (the old name `custom:portal-camera-card` still works) |
| `entity` | – | **Required.** Camera entity, e.g. `camera.front_door` |
| `title` | – | Name of the card (currently only used in debug output) |
| `media_folder` | empty | Recordings folder in the media browser, e.g. `media-source://media_source/local/Cameras/FrontDoor`. Empty = live view only |
| `aspect_ratio` | `16/9` | Video shape: `16/9`, `4/3`, `1/1` or `3/4` (tall, e.g. doorbell) |
| `mic` | `false` | Show the push-to-talk button (camera with speaker, access over HTTPS) |
| `go2rtc_url` | camera entity | Name of the main stream in go2rtc |
| `go2rtc_url_sub` | empty | Second, lower-quality stream; the normal view uses it, fullscreen uses the main stream, plus an SD/HD toggle |
| `go2rtc_server_lan` | `http://<HA host>:1984` | go2rtc address on your home network, if go2rtc does not run on the HA host |
| `go2rtc_ingress` | empty | Path to the go2rtc add-on through HA ingress for access when away |
| `go2rtc_server` | empty | Your own external go2rtc address when ingress is not used |
| `go2rtc_token` | empty | Token for your own reverse proxy in front of go2rtc (external address only) |
| `bitrate_entity` | empty | `input_number` the card writes the measured bitrate to |
| `debug` | `false` | Diagnostics in the browser console (F12) |
| `detection_badges` | `true` | Person / animal / vehicle markers on the thumbnails |
| `detection.person` / `.animal` / `.vehicle` | automatic | Your own binary sensors instead of the ones found automatically (Reolink); `none` turns a type off |
| `detection.pre` / `.post` | `5` / `60` | Seconds before / after the start of a recording in which a detection counts for it |
| `faces` | `true` | Show face avatars (`<recording>__face__<Name>.jpg`, e.g. from TheBoringFace) |
| `faces_show_unknown` | `true` | Also show unknown faces |
| `face_tag` | `__face__` | Separator in the file name of the face images |

## 4. How the card reaches go2rtc

1. **At home** (HA opened via a private IP, `.local` or `localhost`): directly through `go2rtc_server_lan`.
2. **Away, with `go2rtc_ingress`**: through Home Assistant's ingress proxy, no extra port forwarding needed.
3. **Away, without ingress**: through `go2rtc_server`; if that is not set, `go2rtc_server_lan` is tried.

The stream name in go2rtc must match `go2rtc_url` (if not set: the entity ID, e.g. `camera.front_door`).

## 5. Folder structure of the recordings

The card recognises three layouts inside `media_folder`:

- One folder per day: `2026-10-19/` or `20261019/`
- Year/month/day: `2026/10/19/`
- Flat, if the file name contains a timestamp, e.g. `2026-10-19_14-30-05.mp4` or `20261019_143005.mp4`

Face images are `.jpg` files in the same folder as the recording.

## Troubleshooting

- **Card not found ("Custom element doesn't exist")**: resource missing or browser cache. Check the resource, then press Ctrl+Shift+R.
- **No live view**: check the stream name in go2rtc against `go2rtc_url` and the address in `go2rtc_server_lan`; use `debug: true` and look at the console.
- **No recordings**: check `media_folder` (open it in the media browser and copy the path) and the folder structure above.
- **Push-to-talk does nothing**: open Home Assistant over HTTPS (or `localhost`).
