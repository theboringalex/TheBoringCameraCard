# The Boring Camera Card

*[English version](README.md)*

[![Repository zu HACS hinzufügen](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=theboringalex&repository=TheBoringCameraCard&category=plugin)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-FFDD00?logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/theboringalex)

Eine Kamera-Karte für dein Home-Assistant-Dashboard, die aussieht und sich
anfühlt wie die Kamera-Ansicht in Apple Home: flüssiges Live-Bild, ein Knopf
zum Sprechen über den Kamera-Lautsprecher, und eine Leiste mit vergangenen
Aufnahmen zum Durchblättern und Abspielen. Keine Programmierung, kein YAML
nötig — einfach deine Kamera aus einer Liste auswählen.

![Screenshot-Platzhalter](docs/screenshot.png)

## Was sie kann

- Zeigt das Live-Bild deiner Kamera (nutzt [go2rtc](https://github.com/AlexxIT/go2rtc), das die meisten Home-Assistant-Installationen bereits mitbringen — schnell, egal ob zuhause oder unterwegs)
- Ein Push-to-Talk-Knopf, falls deine Kamera Ton wiedergeben kann (die meisten Video-Türklingeln können das)
- Eine Thumbnail-Leiste und eine 24-Stunden-Timeline mit den vergangenen Aufnahmen deiner Kamera, automatisch aus Home Assistant geladen
- Lang drücken auf eine Aufnahme zum Herunterladen oder Löschen, oder einfach doppelt klicken/tippen zum sofortigen Herunterladen
- Wähle das Seitenverhältnis, das zu deiner Kamera passt: breit (16:9), klassisch (4:3), quadratisch (1:1) oder hoch (3:4, ideal für Türklingeln)
- Bietet deine Kamera zwei Videoqualitäten an (üblich bei Reolink-Kameras), kann die Karte die niedrigere nutzen, um Daten zu sparen, solange du nur kurz hinschaust — und wechselt automatisch zur vollen Qualität, sobald du ins Vollbild gehst
- Ein einfacher, visueller Einstellungsbildschirm — Formular ausfüllen, kein Code nötig

## Was du vorher brauchst

- Home Assistant mit dem [go2rtc-Add-on](https://github.com/AlexxIT/go2rtc) (oder einem eigenen go2rtc-Server), das das Live-Bild deiner Kamera bereits zeigt
- Deine Kamera bereits als Stream in go2rtc eingebunden (das go2rtc-Add-on macht das meist von selbst für Kameras, die es in Home Assistant schon kennt)
- *(Optional)* Ein Ordner mit den Aufnahmen dieser Kamera in der Medienbibliothek von Home Assistant, falls du Thumbnail-Leiste und Timeline nutzen willst. Ohne diesen Ordner funktioniert die Karte trotzdem — sie zeigt dann nur das Live-Bild.

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

1. Lade `the-boring-camera-card.js` aus dem [neuesten Release](../../releases) dieses Repositories herunter
2. Kopiere sie in den Ordner `www` innerhalb deines Home-Assistant-`config`-Ordners
3. Gehe zu **Einstellungen → Dashboards → „⋮"-Menü → Ressourcen → Ressource hinzufügen**
   - URL: `/local/the-boring-camera-card.js`
   - Ressourcentyp: **JavaScript-Modul**
4. Lade deinen Browser neu

## Eine Kamera zum Dashboard hinzufügen

1. Dashboard bearbeiten, dann **Karte hinzufügen → nach „The Boring Camera Card" suchen**
2. Formular ausfüllen:
   - **Kamera** — deine Kamera aus der Liste wählen
   - **Titel** — welcher Name angezeigt werden soll
   - **Aufzeichnungsordner** — optional; öffnet Home Assistants Medien-Browser, damit du den Aufnahmeordner deiner Kamera auswählen kannst
   - **Push-to-Talk** — aktivieren, falls deine Kamera Ton wiedergeben kann
   - **Seitenverhältnis** — das passende Videoformat aus der Liste wählen
3. Öffne **Erweitert** nur, falls etwas unten nicht zu deinem Setup passt

Das reicht für die meisten — keine YAML-Bearbeitung nötig.

### Erweiterte Einstellungen (nur bei Bedarf)

Die Karte geht davon aus, dass go2rtc auf demselben Gerät wie Home Assistant
läuft, auf dem üblichen Port 1984. Falls dein Setup anders aussieht, öffne
**Erweitert** in den Karteneinstellungen:

| Einstellung | Wann du sie brauchst |
|---|---|
| `go2rtc_url` | Der Stream deiner Kamera heißt in go2rtc anders als ihre Entity-ID |
| `go2rtc_url_sub` | Deine Kamera bietet in go2rtc einen zweiten, niedrig aufgelösten Videostream an (üblich bei Reolink-Kameras, oft `<kamera>_sub` genannt). Ist dieser gesetzt, nutzt die Karte ihn standardmäßig, um Daten zu sparen, und wechselt automatisch zur vollen Qualität, sobald du ins Vollbild gehst. Ein kleiner Button unterhalb der Timeline lässt dich außerdem jederzeit von Hand zwischen beiden umschalten. |
| `go2rtc_server_lan` | go2rtc läuft auf einem *anderen* Gerät als Home Assistant, in deinem Heimnetz |
| `go2rtc_ingress` | Du willst, dass der Zugriff von unterwegs über Home Assistants eigenen, eingebauten Proxy läuft, ohne dass du extra etwas einrichten musst. Diese Adresse findest du auf der Infoseite des go2rtc-Add-ons. |
| `go2rtc_server` | Eine eigene Webadresse für go2rtc, falls du die Option oben nicht nutzt |
| `go2rtc_token` | Dein eigener Reverse-Proxy vor go2rtc verlangt einen Zugangscode |
| `bitrate_entity` | Ein Zahlen-Helfer, in den die Karte die live gemessene Datenrate des Videos einträgt (praktisch, falls du das irgendwo anders im Dashboard anzeigen willst) |
| `debug` | Schreibt ausführliche Verbindungsinfos in die Browser-Konsole (F12 drücken) — hilfreich, wenn mal etwas nicht funktioniert und du sehen willst, warum |

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
