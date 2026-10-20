# Gesichtserkennung mit TheBoringFace

*[English version](theboringface.md)*

Die Karte zeigt erkannte Personen als **runden Gesichts-Avatar oben rechts** am Vorschaubild jeder
Aufnahme. Erkannt werden die Gesichter von **[TheBoringFace](https://github.com/theboringalex/TheBoringFace)** –
einem kleinen Docker-Stack (CompreFace + Verwaltungsoberfläche), der neue Aufnahmen im Hintergrund prüft.

Die Karte selbst rechnet nichts: Sie liest nur kleine Bilder, die TheBoringFace **neben die Aufnahme** legt.
Dadurch braucht es weder eine API-Verbindung noch Zugangsdaten im Browser.

```
Aufnahme:      RecM01_20261020_101500.mp4
Gesicht:       RecM01_20261020_101500__face__Alex.jpg
Unbekannt:     RecM01_20261020_101500__face__Unbekannt_1.jpg
```

## Voraussetzungen

- Die Aufnahmen liegen in einem Ordner, den Home Assistant als **Medienquelle** sieht
  (z. B. `media-source://media_source/local/NAS_Kameraaufzeichnung/SkyNet-Doorbell`) und den du in der Karte als `media_folder` angegeben hast.
- Derselbe Ordner ist für TheBoringFace eingebunden – **mit Schreibrechten**, denn dort werden die Gesichts-Bilder abgelegt.
- Ein laufender TheBoringFace-Stack ([Anleitung](https://github.com/theboringalex/TheBoringFace#einrichtung)).

## Einrichtung

### 1. TheBoringFace starten

Den Stack nach der [Anleitung im TheBoringFace-Repository](https://github.com/theboringalex/TheBoringFace#einrichtung) starten,
CompreFace einmalig einrichten und den API-Key eintragen. Wichtig:

- `CAMERAS` = Ordnername der Kamera (z. B. `SkyNet-Doorbell`)
- Der Aufnahme-Ordner wird nach `/recordings` eingebunden (ohne `:ro`)
- `WRITE_SIDECARS: "true"` (Standard)

### 2. Personen anlegen

In der TheBoringFace-Oberfläche (`http://<host>:8099`) → **Personen** → Name eintragen und 3–5 Frontalfotos hochladen.
Gesichter, die noch keiner Person gehören, tauchen unter **Unbekannt** auf; dort kannst du sie mit einem Klick zuordnen –
die Karte zeigt danach den richtigen Namen.

### 3. Karte einstellen

Im Formular der Karte den Abschnitt **Erkennung & Gesichter** öffnen und **Gesichter (TheBoringFace) anzeigen** einschalten.
Wer keine Avatare unbekannter Personen sehen möchte, schaltet **Unbekannte Gesichter anzeigen** aus.

Dasselbe in YAML:

```yaml
type: custom:the-boring-camera-card
entity: camera.skynet_doorbell
media_folder: media-source://media_source/local/NAS_Kameraaufzeichnung/SkyNet-Doorbell
faces: true
faces_show_unknown: true
# face_tag: __face__   # nur ändern, wenn TheBoringFace mit anderem FACE_TAG läuft
```

### 4. Prüfen

1. In TheBoringFace unter **System** → *Neu scannen* die letzten 24 h auswerten lassen.
2. Im Medien-Browser von Home Assistant im Aufnahme-Ordner nach `__face__` suchen – dort müssen `.jpg`-Dateien liegen.
3. Karte neu laden (Strg+Shift+R). Aufnahmen mit erkannten Personen zeigen oben rechts einen Kreis; ein Tipp auf die Aufnahme zeigt den Namen in der Zeile unter dem Video.

## Wie die Dateien benannt sind

| Datei | Bedeutung |
|---|---|
| `<Aufnahme>__face__<Name>.jpg` | erkannte Person (Leerzeichen im Namen werden zu `_`, die Karte zeigt sie wieder als Leerzeichen) |
| `<Aufnahme>__face__Unbekannt_<n>.jpg` | Gesicht, das keiner Person zugeordnet werden konnte |

Ordnest du ein unbekanntes Gesicht in TheBoringFace zu, benennt TheBoringFace die Datei automatisch um.
Löschst du eine Aufnahme über das Kontextmenü der Karte (lang drücken), werden die zugehörigen Gesichts-Dateien mitgelöscht.
Verschwindet eine Aufnahme auf anderem Weg (z. B. durch die Aufbewahrungsregel deines NAS), räumt TheBoringFace die Gesichts-Dateien täglich selbst auf.

## Fehlersuche

| Problem | Ursache / Lösung |
|---|---|
| Kein Kreis an den Aufnahmen | Option *Gesichter* in der Karte aus? Liegen `__face__`-Dateien im Aufnahme-Ordner? Wenn nein: TheBoringFace hat keine Schreibrechte (Ordner nicht `:ro`, NAS-Benutzerrechte prüfen). |
| Dateien liegen im Ordner, aber nicht in der Karte | Der `media_folder` der Karte zeigt auf einen anderen Ordner als der, den TheBoringFace beschreibt. Beide müssen derselbe Ordner sein. |
| Alle Gesichter „Unbekannt" | Person mit mehr/besseren Fotos anlegen oder `SIMILARITY_MIN` in TheBoringFace leicht senken (z. B. 0.85). |
| Kreis erscheint erst nach einiger Zeit | TheBoringFace wartet, bis der FTP-Upload abgeschlossen ist (ca. 15 s) und arbeitet Aufnahmen nacheinander ab. |
| Neue Version der Karte lädt nicht | Browser-Cache leeren (Strg+Shift+R); in HACS prüfen, ob die Aktualisierung eingespielt ist. |

## Datenschutz

Gesichtsdaten sind biometrische Daten. Betreibe TheBoringFace nur im lokalen Netz, gib die Ports nicht ins Internet frei und
hinterlege nur Personen, die einverstanden sind.
