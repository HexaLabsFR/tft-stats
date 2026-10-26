'use strict';
/**
 * Mode partie : petite fenêtre toujours au premier plan avec le guide de la compo
 * choisie AVANT la partie.
 *
 * Conformité Riot (politique TFT) : la fenêtre n'affiche que des données statiques
 * (guide, recettes, stats d'augments). La seule information lue sur la partie est
 * « une partie TFT est-elle en cours ? » via l'API officielle du client de jeu
 * (127.0.0.1:2999, champ gameMode). Ni la boutique, ni le plateau, ni les adversaires.
 */
const path = require('path');
const fs = require('fs');
const https = require('https');
const { BrowserWindow, screen, shell } = require('electron');

const DEFAULTS = { compId: null, bracket: 'all', autoOpen: true, opacity: 0.95, bounds: null, checks: {}, tab: 'guide' };
const POLL_MS = 5000;

class Overlay {
  constructor({ dataDir, preload, rendererDir, broadcast }) {
    this.file = path.join(dataDir, 'overlay.json');
    this.preload = preload;
    this.rendererDir = rendererDir;
    this.broadcast = broadcast;
    this.win = null;
    this.inGame = false;
    this.autoOpened = false;
    try {
      this.state = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch {
      this.state = { ...DEFAULTS };
    }
  }

  _save() {
    fs.writeFileSync(this.file, JSON.stringify(this.state));
  }

  get() {
    return { ...this.state, inGame: this.inGame, visible: Boolean(this.win?.isVisible()) };
  }

  set(patch = {}) {
    for (const k of Object.keys(DEFAULTS)) if (k in patch && k !== 'bounds') this.state[k] = patch[k];
    // Nouvelle compo choisie : on repart d'une liste vierge.
    if ('compId' in patch) this.state.checks = {};
    this.state.opacity = Math.min(1, Math.max(0.4, Number(this.state.opacity) || 0.95));
    if (this.win) this.win.setOpacity(this.state.opacity);
    this._save();
    this.broadcast('overlay', this.get());
    return this.get();
  }

  _create() {
    const b = this.state.bounds;
    const area = screen.getPrimaryDisplay().workArea;
    this.win = new BrowserWindow({
      width: b?.width || 380,
      height: b?.height || 680,
      x: b?.x ?? area.x + area.width - 400,
      y: b?.y ?? area.y + 80,
      minWidth: 300,
      minHeight: 320,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      show: false,
      backgroundColor: '#0a0e18',
      title: 'HexaRise · Mode partie',
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    // Niveau « screen-saver » : reste visible au-dessus du jeu en plein écran fenêtré.
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setOpacity(this.state.opacity);
    this.win.loadFile(path.join(this.rendererDir, 'overlay.html'));
    this.win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    this.win.webContents.on('will-navigate', (e) => e.preventDefault());
    const remember = () => {
      if (!this.win || this.win.isDestroyed()) return;
      this.state.bounds = this.win.getBounds();
      this._save();
    };
    this.win.on('moved', remember);
    this.win.on('resized', remember);
    this.win.on('close', (e) => {
      if (!this.quitting) {
        e.preventDefault();
        this.hide();
      }
    });
  }

  show({ focus = true } = {}) {
    if (!this.win || this.win.isDestroyed()) this._create();
    const reveal = () => (focus ? this.win.show() : this.win.showInactive());
    if (this.win.webContents.isLoading()) this.win.once('ready-to-show', reveal);
    else reveal();
    this.broadcast('overlay', this.get());
  }

  hide() {
    this.win?.hide();
    this.autoOpened = false;
    this.broadcast('overlay', this.get());
  }

  toggle(force) {
    const visible = Boolean(this.win?.isVisible());
    const want = typeof force === 'boolean' ? force : !visible;
    if (want) this.show();
    else this.hide();
    return this.get();
  }

  send(event, data) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('tft-event', event, data);
  }

  // ---------- Détection de partie (gameMode uniquement) ----------
  startWatching() {
    const tick = async () => {
      const mode = await gameMode();
      const inGame = mode === 'TFT';
      if (inGame === this.inGame) return;
      this.inGame = inGame;
      if (inGame) {
        this.state.checks = {};
        this._save();
        if (this.state.autoOpen && !this.win?.isVisible()) {
          // Sans voler le focus au jeu.
          this.show({ focus: false });
          this.autoOpened = true;
        }
      } else if (this.autoOpened) {
        this.hide();
      }
      this.broadcast('game', { inGame });
      this.broadcast('overlay', this.get());
    };
    this.timer = setInterval(tick, POLL_MS);
    tick();
  }

  destroy() {
    clearInterval(this.timer);
    this.quitting = true;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
  }
}

/** API officielle du client de jeu (certificat Riot auto-signé, uniquement en local). */
function gameMode() {
  return new Promise((resolve) => {
    const req = https.get(
      {
        host: '127.0.0.1',
        port: 2999,
        path: '/liveclientdata/gamestats',
        rejectUnauthorized: false,
        timeout: 1500
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw).gameMode || null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

module.exports = { Overlay };
