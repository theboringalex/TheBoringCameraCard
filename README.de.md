# The Boring Camera Card

*[English version](README.md)*

[![Repository zu HACS hinzufügen](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=theboringalex&repository=TheBoringCameraCard&category=integration)
[![Integration hinzufügen](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=theboringcameracard)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-FFDD00?logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/theboringalex)

Eine Kamera-Karte für dein Home-Assistant-Dashboard, die aussieht und sich anfühlt wie die
Kameraansicht in Apple Home: flüssiges Live-Bild, ein Knopf zum Sprechen über den Lautsprecher
der Kamera und eine Leiste mit vergangenen Aufnahmen, durch die du scrollen und die du antippen
kannst.

Deine Kameras richtest du **einmalig in den Einstellungen von Home Assistant** ein — Kamera für
Kamera, mit einem Formular, das das meiste selbst ausfüllt. Kein YAML, nichts zum Herumkopieren.
Danach wählst du im Dashboard-Editor nur noch eine Kamera aus.

<p align="center"><img src="docs/screenshot.jpg" width="320" alt="The Boring Camera Card in einem Home-Assistant-Dashboard"></p>

## Download

| | |
|---|---|
| **HACS (empfohlen)** | [Repository zu HACS hinzufügen](https://my.home-assistant.io/redirect/hacs_repository/?owner=theboringalex&repository=TheBoringCameraCard&category=integration) |
| **Manueller Download** | [Repository als ZIP](https://github.com/theboringalex/TheBoringCameraCard/archive/refs/heads/main.zip) · [Releases](https://github.com/theboringalex/TheBoringCameraCard/releases/latest) |
| **Integration einrichten** | [Integration zu Home Assistant hinzufügen](https://my.home-assistant.io/redirect/config_flow_start/?domain=theboringcameracard) (nach der Installation) |
| **Projekt unterstützen** | [Spendier mir einen Kaffee](https://www.buymeacoffee.com/theboringalex) |

## Was sie kann

- Live-Bild deiner Kamera über [go2rtc](https://github.com/AlexxIT/go2rtc), das Home Assistant schon mitbringt — schnell, zu Hause und unterwegs
- Push-to-Talk, wenn deine Kamera Ton wiedergeben kann (die meisten Video-Türklingeln können das)
- Eine Leiste mit Vorschaubildern vergangener Aufnahmen und festem „Heute"-Knopf; lang drücken zum Herunterladen oder Löschen
- Markierungen für Person / Tier / Fahrzeug an den Vorschaubildern (Reolink-KI-Erkennung) und runde Gesichts-Avatare (z. B. von TheBoringFace)
- Ein Stream mit niedrigerer Qualität in der normalen Ansicht spart Daten, im Vollbild gibt es volle Qualität
- Auto-Livestream: startet von selbst, sobald die Karte sichtbar wird, und stoppt, wenn sie verschwindet
- Formate passend zur Kamera: 16:9, 4:3, 1:1 oder hoch 3:4 für Türklingeln

## Installation

### Mit HACS (der einfache Weg)

1. Oben auf **„Repository zu HACS hinzufügen"** klicken, dann **Herunterladen**.
2. Home Assistant neu starten.
3. **Einstellungen → Geräte & Dienste → Integration hinzufügen → „The Boring Camera Card"**
   (oder oben auf *Integration hinzufügen* klicken).

Die Integration liefert die Karte selbst an deine Dashboards aus — du musst keine Dashboard-Ressource
eintragen (nur einmal den Browser neu laden).

### Von Hand (ohne HACS)

1. [Repository herunterladen](https://github.com/theboringalex/TheBoringCameraCard/archive/refs/heads/main.zip) und entpacken.
2. Den Ordner `custom_components/theboringcameracard` in den Ordner `custom_components` deines Home
   Assistant kopieren (anlegen, falls er fehlt).
3. Home Assistant neu starten und die Integration wie oben hinzufügen.

## Kameras einrichten

1. **Einstellungen → Geräte & Dienste → The Boring Camera Card → Kamera hinzufügen**
2. Kamera auswählen. Das ist das Einzige, was du wählen musst.
3. Die nächste Seite zeigt, was **automatisch gefunden** wurde, und lässt dich es korrigieren:

| Was | Wie es gefunden wird |
|---|---|
| Live-Stream | Der zur Kamera gehörende Stream in go2rtc (wird in go2rtc geprüft) |
| Stream mit niedrigerer Qualität | Der zweite Stream der Kamera (z. B. Reolink „Fluent"), spart Daten |
| Aufzeichnungsordner | Wird im Medienbrowser von Home Assistant über den Kameranamen gesucht; bei mehreren Treffern wählst du einen |
| Erkennung (Person / Tier / Fahrzeug) | Die KI-Sensoren am Gerät der Kamera (Reolink) — findet die Karte selbst |
| Türklingel | Wird am Namen/Modell erkannt: Push-to-Talk und das hohe 3:4-Format sind vorausgewählt |

**Kamera hinzufügen** wiederholst du für jede Kamera — eine Integration, beliebig viele Kameras.
Später änderst du eine Kamera über das „⋮"-Menü daneben → **Neu konfigurieren**.

Unter **Konfigurieren** der Integration stehen die optionalen go2rtc-Einstellungen (siehe unten);
die meisten brauchen sie nie.

## Karte zum Dashboard hinzufügen

Dashboard bearbeiten → **Karte hinzufügen → „The Boring Camera Card"** → eine der eingerichteten
Kameras auswählen. Fertig.

## go2rtc-Einstellungen (nur bei Bedarf)

Die Karte nimmt an, dass go2rtc auf demselben Gerät wie Home Assistant läuft, auf dem üblichen
Port 1984. Ist das bei dir anders, öffne die Integration und klicke auf **Konfigurieren**:

| Einstellung | Wann du sie brauchst |
|---|---|
| go2rtc-Server im Heimnetz | go2rtc läuft auf einem *anderen* Gerät als Home Assistant, z. B. `http://192.168.1.50:1984` |
| go2rtc-Ingress-Pfad | Fernzugriff über den eingebauten Proxy von Home Assistant (go2rtc-Add-on) |
| go2rtc externe Adresse | Eine eigene Web-Adresse für go2rtc, wenn du nicht zu Hause bist |
| go2rtc-Zugriffstoken | Dein eigener Reverse-Proxy vor go2rtc verlangt eins |

## Erkennung & Gesichter

- **Person / Tier / Fahrzeug:** Hat deine Kamera KI-Erkennung (z. B. Reolink), erscheint unten rechts an
  jedem Vorschaubild ein farbiger Punkt: blau = Person, orange = Tier, lila = Fahrzeug. Die Sensoren
  werden automatisch am Gerät der Kamera gefunden.
- **Gesichter:** Bilder neben einer Aufnahme mit dem Namen `<Aufnahme>__face__<Name>.jpg` (z. B. von
  TheBoringFace) erscheinen als runder Avatar oben rechts. Einschalten pro Kamera mit **Gesichter
  anzeigen** beim Hinzufügen oder Neu konfigurieren.

## Ohne die Integration (für Fortgeschrittene)

Die Karte funktioniert auch allein: `custom_components/theboringcameracard/frontend/the-boring-camera-card.js`
nach `config/www/` kopieren, als Dashboard-Ressource eintragen (`/local/the-boring-camera-card.js`, Typ
*JavaScript-Modul*) und im Dashboard-Editor das Formular der Karte ausfüllen (Kamera, Aufzeichnungsordner, …).
Der Abschnitt **Erweitert** kennt `go2rtc_url`, `go2rtc_url_sub`, `go2rtc_server_lan`, `go2rtc_ingress`,
`go2rtc_server`, `go2rtc_token`, `bitrate_entity` und `debug`.

## Ein paar Dinge, die gut zu wissen sind

- **Push-to-Talk braucht eine sichere Verbindung (HTTPS) oder „localhost".** Browser erlauben den
  Mikrofonzugriff nur auf sicheren Verbindungen — eine Browser-Regel, die die Karte nicht umgehen kann.
  Über reines `http://` reagiert der Knopf einfach nicht. Mach Home Assistant auch zu Hause per HTTPS
  erreichbar (z. B. mit einem lokalen DNS-Eintrag für deine übliche HTTPS-Adresse).
- Verbindungen über den eingebauten Proxy von Home Assistant (Ingress) können gelegentlich abbrechen — eine
  bekannte Eigenheit von Home Assistant. Ein eigener Reverse-Proxy vor go2rtc ist für den Zugriff von
  außerhalb meist zuverlässiger.

## Dieses Projekt unterstützen

Wenn die Karte dein Dashboard schöner gemacht hat, kannst du mir [einen Kaffee ausgeben](https://www.buymeacoffee.com/theboringalex) — völlig
freiwillig und immer willkommen.

## Einen Fehler gefunden, oder eine Idee?

Das ist ein kleines Projekt, das ich in meiner Freizeit baue — [Issues](https://github.com/theboringalex/TheBoringCameraCard/issues)
und Pull Requests sind willkommen, hab nur bitte etwas Geduld auf eine Antwort.

## Lizenz

MIT — siehe [LICENSE](LICENSE).
