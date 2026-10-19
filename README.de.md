# The Boring Camera Card

*[English version](README.md)*

[![Repository zu HACS hinzufügen](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=theboringalex&repository=TheBoringCameraCard&category=plugin)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-FFDD00?logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/theboringalex)

Eine Kamera-Karte für dein Home-Assistant-Dashboard, die aussieht und sich
anfühlt wie die Kamera-Ansicht in Apple Home: flüssiges Live-Bild, ein Knopf
zum Sprechen über den Kamera-Lautsprecher, und eine Leiste mit vergangenen
Aufnahmen zum Durchblättern und Abspielen. Keine Programmierung, kein YAML
nötig — einfach deine Kamera aus einer Liste auswählen.

<p align="center"><img src="docs/screenshot.jpg" width="320" alt="The Boring Camera Card in einem Home-Assistant-Dashboard"></p>

## Download

| | |
|---|---|
| **HACS (empfohlen)** | [Repository zu HACS hinzufügen](https://my.home-assistant.io/redirect/hacs_repository/?owner=theboringalex&repository=TheBoringCameraCard&category=plugin) |
| **Manueller Download** | [the-boring-camera-card.js](https://raw.githubusercontent.com/theboringalex/TheBoringCameraCard/main/the-boring-camera-card.js) (Rechtsklick → *Link speichern unter…*) |
| **Ressource in Home Assistant eintragen** | [Dashboard-Ressourcen öffnen](https://my.home-assistant.io/redirect/lovelace_resources/) |
| **Projekt unterstützen** | [Spendier mir einen Kaffee](https://www.buymeacoffee.com/theboringalex) |

## Was sie kann

- Zeigt das Live-Bild deiner Kamera (nutzt [go2rtc](https://github.com/AlexxIT/go2rtc), das die meisten Home-Assistant-Installationen bereits mitbringen — schnell, egal ob zuhause oder unterwegs)
- Ein Push-to-Talk-Knopf, falls deine Kamera Ton wiedergeben kann (die meisten Video-Türklingeln können das)
- Eine Thumbnail-Leiste mit den vergangenen Aufnahmen und festem „Heute“-Button deiner Kamera, automatisch aus Home Assistant geladen
- Lang drücken auf eine Aufnahme zum Herunterladen oder Löschen, oder einfach doppelt klicken/tippen zum sofortigen Herunterladen
- Wähle das Seitenverhältnis, das zu deiner Kamera passt: breit (16:9), klassisch (4:3), quadratisch (1:1) oder hoch (3:4, ideal für Türklingeln)
- Bietet deine Kamera zwei Videoqualitäten an (üblich bei Reolink-Kameras), kann die Karte die niedrigere nutzen, um Daten zu sparen, solange du nur kurz hinschaust — und wechselt automatisch zur vollen Qualität, sobald du ins Vollbild gehst
- Ein **Auto-Livestream**-Schalter neben SD/HD (pro Kamera): an = das Live-Bild startet von selbst, sobald die Karte sichtbar ist (z. B. beim Öffnen eines Pop-ups), und stoppt beim Schließen; aus = es startet erst per Play-Knopf
- Ein **Einrichtungsassistent** im Karteneditor: Kamera wählen, alles andere wird automatisch gefunden — kein YAML

## Was du vorher brauchst

- Home Assistant mit dem [go2rtc-Add-on](https://github.com/AlexxIT/go2rtc) (oder einem eigenen go2rtc-Server), das das Live-Bild deiner Kamera bereits zeigt
- Deine Kamera bereits als Stream in go2rtc eingebunden (das go2rtc-Add-on macht das meist von selbst für Kameras, die es in Home Assistant schon kennt)
- *(Optional)* Ein Ordner mit den Aufnahmen dieser Kamera in der Medienbibliothek von Home Assistant, falls du die Thumbnail-Leiste nutzen willst. Ohne diesen Ordner funktioniert die Karte trotzdem — sie zeigt dann nur das Live-Bild.

## Installation

### Mit HACS (der einfache Weg)

1. Klicke oben auf dieser Seite auf den Button **"Repository zu HACS hinzufügen"** — er öffnet Home Assistant und trägt alles Nötige automatisch ein.
2. Klicke in HACS auf "Herunterladen", um die Karte zu installieren.
3. Lade deinen Browser neu (Strg+Shift+R bzw. Cmd+Shift+R auf dem Mac), damit Home Assistant die neue Karte erkennt.

Falls der Button aus irgendeinem Grund nicht funktioniert, geht es auch von
Hand: **HACS → „⋮"-Menü (oben rechts) → Benutzerdefinierte Repositories**,
die URL dieses Repositories eintragen, Kategorie **Dashboard** wählen, dann
in HACS nach „The Boring Camera Card" suchen und installieren.

### Von Hand (ohne HACS)

1. Lade [`the-boring-camera-card.js`](https://raw.githubusercontent.com/theboringalex/TheBoringCameraCard/main/the-boring-camera-card.js) herunter
2. Kopiere sie in den Ordner `www` innerhalb deines Home-Assistant-`config`-Ordners
3. Gehe zu **Einstellungen → Dashboards → „⋮"-Menü → Ressourcen → Ressource hinzufügen**
   - URL: `/local/the-boring-camera-card.js`
   - Ressourcentyp: **JavaScript-Modul**
4. Lade deinen Browser neu

## Eine Kamera zum Dashboard hinzufügen

1. Dashboard bearbeiten, dann **Karte hinzufügen → „The Boring Camera Card" suchen**
2. Deine **Kamera** im Dropdown auswählen. Mehr musst du nicht tun.

Der **Einrichtungsassistent** oben im Karteneditor sucht dann alles heraus und trägt es ein:

| Was | Wie es gefunden wird |
|---|---|
| Live-Stream | Der zur Kamera gehörende Stream in go2rtc (wird in go2rtc geprüft) |
| Stream mit niedrigerer Qualität | Der zweite Stream der Kamera (z. B. Reolink „Fluent"), spart Daten |
| Aufzeichnungsordner | Wird im Medienbrowser von Home Assistant über den Kameranamen gesucht; bei mehreren Treffern wählst du einen |
| Erkennung (Person / Tier / Fahrzeug) | Die KI-Sensoren am Gerät der Kamera (Reolink) |
| Türklingel | Wird am Namen/Modell erkannt: Push-to-Talk und das hohe 3:4-Format werden eingeschaltet |

Jede Zeile zeigt ein ✓, wenn etwas gefunden wurde. Was nicht gefunden wurde, trägst du
im Formular darunter von Hand ein (Titel, Aufzeichnungsordner, Push-to-Talk, Format).
Eigene Eingaben werden nie überschrieben. Mit **Erneut suchen** startet die Suche noch
einmal.

Das reicht den meisten — kein YAML nötig. Die Werte stehen im Dashboard und gelten damit
für alle Benutzer.

### Erweiterte Einstellungen (nur bei Bedarf)

Die Karte geht davon aus, dass go2rtc auf demselben Gerät wie Home Assistant
läuft, auf dem üblichen Port 1984. Falls dein Setup anders aussieht, öffne
**Erweitert** in den Karteneinstellungen:

| Einstellung | Wann du sie brauchst |
|---|---|
| `go2rtc_url` | Der Stream deiner Kamera heißt in go2rtc anders als ihre Entity-ID |
| `go2rtc_url_sub` | Deine Kamera bietet in go2rtc einen zweiten, niedrig aufgelösten Videostream an (üblich bei Reolink-Kameras, oft `<kamera>_sub` genannt). Ist dieser gesetzt, nutzt die Karte ihn standardmäßig, um Daten zu sparen, und wechselt automatisch zur vollen Qualität, sobald du ins Vollbild gehst. Ein kleiner Button unterhalb der Vorschaubilder lässt dich außerdem jederzeit von Hand zwischen beiden umschalten. |
| `go2rtc_server_lan` | go2rtc läuft auf einem *anderen* Gerät als Home Assistant, in deinem Heimnetz |
| `go2rtc_ingress` | Du willst, dass der Zugriff von unterwegs über Home Assistants eigenen, eingebauten Proxy läuft, ohne dass du extra etwas einrichten musst. Diese Adresse findest du auf der Infoseite des go2rtc-Add-ons. |
| `go2rtc_server` | Eine eigene Webadresse für go2rtc, falls du die Option oben nicht nutzt |
| `go2rtc_token` | Dein eigener Reverse-Proxy vor go2rtc verlangt einen Zugangscode |
| `bitrate_entity` | Ein Zahlen-Helfer, in den die Karte die live gemessene Datenrate des Videos einträgt (praktisch, falls du das irgendwo anders im Dashboard anzeigen willst) |
| `debug` | Schreibt ausführliche Verbindungsinfos in die Browser-Konsole (F12 drücken) — hilfreich, wenn mal etwas nicht funktioniert und du sehen willst, warum |

## Erkennung & Gesichter

- **Person / Tier / Fahrzeug:** Hat deine Kamera eine KI-Erkennung (z. B. Reolink),
  zeigt die Karte unten rechts am Vorschaubild einen farbigen Kreis: blau = Person,
  orange = Tier, lila = Fahrzeug. Die Sensoren werden automatisch gefunden. Falls nicht,
  trägst du sie selbst ein:

  ```yaml
  detection:
    person: binary_sensor.klingel_person
    animal: binary_sensor.klingel_tier
    vehicle: binary_sensor.klingel_fahrzeug
    pre: 5     # Sekunden vor Aufnahmebeginn (Standard 5)
    post: 60   # Sekunden danach (Standard 60, endet spätestens bei der nächsten Aufnahme)
  ```

  Ausschalten mit `detection_badges: false`.
- **Gesichter:** Liegen neben einer Aufnahme Bilder nach dem Muster
  `<aufnahme>__face__<Name>.jpg` (z. B. von TheBoringFace), erscheinen sie als runder
  Avatar oben rechts. `faces: false` schaltet das ab, `faces_show_unknown: false` blendet
  unbekannte Gesichter aus, `face_tag` ändert die Kennung.

## Einstellungsseite (optional)

Für viele Kameras: eine Übersicht für go2rtc-Vorgaben, den Aufzeichnungsordner und alle
Kameras. Der Einrichtungsassistent übernimmt die go2rtc-Vorgaben von hier. Für
Fortgeschrittene gibt es dort auch fertiges YAML und eine `go2rtc.yaml`-Vorlage — nichts
davon ist nötig. Einbinden als Seitenleisten-Eintrag über `panel_custom` (Name
`the-boring-camera-settings`, `module_url:
/hacsfiles/TheBoringCameraCard/the-boring-camera-card.js`) oder die Karte
`type: custom:the-boring-camera-settings` auf einem eigenen Dashboard mit Panel-Ansicht.

## Ein paar Dinge, die gut zu wissen sind

- **Push-to-Talk braucht eine sichere Verbindung (HTTPS), oder „localhost".**
  Browser erlauben Mikrofonzugriff nur über sichere Verbindungen — das ist
  eine Browser-Regel, die diese Karte nicht umgehen kann. Greifst du zuhause
  über reines `http://` auf Home Assistant zu, reagiert der Push-to-Talk-
  Button einfach nicht, ohne Fehlermeldung. Die Lösung: Home Assistant auch
  zuhause per HTTPS erreichbar machen (z. B. ein lokaler DNS-Eintrag, der
  deine übliche HTTPS-Adresse auch im Heimnetz auf die richtige Adresse zeigt).
- Verbindungen über Home Assistants eingebauten Proxy (`go2rtc_ingress`)
  können gelegentlich abbrechen — das ist eine bekannte Eigenheit von Home
  Assistant selbst, nichts Spezifisches an dieser Karte. Ein eigener
  Reverse-Proxy vor go2rtc ist für den Zugriff von unterwegs meist
  zuverlässiger.

## Dieses Projekt unterstützen

Wenn dir diese Karte dein Dashboard schöner gemacht hat und du dich bedanken
möchtest, kannst du mir [einen Kaffee ausgeben](https://www.buymeacoffee.com/theboringalex)
— völlig freiwillig, aber immer eine Freude.

## Einen Fehler gefunden, oder eine Idee?

Das ist ein kleines Nebenprojekt in meiner Freizeit — Issues und Pull
Requests sind willkommen, bitte einfach etwas Geduld bei der Antwort haben.

## Lizenz

MIT — siehe [LICENSE](LICENSE).
