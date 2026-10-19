// the-boring-camera-card.js
// Home-Assistant Custom Lovelace Card im Stil der Apple-Home-Kamera-Ansicht.
// Live-Stream direkt über go2rtc (eigene WebRTC-Signalisierung, kein Fremd-Card-Wrapper
// mehr), dezenter Play/Pause-Schalter, Ton/Vollbild-Pille, Push2Talk-Button, waagerechte
// Thumbnail-Leiste mit selbst erzeugten Vorschaubildern (lang drücken = Kontextmenü mit
// Download/Löschen) mit festem Tages-Button links davor. Aufzeichnungen aus media_source.
//
// Lädt sein eigenes Lit unabhängig von HA-internen Komponenten (deren Ladezeitpunkt
// je nach View-Typ variiert, z.B. bei "sections"-Views), damit die Karte auch dann
// zuverlässig registriert wird, wenn interne HA-Bausteine wie hui-view noch nicht
// existieren.
let LitElement, html, css;
try {
  ({ LitElement, html, css } = await import('https://cdn.jsdelivr.net/npm/lit@3/+esm'));
} catch (e) {
  const base =
    customElements.get('home-assistant-main') ||
    customElements.get('hui-view') ||
    customElements.get('hui-masonry-view') ||
    customElements.get('ha-panel-lovelace') ||
    customElements.get('hui-card');
  if (!base) {
    console.error('the-boring-camera-card: konnte LitElement nicht laden', e);
    throw e;
  }
  LitElement = Object.getPrototypeOf(base);
  html = LitElement.prototype.html;
  css = LitElement.prototype.css;
}

if (!customElements.get('the-boring-camera-card')) {
  const DATE_FOLDER_RE = /^(\d{4})-?(\d{2})-?(\d{2})$/;
  const TS_RE_1 = /(\d{4})-(\d{2})-(\d{2})[ _T](\d{2}):?(\d{2}):?(\d{2})/;
  const TS_RE_2 = /(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/;
  const THUMB_W = 176;
  const THUMB_H = 126;
  const THUMB_CACHE_MAX = 60;
  const LONG_PRESS_MS = 550;
  const CARD_VERSION = '1.0.0';

  // ---------- Objekterkennung (Person / Tier / Fahrzeug) ----------
  // Quelle sind die Binärsensoren der Reolink-Integration (KI-Erkennung der Kamera).
  // Die Karte liest deren Verlauf für den angezeigten Tag und ordnet jede Aufnahme den
  // Erkennungen zu, die in ihrem Zeitfenster aktiv waren. Keine Dauerlast: eine
  // History-Abfrage pro Tageswechsel.
  const DET_TYPES = ['person', 'animal', 'vehicle'];
  const DET_META = {
    person: { icon: 'mdi:walk', label: 'Person', color: '#0a84ff' },
    animal: { icon: 'mdi:paw', label: 'Tier', color: '#ff9f0a' },
    vehicle: { icon: 'mdi:car', label: 'Fahrzeug', color: '#bf5af2' },
  };
  // translation_key der Reolink-Integration (sprachunabhängig) ...
  const DET_KEYS = {
    person: ['person', 'people'],
    animal: ['pet', 'animal', 'dog_cat'],
    vehicle: ['vehicle'],
  };
  // ... und als Rückfall die Endung der Entity-ID (deutsch/englisch).
  const DET_ID_RE = {
    person: /_(person|personen|people)(_\d+)?$/,
    animal: /_(pet|animal|tier|haustier|dog_cat|hund_katze)(_\d+)?$/,
    vehicle: /_(vehicle|fahrzeug)(_\d+)?$/,
  };
  const DET_STORE_MAX = 3000;
  const FACE_CACHE_MAX = 300;
  const DEFAULT_FACE_TAG = '__face__';
  const FACE_PX = 64;

  // Sucht die Erkennungs-Sensoren, die zum selben Gerät wie die Kamera-Entität gehören.
  function findDetectionEntities(hass, cameraEntityId) {
    const out = {};
    const ents = (hass && hass.entities) || {};
    const devId = ents[cameraEntityId] && ents[cameraEntityId].device_id;
    if (!devId) return out;
    const cands = Object.values(ents).filter(
      (e) => e.device_id === devId && (e.entity_id || '').startsWith('binary_sensor.')
    );
    for (const t of DET_TYPES) {
      const hit =
        cands.find((e) => DET_KEYS[t].includes(e.translation_key)) ||
        cands.find((e) => DET_ID_RE[t].test(e.entity_id));
      if (hit) out[t] = hit.entity_id;
    }
    return out;
  }

  // History-Einträge (kompaktes oder volles Format) -> [[start, ende], ...] in Sekunden.
  function toIntervals(list, endTs) {
    const out = [];
    let on = null;
    for (const e of list || []) {
      const st = e.s !== undefined ? e.s : e.state;
      const t =
        e.lu !== undefined ? e.lu : e.lc !== undefined ? e.lc : Date.parse(e.last_updated || e.last_changed) / 1000;
      if (!isFinite(t)) continue;
      if (st === 'on') {
        if (on === null) on = t;
      } else if (on !== null) {
        out.push([on, t]);
        on = null;
      }
    }
    if (on !== null) out.push([on, endTs]);
    return out;
  }

  function clipEpoch(ts) {
    return new Date(`${ts.date}T${pad(ts.h)}:${pad(ts.m)}:${pad(ts.s)}`).getTime() / 1000;
  }

  function stripExt(name) {
    return String(name || '').replace(/\.[a-z0-9]{2,4}$/i, '');
  }

  function numOr(v, d) {
    const n = Number(v);
    return v === undefined || v === null || v === '' || !isFinite(n) ? d : n;
  }
  // Kein fest einprogrammierter go2rtc-Server mehr (das war früher eine private LAN-IP
  // und funktioniert bei niemand anderem) — Standardannahme ist stattdessen "go2rtc läuft
  // auf demselben Host wie Home Assistant, Standardport 1984" (host_network-Modus des
  // go2rtc-Add-ons, mit Abstand die häufigste Installationsart). Wer eine andere
  // Topologie hat, überschreibt das im Editor über "go2rtc-Server (LAN)".
  function defaultGo2rtcServer() {
    return `http://${location.hostname}:1984`;
  }

  // Erkennt, ob der Browser gerade im lokalen Netzwerk auf HA zugreift (private
  // IP-Range oder .local-Hostname) statt über die externe Domain. Nur dann macht
  // eine direkte LAN-Verbindung zu go2rtc Sinn — über die externe Domain (Reverse-
  // Proxy) wäre das ein unnötiger Umweg übers Internet und spürbar langsamer beim
  // Verbindungsaufbau.
  function isLikelyLan() {
    const h = location.hostname;
    return (
      h === 'localhost' ||
      /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(h) ||
      h.endsWith('.local')
    );
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function parseTs(str) {
    if (!str) return null;
    let m = TS_RE_1.exec(str) || TS_RE_2.exec(str);
    if (!m) return null;
    const [, y, mo, d, h, mi, s] = m;
    const date = `${y}-${mo}-${d}`;
    const seconds = (+h) * 3600 + (+mi) * 60 + (+s);
    return { date, h: +h, m: +mi, s: +s, seconds, label: `${h}:${mi}` };
  }

  function normDate(str) {
    const m = DATE_FOLDER_RE.exec((str || '').trim());
    if (!m) return null;
    return `${m[1]}-${m[2]}-${m[3]}`;
  }

  function fmtDayLabel(dateStr) {
    if (!dateStr || dateStr === 'unbekannt') return '?';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    const today = new Date();
    const yest = new Date();
    yest.setDate(today.getDate() - 1);
    const sameDay = (a, b) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
    if (sameDay(d, today)) return 'Heute';
    if (sameDay(d, yest)) return 'Gestern';
    return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
  }

  function fmtBitrate(kbps) {
    if (kbps === null || kbps === undefined) return 'Live';
    if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbit/s`;
    return `${kbps} kbit/s`;
  }

  class TheBoringCameraCard extends LitElement {
    static get properties() {
      return {
        _days: { state: true },
        _day: { state: true },
        _clips: { state: true },
        _mode: { state: true },
        _selected: { state: true },
        _loading: { state: true },
        _error: { state: true },
        _muted: { state: true },
        _playing: { state: true },
        _progress: { state: true },
        _liveActive: { state: true },
        _liveFrozen: { state: true },
        _connecting: { state: true },
        _connState: { state: true },
        _isFullscreen: { state: true },
        _bitrateKbps: { state: true },
        _contextClip: { state: true },
        _confirmingDelete: { state: true },
        _thumbTick: { state: true },
        _dayPickerOpen: { state: true },
        _pttActive: { state: true },
        _pttAvailable: { state: true },
        _streamOverride: { state: true },
        _autoLive: { state: true },
        _cameraWait: { state: true },
        _cameraError: { state: true },
      };
    }

    // Zwei Betriebsarten:
    //  1) Mit der Integration "The Boring Camera Card": die Karte bekommt nur `camera: <id>`
    //     und holt sich alle Einstellungen (Streams, Ordner, Klingel ...) per WebSocket.
    //  2) Ohne Integration: wie bisher mit `entity:` und den übrigen Optionen.
    setConfig(config) {
      if (!config.entity && config.camera) {
        this._pendingCfg = config;
        this._cameraWait = true;
        this._cameraError = '';
        this._resolving = false;
        this.config = undefined;
        this.requestUpdate();
        if (this._hass) this._resolveCamera();
        return;
      }
      this._cameraWait = false;
      this._applyConfig(config);
    }

    async _resolveCamera() {
      if (this._resolving || !this._cameraWait || !this._hass) return;
      this._resolving = true;
      const pending = this._pendingCfg;
      try {
        const list = await this._hass.callWS({ type: 'theboringcameracard/cameras' });
        if (!this._cameraWait || this._pendingCfg !== pending) return;
        const cam = (list || []).find((c) => c.id === pending.camera || c.entity === pending.camera);
        if (!cam) {
          this._cameraError =
            'Kamera nicht gefunden. Unter Einstellungen → Geräte & Dienste → The Boring Camera Card einrichten und hier neu auswählen.';
        } else {
          // Eigene Werte in der Karte (z. B. ein anderer Titel) haben Vorrang.
          const overrides = {};
          for (const [k, v] of Object.entries(pending)) {
            if (k !== 'camera' && k !== 'type' && v !== '' && v !== undefined && v !== null) overrides[k] = v;
          }
          this._cameraWait = false;
          this._applyConfig(Object.assign({}, cam.config, overrides));
          this._booted = true;
          this._loadDays();
          if (this.isConnected) {
            this._loadThumbCacheFromStorage();
            this._loadSideCaches();
            this._startAutoWatch();
          }
        }
      } catch (e) {
        this._cameraError =
          'Die Integration „The Boring Camera Card" ist nicht eingerichtet oder nicht erreichbar (' + (e.message || e) + ').';
      } finally {
        this._resolving = false;
        this.requestUpdate();
      }
    }

    _applyConfig(config) {
      if (!config.entity) {
        throw new Error('the-boring-camera-card: "entity" (Kamera-Entität) ist erforderlich');
      }
      this.config = config;
      // Der HA-Medien-Selector im Editor liefert beim Auswählen eines Ordners ein Objekt
      // ({media_content_id, media_content_type, ...}) statt eines reinen Strings - hier
      // auf einen einfachen String normalisieren, damit der Rest der Karte (und Configs,
      // die media_folder direkt als String in YAML schreiben) unverändert funktioniert.
      const mf = config.media_folder;
      this._mediaFolder = mf && typeof mf === 'object' ? mf.media_content_id || '' : mf || '';
      this._days = [];
      this._day = null;
      this._clips = [];
      this._mode = 'live';
      this._selected = null;
      this._loading = false;
      this._error = null;
      this._muted = false;
      this._playing = false;
      this._progress = 0;
      this._liveActive = false;
      this._liveFrozen = false;
      this._connecting = false;
      this._connState = 'idle';
      this._isFullscreen = false;
      this._bitrateKbps = null;
      this._lastPushedBitrate = null;
      this._contextClip = null;
      this._confirmingDelete = false;
      this._thumbTick = 0;
      this._dayPickerOpen = false;
      this._pttActive = false;
      this._pttAvailable = false;
      // null = automatisch (Substream normal, Hauptstream im Vollbild) - 'main'/'sub',
      // sobald der Nutzer per Hand über den Button unter den Vorschaubildern umgeschaltet hat.
      this._streamOverride = null;
      this._autoLive = this._loadAutoLive();
      this._autoArmed = true;
      this._offscreenTicks = 0;
      this._byDate = new Map();
      this._folderMode = 'flat'; // 'day' | 'nested' | 'flat'
      this._booted = false;
      this._debug = !!config.debug;
      this._storageKey = 'the-boring-camera-card-thumbs2:' + (this._mediaFolder || config.entity);
      this._thumbCache = new Map();
      this._thumbGenerating = new Set();
      this._rootImages = [];
      this._faceCache = new Map();
      this._faceLoading = new Set();
      this._detStore = new Map();
      this._detSeq = 0;
      this._bitrateInterval = null;
      this._longPressTimer = null;
      this._longPressFired = false;
      this._pc = null;
      this._ws = null;
      this._micStream = null;
      this._micTrack = null;
    }

    connectedCallback() {
      super.connectedCallback();
      this._loadThumbCacheFromStorage();
      this._loadSideCaches();
      if (this._liveActive && !this._pc) {
        this._liveActive = false;
        this._liveFrozen = false;
        this._autoArmed = true;
      }
      this._startAutoWatch();
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      if (this._isFullscreen) document.body.style.overflow = '';
      this._stopVisibilityWatch();
      this._stopAutoWatch();
      this._disconnectLive();
      clearTimeout(this._longPressTimer);
    }

    set hass(hass) {
      this._hass = hass;
      if (this._cameraWait) {
        this._resolveCamera();
        this.requestUpdate();
        return;
      }
      if (!this._booted) {
        this._booted = true;
        this._loadDays();
      }
      this.requestUpdate();
    }

    get hass() {
      return this._hass;
    }

    getCardSize() {
      return 9;
    }

    // Einrichtungsassistent: eigener Editor mit automatischer Suche (siehe unten).
    static getConfigElement() {
      return document.createElement('the-boring-camera-card-editor');
    }

    static async getStubConfig(hass) {
      try {
        const list = await hass.callWS({ type: 'theboringcameracard/cameras' });
        if (list && list.length) return { camera: list[0].id };
      } catch (e) {}
      return TheBoringCameraCard._legacyStub();
    }

    static _legacyStub() {
      return {
        entity: '',
        title: 'Kamera',
        media_folder: '',
        mic: false,
        aspect_ratio: '16/9',
        detection_badges: true,
        faces: true,
        faces_show_unknown: true,
      };
    }

    // ---------- Visueller Config-Editor ----------
    // HA rendert daraus automatisch ein ha-form mit den Standard-Selektoren (Entity-
    // Dropdown, Medien-Browser-Dialog, Schalter, Auswahlliste) - Dieses Schema nutzt auch der
    // Einrichtungsassistent (the-boring-camera-card-editor) unter dem Auto-Setup. "advanced"-Felder werden als
    // einklappbarer Abschnitt dargestellt.
    static getConfigForm() {
      const schema = [
        { name: 'entity', required: true, selector: { entity: { domain: 'camera' } } },
        { name: 'title', selector: { text: {} } },
        { name: 'media_folder', selector: { media: {} } },
        { name: 'mic', selector: { boolean: {} } },
        {
          name: 'aspect_ratio',
          selector: {
            select: {
              mode: 'dropdown',
              options: [
                { value: '16/9', label: '16:9 (breit)' },
                { value: '4/3', label: '4:3' },
                { value: '1/1', label: '1:1 (quadratisch)' },
                { value: '3/4', label: '3:4 (hoch, z.B. Klingel)' },
              ],
            },
          },
        },
        {
          name: 'recognition',
          type: 'expandable',
          title: 'Erkennung & Gesichter',
          flatten: true,
          schema: [
            { name: 'detection_badges', selector: { boolean: {} } },
            {
              name: 'detection',
              type: 'grid',
              schema: [
                { name: 'person', selector: { entity: { domain: 'binary_sensor' } } },
                { name: 'animal', selector: { entity: { domain: 'binary_sensor' } } },
                { name: 'vehicle', selector: { entity: { domain: 'binary_sensor' } } },
                { name: 'pre', selector: { number: { min: 0, max: 60, mode: 'box', unit_of_measurement: 's' } } },
                { name: 'post', selector: { number: { min: 5, max: 600, mode: 'box', unit_of_measurement: 's' } } },
              ],
            },
            { name: 'faces', selector: { boolean: {} } },
            { name: 'faces_show_unknown', selector: { boolean: {} } },
          ],
        },
        {
          name: 'advanced',
          type: 'expandable',
          title: 'Erweitert',
          flatten: true,
          schema: [
            { name: 'go2rtc_url', selector: { text: {} } },
            { name: 'go2rtc_url_sub', selector: { text: {} } },
            { name: 'go2rtc_server_lan', selector: { text: {} } },
            { name: 'go2rtc_ingress', selector: { text: {} } },
            { name: 'go2rtc_server', selector: { text: {} } },
            { name: 'go2rtc_token', selector: { text: { type: 'password' } } },
            { name: 'bitrate_entity', selector: { entity: { domain: 'input_number' } } },
            { name: 'debug', selector: { boolean: {} } },
          ],
        },
      ];
      const labels = {
        entity: 'Kamera',
        title: 'Titel',
        media_folder: 'Aufzeichnungsordner (media_source)',
        mic: 'Push-to-Talk (Mikrofon) aktivieren',
        aspect_ratio: 'Seitenverhältnis des Videos',
        advanced: 'Erweitert',
        go2rtc_url: 'go2rtc-Stream-Name (Hauptstream)',
        go2rtc_url_sub: 'go2rtc-Substream-Name (optional, z.B. Reolink)',
        go2rtc_server_lan: 'go2rtc-Server (LAN, z.B. http://192.168.1.50:1984)',
        go2rtc_ingress: 'go2rtc-Ingress-Pfad (für Fernzugriff)',
        go2rtc_server: 'go2rtc-Server (externe Adresse, Fallback)',
        go2rtc_token: 'go2rtc-Zugriffstoken (falls per Reverse-Proxy abgesichert)',
        bitrate_entity: 'Helfer-Entity für Live-Bitrate (input_number)',
        debug: 'Debug-Logging in der Browser-Konsole',
        detection_badges: 'Erkennung (Person/Tier/Fahrzeug) an den Vorschaubildern',
        person: 'Sensor Person (leer = automatisch)',
        animal: 'Sensor Tier (leer = automatisch)',
        vehicle: 'Sensor Fahrzeug (leer = automatisch)',
        pre: 'Zeitfenster vor Aufnahmebeginn',
        post: 'Zeitfenster nach Aufnahmebeginn',
        faces: 'Gesichter (TheBoringFace) anzeigen',
        faces_show_unknown: 'Unbekannte Gesichter anzeigen',
      };
      const helpers = {
        entity: 'Die Kamera-Entität, deren Live-Bild und Aufzeichnungen angezeigt werden sollen.',
        title: 'Wird in der Karte als Name angezeigt.',
        media_folder:
          'Ordner mit den Aufzeichnungen dieser Kamera. Über den Medien-Browser auswählen - leer lassen, wenn es keine lokalen Aufzeichnungen gibt (dann nur Live-Bild, keine Vorschaubilder).',
        mic: 'Zeigt einen Push-to-Talk-Button an, mit dem über die Kamera gesprochen werden kann (Kamera muss Audio-Rückkanal unterstützen).',
        aspect_ratio: 'Wie hoch/breit das Videofenster dargestellt wird. "3:4" eignet sich gut für Türklingeln.',
        go2rtc_url: 'Name des Streams in go2rtc, falls er vom Entity-Namen abweicht. Standard: Entity-ID.',
        go2rtc_url_sub:
          'Name eines separaten Substreams in go2rtc (niedrigere Auflösung), z.B. bei Reolink-Kameras oft "<kamera>_sub". Wenn gesetzt, verbindet sich die Karte im Normalbetrieb mit diesem Substream, um Bandbreite und Rechenleistung zu sparen, und wechselt automatisch zum Hauptstream (oben), sobald das Vollbild geöffnet wird. Zusätzlich erscheint unter den Vorschaubildern ein kleiner Button, mit dem manuell jederzeit zwischen Haupt- und Substream umgeschaltet werden kann. Leer lassen, wenn deine Kamera keinen Substream anbietet.',
        go2rtc_server_lan:
          'Nur nötig, wenn go2rtc NICHT auf demselben Host wie Home Assistant läuft. Standard: gleicher Host, Port 1984.',
        go2rtc_ingress:
          'Relativer Pfad zum go2rtc-Add-on über HA-Ingress, für Zugriff von unterwegs ohne eigenen Reverse-Proxy. In den go2rtc-Add-on-Infos zu finden.',
        go2rtc_server: 'Alternative externe go2rtc-Adresse, falls kein Ingress verwendet wird.',
        go2rtc_token: 'Nur nötig, falls ein eigener Reverse-Proxy vor go2rtc ein Token verlangt.',
        bitrate_entity:
          'Optionaler input_number-Helfer, in den die Karte die live gemessene Bitrate schreibt (z.B. für eine Anzeige-Pille außerhalb der Karte).',
        debug: 'Schreibt detaillierte Diagnose-Meldungen in die Browser-Konsole (F12).',
        detection_badges:
          'Zeigt unten rechts am Vorschaubild einen Kreis für Person, Tier oder Fahrzeug. Die Sensoren der Reolink-Integration werden automatisch gefunden.',
        faces: 'Zeigt oben rechts erkannte Gesichter als Kreis (Dateien <clip>__face__<Name>.jpg neben der Aufnahme).',
      };
      return {
        schema,
        assertConfig: (config) => {
          if (!config.entity) {
            throw new Error('Bitte eine Kamera auswählen.');
          }
        },
        computeLabel: (s) => labels[s.name] || s.name,
        computeHelper: (s) => helpers[s.name] || '',
      };
    }

    async _browse(id) {
      return this._hass.callWS({ type: 'media_source/browse_media', media_content_id: id });
    }

    async _resolve(id) {
      return this._hass.callWS({ type: 'media_source/resolve_media', media_content_id: id });
    }

    _log(...args) {
      if (this._debug) console.debug('[the-boring-camera-card]', this.config?.title || this.config?.entity, ...args);
    }

    // Nur Videos zeigen, Standbilder/Snapshots ausblenden.
    _isImage(c) {
      const ct = (c.media_content_type || '').toLowerCase();
      return c.media_class === 'image' || ct.startsWith('image/');
    }

    // ---------- Ordner-/Tages-Erkennung (media_source) ----------

    async _collectNestedDays(yearDirs) {
      const numDirs = (dirs, re) => dirs.filter((d) => re.test((d.title || '').trim()));
      const sortDesc = (arr) =>
        [...arr].sort((a, b) => (b.title || '').localeCompare(a.title || '', undefined, { numeric: true }));

      const years = sortDesc(numDirs(yearDirs, /^\d{4}$/)).slice(0, 2);
      this._log('Jahres-Ordner', years.map((y) => y.title));

      let monthEntries = [];
      for (const y of years) {
        const res = await this._browse(y.media_content_id);
        const months = numDirs((res.children || []).filter((c) => c.media_class === 'directory'), /^\d{1,2}$/);
        for (const m of months) monthEntries.push({ year: y.title.trim(), month: m.title.trim(), item: m });
      }
      monthEntries.sort((a, b) => `${b.year}${pad(+b.month)}`.localeCompare(`${a.year}${pad(+a.month)}`));
      monthEntries = monthEntries.slice(0, 3);
      this._log('Monats-Ordner', monthEntries.map((m) => `${m.year}-${pad(+m.month)}`));

      let dayLeaves = [];
      for (const m of monthEntries) {
        const res = await this._browse(m.item.media_content_id);
        const days = numDirs((res.children || []).filter((c) => c.media_class === 'directory'), /^\d{1,2}$/);
        for (const d of days) {
          dayLeaves.push({ id: d.media_content_id, date: `${m.year}-${pad(+m.month)}-${pad(+d.title.trim())}` });
        }
      }
      dayLeaves.sort((a, b) => b.date.localeCompare(a.date));
      this._log('Tages-Ordner gefunden', dayLeaves.length);
      return dayLeaves.slice(0, 30);
    }

    async _loadDays() {
      if (!this._mediaFolder) {
        this._error = 'Kein "media_folder" (media_source Pfad) konfiguriert.';
        return;
      }
      this._loading = true;
      this._error = null;
      this.requestUpdate();
      try {
        const root = await this._browse(this._mediaFolder);
        const children = root.children || [];
        this._log('Root-Inhalt', children.map((c) => `${c.title} (${c.media_class})`));
        const rootDirs = children.filter((c) => c.media_class === 'directory');
        const rootFiles = children.filter((c) => c.media_class !== 'directory');
        const dateDirs = rootDirs.filter((c) => normDate(c.title));

        if (dateDirs.length) {
          this._folderMode = 'day';
          this._days = dateDirs
            .map((c) => ({ id: c.media_content_id, date: normDate(c.title) }))
            .sort((a, b) => b.date.localeCompare(a.date));
        } else if (rootDirs.length && rootDirs.every((d) => /^\d{4}$/.test((d.title || '').trim()))) {
          this._folderMode = 'nested';
          this._days = await this._collectNestedDays(rootDirs);
        } else {
          this._folderMode = 'flat';
          this._rootImages = rootFiles.filter((c) => this._isImage(c));
          const byDate = new Map();
          for (const c of rootFiles.filter((c) => !this._isImage(c))) {
            const ts = parseTs(c.title) || parseTs(c.media_content_id);
            const d = ts ? ts.date : 'unbekannt';
            if (!byDate.has(d)) byDate.set(d, []);
            byDate.get(d).push({ item: c, ts });
          }
          this._byDate = byDate;
          this._days = [...byDate.keys()]
            .filter((d) => d !== 'unbekannt')
            .sort((a, b) => b.localeCompare(a))
            .map((d) => ({ id: d, date: d }));
        }
        if (this._days.length) {
          await this._selectDay(this._days[0]);
        } else {
          this._clips = [];
          if (!this._error) {
            this._error =
              'Keine Aufzeichnungen im media_source-Pfad gefunden. Prüfe "media_folder" und die Ordnerstruktur (siehe Konsole mit debug: true).';
          }
        }
      } catch (e) {
        this._error = 'Aufzeichnungen konnten nicht geladen werden (' + (e.message || e) + ')';
        this._log('Fehler beim Laden', e);
      } finally {
        this._loading = false;
        this.requestUpdate();
      }
    }

    async _selectDay(day) {
      this._day = day;
      this._loading = true;
      this.requestUpdate();
      let images = [];
      try {
        if (this._folderMode === 'day' || this._folderMode === 'nested') {
          const res = await this._browse(day.id);
          images = (res.children || []).filter((c) => c.media_class !== 'directory' && this._isImage(c));
          const files = (res.children || []).filter((c) => c.media_class !== 'directory' && !this._isImage(c));
          this._log('Dateien für', day.date, files.map((f) => f.title));
          this._clips = files
            .map((c) => ({ item: c, ts: parseTs(c.title) || parseTs(c.media_content_id) }))
            .sort((a, b) => (a.ts?.seconds ?? 0) - (b.ts?.seconds ?? 0));
        } else {
          const list = this._byDate.get(day.date) || [];
          this._clips = [...list].map((c) => ({ ...c })).sort((a, b) => (a.ts?.seconds ?? 0) - (b.ts?.seconds ?? 0));
          images = this._rootImages;
        }
        this._attachFaces(images);
        this._applyStoredDetections();
      } catch (e) {
        this._error = 'Tag konnte nicht geladen werden (' + (e.message || e) + ')';
        this._clips = [];
      } finally {
        this._loading = false;
        this.requestUpdate();
        this._ensureThumbsForDay();
        this._ensureFaces();
        this._loadDetections(day);
        // Die Thumbnail-Leiste ist chronologisch sortiert (links=früh, rechts=spät) und
        // startet gescrollt bei Position 0 - das würde ohne Eingriff die ÄLTESTEN
        // Aufnahmen des Tages zeigen. Stattdessen direkt ans rechte Ende scrollen, damit
        // die NEUESTE Aufnahme sofort sichtbar ist, ohne dass man manuell scrollen muss.
        this.updateComplete.then(() => {
          const strip = this.renderRoot?.querySelector('.thumb-strip');
          if (strip) strip.scrollLeft = strip.scrollWidth;
        });
      }
    }

    // ---------- Objekterkennung: Person / Tier / Fahrzeug ----------

    _detEntities() {
      if (this.config.detection_badges === false) return {};
      const cfg = this.config.detection && typeof this.config.detection === 'object' ? this.config.detection : {};
      const auto = findDetectionEntities(this._hass, this.config.entity);
      const out = {};
      for (const t of DET_TYPES) {
        const v = cfg[t] || auto[t];
        if (v && v !== 'none') out[t] = v;
      }
      return out;
    }

    _loadSideCaches() {
      try {
        const f = localStorage.getItem(this._storageKey + ':faces');
        if (f) this._faceCache = new Map(Object.entries(JSON.parse(f)));
      } catch (e) {
        this._log('Gesichts-Cache konnte nicht geladen werden', e);
      }
      try {
        const d = localStorage.getItem(this._storageKey + ':det');
        if (d) this._detStore = new Map(Object.entries(JSON.parse(d)));
      } catch (e) {
        this._log('Erkennungs-Cache konnte nicht geladen werden', e);
      }
    }

    _persistMap(suffix, map, max) {
      try {
        const entries = [...map.entries()];
        const obj = Object.fromEntries(entries.slice(Math.max(0, entries.length - max)));
        localStorage.setItem(this._storageKey + suffix, JSON.stringify(obj));
      } catch (e) {
        this._log('Cache konnte nicht gespeichert werden', suffix, e);
      }
    }

    // Bereits ermittelte Erkennungen sofort zeigen (auch wenn der Recorder den Verlauf
    // inzwischen gelöscht hat - Standard sind 10 Tage).
    _applyStoredDetections() {
      for (const c of this._clips) {
        const v = this._detStore.get(c.item.media_content_id);
        if (v) c.det = v.split(',').filter(Boolean);
      }
    }

    async _loadDetections(day) {
      const ents = this._detEntities();
      const ids = [...new Set(Object.values(ents))];
      if (!ids.length || !day || !day.date || day.date === 'unbekannt' || !this._clips.length) return;
      const seq = ++this._detSeq;
      const clips = this._clips;
      const det = (this.config.detection && typeof this.config.detection === 'object') ? this.config.detection : {};
      const pre = numOr(det.pre, 5);
      const post = numOr(det.post, 60);
      try {
        const start = new Date(day.date + 'T00:00:00');
        start.setMinutes(start.getMinutes() - 10);
        const end = new Date(day.date + 'T23:59:59');
        end.setSeconds(end.getSeconds() + post + 60);
        const now = new Date();
        const until = end > now ? now : end;
        const res = await this._hass.callWS({
          type: 'history/history_during_period',
          start_time: start.toISOString(),
          end_time: until.toISOString(),
          entity_ids: ids,
          minimal_response: true,
          no_attributes: true,
          significant_changes_only: false,
        });
        if (seq !== this._detSeq || this._clips !== clips) return;
        const endTs = until.getTime() / 1000;
        const iv = {};
        for (const [type, id] of Object.entries(ents)) iv[type] = toIntervals(res && res[id], endTs);
        let changed = false;
        clips.forEach((c, i) => {
          if (!c.ts) return;
          const s = clipEpoch(c.ts);
          const nxt = clips[i + 1] && clips[i + 1].ts ? clipEpoch(clips[i + 1].ts) : Infinity;
          const e = Math.min(s + post, Math.max(s + 10, nxt));
          const found = DET_TYPES.filter((t) => (iv[t] || []).some(([a, b]) => a <= e && b >= s - pre));
          if (found.length) {
            c.det = found;
            this._detStore.set(c.item.media_content_id, found.join(','));
            changed = true;
          }
        });
        if (changed) this._persistMap(':det', this._detStore, DET_STORE_MAX);
        this._log('Erkennungen geladen', ents, clips.filter((c) => c.det).length);
        this.requestUpdate();
      } catch (e) {
        this._log('Erkennungs-Verlauf konnte nicht geladen werden', e);
      }
    }

    // ---------- Gesichter (TheBoringFace legt <clip>__face__<Name>.jpg neben den Clip) ----------

    _attachFaces(images) {
      if (this.config.faces === false || !images || !images.length) return;
      const tag = this.config.face_tag || DEFAULT_FACE_TAG;
      const byStem = new Map();
      for (const img of images) {
        const t = img.title || '';
        const i = t.indexOf(tag);
        if (i <= 0) continue;
        const stem = t.slice(0, i);
        const raw = stripExt(t.slice(i + tag.length));
        const unknown = /^(unbekannt|unknown)/i.test(raw);
        if (unknown && this.config.faces_show_unknown === false) continue;
        const name = unknown ? 'Unbekannt' : raw.replace(/_\d+$/, '').replace(/_/g, ' ');
        if (!byStem.has(stem)) byStem.set(stem, []);
        byStem.get(stem).push({ name, unknown, item: img });
      }
      if (!byStem.size) return;
      for (const c of this._clips) {
        const title = c.item.title || '';
        const f = byStem.get(stripExt(title)) || byStem.get(title);
        if (f) c.faces = [...f].sort((a, b) => a.unknown - b.unknown || a.name.localeCompare(b.name));
      }
    }

    async _ensureFaces() {
      const todo = [];
      for (const c of this._clips) for (const f of c.faces || []) {
        const id = f.item.media_content_id;
        if (!this._faceCache.has(id) && !this._faceLoading.has(id)) todo.push(id);
      }
      for (const id of todo.slice(-60)) {
        this._faceLoading.add(id);
        try {
          const { url } = await this._resolve(id);
          const img = new Image();
          img.decoding = 'async';
          img.src = url;
          await img.decode();
          const cv = document.createElement('canvas');
          cv.width = FACE_PX;
          cv.height = FACE_PX;
          const side = Math.min(img.naturalWidth, img.naturalHeight);
          cv.getContext('2d').drawImage(
            img,
            (img.naturalWidth - side) / 2,
            (img.naturalHeight - side) / 2,
            side,
            side,
            0,
            0,
            FACE_PX,
            FACE_PX
          );
          this._faceCache.set(id, cv.toDataURL('image/jpeg', 0.7));
          this.requestUpdate();
        } catch (e) {
          this._log('Gesicht konnte nicht geladen werden', id, e.message || e);
        } finally {
          this._faceLoading.delete(id);
        }
      }
      if (todo.length) this._persistMap(':faces', this._faceCache, FACE_CACHE_MAX);
    }

    _renderMarks(c) {
      const faces = (c.faces || []).filter((f) => this._faceCache.has(f.item.media_content_id));
      const det = c.det || [];
      return html`
        ${faces.length
          ? html`<div class="faces">
              ${faces.slice(0, 2).map(
                (f) => html`<img class="face ${f.unknown ? 'unknown' : ''}" src=${this._faceCache.get(f.item.media_content_id)} title=${f.name} />`
              )}
            </div>`
          : ''}
        ${det.length
          ? html`<div class="badges">
              ${det.map(
                (t) => html`<span class="badge" style="background:${DET_META[t].color}" title=${DET_META[t].label}>
                  <ha-icon icon=${DET_META[t].icon}></ha-icon>
                </span>`
              )}
            </div>`
          : ''}
      `;
    }

    _clipSummary(clip) {
      if (!clip) return '';
      const names = (clip.faces || []).map((f) => f.name);
      const det = (clip.det || []).filter((t) => !(t === 'person' && names.length)).map((t) => DET_META[t].label);
      return [...new Set(names), ...det].join(' · ');
    }

    // ---------- Thumbnail-Erzeugung (client-seitig, mit localStorage-Cache) ----------

    _loadThumbCacheFromStorage() {
      // Kleine, alte Vorschaubilder früherer Versionen belegen nur Speicher -> einmal aufräumen.
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && /^(the-boring|portal)-camera-card-thumbs:/.test(k)) localStorage.removeItem(k);
        }
      } catch (e) {}
      try {
        const raw = localStorage.getItem(this._storageKey);
        if (raw) this._thumbCache = new Map(Object.entries(JSON.parse(raw)));
      } catch (e) {
        this._log('Thumbnail-Cache konnte nicht geladen werden', e);
      }
    }

    _persistThumbCache() {
      try {
        const entries = [...this._thumbCache.entries()];
        const obj = Object.fromEntries(entries.slice(Math.max(0, entries.length - THUMB_CACHE_MAX)));
        const json = JSON.stringify(obj);
        try {
          localStorage.setItem(this._storageKey, json);
        } catch (e) {
          // Speicher voll: Caches älterer Kartenversionen entfernen und nochmal versuchen.
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && /^(the-boring|portal)-camera-card-thumbs:/.test(k)) localStorage.removeItem(k);
          }
          localStorage.setItem(this._storageKey, json);
        }
      } catch (e) {
        this._log('Thumbnail-Cache konnte nicht gespeichert werden (Speicher voll?)', e);
      }
    }

    async _ensureThumbsForDay() {
      // Neueste zuerst: die Leiste steht beim Öffnen rechts bei den neuesten Aufnahmen.
      const clips = this._clips;
      const todo = clips
        .filter((c) => !c.item.thumbnail && !this._thumbCache.has(c.item.media_content_id))
        .reverse()
        .slice(0, THUMB_CACHE_MAX);
      for (const c of todo) {
        if (this._clips !== clips) return; // anderer Tag gewählt
        await this._ensureThumb(c);
      }
    }

    async _ensureThumb(clip) {
      const id = clip.item.media_content_id;
      if (this._thumbCache.has(id) || this._thumbGenerating.has(id)) return;
      this._thumbGenerating.add(id);
      try {
        const resolved = await this._resolve(id);
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.src = resolved.url;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Zeitüberschreitung')), 8000);
          video.addEventListener(
            'loadedmetadata',
            () => {
              try {
                video.currentTime = Math.min(1, (video.duration || 2) / 2);
              } catch (e) {
                reject(e);
              }
            },
            { once: true }
          );
          video.addEventListener(
            'seeked',
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true }
          );
          video.addEventListener(
            'error',
            () => {
              clearTimeout(timer);
              reject(new Error('Video-Ladefehler'));
            },
            { once: true }
          );
        });
        const canvas = document.createElement('canvas');
        canvas.width = THUMB_W;
        canvas.height = THUMB_H;
        canvas.getContext('2d').drawImage(video, 0, 0, THUMB_W, THUMB_H);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        this._thumbCache.set(id, dataUrl);
        this._persistThumbCache();
        this._thumbTick++;
        this.requestUpdate();
      } catch (e) {
        this._log('Thumbnail-Erzeugung fehlgeschlagen für', id, e.message || e);
      } finally {
        this._thumbGenerating.delete(id);
      }
    }

    // ---------- Live-Verbindung: direkt zu go2rtc, eigene WebRTC-Signalisierung ----------
    // Folgt exakt go2rtcs eigener Referenzimplementierung (www/webrtc.html im go2rtc-Repo):
    // WebSocket an /api/ws?src=<stream>, Nachrichten {type:'webrtc/offer'|'webrtc/answer'|
    // 'webrtc/candidate', value:...}. Verbindet direkt mit go2rtc im LAN (siehe
    // defaultGo2rtcServer()) — für Fernzugriff über HA's Ingress-Proxy siehe go2rtc_ingress.

    // Reolink & Co. bieten oft einen Hauptstream (hohe Auflösung, hohe Bitrate) und
    // einen Substream (niedrige Auflösung, spart Bandbreite/CPU) desselben Kamerabilds,
    // beide unabhängig als eigene Streams in go2rtc registriert. Ist ein Substream
    // konfiguriert, nutzt die Karte ihn standardmäßig (z.B. für die kleine Kachel-/
    // Live-Ansicht) und wechselt automatisch zum Hauptstream, sobald das Vollbild
    // geöffnet wird - dort zählt Bildqualität am meisten.
    // Ohne manuelle Wahl (_streamOverride === null): Substream normal, automatischer
    // Wechsel zum Hauptstream im Vollbild. Hat der Nutzer über den dezenten Button unter
    // den Vorschaubildern manuell "Hauptstream" oder "Substream" gewählt, gilt diese Wahl fest,
    // unabhängig vom Vollbild-Status, bis er erneut umschaltet.
    _activeStreamName() {
      const mainStream = this.config.go2rtc_url || this.config.entity;
      const subStream = this.config.go2rtc_url_sub;
      if (!subStream) return mainStream;
      if (this._streamOverride === 'main') return mainStream;
      if (this._streamOverride === 'sub') return subStream;
      return this._isFullscreen ? mainStream : subStream;
    }

    // Trennt bei Bedarf die laufende WebRTC-Verbindung und baut sie mit dem jeweils
    // passenden Stream neu auf (Vollbild-Wechsel oder manuelle Umschaltung). Ohne
    // konfigurierten Substream oder ohne aktive Live-Verbindung passiert nichts.
    _reconnectStreamIfNeeded() {
      if (!this.config.go2rtc_url_sub || !this._liveActive) return;
      const desired = this._activeStreamName();
      if (desired === this._connectedStreamName) return;
      this._log('Wechsle Stream:', this._connectedStreamName, '->', desired);
      this._disconnectLive();
      this._connectLive();
    }

    // Manueller Umschalter (Button unter den Vorschaubildern): schaltet fest zwischen Haupt-
    // und Substream um, unabhängig vom Vollbild-Status.
    _toggleStreamQuality() {
      if (!this.config.go2rtc_url_sub) return;
      const subStream = this.config.go2rtc_url_sub;
      const currentlySub = this._activeStreamName() === subStream;
      this._streamOverride = currentlySub ? 'main' : 'sub';
      this._reconnectStreamIfNeeded();
      this.requestUpdate();
    }

    async _connectLive() {
      this._connecting = true;
      this._error = null;
      this.requestUpdate();
      try {
        const streamName = this._activeStreamName();
        this._connectedStreamName = streamName;
        // Direkt im LAN verbinden, wenn der Browser lokal auf HA zugreift (schnell,
        // kein Umweg übers Internet). Sonst über HA's eigenen Ingress-Proxy zum
        // go2rtc-Add-on (go2rtc_ingress) - läuft komplett über die HA-eigene Domain,
        // kein separater Reverse-Proxy noetig. go2rtc_server bleibt als Fallback fuer
        // eine externe Adresse, falls kein go2rtc_ingress konfiguriert ist.
        const onLan = isLikelyLan();
        const useIngress = !onLan && !!this.config.go2rtc_ingress;
        const lanServer = this.config.go2rtc_server_lan || defaultGo2rtcServer();
        const server = onLan
          ? lanServer
          : useIngress
          ? this.config.go2rtc_ingress
          : (this.config.go2rtc_server || lanServer);
        this._log(
          onLan ? 'LAN erkannt - verbinde direkt' : (useIngress ? 'Verbinde ueber HA-Ingress' : 'Verbinde ueber externen Server'),
          server
        );

        // Ingress-Verbindungen brauchen vorher eine gueltige Ingress-Session (sonst
        // 401): per Supervisor-API anfordern und als Cookie setzen - genau der
        // Handshake, den auch das HA-Frontend selbst vor jedem Ingress-Zugriff macht.
        if (useIngress) {
          try {
            const resp = await this._hass.callWS({
              type: 'supervisor/api',
              endpoint: '/ingress/session',
              method: 'post',
            });
            document.cookie =
              'ingress_session=' + resp.session + ';path=/api/hassio_ingress/;SameSite=Strict' +
              (location.protocol === 'https:' ? ';Secure' : '');
          } catch (e) {
            this._log('Ingress-Session konnte nicht erstellt werden', e);
          }
        }

        let wsUrl;
        if (/^https?:\/\//.test(server)) {
          // Absolute URL: direkt verbinden (nur im LAN erreichbar, sofern nicht per
          // Reverse-Proxy von außen freigegeben).
          wsUrl = server.replace(/^http/, 'ws') + '/api/ws?src=' + encodeURIComponent(streamName);
        } else {
          // Relativer Pfad: über denselben Origin wie das HA-Frontend (Ingress-Proxy),
          // funktioniert dadurch auch über den Fernzugriff, mit dem die App bereits auf
          // HA zugreift, und bleibt hinter der HA-Anmeldung.

          const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
          const base = server.endsWith('/') ? server.slice(0, -1) : server;
          wsUrl = `${proto}//${location.host}${base}/api/ws?src=${encodeURIComponent(streamName)}`;
        }
        // go2rtc_token: optionales geheimes Token fuer einen EIGENEN Reverse-Proxy vor
        // go2rtc (z.B. NPM mit "if $arg_token != ..."), da go2rtc selbst keine eigene
        // Authentifizierung hat. Bei Ingress uebernimmt die Ingress-Session das, ein
        // Token ist dort nicht noetig.
        if (!onLan && !useIngress && this.config.go2rtc_token) {
          wsUrl += '&token=' + encodeURIComponent(this.config.go2rtc_token);
        }
        this._log('go2rtc WS-URL', wsUrl);


        const pc = new RTCPeerConnection({
          iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }],
        });
        this._pc = pc;

        const remoteTracks = ['video', 'audio'].map(
          (kind) => pc.addTransceiver(kind, { direction: 'recvonly' }).receiver.track
        );

        this._pttAvailable = false;
        if (this.config.mic) {
          // navigator.mediaDevices existiert nur in sicheren Kontexten (HTTPS oder
          // localhost) - der Browser blendet die API im unsicheren Kontext (z.B. reines
          // HTTP im LAN) komplett aus, statt einen Fehler zu werfen. Das ist keine echte
          // Störung, sondern eine Browser-Sicherheitsvorgabe: Push2Talk bleibt dort einfach
          // deaktiviert (kein roter Fehlertext), statt mit einem kryptischen TypeError zu
          // crashen ("undefined is not an object (evaluating 'navigator.mediaDevices...')").
          if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
            this._log(
              'Mikrofon (Push2Talk) nicht verfügbar: unsicherer Kontext ohne HTTPS. ' +
              'Browser blockieren Mikrofonzugriff außerhalb von HTTPS/localhost grundsätzlich.'
            );
          } else {
            try {
              const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
              const micTrack = micStream.getAudioTracks()[0];
              micTrack.enabled = false; // erst bei gedrückter Push2Talk-Taste aktiv
              this._micStream = micStream;
              this._micTrack = micTrack;
              pc.addTransceiver(micTrack, { direction: 'sendonly' });
              this._pttAvailable = true;
            } catch (e) {
              this._error = 'Mikrofonzugriff für Push2Talk fehlgeschlagen: ' + (e.name || '') + ' ' + (e.message || e);
              this._log('Mikrofonzugriff für Push2Talk nicht verfügbar', e);
            }
          }
        }

        pc.addEventListener('connectionstatechange', () => {
          this._log('WebRTC-Status', pc.connectionState);
          this._connState = pc.connectionState;
          if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            this._error = 'WebRTC-Verbindung zu go2rtc getrennt (' + pc.connectionState + ').';
          }
          this.requestUpdate();
        });

        const ws = new WebSocket(wsUrl);
        this._ws = ws;

        ws.addEventListener('open', () => {
          pc.addEventListener('icecandidate', (ev) => {
            if (!ev.candidate) return;
            ws.send(JSON.stringify({ type: 'webrtc/candidate', value: ev.candidate.candidate }));
          });
          pc
            .createOffer()
            .then((offer) => pc.setLocalDescription(offer))
            .then(() => {
              ws.send(JSON.stringify({ type: 'webrtc/offer', value: pc.localDescription.sdp }));
            })
            .catch((e) => {
              this._error = 'WebRTC-Angebot konnte nicht erstellt werden (' + (e.message || e) + ')';
              this.requestUpdate();
            });
        });

        ws.addEventListener('message', (ev) => {
          let msg;
          try {
            msg = JSON.parse(ev.data);
          } catch (e) {
            return;
          }
          if (msg.type === 'webrtc/candidate') {
            if (msg.value) pc.addIceCandidate({ candidate: msg.value, sdpMid: '0' }).catch(() => {});
          } else if (msg.type === 'webrtc/answer') {
            pc.setRemoteDescription({ type: 'answer', sdp: msg.value }).catch((e) => {
              this._error = 'go2rtc-Antwort konnte nicht verarbeitet werden (' + (e.message || e) + ')';
              this.requestUpdate();
            });
          }
        });

        ws.addEventListener('error', (e) => {
          this._log('go2rtc WebSocket-Fehler', e);
          this._error =
            'Verbindung zu go2rtc fehlgeschlagen (' +
            server +
            '). Ist der Stream-Name korrekt und der Server erreichbar?';
          this.requestUpdate();
        });

        this.requestUpdate();
        await this.updateComplete;
        const videoEl = this.renderRoot.getElementById('live-video');
        if (videoEl) {
          videoEl.srcObject = new MediaStream(remoteTracks);
          videoEl.muted = this._muted;
          try {
            await videoEl.play();
          } catch (e) {
            // Browser-Autoplay-Policy: mit Ton startet Wiedergabe nicht automatisch.
            // Auf stumm zurückfallen und erneut versuchen, Zustand entsprechend spiegeln.
            videoEl.muted = true;
            this._muted = true;
            try {
              await videoEl.play();
            } catch (e2) {
              this._log('Video-Wiedergabe fehlgeschlagen', e2);
            }
            this.requestUpdate();
          }
        }

        this._startBitrateMonitor();
      } catch (e) {
        this._error = 'Live-Verbindung fehlgeschlagen (' + (e.message || e) + ')';
        this._log('Verbindungsfehler', e);
      } finally {
        this._connecting = false;
        this.requestUpdate();
      }
    }

    _disconnectLive() {
      this._stopBitrateMonitor();
      if (this._ws) {
        try {
          this._ws.close();
        } catch (e) {}
        this._ws = null;
      }
      if (this._pc) {
        try {
          this._pc.close();
        } catch (e) {}
        this._pc = null;
      }
      if (this._micStream) {
        this._micStream.getTracks().forEach((t) => t.stop());
        this._micStream = null;
        this._micTrack = null;
      }
      const videoEl = this.renderRoot?.getElementById('live-video');
      if (videoEl) videoEl.srcObject = null;
      this._pttActive = false;
      this._pttAvailable = false;
      this._connState = 'idle';
      this._connectedStreamName = null;
    }

    // ---------- Auto-Livestream ----------
    // Schalter je Kamera (localStorage, Schluessel = Kamera-Entity, Standard: an).
    // An: Sobald die Karte sichtbar ist (z.B. Pop-up geoeffnet), startet der Livestream
    // von selbst. Schliesst sich das Pop-up, beendet die Sichtbarkeits-Ueberwachung den
    // Stream wieder. Aus: Der Stream startet erst per Play-Button.
    // Nach manuellem Beenden (X) startet er NICHT sofort neu, sondern erst, wenn die
    // Karte zwischenzeitlich unsichtbar war (_autoArmed).
    _autoKey() {
      return 'the-boring-camera-card-autolive:' + ((this.config && this.config.entity) || '');
    }

    _loadAutoLive() {
      try {
        const v = window.localStorage.getItem(this._autoKey());
        return v === null ? true : v === '1';
      } catch (e) {
        return true;
      }
    }

    _toggleAutoLive() {
      this._autoLive = !this._autoLive;
      try {
        window.localStorage.setItem(this._autoKey(), this._autoLive ? '1' : '0');
      } catch (e) {}
      if (this._autoLive) {
        this._autoArmed = true;
        this._autoCheck();
      }
      this.requestUpdate();
    }

    _inViewport() {
      const r = this.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      return (
        r.bottom > 0 &&
        r.right > 0 &&
        r.top < (window.innerHeight || document.documentElement.clientHeight) &&
        r.left < (window.innerWidth || document.documentElement.clientWidth)
      );
    }

    // true, wenn die Karte zwei Pruefungen in Folge ausserhalb des Bildschirms war
    // (faengt Pop-ups ab, die nur weggeschoben statt per CSS versteckt werden).
    _offscreenLong() {
      if (this._inViewport()) {
        this._offscreenTicks = 0;
        return false;
      }
      this._offscreenTicks = (this._offscreenTicks || 0) + 1;
      return this._offscreenTicks >= 2;
    }

    _startAutoWatch() {
      this._stopAutoWatch();
      this._autoInterval = setInterval(() => this._autoCheck(), 400);
    }

    _stopAutoWatch() {
      if (this._autoInterval) {
        clearInterval(this._autoInterval);
        this._autoInterval = null;
      }
    }

    _autoCheck() {
      if (!this._autoLive || !this.config || !this._hass) return;
      const visible = this._isVisible() && this._inViewport();
      if (!visible) {
        this._autoArmed = true;
        return;
      }
      if (this._autoArmed && !this._liveActive && !this._connecting && this._mode === 'live') {
        this._autoArmed = false;
        this._log('Auto-Livestream: Karte sichtbar - starte');
        this._startLive();
      }
    }

    _startLive() {
      this._mode = 'live';
      this._liveActive = true;
      this._liveFrozen = false;
      this.requestUpdate();
      this._connectLive();
      this._startVisibilityWatch();
    }

    _closeSession() {
      this._stopVisibilityWatch();
      this._mode = 'live';
      this._selected = null;
      this._liveActive = false;
      this._liveFrozen = false;
      this._playing = false;
      this._progress = 0;
      this._disconnectLive();
      this.requestUpdate();
    }

    // ---------- Sichtbarkeits-Überwachung ----------
    // Manche Dashboard-Pop-ups (z.B. ältere Bubble-Card-Versionen mit
    // card_type: pop-up) entfernen ihren Inhalt beim Schließen NICHT aus dem
    // DOM, sondern verstecken ihn nur per CSS — disconnectedCallback feuert
    // dann nicht und Live-Stream/Aufzeichnung würden unbemerkt im Hintergrund
    // weiterlaufen. Deshalb prüft die Karte, solange eine Sitzung aktiv ist,
    // regelmäßig selbst ihre CSS-Sichtbarkeit und beendet die Übertragung,
    // sobald sie (z.B. durch Schließen des Pop-ups) nicht mehr sichtbar ist.
    _isVisible() {
      if (typeof this.checkVisibility === 'function') {
        return this.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      }
      return !!this.offsetParent;
    }

    _startVisibilityWatch() {
      this._stopVisibilityWatch();
      this._visibilityInterval = setInterval(() => {
        if (!this._isVisible() || this._offscreenLong()) {
          this._log('Karte nicht mehr sichtbar (Pop-up geschlossen o.ä.) — Übertragung wird beendet');
          this._closeSession();
        }
      }, 1000);
    }

    _stopVisibilityWatch() {
      if (this._visibilityInterval) {
        clearInterval(this._visibilityInterval);
        this._visibilityInterval = null;
      }
    }

    _togglePlay() {
      const v = this.renderRoot.getElementById('playback-video');
      if (!v) return;
      if (v.paused) v.play();
      else v.pause();
    }

    // Im Live-Modus "pausiert" der Haupt-Play/Pause-Schalter das <video>-Element selbst
    // (der WebRTC-Stream läuft im Hintergrund weiter, es wird nur nicht mehr gerendert/
    // abgespielt) statt die Verbindung zu kappen.
    _toggleMainPlay() {
      if (this._mode === 'playback') {
        this._togglePlay();
        return;
      }
      const v = this.renderRoot.getElementById('live-video');
      this._liveFrozen = !this._liveFrozen;
      if (v) {
        if (this._liveFrozen) v.pause();
        else v.play().catch(() => {});
      }
      this.requestUpdate();
    }

    _onVideoTime(e) {
      const v = e.target;
      if (v.duration) this._progress = (v.currentTime / v.duration) * 100;
      this._playing = !v.paused;
      this.requestUpdate();
    }

    _toggleMute() {
      this._muted = !this._muted;
      const v = this.renderRoot.getElementById('live-video');
      if (v) v.muted = this._muted;
      this.requestUpdate();
    }

    // Reines CSS-Vollbild statt Fullscreen-API: die native requestFullscreen()-API
    // wird von der eingebetteten WebView der HA-App (WKWebView auf iOS) nicht
    // freigeschaltet und schlägt dort lautlos fehl. Ein CSS-basiertes Vollbild
    // (fixe Position über dem ganzen Viewport) funktioniert dagegen überall gleich.
    _toggleFullscreen() {
      this._isFullscreen = !this._isFullscreen;
      document.body.style.overflow = this._isFullscreen ? 'hidden' : '';
      if (this._isFullscreen) {
        screen.orientation?.lock?.('landscape').catch(() => {});
      } else {
        screen.orientation?.unlock?.();
      }
      this._reconnectStreamIfNeeded();
      this.requestUpdate();
    }

    // ---------- Push2Talk ----------
    // Schaltet nur die bereits (beim Verbindungsaufbau) angelegte sendonly-Audiospur frei/
    // stumm, statt die WebRTC-Verbindung neu auszuhandeln — einfacher und zuverlässiger.

    _pttDown(e) {
      e?.preventDefault?.();
      if (!this._micTrack) return;
      this._micTrack.enabled = true;
      this._pttActive = true;
      this.requestUpdate();
    }

    _pttUp() {
      if (this._micTrack) this._micTrack.enabled = false;
      this._pttActive = false;
      this.requestUpdate();
    }

    // ---------- Bitrate (über echte WebRTC-Statistiken, browserübergreifend) ----------

    _startBitrateMonitor() {
      this._stopBitrateMonitor();
      let lastBytes = null;
      let lastTime = performance.now();
      this._bitrateInterval = setInterval(async () => {
        if (!this._pc) return;
        try {
          const stats = await this._pc.getStats();
          let bytes = null;
          stats.forEach((s) => {
            if (s.type === 'inbound-rtp' && s.kind === 'video') bytes = s.bytesReceived;
          });
          if (bytes === null) {
            this._bitrateKbps = null;
            this.requestUpdate();
            return;
          }
          const now = performance.now();
          if (lastBytes !== null) {
            const dt = (now - lastTime) / 1000;
            const db = bytes - lastBytes;
            if (dt > 0 && db >= 0) this._bitrateKbps = Math.round((db * 8) / 1000 / dt);
          }
          lastBytes = bytes;
          lastTime = now;
          this.requestUpdate();
          this._pushBitrate(this._bitrateKbps);
        } catch (e) {
          /* still connecting */
        }
      }, 1500);
    }

    _stopBitrateMonitor() {
      if (this._bitrateInterval) {
        clearInterval(this._bitrateInterval);
        this._bitrateInterval = null;
      }
      this._bitrateKbps = null;
      this._pushBitrate(0);
    }

    // ---------- Live-Bitrate an einen HA-Helfer melden (input_number) ----------
    // Externe Dashboard-Pillen (z.B. im Popup-Header) können nicht direkt auf den
    // Karten-internen State zugreifen - sie binden an eine echte HA-Entity. Damit dort
    // die TATSÄCHLICHE, aus echten WebRTC-Statistiken berechnete Bitrate steht (statt
    // eines unabhängigen Sensors, der nie aktualisiert wird), schreibt die Karte ihren
    // Wert bei jedem Tick in die per "bitrate_entity" konfigurierte input_number-Entity.
    // Nur bei Wertänderung schreiben, um die Datenbank nicht mit identischen Werten zu
    // fluten. Wird beim Verbindungsende automatisch auf 0 zurückgesetzt.
    _pushBitrate(kbps) {
      const entity = this.config.bitrate_entity;
      if (!entity || !this._hass) return;
      const value = kbps === null || kbps === undefined ? 0 : kbps;
      if (this._lastPushedBitrate === value) return;
      this._lastPushedBitrate = value;
      this._hass
        .callService('input_number', 'set_value', { entity_id: entity, value })
        .catch((e) => this._log('Bitrate konnte nicht an', entity, 'gemeldet werden', e));
    }

    // ---------- Aufzeichnung abspielen ----------

    async _playClip(clip) {
      try {
        const resolved = await this._resolve(clip.item.media_content_id);
        this._selected = { clip, url: resolved.url };
        this._mode = 'playback';
        this._playing = true;
        this._progress = 0;
        this.requestUpdate();
        await this.updateComplete;
        const v = this.renderRoot.getElementById('playback-video');
        if (v) v.play().catch(() => {});
        this._startVisibilityWatch();
      } catch (e) {
        this._error = 'Aufzeichnung konnte nicht geladen werden (' + (e.message || e) + ')';
        this.requestUpdate();

      }
    }

    // ---------- Lang drücken -> Kontextmenü (Download / Löschen) ----------

    _onThumbPointerDown(clip) {
      this._longPressFired = false;
      clearTimeout(this._longPressTimer);
      this._longPressTimer = setTimeout(() => {
        this._longPressFired = true;
        this._contextClip = clip;
        this._confirmingDelete = false;
        this.requestUpdate();
      }, LONG_PRESS_MS);
    }

    _onThumbPointerUp() {
      clearTimeout(this._longPressTimer);
    }

    _onThumbClick(clip) {
      if (this._longPressFired) {
        this._longPressFired = false;
        return;
      }
      this._playClip(clip);
    }

    _closeContext() {
      this._contextClip = null;
      this._confirmingDelete = false;
      this.requestUpdate();
    }

    _openDayPicker() {
      this._dayPickerOpen = true;
      this.requestUpdate();
    }

    _jumpToday() {
      const now = new Date();
      const key = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const day = this._days.find((d) => d.date === key);
      if (day) this._selectDay(day);
      else this._openDayPicker();
    }

    _closeDayPicker() {
      this._dayPickerOpen = false;
      this.requestUpdate();
    }

    _pickDay(d) {
      this._dayPickerOpen = false;
      this._selectDay(d);
    }

    async _downloadClip(clip) {
      try {
        const resolved = await this._resolve(clip.item.media_content_id);
        const a = document.createElement('a');
        a.href = resolved.url;
        a.download = (clip.item.title || clip.ts?.label || 'aufnahme').replace(/[^\w.-]+/g, '_') + '.mp4';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (e) {
        this._error = 'Download fehlgeschlagen (' + (e.message || e) + ')';
      }
      this._closeContext();
    }

    async _deleteClip(clip) {
      try {
        await this._hass.callWS({
          type: 'media_source/local_source/remove',
          media_content_id: clip.item.media_content_id,
        });
        this._clips = this._clips.filter((c) => c !== clip);
        this._thumbCache.delete(clip.item.media_content_id);
        this._persistThumbCache();
      } catch (e) {
        this._error =
          'Löschen fehlgeschlagen (' +
          (e.message || e) +
          '). Möglicherweise nutzt diese HA-Version einen anderen WebSocket-Befehl zum Löschen lokaler Medien.';
      }
      this._closeContext();
    }

    // ---------- Render ----------

    render() {
      if (this._cameraWait) {
        return html`<div style="padding:16px;color:var(--secondary-text-color);font-size:14px">
          ${this._cameraError || 'Kamera wird geladen …'}
        </div>`;
      }
      if (!this._hass || !this.config) return html``;
      const stateObj = this._hass.states[this.config.entity];
      const caption =
        this._mode === 'playback' && this._selected
          ? (this._selected.clip.ts ? this._selected.clip.ts.label : '')
          : 'Live';
      const subLabel =
        this._mode === 'playback' && this._selected && this._selected.clip.ts
          ? [fmtDayLabel(this._selected.clip.ts.date), this._clipSummary(this._selected.clip)].filter(Boolean).join(' · ')
          : '';
      const mainIsPlaying = this._mode === 'playback' ? this._playing : !this._liveFrozen;
      const showSession = this._liveActive || this._mode === 'playback';
      const now = new Date();
      const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

      const tlSub = this._mode === 'playback'
        ? subLabel
        : this._connecting
        ? 'Verbinde…'
        : this._liveActive
        ? (this._liveFrozen ? 'Pausiert' : 'Live')
        : 'Tippen zum Anzeigen';

      const showPtt = !!this.config.mic;
      const aspectRatio = this.config.aspect_ratio || '16/9';

      return html`
        <ha-card>
          <div class="stream-wrap ${this._isFullscreen ? 'fs' : ''}" style="${this._isFullscreen ? '' : `aspect-ratio:${aspectRatio};`}">
            ${this._mode === 'live' && !this._liveActive
              ? html`<img class="fallback-img dim" src=${stateObj?.attributes?.entity_picture || ''} />`
              : this._mode === 'live'
              ? html`<video
                  id="live-video"
                  playsinline
                  autoplay
                  ?muted=${this._muted}
                ></video>`
              : html`<video
                  id="playback-video"
                  playsinline
                  ?muted=${this._muted}
                  src=${this._selected?.url || ''}
                  @timeupdate=${this._onVideoTime}
                  @play=${() => (this._playing = true)}
                  @pause=${() => (this._playing = false)}
                ></video>`}

            ${this._mode === 'live' && !this._liveActive
              ? html`<button class="start-live-btn" @click=${this._startLive} title="Live ansehen">
                  <ha-icon icon="mdi:play"></ha-icon>
                </button>`
              : ''}

            <div class="tl-overlay">
              ${showSession
                ? html`<ha-icon-button class="x-btn" @click=${this._closeSession} title="Schließen">
                    <ha-icon icon="mdi:close"></ha-icon>
                  </ha-icon-button>`
                : ''}
              <div class="tl-text">
                <div class="tl-sub">${tlSub}</div>
              </div>
            </div>

            ${showSession
              ? html`<div class="overlay-bottom">
                  <div class="caption-row">
                    <ha-icon-button class="small" @click=${this._toggleMainPlay}>
                      <ha-icon icon=${mainIsPlaying ? 'mdi:pause' : 'mdi:play'}></ha-icon>
                    </ha-icon-button>
                    <div class="caption-text">
                      <div class="caption-title">${caption}</div>
                      ${subLabel ? html`<div class="caption-sub">${subLabel}</div>` : ''}
                    </div>
                  </div>
                  ${this._mode === 'playback'
                    ? html`<div class="progress-track">
                        <div class="progress-fill" style="width:${this._progress}%"></div>
                      </div>`
                    : ''}
                </div>`
              : ''}
          </div>

          ${showPtt
            ? html`<div class="ptt-row">
                <button
                  class="ptt-btn-round ${this._pttActive ? 'active' : ''}"
                  title="Halten zum Sprechen"
                  @pointerdown=${this._pttDown}
                  @pointerup=${this._pttUp}
                  @pointerleave=${this._pttUp}
                  @pointercancel=${this._pttUp}
                >
                  <ha-icon icon="mdi:microphone"></ha-icon>
                </button>
              </div>`
            : ''}

          ${this._error ? html`<div class="error">${this._error}</div>` : ''}

          <div class="strip-row">
            <button class="today-btn ${todayKey && this._day?.date === todayKey ? 'active' : ''}" @click=${this._openDayPicker} title="Tag wählen">
              ${fmtDayLabel(this._day?.date)}
            </button>
            <div class="thumb-strip">
              ${this._loading
                ? html`<div class="thumb-loading"><ha-icon icon="mdi:loading" class="spin"></ha-icon></div>`
                : this._clips.map((c) => {
                    const src = c.item.thumbnail || this._thumbCache.get(c.item.media_content_id);
                    return html`<div
                      class="thumb ${this._selected?.clip === c ? 'active' : ''}"
                      @pointerdown=${() => this._onThumbPointerDown(c)}
                      @pointerup=${this._onThumbPointerUp}
                      @pointerleave=${this._onThumbPointerUp}
                      @pointercancel=${this._onThumbPointerUp}
                      @click=${() => this._onThumbClick(c)}
                      @dblclick=${() => this._downloadClip(c)}
                    >
                      ${src
                        ? html`<img src=${src} />`
                        : html`<ha-icon icon="mdi:cctv"></ha-icon>`}
                      ${c.ts ? html`<span>${c.ts.label}</span>` : ''}
                      ${this._renderMarks(c)}
                    </div>`;
                  })}
              ${!this._loading && !this._clips.length
                ? html`<div class="thumb-empty">Keine Aufzeichnungen an diesem Tag</div>`
                : ''}
            </div>
          </div>

          <div class="controls-row">
            <button class="ctrl-btn" @click=${this._toggleMute} title="Ton">
              <ha-icon icon=${this._muted ? 'mdi:volume-off' : 'mdi:volume-high'}></ha-icon>
            </button>
            <button class="ctrl-btn" @click=${this._toggleFullscreen} title="Vollbild">
              <ha-icon icon=${this._isFullscreen ? 'mdi:fullscreen-exit' : 'mdi:fullscreen'}></ha-icon>
            </button>
            ${this.config.go2rtc_url_sub
              ? html`<button class="ctrl-btn quality-btn" @click=${this._toggleStreamQuality} title="Bildqualität wechseln (Haupt-/Substream)">
                  <ha-icon icon="mdi:swap-horizontal"></ha-icon>
                  ${this._activeStreamName() === this.config.go2rtc_url_sub ? 'SD' : 'HD'}
                </button>`
              : ''}
            <button class="ctrl-btn auto-btn ${this._autoLive ? 'on' : ''}" @click=${this._toggleAutoLive} title="Auto-Livestream: startet automatisch, sobald die Karte sichtbar ist">
              <ha-icon icon="mdi:play-circle-outline"></ha-icon>
              Auto
              <span class="auto-sw"><span class="auto-knob"></span></span>
            </button>
          </div>

          ${this._dayPickerOpen
            ? html`<div class="context-backdrop" @click=${this._closeDayPicker}>
                <div class="daypicker-menu" @click=${(e) => e.stopPropagation()}>
                  <div class="context-title">Tag wählen</div>
                  <div class="daypicker-grid">
                    ${this._days.map(
                      (d) => html`<button
                        class="daypicker-item ${this._day?.id === d.id ? 'active' : ''}"
                        @click=${() => this._pickDay(d)}
                      >
                        ${fmtDayLabel(d.date)}
                      </button>`
                    )}
                  </div>
                  <button class="context-btn cancel" @click=${this._closeDayPicker}>Schließen</button>
                </div>
              </div>`
            : ''}

          ${this._contextClip
            ? html`<div class="context-backdrop" @click=${this._closeContext}>
                <div class="context-menu" @click=${(e) => e.stopPropagation()}>
                  <div class="context-title">
                    ${this._contextClip.ts ? this._contextClip.ts.label : this._contextClip.item.title}
                  </div>
                  ${!this._confirmingDelete
                    ? html`
                        <button class="context-btn" @click=${() => this._downloadClip(this._contextClip)}>
                          <ha-icon icon="mdi:download"></ha-icon> Herunterladen
                        </button>
                        <button
                          class="context-btn danger"
                          @click=${() => {
                            this._confirmingDelete = true;
                            this.requestUpdate();
                          }}
                        >
                          <ha-icon icon="mdi:delete-outline"></ha-icon> Löschen
                        </button>
                        <button class="context-btn cancel" @click=${this._closeContext}>Abbrechen</button>
                      `
                    : html`
                        <div class="context-warn">
                          Aufzeichnung wirklich löschen? Das kann nicht rückgängig gemacht werden.
                        </div>
                        <button class="context-btn danger" @click=${() => this._deleteClip(this._contextClip)}>
                          Ja, löschen
                        </button>
                        <button
                          class="context-btn cancel"
                          @click=${() => {
                            this._confirmingDelete = false;
                            this.requestUpdate();
                          }}
                        >
                          Abbrechen
                        </button>
                      `}
                </div>
              </div>`
            : ''}
        </ha-card>
      `;
    }

    static get styles() {
      return css`
        :host {
          --acc-bg: #000;
          --acc-fg: #fff;
          --acc-sub: rgba(255, 255, 255, 0.65);
        }
        ha-card {
          position: relative;
          overflow: hidden;
          background: var(--ha-card-background, var(--card-background-color, #111));
          padding: 0;
        }
        .stream-wrap {
          position: relative;
          width: 100%;
          aspect-ratio: 16/9;
          background: var(--acc-bg);
          overflow: hidden;
        }
        .stream-wrap.fs {
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100vh;
          aspect-ratio: auto;
          z-index: 2147483647;
        }
        .stream-wrap video,
        .stream-wrap img.fallback-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          background: #000;
        }
        .fallback-img.dim {
          filter: brightness(0.55) saturate(0.9);
        }
        .start-live-btn {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 56px;
          height: 56px;
          border-radius: 50%;
          border: none;
          background: rgba(255, 255, 255, 0.22);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .start-live-btn ha-icon {
          --mdc-icon-size: 28px;
        }
        .tl-overlay {
          position: absolute;
          top: 8px;
          left: 8px;
          right: 8px;
          display: flex;
          align-items: flex-start;
          gap: 2px;
          color: #fff;
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
        }
        .x-btn {
          --mdc-icon-button-size: 30px;
          color: #fff;
          margin-top: -3px;
        }
        .tl-text {
          padding-top: 3px;
          min-width: 0;
        }
        .tl-sub {
          font-size: 10px;
          font-weight: 500;
          opacity: 0.75;
          margin-top: 1px;
        }
        .overlay-bottom {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          padding: 10px 10px 14px;
          background: linear-gradient(to top, rgba(0, 0, 0, 0.88) 35%, rgba(0, 0, 0, 0.6) 70%, transparent);
        }
        .caption-row {
          display: flex;
          align-items: center;
          gap: 4px;
          color: #fff;
          margin-bottom: 4px;
        }
        .caption-text {
          flex: 1;
          min-width: 0;
        }
        .caption-title {
          font-size: 13px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .caption-sub {
          font-size: 11px;
          color: var(--acc-sub);
        }
        ha-icon-button.small {
          --mdc-icon-button-size: 32px;
          color: #fff;
        }
        .ptt-row {
          display: flex;
          justify-content: center;
          padding: 18px 14px 22px;
        }
        .ptt-btn-round {
          width: 64px;
          height: 64px;
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #ff9500;
          color: #fff;
          border: none;
          border-radius: 50%;
          cursor: pointer;
          touch-action: none;
          user-select: none;
          box-shadow: 0 2px 10px rgba(255, 149, 0, 0.35);
        }
        .ptt-btn-round ha-icon {
          --mdc-icon-size: 28px;
        }
        .ptt-btn-round.active {
          background: #ff3b30;
          transform: scale(0.94);
          box-shadow: 0 1px 6px rgba(255, 59, 48, 0.4);
        }
        .progress-track {
          height: 3px;
          border-radius: 2px;
          background: rgba(255, 255, 255, 0.3);
          margin-top: 4px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: #fff;
        }
        .error {
          margin: 8px 12px 0;
          font-size: 12px;
          color: var(--error-color, #ff453a);
        }
        .thumb-strip {
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 26px;
          padding: 4px 18px 4px 0;
          /* dünne Linie durch die Mitte: die Aufnahmen liegen optisch auf einer Zeitachse */
          background: linear-gradient(rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.22)) left center / 100% 1px no-repeat;
          background-attachment: local;
          overflow-x: auto;
          scrollbar-width: none;
          opacity: 0.92;
        }
        .thumb-strip::-webkit-scrollbar {
          display: none;
        }
        .thumb {
          flex: 0 0 auto;
          width: 104px;
          height: 74px;
          border-radius: 14px;
          background: #1c1c1e;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1px;
          color: rgba(255, 255, 255, 0.92);
          font-size: 12px;
          cursor: pointer;
          border: 1.5px solid transparent;
          overflow: hidden;
          position: relative;
          transition: opacity 0.15s;
          touch-action: manipulation;
          user-select: none;
        }
        .thumb:not(.active) {
          opacity: 0.75;
        }
        .thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          position: absolute;
          inset: 0;
        }
        .thumb span {
          position: relative;
          z-index: 1;
          background: rgba(0, 0, 0, 0.4);
          padding: 1px 6px;
          border-radius: 6px;
          font-weight: 600;
        }
        .thumb.active {
          border-color: rgba(255, 255, 255, 0.55);
          opacity: 1;
        }
        .thumb .badges {
          position: absolute;
          right: 4px;
          bottom: 4px;
          z-index: 2;
          display: flex;
          flex-direction: row-reverse;
          gap: 2px;
        }
        .thumb .badge {
          width: 21px;
          height: 21px;
          padding: 0;
          box-sizing: border-box;
          flex: none;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
          --mdc-icon-size: 14px;
        }
        .thumb .badge ha-icon {
          display: flex;
          --mdc-icon-size: 14px;
        }
        .thumb .faces {
          position: absolute;
          top: 4px;
          right: 4px;
          z-index: 2;
          display: flex;
          flex-direction: row-reverse;
        }
        .thumb .face,
        .thumb img.face {
          position: static;
          width: 25px;
          height: 25px;
          border-radius: 50%;
          object-fit: cover;
          border: 1.5px solid #fff;
          box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
          margin-left: -8px;
          background: #2c2c2e;
        }
        .thumb .face.unknown {
          border-color: rgba(255, 255, 255, 0.45);
          filter: grayscale(0.6);
        }
        .thumb-loading,
        .thumb-empty,
        .day-empty {
          color: var(--secondary-text-color);
          font-size: 12px;
          display: flex;
          align-items: center;
          padding: 0 6px;
        }
        .spin {
          animation: acc-spin 1s linear infinite;
        }
        @keyframes acc-spin {
          to {
            transform: rotate(360deg);
          }
        }
        .strip-row {
          display: flex;
          align-items: center;
          gap: 18px;
          padding: 20px 0 16px 14px;
        }
        .controls-row {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 8px;
          padding: 0 14px 10px;
        }
        .ctrl-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          border: none;
          background: rgba(127, 127, 127, 0.12);
          color: var(--secondary-text-color);
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.3px;
          padding: 7px;
          border-radius: 10px;
          cursor: pointer;
          opacity: 0.75;
        }
        .ctrl-btn:active {
          opacity: 1;
        }
        .ctrl-btn ha-icon {
          --mdc-icon-size: 15px;
        }
        .ctrl-btn.quality-btn {
          padding: 6px 12px;
        }
        .ctrl-btn.auto-btn {
          padding: 6px 10px;
          gap: 6px;
        }
        .auto-sw {
          position: relative;
          flex: 0 0 auto;
          width: 22px;
          height: 12px;
          border-radius: 6px;
          background: rgba(127, 127, 127, 0.45);
          transition: background 0.2s;
        }
        .auto-knob {
          position: absolute;
          top: 1px;
          left: 1px;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #fff;
          transition: transform 0.2s;
        }
        .ctrl-btn.auto-btn.on {
          opacity: 1;
        }
        .ctrl-btn.auto-btn.on .auto-sw {
          background: #34c759;
        }
        .ctrl-btn.auto-btn.on .auto-knob {
          transform: translateX(10px);
        }
        .today-btn {
          flex: 0 0 auto;
          border: none;
          padding: 10px 14px;
          border-radius: 18px;
          background: rgba(127, 127, 127, 0.15);
          color: var(--primary-text-color);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
        }
        .today-btn.active {
          background: #ff9500;
          color: #fff;
        }
        .context-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 20;
        }
        .context-menu {
          background: #1c1c1e;
          border-radius: 14px;
          padding: 14px;
          width: min(260px, 82%);
          display: flex;
          flex-direction: column;
          gap: 8px;
          box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
        }
        .daypicker-menu {
          background: #1c1c1e;
          border-radius: 14px;
          padding: 14px;
          width: min(320px, 86%);
          max-height: 70%;
          display: flex;
          flex-direction: column;
          gap: 10px;
          box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
        }
        .daypicker-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
          overflow-y: auto;
          max-height: 300px;
          padding-right: 2px;
        }
        .daypicker-item {
          border: none;
          border-radius: 10px;
          padding: 8px 4px;
          font-size: 12px;
          font-weight: 600;
          color: #fff;
          background: rgba(255, 255, 255, 0.1);
          cursor: pointer;
        }
        .daypicker-item.active {
          background: #ff9500;
        }
        .context-title {
          color: #fff;
          font-size: 13px;
          font-weight: 600;
          text-align: center;
          margin-bottom: 4px;
        }
        .context-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          border: none;
          border-radius: 10px;
          padding: 10px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }
        .context-btn.danger {
          background: rgba(255, 69, 58, 0.18);
          color: #ff453a;
        }
        .context-btn.cancel {
          background: transparent;
          color: rgba(255, 255, 255, 0.6);
        }
        .context-warn {
          color: rgba(255, 255, 255, 0.85);
          font-size: 12px;
          text-align: center;
          margin-bottom: 4px;
        }
      `;
    }
  }


  // =====================================================================================
  //  Einstellungsseite: <the-boring-camera-settings>
  //  Läuft als eigene Seitenleisten-Seite (panel_custom) oder als Karte auf einem
  //  eigenen Dashboard. Hier werden go2rtc, Aufnahme-Freigaben und die Reolink-Kameras
  //  einmal zentral eingetragen; daraus entsteht pro Kamera fertiger YAML-Code für die
  //  Karte (aufklappbar, zum Kopieren) sowie eine Vorlage für die go2rtc.yaml.
  //  Gespeichert wird serverseitig in Home Assistant (frontend/set_user_data), also
  //  ohne eigenes Backend und ohne Datei im config-Ordner.
  // =====================================================================================
  const SETTINGS_KEY = 'the_boring_camera_card';
  const ASPECTS = [
    ['16/9', '16:9 (breit)'],
    ['4/3', '4:3'],
    ['1/1', '1:1 (quadratisch)'],
    ['3/4', '3:4 (hoch, Klingel)'],
  ];

  function slug(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function newId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function yq(v) {
    const s = String(v);
    if (
      s === '' ||
      /^\s|\s$|: | #|^[!&*@`'"%{}\[\],|>?#-]|[\n\t]/.test(s) ||
      /^(true|false|yes|no|on|off|null|~|y|n)$/i.test(s) ||
      /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)
    ) {
      return JSON.stringify(s);
    }
    return s;
  }

  function defaultSettings() {
    return {
      version: 1,
      go2rtc: { lan: '', ingress: '', server: '', token: '' },
      media: { base: '', nas_path: '' },
      detection: { badges: true, pre: 5, post: 60 },
      faces: { enabled: true, tag: DEFAULT_FACE_TAG, show_unknown: true },
      cameras: [],
    };
  }

  function newCamera(over) {
    return Object.assign(
      {
        id: newId(),
        name: '',
        title: '',
        type: 'camera',
        ip: '',
        port: 554,
        user: 'admin',
        password: '',
        codec: 'h264',
        stream: '',
        stream_sub: '',
        sub_enabled: true,
        entity: '',
        media_folder: '',
        detection: { person: '', animal: '', vehicle: '' },
        faces: false,
        mic: false,
        aspect: '16/9',
        bitrate_entity: '',
      },
      over || {}
    );
  }

  function normalizeSettings(v) {
    const d = defaultSettings();
    if (!v || typeof v !== 'object') return d;
    const out = {
      version: 1,
      go2rtc: Object.assign(d.go2rtc, v.go2rtc || {}),
      media: Object.assign(d.media, v.media || {}),
      detection: Object.assign(d.detection, v.detection || {}),
      faces: Object.assign(d.faces, v.faces || {}),
      cameras: (Array.isArray(v.cameras) ? v.cameras : []).map((c) =>
        newCamera(Object.assign({}, c, { detection: Object.assign({ person: '', animal: '', vehicle: '' }, c.detection || {}) }))
      ),
    };
    return out;
  }

  // ---------- Abgeleitete Werte ----------
  function camStream(c) {
    return c.stream || slug(c.name) || 'kamera';
  }
  function camStreamSub(c) {
    if (!c.sub_enabled) return '';
    return c.stream_sub || camStream(c) + '_sub';
  }
  function camMedia(c, s) {
    if (c.media_folder) return c.media_folder;
    if (!s.media.base || !c.name) return '';
    return s.media.base.replace(/\/+$/, '') + '/' + c.name;
  }

  function cardYaml(c, s) {
    const L = ['type: custom:the-boring-camera-card'];
    const add = (k, v) => {
      if (v === undefined || v === null || v === '') return;
      L.push(`${k}: ${typeof v === 'boolean' || typeof v === 'number' ? v : yq(v)}`);
    };
    add('entity', c.entity || 'camera.BITTE_AUSWAEHLEN');
    add('title', c.title || c.name);
    add('media_folder', camMedia(c, s));
    if (c.mic) add('mic', true);
    if (c.aspect && c.aspect !== '16/9') add('aspect_ratio', c.aspect);
    add('go2rtc_url', camStream(c));
    add('go2rtc_url_sub', camStreamSub(c));
    add('go2rtc_server_lan', s.go2rtc.lan);
    add('go2rtc_ingress', s.go2rtc.ingress);
    add('go2rtc_server', s.go2rtc.server);
    add('go2rtc_token', s.go2rtc.token);
    add('bitrate_entity', c.bitrate_entity);
    if (!s.detection.badges) {
      add('detection_badges', false);
    } else {
      const det = [];
      for (const t of DET_TYPES) if (c.detection[t]) det.push(`  ${t}: ${yq(c.detection[t])}`);
      if (numOr(s.detection.pre, 5) !== 5) det.push(`  pre: ${numOr(s.detection.pre, 5)}`);
      if (numOr(s.detection.post, 60) !== 60) det.push(`  post: ${numOr(s.detection.post, 60)}`);
      if (det.length) L.push('detection:', ...det);
    }
    const facesOn = s.faces.enabled && c.faces;
    add('faces', facesOn);
    if (facesOn) {
      if (s.faces.tag && s.faces.tag !== DEFAULT_FACE_TAG) add('face_tag', s.faces.tag);
      if (!s.faces.show_unknown) add('faces_show_unknown', false);
    }
    return L.join('\n') + '\n';
  }

  function rtspUrl(c, which) {
    const user = encodeURIComponent(c.user || 'admin');
    const pw = c.password ? encodeURIComponent(c.password) : 'PASSWORT';
    const port = c.port && Number(c.port) !== 554 ? ':' + c.port : ':554';
    return `rtsp://${user}:${pw}@${c.ip || 'IP_ADRESSE'}${port}/${c.codec === 'h265' ? 'h265' : 'h264'}Preview_01_${which}`;
  }

  function go2rtcYaml(s) {
    const L = [
      '# Vorlage aus "The Boring Camera Card – Einstellungen"',
      '# Reolink-Standardpfade (Preview_01_main/_sub). Bestehende Einträge mit',
      '# Sonderfunktionen (z. B. Gegensprechen der Klingel) bitte beibehalten.',
      'streams:',
    ];
    for (const c of s.cameras) {
      if (!c.ip && !c.name) continue;
      L.push(`  ${camStream(c)}:`);
      L.push(`    - ${yq(rtspUrl(c, 'main'))}`);
      // AAC der Kamera -> Opus für WebRTC (sonst kein Ton im Browser)
      L.push(`    - ${yq('ffmpeg:' + camStream(c) + '#audio=opus')}`);
      const sub = camStreamSub(c);
      if (sub) {
        L.push(`  ${sub}:`);
        L.push(`    - ${yq(rtspUrl(c, 'sub'))}`);
      }
    }
    return L.join('\n') + '\n';
  }

  function gridYaml(s) {
    const cams = s.cameras.filter((c) => c.entity || c.name);
    const L = ['type: grid', 'columns: 2', 'square: false', 'cards:'];
    for (const c of cams) {
      const lines = cardYaml(c, s).trimEnd().split('\n');
      L.push('  - ' + lines[0], ...lines.slice(1).map((l) => '    ' + l));
    }
    return L.join('\n') + '\n';
  }

  function facesEnvLine(s) {
    const names = s.cameras.filter((c) => c.faces && c.name).map((c) => c.name);
    return `CAMERAS: ${JSON.stringify(names.join(','))}` + (names.length ? '' : '   # leer = alle Unterordner');
  }

  class TheBoringCameraSettings extends LitElement {
    static get properties() {
      return {
        hass: { attribute: false },
        narrow: { type: Boolean },
        panel: { attribute: false },
        _s: { state: true },
        _loaded: { state: true },
        _dirty: { state: true },
        _msg: { state: true },
        _open: { state: true },
        _checks: { state: true },
        _streams: { state: true },
        _showPw: { state: true },
      };
    }

    constructor() {
      super();
      this._s = defaultSettings();
      this._loaded = false;
      this._dirty = false;
      this._msg = '';
      this._open = {};
      this._checks = {};
      this._streams = [];
      this._showPw = {};
    }

    // Als Karte verwendbar (type: custom:the-boring-camera-settings)
    setConfig() {}
    getCardSize() {
      return 12;
    }

    updated(changed) {
      if (changed.has('hass') && this.hass && !this._loadStarted) {
        this._loadStarted = true;
        this._load();
      }
    }

    async _load() {
      try {
        const r = await this.hass.callWS({ type: 'frontend/get_user_data', key: SETTINGS_KEY });
        this._s = normalizeSettings(r && r.value);
        this._msg = this._s.cameras.length ? '' : 'Noch keine Kameras – „Kameras automatisch finden" probieren.';
      } catch (e) {
        this._s = defaultSettings();
        this._msg = 'Einstellungen konnten nicht geladen werden: ' + (e.message || e);
      }
      this._loaded = true;
    }

    async _save() {
      try {
        await this.hass.callWS({ type: 'frontend/set_user_data', key: SETTINGS_KEY, value: this._s });
        this._dirty = false;
        this._flash('Gespeichert ✓');
      } catch (e) {
        this._msg = 'Speichern fehlgeschlagen: ' + (e.message || e);
      }
    }

    _flash(m) {
      this._msg = m;
      clearTimeout(this._flashT);
      this._flashT = setTimeout(() => {
        if (this._msg === m) this._msg = '';
      }, 2500);
    }

    _touch() {
      this._s = Object.assign({}, this._s);
      this._dirty = true;
    }

    _setGlobal(group, key, value) {
      this._s[group] = Object.assign({}, this._s[group], { [key]: value });
      this._touch();
    }

    _setCam(cam, key, value) {
      const i = this._s.cameras.indexOf(cam);
      if (i < 0) return;
      const next = Object.assign({}, cam, { [key]: value });
      if (key === 'type' && value === 'doorbell') {
        if (!cam.mic) next.mic = true;
        if (cam.aspect === '16/9') next.aspect = '3/4';
      }
      if (key === 'entity' && value) {
        const auto = findDetectionEntities(this.hass, value);
        next.detection = Object.assign({}, cam.detection);
        for (const t of DET_TYPES) if (!next.detection[t] && auto[t]) next.detection[t] = auto[t];
      }
      const cams = [...this._s.cameras];
      cams[i] = next;
      this._s.cameras = cams;
      this._touch();
    }

    _setDet(cam, type, value) {
      this._setCam(cam, 'detection', Object.assign({}, cam.detection, { [type]: value }));
    }

    _addCamera() {
      const c = newCamera({ name: `Kamera-${this._s.cameras.length + 1}` });
      this._s.cameras = [...this._s.cameras, c];
      this._open = Object.assign({}, this._open, { [c.id]: true });
      this._touch();
    }

    _removeCamera(cam) {
      if (!confirm(`Kamera „${cam.title || cam.name}" aus den Einstellungen entfernen?`)) return;
      this._s.cameras = this._s.cameras.filter((c) => c !== cam);
      this._touch();
    }

    _moveCamera(cam, dir) {
      const cams = [...this._s.cameras];
      const i = cams.indexOf(cam);
      const j = i + dir;
      if (j < 0 || j >= cams.length) return;
      [cams[i], cams[j]] = [cams[j], cams[i]];
      this._s.cameras = cams;
      this._touch();
    }

    // Reolink-Geräte aus der Geräte-/Entitätsliste von HA übernehmen
    _autoFind() {
      const ents = this.hass.entities || {};
      const devs = this.hass.devices || {};
      const byDev = new Map();
      for (const e of Object.values(ents)) {
        if (!(e.entity_id || '').startsWith('camera.') || !e.device_id) continue;
        if (e.platform && e.platform !== 'reolink') continue;
        if (!byDev.has(e.device_id)) byDev.set(e.device_id, []);
        byDev.get(e.device_id).push(e);
      }
      const rank = (e) => {
        const k = e.translation_key || '';
        const id = e.entity_id;
        if (k === 'main' || /(hochaufl|_clear|_main)/.test(id)) return 0;
        if (k === 'ext' || /(ausgewogen|balanced|_ext)/.test(id)) return 1;
        if (k === 'sub' || /(standardaufl|fluent|_sub)/.test(id)) return 2;
        return 3;
      };
      let added = 0;
      const cams = [...this._s.cameras];
      for (const [devId, list] of byDev) {
        const main = [...list].sort((a, b) => rank(a) - rank(b))[0];
        if (cams.some((c) => c.entity && list.some((e) => e.entity_id === c.entity))) continue;
        const dev = devs[devId] || {};
        const name = dev.name_by_user || dev.name || main.entity_id.split('.')[1];
        if (cams.some((c) => c.name === name)) continue;
        let ip = '';
        try {
          if (dev.configuration_url) ip = new URL(dev.configuration_url).hostname;
        } catch (e) {}
        const doorbell = /doorbell|klingel/i.test(`${dev.model || ''} ${name}`);
        const det = findDetectionEntities(this.hass, main.entity_id);
        cams.push(
          newCamera({
            name,
            title: name,
            type: doorbell ? 'doorbell' : 'camera',
            ip,
            entity: main.entity_id,
            mic: doorbell,
            aspect: doorbell ? '3/4' : '16/9',
            faces: doorbell,
            detection: { person: det.person || '', animal: det.animal || '', vehicle: det.vehicle || '' },
          })
        );
        added++;
      }
      this._s.cameras = cams;
      this._touch();
      this._flash(added ? `${added} Kamera(s) übernommen – bitte prüfen und speichern.` : 'Keine neuen Reolink-Kameras gefunden.');
    }

    _autoDetect(cam) {
      const auto = findDetectionEntities(this.hass, cam.entity);
      if (!Object.keys(auto).length) {
        this._flash('Keine Erkennungs-Sensoren am Gerät dieser Kamera gefunden.');
        return;
      }
      this._setCam(cam, 'detection', {
        person: auto.person || '',
        animal: auto.animal || '',
        vehicle: auto.vehicle || '',
      });
      this._flash('Sensoren übernommen.');
    }

    async _checkMedia(cam) {
      const key = cam ? cam.id : 'base';
      const target = cam ? camMedia(cam, this._s) : this._s.media.base;
      if (!target) {
        this._checks = Object.assign({}, this._checks, { [key]: { ok: false, text: 'Kein Ordner eingetragen' } });
        return;
      }
      this._checks = Object.assign({}, this._checks, { [key]: { busy: true } });
      try {
        const res = await this.hass.callWS({ type: 'media_source/browse_media', media_content_id: target });
        const ch = res.children || [];
        const dirs = ch.filter((c) => c.media_class === 'directory');
        const isImg = (c) => c.media_class === 'image' || (c.media_content_type || '').startsWith('image/');
        const videos = ch.filter((c) => c.media_class !== 'directory' && !isImg(c));
        const faces = ch.filter((c) => isImg(c) && (c.title || '').includes(this._s.faces.tag || DEFAULT_FACE_TAG));
        let text;
        if (!cam) text = `${dirs.length} Ordner: ${dirs.map((d) => d.title).slice(0, 8).join(', ')}${dirs.length > 8 ? ' …' : ''}`;
        else if (videos.length) text = `${videos.length} Aufnahmen${faces.length ? `, ${faces.length} Gesichter` : ''}`;
        else if (dirs.length) text = `${dirs.length} Unterordner (Tages-/Jahresordner)`;
        else text = 'Ordner ist leer';
        this._checks = Object.assign({}, this._checks, { [key]: { ok: true, text, dirs: dirs.map((d) => d.title) } });
      } catch (e) {
        this._checks = Object.assign({}, this._checks, { [key]: { ok: false, text: e.message || String(e) } });
      }
    }

    async _checkGo2rtc() {
      const base = (this._s.go2rtc.lan || `http://${location.hostname}:1984`).replace(/\/+$/, '');
      this._checks = Object.assign({}, this._checks, { go2rtc: { busy: true } });
      try {
        const r = await fetch(base + '/api/streams', { cache: 'no-store' });
        const j = await r.json();
        this._streams = Object.keys(j || {}).sort();
        this._checks = Object.assign({}, this._checks, {
          go2rtc: { ok: true, text: `erreichbar – ${this._streams.length} Streams: ${this._streams.slice(0, 10).join(', ')}` },
        });
      } catch (e) {
        const mixed = location.protocol === 'https:' && base.startsWith('http:');
        this._checks = Object.assign({}, this._checks, {
          go2rtc: {
            ok: false,
            text: mixed
              ? 'Nicht prüfbar: Home Assistant läuft über HTTPS, go2rtc über HTTP (der Browser blockiert das). Im LAN über http:// öffnen.'
              : 'Keine Antwort lesbar. Entweder nicht erreichbar oder go2rtc erlaubt keine Abfrage von einer fremden Adresse (CORS) – die Karte selbst funktioniert trotzdem.',
          },
        });
      }
    }

    async _copy(text, label) {
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      this._flash(`${label || 'YAML'} kopiert ✓`);
    }

    _export() {
      const blob = new Blob([JSON.stringify(this._s, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'the-boring-camera-card-einstellungen.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    _import(ev) {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      f.text()
        .then((t) => {
          this._s = normalizeSettings(JSON.parse(t));
          this._dirty = true;
          this._flash('Importiert – zum Übernehmen speichern.');
        })
        .catch((e) => (this._msg = 'Import fehlgeschlagen: ' + (e.message || e)));
      ev.target.value = '';
    }

    // ---------- Render-Bausteine ----------
    _input(label, value, onInput, opts = {}) {
      return html`<label class="f ${opts.wide ? 'wide' : ''}">
        <span>${label}</span>
        <input
          type=${opts.type || 'text'}
          .value=${value === undefined || value === null ? '' : String(value)}
          placeholder=${opts.placeholder || ''}
          list=${opts.list || ''}
          autocomplete="off"
          @input=${(e) => onInput(opts.type === 'number' ? Number(e.target.value) : e.target.value)}
        />
        ${opts.hint ? html`<small>${opts.hint}</small>` : ''}
      </label>`;
    }

    _select(label, value, options, onChange, opts = {}) {
      return html`<label class="f ${opts.wide ? 'wide' : ''}">
        <span>${label}</span>
        <select @change=${(e) => onChange(e.target.value)}>
          ${options.map(([v, l]) => html`<option value=${v} ?selected=${v === value}>${l}</option>`)}
          ${value && !options.some(([v]) => v === value) ? html`<option value=${value} selected>${value} (nicht gefunden)</option>` : ''}
        </select>
        ${opts.hint ? html`<small>${opts.hint}</small>` : ''}
      </label>`;
    }

    _toggle(label, value, onChange, hint) {
      return html`<label class="tg">
        <input type="checkbox" .checked=${!!value} @change=${(e) => onChange(e.target.checked)} />
        <span class="sw"></span>
        <span class="tl">${label}${hint ? html`<small>${hint}</small>` : ''}</span>
      </label>`;
    }

    _entityOptions(domain, empty) {
      const st = (this.hass && this.hass.states) || {};
      const opts = Object.keys(st)
        .filter((id) => id.startsWith(domain + '.'))
        .sort()
        .map((id) => [id, `${st[id].attributes.friendly_name || id} (${id})`]);
      return [['', empty || '– keine –'], ...opts];
    }

    _check(key) {
      const c = this._checks[key];
      if (!c) return '';
      if (c.busy) return html`<span class="pill">prüfe …</span>`;
      return html`<span class="pill ${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓ ' : '✗ '}${c.text}</span>`;
    }

    _yamlBlock(title, text, key, label) {
      const open = !!this._open[key];
      return html`<div class="yaml ${open ? 'open' : ''}">
        <button class="yhead" @click=${() => (this._open = Object.assign({}, this._open, { [key]: !open }))}>
          <ha-icon icon=${open ? 'mdi:chevron-down' : 'mdi:chevron-right'}></ha-icon>
          <span>${title}</span>
          <span class="spacer"></span>
          <span class="copy" @click=${(e) => { e.stopPropagation(); this._copy(text, label); }}>
            <ha-icon icon="mdi:content-copy"></ha-icon> Kopieren
          </span>
        </button>
        ${open ? html`<pre>${text}</pre>` : ''}
      </div>`;
    }

    _renderCamera(c, idx) {
      const s = this._s;
      const open = this._open[c.id] !== false && (this._open[c.id] === true || s.cameras.length <= 1);
      const ent = this.hass && this.hass.states[c.entity];
      const detOpts = this._entityOptions('binary_sensor', '– aus –');
      const pwShown = !!this._showPw[c.id];
      const detCount = DET_TYPES.filter((t) => c.detection[t]).length;
      return html`<section class="card cam">
        <div class="cam-head" @click=${() => (this._open = Object.assign({}, this._open, { [c.id]: !open }))}>
          <div class="avatar">
            ${ent && ent.attributes.entity_picture
              ? html`<img src=${ent.attributes.entity_picture} />`
              : html`<ha-icon icon=${c.type === 'doorbell' ? 'mdi:doorbell-video' : 'mdi:cctv'}></ha-icon>`}
          </div>
          <div class="title">
            <b>${c.title || c.name || 'Neue Kamera'}</b>
            <small>${[c.name, c.ip, c.entity].filter(Boolean).join(' · ') || 'noch nicht eingerichtet'}</small>
          </div>
          <div class="chips">
            ${detCount ? html`<span class="pill">${detCount}/3 Erkennung</span>` : ''}
            ${s.faces.enabled && c.faces ? html`<span class="pill">Gesichter</span>` : ''}
          </div>
          <div class="order" @click=${(e) => e.stopPropagation()}>
            <button class="icon" ?disabled=${idx === 0} title="Nach oben" @click=${() => this._moveCamera(c, -1)}><ha-icon icon="mdi:arrow-up"></ha-icon></button>
            <button class="icon" ?disabled=${idx === s.cameras.length - 1} title="Nach unten" @click=${() => this._moveCamera(c, 1)}><ha-icon icon="mdi:arrow-down"></ha-icon></button>
          </div>
          <ha-icon class="chev" icon=${open ? 'mdi:chevron-up' : 'mdi:chevron-down'}></ha-icon>
        </div>
        ${open
          ? html`<div class="body">
              <h4>Kamera</h4>
              <div class="grid">
                ${this._input('Name / Ordnername', c.name, (v) => this._setCam(c, 'name', v), { hint: 'So heißt der FTP-Ordner der Kamera, z. B. Haustuer-Klingel' })}
                ${this._input('Titel in der Karte', c.title, (v) => this._setCam(c, 'title', v), { placeholder: c.name })}
                ${this._select('Typ', c.type, [['camera', 'Kamera'], ['doorbell', 'Video-Türklingel']], (v) => this._setCam(c, 'type', v))}
                ${this._select('Kamera-Entität', c.entity, this._entityOptions('camera', '– bitte wählen –'), (v) => this._setCam(c, 'entity', v))}
              </div>
              <h4>Reolink-Zugang <small>nur für die go2rtc-Vorlage</small></h4>
              <div class="grid">
                ${this._input('IP-Adresse', c.ip, (v) => this._setCam(c, 'ip', v.trim()), { placeholder: '192.168.1.100' })}
                ${this._input('RTSP-Port', c.port, (v) => this._setCam(c, 'port', v), { type: 'number' })}
                ${this._input('Benutzer', c.user, (v) => this._setCam(c, 'user', v))}
                <label class="f">
                  <span>Passwort</span>
                  <div class="row">
                    <input
                      type=${pwShown ? 'text' : 'password'}
                      .value=${c.password || ''}
                      autocomplete="new-password"
                      @input=${(e) => this._setCam(c, 'password', e.target.value)}
                    />
                    <button class="icon" title="Anzeigen" @click=${() => (this._showPw = Object.assign({}, this._showPw, { [c.id]: !pwShown }))}>
                      <ha-icon icon=${pwShown ? 'mdi:eye-off' : 'mdi:eye'}></ha-icon>
                    </button>
                  </div>
                  <small>Optional. Leer = Platzhalter in der Vorlage.</small>
                </label>
                ${this._select('Video-Codec', c.codec, [['h264', 'H.264 (Standard)'], ['h265', 'H.265']], (v) => this._setCam(c, 'codec', v))}
              </div>
              <h4>go2rtc-Streams</h4>
              <div class="grid">
                ${this._input('Hauptstream', c.stream, (v) => this._setCam(c, 'stream', v.trim()), { placeholder: camStream(c), list: 'tbc-streams' })}
                ${this._input('Substream', c.stream_sub, (v) => this._setCam(c, 'stream_sub', v.trim()), { placeholder: camStream(c) + '_sub', list: 'tbc-streams' })}
                ${this._toggle('Substream nutzen', c.sub_enabled, (v) => this._setCam(c, 'sub_enabled', v), 'Spart Bandbreite, Vollbild nimmt den Hauptstream')}
              </div>
              <h4>Aufzeichnungen</h4>
              <div class="grid">
                ${this._input('Aufzeichnungsordner', c.media_folder, (v) => this._setCam(c, 'media_folder', v.trim()), {
                  placeholder: camMedia(Object.assign({}, c, { media_folder: '' }), s) || 'media-source://media_source/local/…',
                  wide: true,
                  hint: 'Leer = Basisordner + Name',
                })}
              </div>
              <div class="actions">
                <button class="ghost" @click=${() => this._checkMedia(c)}><ha-icon icon="mdi:folder-search-outline"></ha-icon> Ordner prüfen</button>
                ${this._check(c.id)}
              </div>
              <h4>Erkennung</h4>
              <div class="grid">
                ${DET_TYPES.map((t) => this._select(`${DET_META[t].label}`, c.detection[t], detOpts, (v) => this._setDet(c, t, v)))}
              </div>
              <div class="actions">
                <button class="ghost" ?disabled=${!c.entity} @click=${() => this._autoDetect(c)}><ha-icon icon="mdi:magnify"></ha-icon> Sensoren automatisch suchen</button>
              </div>
              <h4>Darstellung</h4>
              <div class="grid">
                ${this._select('Seitenverhältnis', c.aspect, ASPECTS, (v) => this._setCam(c, 'aspect', v))}
                ${this._select('Bitrate-Helfer', c.bitrate_entity, this._entityOptions('input_number'), (v) => this._setCam(c, 'bitrate_entity', v))}
                ${this._toggle('Push-to-Talk', c.mic, (v) => this._setCam(c, 'mic', v))}
                ${this._toggle('Gesichter anzeigen', c.faces, (v) => this._setCam(c, 'faces', v), s.faces.enabled ? 'TheBoringFace wertet diese Kamera aus' : 'global ausgeschaltet')}
              </div>
              <div class="actions end">
                <button class="danger ghost" @click=${() => this._removeCamera(c)}><ha-icon icon="mdi:delete-outline"></ha-icon> Entfernen</button>
              </div>
            </div>`
          : ''}
        ${this._yamlBlock('Für Fortgeschrittene: YAML der Karte', cardYaml(c, s), 'y-' + c.id, `YAML ${c.title || c.name}`)}
      </section>`;
    }

    render() {
      const s = this._s;
      const g = s.go2rtc;
      const base = this._checks.base;
      return html`
        ${this.panel
          ? html`<div class="toolbar">
              ${customElements.get('ha-menu-button')
                ? html`<ha-menu-button .hass=${this.hass} .narrow=${this.narrow}></ha-menu-button>`
                : ''}
              <div class="tb-title">Kamera-Einstellungen</div>
            </div>`
          : ''}
        <main>
          <header>
            <h1>The Boring Camera Card <span class="pill">v${CARD_VERSION}</span></h1>
            <p class="sub">Optional: zentrale Übersicht und Vorgaben. Die Karte richtet sich beim Anlegen im Dashboard selbst ein – hier ist nichts zwingend nötig.</p>
          </header>
          ${!this._loaded
            ? html`<div class="card">Lade Einstellungen …</div>`
            : html`
              <section class="card">
                <div class="sec-head"><ha-icon icon="mdi:video-wireless-outline"></ha-icon><b>go2rtc</b></div>
                <div class="grid">
                  ${this._input('Server im LAN', g.lan, (v) => this._setGlobal('go2rtc', 'lan', v.trim()), {
                    placeholder: `http://${location.hostname}:1984`,
                    hint: 'Leer = gleicher Host wie Home Assistant, Port 1984',
                  })}
                  ${this._input('Ingress-Pfad (unterwegs)', g.ingress, (v) => this._setGlobal('go2rtc', 'ingress', v.trim()), {
                    placeholder: '/api/hassio_ingress/…',
                    hint: 'Nur beim go2rtc-Add-on',
                  })}
                  ${this._input('Externe Adresse (Fallback)', g.server, (v) => this._setGlobal('go2rtc', 'server', v.trim()), { placeholder: 'https://go2rtc.example.de' })}
                  ${this._input('Zugriffstoken', g.token, (v) => this._setGlobal('go2rtc', 'token', v), { type: 'password' })}
                </div>
                <div class="actions">
                  <button class="ghost" @click=${this._checkGo2rtc}><ha-icon icon="mdi:lan-check"></ha-icon> Verbindung testen</button>
                  ${this._check('go2rtc')}
                </div>
              </section>

              <section class="card">
                <div class="sec-head"><ha-icon icon="mdi:folder-network-outline"></ha-icon><b>Aufzeichnungen (Freigaben)</b></div>
                <div class="grid">
                  ${this._input('Basisordner (media_source)', s.media.base, (v) => this._setGlobal('media', 'base', v.trim()), {
                    wide: true,
                    hint: 'Darunter liegt je Kamera ein Ordner mit ihrem Namen',
                  })}
                  ${this._input('Pfad auf der NAS (Notiz)', s.media.nas_path, (v) => this._setGlobal('media', 'nas_path', v.trim()), { placeholder: '/volume3/Kameraaufzeichnung' })}
                </div>
                <div class="actions">
                  <button class="ghost" @click=${() => this._checkMedia(null)}><ha-icon icon="mdi:folder-search-outline"></ha-icon> Basisordner prüfen</button>
                  ${this._check('base')}
                </div>
                ${base && base.ok && base.dirs && base.dirs.length
                  ? html`<p class="hint">Ordner ohne passende Kamera: ${base.dirs.filter((d) => !s.cameras.some((c) => c.name === d)).join(', ') || 'keine'}</p>`
                  : ''}
              </section>

              <section class="card">
                <div class="sec-head"><ha-icon icon="mdi:account-eye-outline"></ha-icon><b>Erkennung & Gesichter</b></div>
                <div class="grid">
                  ${this._toggle('Person / Tier / Fahrzeug anzeigen', s.detection.badges, (v) => this._setGlobal('detection', 'badges', v), 'Kreis unten rechts am Vorschaubild')}
                  ${this._input('Zeitfenster vorher (s)', s.detection.pre, (v) => this._setGlobal('detection', 'pre', v), { type: 'number' })}
                  ${this._input('Zeitfenster nachher (s)', s.detection.post, (v) => this._setGlobal('detection', 'post', v), { type: 'number', hint: 'Endet spätestens bei der nächsten Aufnahme' })}
                </div>
                <div class="grid">
                  ${this._toggle('Gesichter (TheBoringFace)', s.faces.enabled, (v) => this._setGlobal('faces', 'enabled', v), 'Kreis oben rechts am Vorschaubild')}
                  ${this._toggle('Unbekannte Gesichter zeigen', s.faces.show_unknown, (v) => this._setGlobal('faces', 'show_unknown', v))}
                  ${this._input('Dateikennung', s.faces.tag, (v) => this._setGlobal('faces', 'tag', v.trim()), { placeholder: DEFAULT_FACE_TAG })}
                </div>
              </section>

              <div class="list-head">
                <h2>Kameras <span class="pill">${s.cameras.length}</span></h2>
                <span class="spacer"></span>
                <button class="ghost" @click=${this._autoFind}><ha-icon icon="mdi:auto-fix"></ha-icon> Automatisch finden</button>
                <button @click=${this._addCamera}><ha-icon icon="mdi:plus"></ha-icon> Kamera</button>
              </div>
              ${s.cameras.map((c, i) => this._renderCamera(c, i))}

              ${s.cameras.length
                ? html`<section class="card">
                    <div class="sec-head"><ha-icon icon="mdi:code-braces"></ha-icon><b>Vorlagen</b></div>
                    ${this._yamlBlock('Alle Kameras als 2×2-Raster', gridYaml(s), 'y-grid', 'Raster-YAML')}
                    ${this._yamlBlock('go2rtc.yaml (streams)', go2rtcYaml(s), 'y-go2rtc', 'go2rtc.yaml')}
                    ${this._yamlBlock('TheBoringFace: Kameras für die Gesichtserkennung', facesEnvLine(s) + '\n', 'y-face', 'CAMERAS-Zeile')}
                  </section>`
                : ''}

              <section class="card muted">
                <div class="actions">
                  <button class="ghost" @click=${this._export}><ha-icon icon="mdi:download"></ha-icon> Exportieren</button>
                  <label class="ghost btnlike">
                    <ha-icon icon="mdi:upload"></ha-icon> Importieren
                    <input type="file" accept="application/json" hidden @change=${this._import} />
                  </label>
                </div>
                <p class="hint">
                  Gespeichert wird in Home Assistant (Benutzerdaten deines Kontos). Passwörter stehen dort und im Export im Klartext –
                  nur nötig für die go2rtc-Vorlage.
                </p>
              </section>
            `}
          <datalist id="tbc-streams">${this._streams.map((n) => html`<option value=${n}></option>`)}</datalist>
        </main>
        <div class="bar">
          <span class="msg">${this._msg}</span>
          <button ?disabled=${!this._dirty} @click=${this._save}><ha-icon icon="mdi:content-save"></ha-icon> Speichern</button>
        </div>
      `;
    }

    static get styles() {
      return css`
        :host {
          display: block;
          background: var(--primary-background-color, #f4f6fa);
          color: var(--primary-text-color, #1c2230);
          min-height: 100%;
          --tbc-card: var(--card-background-color, #fff);
          --tbc-line: var(--divider-color, #e3e7ef);
          --tbc-muted: var(--secondary-text-color, #667085);
          --tbc-accent: var(--primary-color, #3b82f6);
          --tbc-input: var(--secondary-background-color, rgba(127, 127, 127, 0.08));
          font-family: var(--paper-font-body1_-_font-family, system-ui, -apple-system, Segoe UI, Roboto, sans-serif);
          font-size: 14px;
        }
        .toolbar {
          display: flex;
          align-items: center;
          height: var(--header-height, 56px);
          padding: 0 12px;
          background: var(--app-header-background-color, var(--primary-color));
          color: var(--app-header-text-color, #fff);
          position: sticky;
          top: 0;
          z-index: 5;
        }
        .tb-title { font-size: 20px; margin-left: 8px; }
        main { max-width: 900px; margin: 0 auto; padding: 18px 14px 110px; }
        h1 { font-size: 1.45rem; margin: 0 0 2px; font-weight: 600; }
        h2 { font-size: 1.15rem; margin: 0; font-weight: 600; }
        h4 { margin: 16px 0 6px; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--tbc-muted); }
        h4 small { text-transform: none; letter-spacing: 0; font-weight: 400; }
        .sub { color: var(--tbc-muted); margin: 0 0 16px; }
        .card {
          background: var(--tbc-card);
          border: 1px solid var(--tbc-line);
          border-radius: 14px;
          padding: 16px;
          margin: 0 0 14px;
        }
        .card.muted { background: transparent; }
        .sec-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 1.02rem; }
        .sec-head ha-icon { color: var(--tbc-accent); }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px 14px; }
        .f { display: flex; flex-direction: column; gap: 3px; margin: 6px 0; min-width: 0; }
        .f.wide { grid-column: 1 / -1; }
        .f > span { font-weight: 600; font-size: 0.86rem; }
        small, .hint { color: var(--tbc-muted); font-size: 0.8rem; }
        .hint { margin: 8px 0 0; }
        input[type='text'], input[type='password'], input[type='number'], select {
          width: 100%;
          box-sizing: border-box;
          padding: 8px 10px;
          border: 1px solid var(--tbc-line);
          border-radius: 9px;
          background: var(--tbc-input);
          color: inherit;
          font: inherit;
          min-width: 0;
        }
        input:focus, select:focus { outline: 2px solid var(--tbc-accent); outline-offset: -1px; }
        .row { display: flex; gap: 6px; align-items: center; }
        .tg { display: flex; align-items: center; gap: 10px; margin: 10px 0; cursor: pointer; }
        .tg input { display: none; }
        .tg .sw { position: relative; width: 42px; height: 24px; border-radius: 12px; background: #9aa4b5; flex: none; transition: 0.2s; }
        .tg .sw::after { content: ''; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: 0.2s; }
        .tg input:checked + .sw { background: #34c759; }
        .tg input:checked + .sw::after { transform: translateX(18px); }
        .tl { display: flex; flex-direction: column; font-weight: 600; font-size: 0.88rem; }
        .tl small { font-weight: 400; }
        button, .btnlike {
          font: inherit;
          font-weight: 600;
          border: 0;
          border-radius: 9px;
          padding: 8px 13px;
          cursor: pointer;
          background: var(--tbc-accent);
          color: var(--text-primary-color, #fff);
          display: inline-flex;
          align-items: center;
          gap: 6px;
          --mdc-icon-size: 18px;
        }
        button.ghost, .btnlike.ghost { background: transparent; color: var(--tbc-accent); border: 1px solid var(--tbc-accent); }
        button.danger { color: var(--error-color, #dc2626); border-color: var(--error-color, #dc2626); }
        button.icon { background: transparent; color: var(--tbc-muted); padding: 5px; border: 0; }
        button:disabled { opacity: 0.4; cursor: default; }
        .actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
        .actions.end { justify-content: flex-end; }
        .pill { display: inline-block; font-size: 0.76rem; font-weight: 600; padding: 2px 9px; border-radius: 20px; background: var(--tbc-input); color: var(--tbc-muted); vertical-align: middle; }
        .pill.ok { background: rgba(52, 199, 89, 0.16); color: #1f8a3b; }
        .pill.bad { background: rgba(255, 69, 58, 0.14); color: #c5281c; white-space: normal; }
        .list-head { display: flex; align-items: center; gap: 10px; margin: 22px 0 12px; flex-wrap: wrap; }
        .spacer { flex: 1; }
        .cam { padding: 0; overflow: hidden; }
        .cam-head { display: flex; align-items: center; gap: 12px; padding: 12px 14px; cursor: pointer; }
        .avatar { width: 52px; height: 38px; border-radius: 8px; background: #1c1c1e; color: #fff; display: flex; align-items: center; justify-content: center; overflow: hidden; flex: none; }
        .avatar img { width: 100%; height: 100%; object-fit: cover; }
        .title { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .title small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .chips { display: flex; gap: 6px; }
        .order { display: flex; }
        .chev { color: var(--tbc-muted); }
        .body { padding: 0 16px 14px; border-top: 1px solid var(--tbc-line); }
        .yaml { border-top: 1px solid var(--tbc-line); }
        .card:not(.cam) .yaml { margin: 0 -16px; }
        .card:not(.cam) .yaml:last-child { margin-bottom: -16px; }
        .yhead {
          width: 100%;
          background: transparent;
          color: inherit;
          border-radius: 0;
          padding: 11px 14px;
          font-weight: 600;
        }
        .yhead ha-icon { color: var(--tbc-muted); }
        .copy { color: var(--tbc-accent); display: inline-flex; align-items: center; gap: 4px; font-size: 0.85rem; --mdc-icon-size: 16px; }
        .copy ha-icon { color: var(--tbc-accent); }
        pre {
          margin: 0;
          padding: 12px 16px 14px;
          background: var(--code-editor-background-color, rgba(127, 127, 127, 0.08));
          font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          overflow-x: auto;
          white-space: pre;
        }
        .bar {
          position: sticky;
          bottom: 0;
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          align-items: center;
          padding: 10px 16px;
          background: var(--tbc-card);
          border-top: 1px solid var(--tbc-line);
          z-index: 4;
        }
        .msg { font-weight: 600; flex: 1; text-align: right; }
        @media (max-width: 600px) {
          .chips { display: none; }
          .grid { grid-template-columns: 1fr; }
        }
      `;
    }
  }

  // =====================================================================================
  //  Einrichtungsassistent im Karteneditor: <the-boring-camera-card-editor>
  //  Öffnet sich, sobald die Karte im Dashboard angelegt oder bearbeitet wird. Der Nutzer
  //  wählt nur die Kamera; Streams, Substream, Aufnahmeordner, Erkennung und Klingel-
  //  Einstellungen werden automatisch gefunden und direkt in die Karte eingetragen.
  //  Kein YAML nötig. Die Werte stehen in der Dashboard-Konfiguration und gelten damit
  //  für alle Benutzer.
  // =====================================================================================
  function normName(s) {
    return slug(s).replace(/_/g, '');
  }

  // Reolink legt je Kamera mehrere Kamera-Entitäten an (Hauptstream / Ausgewogen / Standard).
  function camRank(e) {
    const k = e.translation_key || '';
    const id = e.entity_id || '';
    if (k === 'main' || /(hochaufl|_clear|_main)/.test(id)) return 0;
    if (k === 'ext' || /(ausgewogen|balanced|_ext)/.test(id)) return 1;
    if (k === 'sub' || /(standardaufl|fluent|_sub)/.test(id)) return 2;
    return 3;
  }

  class TheBoringCameraCardEditor extends LitElement {
    static get properties() {
      return {
        hass: { attribute: false },
        _config: { state: true },
        _scan: { state: true },
        _busy: { state: true },
        _choices: { state: true },
        _cams: { state: true },
        _manual: { state: true },
      };
    }

    constructor() {
      super();
      this._config = {};
      this._scan = null;
      this._busy = false;
      this._choices = [];
      this._global = null;
      this._globalLoaded = false;
      this._cams = null;
      this._manual = false;
    }

    setConfig(config) {
      this._config = Object.assign({}, config);
    }

    updated(changed) {
      // Optionale zentrale Vorgaben (Einstellungsseite) einmal lesen
      if (changed.has('hass') && this.hass && !this._globalLoaded) {
        this._globalLoaded = true;
        // Kameras, die in der Integration eingerichtet wurden
        this.hass
          .callWS({ type: 'theboringcameracard/cameras' })
          .then((l) => (this._cams = Array.isArray(l) ? l : []))
          .catch(() => (this._cams = []));
        this.hass
          .callWS({ type: 'frontend/get_user_data', key: SETTINGS_KEY })
          .then((r) => {
            this._global = r && r.value ? normalizeSettings(r.value) : null;
          })
          .catch(() => {
            this._global = null;
          });
      }
    }

    _emit(config) {
      const out = {};
      for (const [k, v] of Object.entries(config)) {
        if (v === undefined || v === null || v === '') continue;
        out[k] = v;
      }
      this._config = out;
      this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: out }, bubbles: true, composed: true }));
    }

    _formChanged(ev) {
      ev.stopPropagation();
      const prev = this._config.entity;
      const next = ev.detail.value || {};
      this._emit(next);
      if (next.entity && next.entity !== prev) this._autoSetup();
    }

    _camFormChanged(ev) {
      ev.stopPropagation();
      const v = ev.detail.value || {};
      this._emit({ type: this._config.type, camera: v.camera, title: v.title });
    }

    _pick(choice) {
      this._choices = [];
      this._emit(Object.assign({}, this._config, { media_folder: choice.id }));
      this._countFolder(choice.id).then((n) => {
        if (!this._scan) return;
        const rows = this._scan.rows.filter((r) => r.key !== 'media');
        rows.push({ key: 'media', st: 'ok', text: `Aufnahmen: ${choice.path}${n ? ' – ' + n : ''}` });
        this._scan = Object.assign({}, this._scan, { rows });
      });
    }

    async _browseDirs(id) {
      try {
        const r = await this.hass.callWS({ type: 'media_source/browse_media', media_content_id: id });
        return (r.children || []).filter((c) => c.can_expand || c.media_class === 'directory');
      } catch (e) {
        return [];
      }
    }

    async _countFolder(id) {
      try {
        const r = await this.hass.callWS({ type: 'media_source/browse_media', media_content_id: id });
        const ch = r.children || [];
        const isImg = (c) => c.media_class === 'image' || (c.media_content_type || '').startsWith('image/');
        const dirs = ch.filter((c) => c.can_expand || c.media_class === 'directory');
        const vids = ch.filter((c) => !dirs.includes(c) && !isImg(c));
        if (vids.length) return `${vids.length} Aufnahmen`;
        if (dirs.length) return `${dirs.length} Unterordner (Tage)`;
        return 'Ordner ist leer';
      } catch (e) {
        return null;
      }
    }

    // Sucht im Medienbrowser Ordner, die zum Kameranamen passen (max. zwei Ebenen tief).
    async _findFolders(name) {
      const want = normName(name);
      if (want.length < 3) return [];
      const match = (t) => {
        const n = normName(t);
        return !!n && (n === want || n.includes(want) || (want.includes(n) && n.length >= 4));
      };
      const out = [];
      const seen = new Set();
      const add = (c, path) => {
        if (seen.has(c.media_content_id)) return;
        seen.add(c.media_content_id);
        out.push({ id: c.media_content_id, title: c.title, path });
      };
      const g = this._global;
      const roots = [];
      if (g && g.media && g.media.base) roots.push({ id: g.media.base, title: g.media.base });
      else for (const r of await this._browseDirs('media-source://media_source')) roots.push({ id: r.media_content_id, title: r.title });
      for (const root of roots) {
        const l1 = await this._browseDirs(root.id);
        for (const c of l1) if (match(c.title)) add(c, `${root.title}/${c.title}`);
        if (out.length) continue;
        for (const d of l1.slice(0, 15)) {
          for (const c of await this._browseDirs(d.media_content_id)) {
            if (match(c.title)) add(c, `${root.title}/${d.title}/${c.title}`);
          }
        }
      }
      return out.slice(0, 6);
    }

    async _autoSetup() {
      const hass = this.hass;
      const entity = this._config.entity;
      if (!hass || !entity || this._busy) return;
      this._busy = true;
      this._choices = [];
      const cfg = Object.assign({}, this._config);
      const patch = {};
      const rows = [];
      try {
        const ent = (hass.entities || {})[entity] || {};
        const dev = (hass.devices || {})[ent.device_id] || {};
        const st = hass.states[entity];
        const devName = dev.name_by_user || dev.name || (st && st.attributes.friendly_name) || entity.split('.')[1];
        rows.push({ key: 'cam', st: 'ok', text: `Kamera: ${devName}` });
        if (!cfg.title) patch.title = devName;

        // --- go2rtc: Streams finden ---
        const g = this._global;
        const server = (cfg.go2rtc_server_lan || (g && g.go2rtc && g.go2rtc.lan) || defaultGo2rtcServer()).replace(/\/+$/, '');
        let streams = null;
        try {
          const r = await fetch(server + '/api/streams', { cache: 'no-store' });
          streams = Object.keys((await r.json()) || {});
        } catch (e) {
          streams = null;
        }
        const has = (n) => !!streams && streams.includes(n);
        let main = cfg.go2rtc_url || entity;
        if (streams && !has(main)) {
          const alt = [slug(devName), devName, entity.split('.')[1]].find(has);
          if (alt) {
            main = alt;
            patch.go2rtc_url = alt;
          }
        }
        if (!streams) {
          rows.push({ key: 'live', st: 'info', text: `Live: go2rtc nicht abfragbar – Standardname „${main}" wird verwendet` });
        } else if (has(main)) {
          rows.push({ key: 'live', st: 'ok', text: `Live: Stream „${main}" in go2rtc gefunden` });
        } else {
          rows.push({
            key: 'live',
            st: 'warn',
            text: `Live: Stream „${main}" fehlt in go2rtc – den richtigen Namen unter „Erweitert" eintragen`,
          });
        }

        // --- Substream: Schwester-Entität des Geräts oder <name>_sub ---
        if (cfg.go2rtc_url_sub) {
          rows.push({ key: 'sub', st: 'ok', text: `Substream: ${cfg.go2rtc_url_sub}` });
        } else {
          const myRank = camRank(ent.entity_id ? ent : { entity_id: entity });
          const sibs = Object.values(hass.entities || {}).filter(
            (e) => e.device_id && e.device_id === ent.device_id && (e.entity_id || '').startsWith('camera.') && e.entity_id !== entity
          );
          const subEnt = myRank <= 1 ? sibs.find((e) => camRank(e) === 2) || (myRank === 0 ? sibs.find((e) => camRank(e) === 1) : null) : null;
          const cands = [subEnt && subEnt.entity_id, main + '_sub', slug(devName) + '_sub'].filter(Boolean);
          const pick = streams ? cands.find(has) : subEnt && subEnt.entity_id;
          if (pick) {
            patch.go2rtc_url_sub = pick;
            rows.push({ key: 'sub', st: 'ok', text: `Substream: ${pick} (spart Bandbreite, Vollbild nutzt den Hauptstream)` });
          } else {
            rows.push({ key: 'sub', st: 'info', text: 'Substream: keiner gefunden (optional)' });
          }
        }

        // --- Zentrale Vorgaben der Einstellungsseite übernehmen (ohne Token) ---
        if (g && g.go2rtc) {
          if (g.go2rtc.lan && !cfg.go2rtc_server_lan) patch.go2rtc_server_lan = g.go2rtc.lan;
          if (g.go2rtc.ingress && !cfg.go2rtc_ingress) patch.go2rtc_ingress = g.go2rtc.ingress;
          if (g.go2rtc.server && !cfg.go2rtc_server) patch.go2rtc_server = g.go2rtc.server;
        }

        // --- Türklingel ---
        if (/doorbell|klingel/i.test(`${dev.model || ''} ${devName}`)) {
          if (cfg.mic === undefined) patch.mic = true;
          if (!cfg.aspect_ratio) patch.aspect_ratio = '3/4';
          rows.push({ key: 'bell', st: 'ok', text: 'Türklingel erkannt: Sprechen und Hochformat aktiviert' });
        }

        // --- Aufnahmen ---
        const mf = cfg.media_folder && typeof cfg.media_folder === 'object' ? cfg.media_folder.media_content_id : cfg.media_folder;
        if (mf) {
          const n = await this._countFolder(mf);
          rows.push({ key: 'media', st: n ? 'ok' : 'warn', text: n ? `Aufnahmen: ${mf} – ${n}` : `Aufnahmen: Ordner „${mf}" nicht lesbar` });
        } else {
          const found = await this._findFolders(devName);
          if (found.length === 1) {
            patch.media_folder = found[0].id;
            const n = await this._countFolder(found[0].id);
            rows.push({ key: 'media', st: 'ok', text: `Aufnahmen: ${found[0].path}${n ? ' – ' + n : ''}` });
          } else if (found.length > 1) {
            this._choices = found;
            rows.push({ key: 'media', st: 'warn', text: 'Aufnahmen: mehrere passende Ordner – bitte einen wählen' });
          } else {
            rows.push({
              key: 'media',
              st: 'warn',
              text: 'Aufnahmen: kein passender Ordner gefunden – unten „Aufzeichnungsordner" wählen (ohne Ordner nur Live-Bild)',
            });
          }
        }

        // --- Erkennung (läuft zur Laufzeit automatisch, hier nur Anzeige) ---
        const det = findDetectionEntities(hass, entity);
        const found = DET_TYPES.filter((t) => det[t]).map((t) => DET_META[t].label);
        rows.push({
          key: 'det',
          st: found.length ? 'ok' : 'info',
          text: found.length ? `Erkennung: ${found.join(', ')} (automatisch)` : 'Erkennung: keine Sensoren am Gerät gefunden (Reolink-Integration nötig)',
        });
      } catch (e) {
        rows.push({ key: 'err', st: 'warn', text: 'Automatische Einrichtung fehlgeschlagen: ' + (e.message || e) });
      }
      // Nur leere Felder füllen – Eingaben des Nutzers bleiben unangetastet.
      const cur = Object.assign({}, this._config);
      for (const [k, v] of Object.entries(patch)) if (cur[k] === undefined || cur[k] === '') cur[k] = v;
      this._scan = { rows };
      this._busy = false;
      this._emit(cur);
    }

    _renderIntegration() {
      const opts = this._cams.map((c) => ({ value: c.id, label: c.title || c.entity }));
      const schema = [
        { name: 'camera', required: true, selector: { select: { mode: 'dropdown', options: opts } } },
        { name: 'title', selector: { text: {} } },
      ];
      const labels = { camera: 'Kamera', title: 'Titel (leer = Name aus der Integration)' };
      return html`
        <div class="assist">
          <div class="ah"><ha-icon icon="mdi:cctv"></ha-icon><b>Eingerichtete Kameras</b></div>
          <p class="hint">
            Die Kameras kommen aus der Integration „The Boring Camera Card". Neue Kamera: Einstellungen → Geräte &amp;
            Dienste → The Boring Camera Card → <i>Kamera hinzufügen</i>.
          </p>
        </div>
        <ha-form
          .hass=${this.hass}
          .data=${this._config}
          .schema=${schema}
          .computeLabel=${(s) => labels[s.name] || s.name}
          @value-changed=${this._camFormChanged}
        ></ha-form>
        <div class="actions">
          <button class="ghost" @click=${() => (this._manual = true)}>Stattdessen ohne Integration einrichten</button>
        </div>
      `;
    }

    render() {
      if (!this.hass) return html``;
      const integrated = this._config.camera && !this._config.entity;
      if (this._cams && this._cams.length && !this._manual && (integrated || !this._config.entity)) {
        return this._renderIntegration();
      }
      const form = TheBoringCameraCard.getConfigForm();
      const has = !!this._config.entity;
      const mark = { ok: '✓', warn: '!', info: '–' };
      return html`
        <div class="assist">
          <div class="ah"><ha-icon icon="mdi:auto-fix"></ha-icon><b>Einrichtungsassistent</b></div>
          ${!has
            ? html`<p class="hint">Kamera unten auswählen. Live-Stream, Substream, Aufnahmeordner, Erkennung und Klingel-Einstellungen werden dann automatisch gefunden und eingetragen.</p>`
            : ''}
          ${this._busy ? html`<p class="hint">Suche …</p>` : ''}
          ${this._scan && !this._busy
            ? html`<ul class="rows">
                ${this._scan.rows.map((r) => html`<li class=${r.st}><span class="m">${mark[r.st]}</span><span>${r.text}</span></li>`)}
              </ul>`
            : ''}
          ${this._choices.length
            ? html`<div class="choices">
                ${this._choices.map((c) => html`<button class="ghost" @click=${() => this._pick(c)}>${c.path}</button>`)}
              </div>`
            : ''}
          <div class="actions">
            <button ?disabled=${!has || this._busy} @click=${() => this._autoSetup()}>
              <ha-icon icon="mdi:magnify"></ha-icon> ${this._scan ? 'Erneut suchen' : 'Automatisch einrichten'}
            </button>
          </div>
        </div>
        <ha-form
          .hass=${this.hass}
          .data=${this._config}
          .schema=${form.schema}
          .computeLabel=${form.computeLabel}
          .computeHelper=${form.computeHelper}
          @value-changed=${this._formChanged}
        ></ha-form>
      `;
    }

    static get styles() {
      return css`
        :host { display: block; }
        .assist {
          border: 1px solid var(--divider-color, #e3e7ef);
          border-radius: 12px;
          padding: 12px 14px;
          margin-bottom: 16px;
          background: var(--secondary-background-color, rgba(127, 127, 127, 0.06));
        }
        .ah { display: flex; align-items: center; gap: 8px; font-size: 1rem; }
        .ah ha-icon { color: var(--primary-color); }
        .hint { margin: 8px 0 0; color: var(--secondary-text-color); font-size: 0.85rem; }
        .rows { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 0.88rem; }
        .rows li { display: flex; gap: 8px; }
        .m { width: 16px; text-align: center; font-weight: 700; flex: none; }
        .ok .m { color: #1f8a3b; }
        .warn .m { color: #c5281c; }
        .info .m { color: var(--secondary-text-color); }
        .choices { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
        .actions { margin-top: 10px; }
        button {
          font: inherit;
          font-weight: 600;
          border: 0;
          border-radius: 9px;
          padding: 8px 13px;
          cursor: pointer;
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
          display: inline-flex;
          align-items: center;
          gap: 6px;
          text-align: left;
        }
        button.ghost { background: transparent; color: var(--primary-color); border: 1px solid var(--primary-color); }
        button:disabled { opacity: 0.4; cursor: default; }
      `;
    }
  }

  customElements.define('the-boring-camera-card-editor', TheBoringCameraCardEditor);

  customElements.define('the-boring-camera-settings', TheBoringCameraSettings);

  customElements.define('the-boring-camera-card', TheBoringCameraCard);

  // Kompatibilität: Dashboards aus der Zeit vor der Umbenennung nutzen noch den alten
  // Kartennamen "portal-camera-card" - der funktioniert damit ohne Änderung weiter.
  if (!customElements.get('portal-camera-card')) {
    customElements.define('portal-camera-card', class extends TheBoringCameraCard {});
  }
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'the-boring-camera-card',
    name: 'The Boring Camera Card',
    description:
      'Kamera-Karte im Apple-Home-Stil: Live-Stream direkt über go2rtc (LAN), Push2Talk, Event-Thumbnails mit Download/Löschen und Tagesauswahl aus media_source. Mit Einrichtungsassistent – kein YAML nötig.',
  });
  window.customCards.push({
    type: 'the-boring-camera-settings',
    name: 'The Boring Camera Card – Einstellungen',
    description: 'Optionale Übersicht: go2rtc-Vorgaben, Aufnahme-Ordner und Reolink-Kameras zentral verwalten.',
  });
  console.info('%c THE-BORING-CAMERA-CARD %c v' + CARD_VERSION + ' ', 'background:#ff9500;color:#000;font-weight:700', 'background:#1c1c1e;color:#fff');
}
