// the-boring-camera-card.js
// Home-Assistant Custom Lovelace Card im Stil der Apple-Home-Kamera-Ansicht.
// Live-Stream direkt über go2rtc (eigene WebRTC-Signalisierung, kein Fremd-Card-Wrapper
// mehr), dezenter Play/Pause-Schalter, Ton/Vollbild-Pille, Push2Talk-Button, waagerechte
// Thumbnail-Leiste mit selbst erzeugten Vorschaubildern (lang drücken = Kontextmenü mit
// Download/Löschen), 24h-Timeline und Tagesauswahl. Aufzeichnungen aus media_source.
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
  const THUMB_W = 120;
  const THUMB_H = 68;
  const THUMB_CACHE_MAX = 100;
  const LONG_PRESS_MS = 550;
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
      };
    }

    setConfig(config) {
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
      // sobald der Nutzer per Hand über den Button unter der Timeline umgeschaltet hat.
      this._streamOverride = null;
      this._byDate = new Map();
      this._folderMode = 'flat'; // 'day' | 'nested' | 'flat'
      this._booted = false;
      this._debug = !!config.debug;
      this._storageKey = 'the-boring-camera-card-thumbs:' + (this._mediaFolder || config.entity);
      this._thumbCache = new Map();
      this._thumbGenerating = new Set();
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
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      if (this._isFullscreen) document.body.style.overflow = '';
      this._stopVisibilityWatch();
      this._disconnectLive();
      clearTimeout(this._longPressTimer);
    }

    set hass(hass) {
      this._hass = hass;
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

    static getStubConfig() {
      return { entity: '', title: 'Kamera', media_folder: '', mic: false, aspect_ratio: '16/9' };
    }

    // ---------- Visueller Config-Editor ----------
    // HA rendert daraus automatisch ein ha-form mit den Standard-Selektoren (Entity-
    // Dropdown, Medien-Browser-Dialog, Schalter, Auswahlliste) - kein eigenes Editor-
    // Element noetig, kein YAML fuer die Einrichtung. "advanced"-Felder werden als
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
        go2rtc_server_lan: 'go2rtc-Server (LAN, z.B. http://192.168.1.11:1984)',
        go2rtc_ingress: 'go2rtc-Ingress-Pfad (für Fernzugriff)',
        go2rtc_server: 'go2rtc-Server (externe Adresse, Fallback)',
        go2rtc_token: 'go2rtc-Zugriffstoken (falls per Reverse-Proxy abgesichert)',
        bitrate_entity: 'Helfer-Entity für Live-Bitrate (input_number)',
        debug: 'Debug-Logging in der Browser-Konsole',
      };
      const helpers = {
        entity: 'Die Kamera-Entität, deren Live-Bild und Aufzeichnungen angezeigt werden sollen.',
        title: 'Wird in der Karte als Name angezeigt.',
        media_folder:
          'Ordner mit den Aufzeichnungen dieser Kamera. Über den Medien-Browser auswählen - leer lassen, wenn es keine lokalen Aufzeichnungen gibt (dann nur Live-Bild, keine Timeline).',
        mic: 'Zeigt einen Push-to-Talk-Button an, mit dem über die Kamera gesprochen werden kann (Kamera muss Audio-Rückkanal unterstützen).',
        aspect_ratio: 'Wie hoch/breit das Videofenster dargestellt wird. "3:4" eignet sich gut für Türklingeln.',
        go2rtc_url: 'Name des Streams in go2rtc, falls er vom Entity-Namen abweicht. Standard: Entity-ID.',
        go2rtc_url_sub:
          'Name eines separaten Substreams in go2rtc (niedrigere Auflösung), z.B. bei Reolink-Kameras oft "<kamera>_sub". Wenn gesetzt, verbindet sich die Karte im Normalbetrieb mit diesem Substream, um Bandbreite und Rechenleistung zu sparen, und wechselt automatisch zum Hauptstream (oben), sobald das Vollbild geöffnet wird. Zusätzlich erscheint unter der Timeline ein kleiner Button, mit dem manuell jederzeit zwischen Haupt- und Substream umgeschaltet werden kann. Leer lassen, wenn deine Kamera keinen Substream anbietet.',
        go2rtc_server_lan:
          'Nur nötig, wenn go2rtc NICHT auf demselben Host wie Home Assistant läuft. Standard: gleicher Host, Port 1984.',
        go2rtc_ingress:
          'Relativer Pfad zum go2rtc-Add-on über HA-Ingress, für Zugriff von unterwegs ohne eigenen Reverse-Proxy. In den go2rtc-Add-on-Infos zu finden.',
        go2rtc_server: 'Alternative externe go2rtc-Adresse, falls kein Ingress verwendet wird.',
        go2rtc_token: 'Nur nötig, falls ein eigener Reverse-Proxy vor go2rtc ein Token verlangt.',
        bitrate_entity:
          'Optionaler input_number-Helfer, in den die Karte die live gemessene Bitrate schreibt (z.B. für eine Anzeige-Pille außerhalb der Karte).',
        debug: 'Schreibt detaillierte Diagnose-Meldungen in die Browser-Konsole (F12).',
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
      try {
        if (this._folderMode === 'day' || this._folderMode === 'nested') {
          const res = await this._browse(day.id);
          const files = (res.children || []).filter((c) => c.media_class !== 'directory' && !this._isImage(c));
          this._log('Dateien für', day.date, files.map((f) => f.title));
          this._clips = files
            .map((c) => ({ item: c, ts: parseTs(c.title) || parseTs(c.media_content_id) }))
            .sort((a, b) => (a.ts?.seconds ?? 0) - (b.ts?.seconds ?? 0));
        } else {
          const list = this._byDate.get(day.date) || [];
          this._clips = [...list].sort((a, b) => (a.ts?.seconds ?? 0) - (b.ts?.seconds ?? 0));
        }
      } catch (e) {
        this._error = 'Tag konnte nicht geladen werden (' + (e.message || e) + ')';
        this._clips = [];
      } finally {
        this._loading = false;
        this.requestUpdate();
        this._ensureThumbsForDay();
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

    // ---------- Thumbnail-Erzeugung (client-seitig, mit localStorage-Cache) ----------

    _loadThumbCacheFromStorage() {
      try {
        const raw = localStorage.getItem(this._storageKey);
        if (raw) this._thumbCache = new Map(Object.entries(JSON.parse(raw)));
      } catch (e) {
        this._log('Thumbnail-Cache konnte nicht geladen werden', e);
      }
    }

    _persistThumbCache() {
      try {
        const obj = {};
        let i = 0;
        for (const [k, v] of this._thumbCache) {
          if (i++ >= THUMB_CACHE_MAX) break;
          obj[k] = v;
        }
        localStorage.setItem(this._storageKey, JSON.stringify(obj));
      } catch (e) {
        this._log('Thumbnail-Cache konnte nicht gespeichert werden (Speicher voll?)', e);
      }
    }

    async _ensureThumbsForDay() {
      const todo = this._clips
        .filter((c) => !c.item.thumbnail && !this._thumbCache.has(c.item.media_content_id))
        .slice(0, 24);
      for (const c of todo) {
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
        const dataUrl = canvas.toDataURL('image/jpeg', 0.55);
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
    // der Timeline manuell "Hauptstream" oder "Substream" gewählt, gilt diese Wahl fest,
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

    // Manueller Umschalter (Button unter der Timeline): schaltet fest zwischen Haupt-
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
        if (!this._isVisible()) {
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
      if (!this._hass || !this.config) return html``;
      const stateObj = this._hass.states[this.config.entity];
      const caption =
        this._mode === 'playback' && this._selected
          ? (this._selected.clip.ts ? this._selected.clip.ts.label : '')
          : 'Live';
      const subLabel =
        this._mode === 'playback' && this._selected && this._selected.clip.ts
          ? fmtDayLabel(this._selected.clip.ts.date)
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
                  </div>`;
                })}
            ${!this._loading && !this._clips.length
              ? html`<div class="thumb-empty">Keine Aufzeichnungen an diesem Tag</div>`
              : ''}
          </div>

          <div class="timeline-row">
            <button class="today-btn ${todayKey && this._day?.date === todayKey ? 'active' : ''}" @click=${this._jumpToday} @dblclick=${this._openDayPicker} title="Anderen Tag wählen (Doppelklick)">
              ${fmtDayLabel(this._day?.date)}
            </button>
            <div class="timeline">
              <div class="timeline-track">
                ${['00', '06', '12', '18', '24'].map((t) => html`<span class="tick">${t}</span>`)}
                ${this._clips
                  .filter((c) => c.ts)
                  .map(
                    (c) => html`<div
                      class="marker ${this._selected?.clip === c ? 'active' : ''}"
                      style="left:${(c.ts.seconds / 86400) * 100}%"
                      title=${c.ts.label}
                      @click=${() => this._playClip(c)}
                    ></div>`
                  )}
              </div>
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
          display: flex;
          gap: 6px;
          padding: 16px 12px 8px;
          overflow-x: auto;
          scrollbar-width: none;
          opacity: 0.92;
        }
        .thumb-strip::-webkit-scrollbar {
          display: none;
        }
        .thumb {
          flex: 0 0 auto;
          width: 46px;
          height: 46px;
          border-radius: 8px;
          background: #1c1c1e;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1px;
          color: rgba(255, 255, 255, 0.85);
          font-size: 8px;
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
          background: rgba(0, 0, 0, 0.35);
          padding: 0 2px;
          border-radius: 3px;
        }
        .thumb.active {
          border-color: rgba(255, 255, 255, 0.55);
          opacity: 1;
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
        .timeline-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px 14px;
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
        .timeline {
          flex: 1;
          min-width: 0;
        }
        .timeline-track {
          position: relative;
          height: 30px;
          border-radius: 8px;
          background: rgba(127, 127, 127, 0.15);
        }
        .tick {
          position: absolute;
          top: 8px;
          font-size: 9px;
          color: var(--secondary-text-color);
          transform: translateX(-50%);
        }
        .tick:nth-child(1) {
          left: 0%;
        }
        .tick:nth-child(2) {
          left: 25%;
        }
        .tick:nth-child(3) {
          left: 50%;
        }
        .tick:nth-child(4) {
          left: 75%;
        }
        .tick:nth-child(5) {
          left: 100%;
        }
        .marker {
          position: absolute;
          top: 3px;
          width: 8px;
          height: 24px;
          border-radius: 4px;
          background: rgba(255, 149, 0, 0.55);
          transform: translateX(-50%);
          cursor: pointer;
        }
        .marker.active {
          background: #ff9500;
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

  customElements.define('the-boring-camera-card', TheBoringCameraCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'the-boring-camera-card',
    name: 'The Boring Camera Card',
    description:
      'Kamera-Karte im Apple-Home-Stil: Live-Stream direkt über go2rtc (LAN), Push2Talk, Event-Thumbnails mit Download/Löschen, Tagesauswahl und Timeline aus media_source.',
  });
}
