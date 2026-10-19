# YAML-Konfiguration

*[English version](yaml-configuration.md)* · [Zurück zur README](../README.de.md)

Die Karte lässt sich komplett im Formular einrichten. Wer lieber YAML nutzt (oder ein Dashboard im YAML-Modus betreibt), findet hier alle Optionen.

## 1. Ressource eintragen

HACS trägt die Ressource normalerweise selbst ein. Bei einem Dashboard im YAML-Modus oder einer Installation von Hand brauchst du sie in der Dashboard-Konfiguration:

```yaml
resources:
  - url: /hacsfiles/TheBoringCameraCard/the-boring-camera-card.js   # HACS
    type: module
  # von Hand (Datei in config/www/):
  # - url: /local/the-boring-camera-card.js
  #   type: module
```

## 2. Karte hinzufügen

Dashboard bearbeiten → Menü (⋮) oben rechts → **Raw-Konfigurationseditor**. Oder: Karte hinzufügen → *The Boring Camera Card* → **Code-Editor anzeigen**.

### Minimal

```yaml
type: custom:the-boring-camera-card
entity: camera.haustuer
```

Das zeigt das Live-Bild. Ohne `media_folder` gibt es keine Aufnahmen-Leiste.

### Mit Aufnahmen

```yaml
type: custom:the-boring-camera-card
entity: camera.haustuer
title: Haustür
media_folder: media-source://media_source/local/Kamera/Haustuer
aspect_ratio: 16/9
```

### Türklingel mit Push-to-Talk

```yaml
type: custom:the-boring-camera-card
entity: camera.klingel
title: Klingel
media_folder: media-source://media_source/local/Kamera/Klingel
mic: true
aspect_ratio: 3/4
```

### Vollständiges Beispiel (Reolink, go2rtc auf anderem Gerät)

```yaml
type: custom:the-boring-camera-card
entity: camera.garten_standardaufloesung
title: Garten
media_folder: media-source://media_source/local/Kamera/Garten
aspect_ratio: 4/3
mic: false
# Streams in go2rtc
go2rtc_url: garten            # Haupt-Stream (Standard: Kamera-Entity)
go2rtc_url_sub: garten_sub    # Stream mit niedrigerer Qualität
go2rtc_server_lan: http://192.168.1.50:1984
go2rtc_ingress: /api/hassio_ingress/<DEIN_INGRESS_TOKEN>
# Erkennung & Gesichter
detection_badges: true
detection:
  person: binary_sensor.garten_person
  animal: binary_sensor.garten_tier
  vehicle: binary_sensor.garten_fahrzeug
  pre: 5
  post: 60
faces: true
faces_show_unknown: false
```

## 3. Alle Optionen

| Option | Standard | Bedeutung |
|---|---|---|
| `type` | – | Pflicht: `custom:the-boring-camera-card` (der alte Name `custom:portal-camera-card` funktioniert weiterhin) |
| `entity` | – | **Pflicht.** Kamera-Entity, z. B. `camera.haustuer` |
| `title` | – | Name der Karte (wird derzeit nur für Debug-Ausgaben genutzt) |
| `media_folder` | leer | Ordner mit den Aufnahmen im Medienbrowser, z. B. `media-source://media_source/local/Kamera/Haustuer`. Leer = nur Live-Bild |
| `aspect_ratio` | `16/9` | Seitenverhältnis des Videos: `16/9`, `4/3`, `1/1` oder `3/4` (hoch, z. B. Klingel) |
| `mic` | `false` | Push-to-Talk-Knopf anzeigen (Kamera mit Lautsprecher, Zugriff über HTTPS) |
| `go2rtc_url` | Kamera-Entity | Name des Hauptstreams in go2rtc |
| `go2rtc_url_sub` | leer | Zweiter Stream mit niedrigerer Qualität; normale Ansicht nutzt ihn, Vollbild den Hauptstream, dazu ein SD/HD-Umschalter |
| `go2rtc_server_lan` | `http://<HA-Host>:1984` | Adresse von go2rtc im Heimnetz, wenn go2rtc nicht auf dem HA-Host läuft |
| `go2rtc_ingress` | leer | Pfad zum go2rtc-Add-on über HA-Ingress für Zugriff von unterwegs |
| `go2rtc_server` | leer | Eigene externe Adresse von go2rtc, wenn kein Ingress genutzt wird |
| `go2rtc_token` | leer | Token für einen eigenen Reverse-Proxy vor go2rtc (nur bei externer Adresse) |
| `bitrate_entity` | leer | `input_number`, in die die Karte die gemessene Bitrate schreibt |
| `debug` | `false` | Diagnose-Meldungen in der Browser-Konsole (F12) |
| `detection_badges` | `true` | Person/Tier/Fahrzeug-Markierungen an den Vorschaubildern |
| `detection.person` / `.animal` / `.vehicle` | automatisch | Eigene Binärsensoren statt der automatisch gefundenen (Reolink); `none` schaltet einen Typ ab |
| `detection.pre` / `.post` | `5` / `60` | Zeitfenster in Sekunden vor bzw. nach Aufnahmebeginn, in dem eine Erkennung zur Aufnahme zählt |
| `faces` | `true` | Gesichts-Avatare anzeigen (`<Aufnahme>__face__<Name>.jpg`, z. B. von TheBoringFace) |
| `faces_show_unknown` | `true` | Auch unbekannte Gesichter zeigen |
| `face_tag` | `__face__` | Trennzeichen im Dateinamen der Gesichtsbilder |

## 4. Wie die Karte go2rtc erreicht

1. **Im Heimnetz** (HA über private IP, `.local` oder `localhost`): direkt über `go2rtc_server_lan`.
2. **Unterwegs mit `go2rtc_ingress`**: über den Ingress-Proxy von Home Assistant, keine eigene Freigabe nötig.
3. **Unterwegs ohne Ingress**: über `go2rtc_server`; falls nicht gesetzt, wird `go2rtc_server_lan` versucht.

Der Stream-Name in go2rtc muss dem Wert von `go2rtc_url` entsprechen (ohne Angabe: der Entity-ID, also z. B. `camera.haustuer`).

## 5. Ordnerstruktur der Aufnahmen

Die Karte erkennt drei Strukturen im `media_folder`:

- Ordner pro Tag: `2026-10-19/` oder `20261019/`
- Jahr/Monat/Tag: `2026/10/19/`
- Flach, wenn der Dateiname einen Zeitstempel enthält, z. B. `2026-10-19_14-30-05.mp4` oder `20261019_143005.mp4`

Gesichtsbilder liegen als `.jpg` im selben Ordner wie die Aufnahme.

## Häufige Probleme

- **Karte nicht gefunden ("Custom element doesn't exist")**: Ressource fehlt oder Browser-Cache. Ressource prüfen, dann Strg+Shift+R.
- **Kein Live-Bild**: Stream-Name in go2rtc und `go2rtc_url` prüfen, Adresse von `go2rtc_server_lan` prüfen, mit `debug: true` die Konsole ansehen.
- **Keine Aufnahmen**: `media_folder` prüfen (im Medienbrowser öffnen und Pfad kopieren) und die Ordnerstruktur wie oben.
- **Push-to-Talk reagiert nicht**: Home Assistant muss über HTTPS (oder `localhost`) aufgerufen werden.
