# Face recognition with TheBoringFace

*[Deutsche Version](theboringface.de.md)*

The card shows recognised people as a **round face avatar at the top right** of each recording's thumbnail.
Faces are detected by **[TheBoringFace](https://github.com/theboringalex/TheBoringFace)** – a small Docker stack
(CompreFace + a management UI) that checks new recordings in the background.

The card itself does no recognition: it only reads small images that TheBoringFace puts **next to the recording**.
No API connection and no credentials in the browser are needed.

```
Recording:     RecM01_20261020_101500.mp4
Face:          RecM01_20261020_101500__face__Alex.jpg
Unknown:       RecM01_20261020_101500__face__Unbekannt_1.jpg
```

## Requirements

- The recordings are in a folder Home Assistant can see as a **media source**
  (e.g. `media-source://media_source/local/NAS_Cameras/FrontDoor`) and which you entered as `media_folder` in the card.
- The same folder is mounted into TheBoringFace – **with write access**, because the face images are stored there.
- A running TheBoringFace stack ([setup guide](https://github.com/theboringalex/TheBoringFace#einrichtung)).

## Setup

### 1. Start TheBoringFace

Start the stack following the [guide in the TheBoringFace repository](https://github.com/theboringalex/TheBoringFace#einrichtung),
set up CompreFace once and enter its API key. Make sure that:

- `CAMERAS` = folder name of the camera (e.g. `SkyNet-Doorbell`)
- the recordings folder is mounted to `/recordings` (without `:ro`)
- `WRITE_SIDECARS: "true"` (default)

### 2. Add people

Open the TheBoringFace UI (`http://<host>:8099`) → **Personen** → enter a name and upload 3–5 frontal photos.
Faces not yet assigned to anyone appear under **Unbekannt**; assign them with one click and the card shows the right name.

### 3. Configure the card

In the card's form open **Detections & faces** and switch on **Show faces (TheBoringFace)**.
Switch off **Show unknown faces** if you do not want avatars for unknown people.

The same in YAML:

```yaml
type: custom:the-boring-camera-card
entity: camera.skynet_doorbell
media_folder: media-source://media_source/local/NAS_Cameras/SkyNet-Doorbell
faces: true
faces_show_unknown: true
# face_tag: __face__   # only change if TheBoringFace runs with a different FACE_TAG
```

### 4. Check

1. In TheBoringFace go to **System** → *Neu scannen* to analyse the last 24 h.
2. In Home Assistant's media browser look for `__face__` in the recordings folder – there must be `.jpg` files.
3. Reload the card (Ctrl+Shift+R). Recordings with recognised people show a circle at the top right; tapping a recording shows the name below the video.

## File naming

| File | Meaning |
|---|---|
| `<recording>__face__<Name>.jpg` | recognised person (spaces in the name become `_`; the card shows them as spaces again) |
| `<recording>__face__Unbekannt_<n>.jpg` | a face that could not be assigned to anyone |

When you assign an unknown face in TheBoringFace, the file is renamed automatically.
If you delete a recording through the card's context menu (long press), its face files are deleted too.
If a recording disappears otherwise (e.g. your NAS retention rule), TheBoringFace cleans up the face files daily.

## Troubleshooting

| Problem | Cause / fix |
|---|---|
| No circle on recordings | Is *Faces* switched on in the card? Are there `__face__` files in the recordings folder? If not, TheBoringFace has no write access (folder not `:ro`, check NAS user permissions). |
| Files exist but the card does not show them | The card's `media_folder` points to a different folder than the one TheBoringFace writes to. They must be the same folder. |
| All faces are "Unbekannt" | Add more/better photos for the person, or lower `SIMILARITY_MIN` in TheBoringFace slightly (e.g. 0.85). |
| Circle appears only after a while | TheBoringFace waits until the FTP upload is finished (about 15 s) and processes recordings one after another. |
| New card version does not load | Clear the browser cache (Ctrl+Shift+R); check in HACS that the update has been installed. |

## Privacy

Face data is biometric data. Run TheBoringFace only on your local network, never expose its ports to the internet,
and only enrol people who have agreed.
