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
const { BrowserWindow, screen, shell } = require('electron');
const { gameMode } = require('../core/live-client');

const DEFAULTS = { compId: null, bracket: 'all', autoOpen: true, opacity: 0.95, bounds: null, checks: {}, tab: 'guide', screen2Auto: false, wideBounds: null };
const POLL_MS = 5000;

class Overlay {
  constructor({ dataDir, preload, rendererDir, broadcast }) {
    this.file = path.join(dataDir, 'overlay.json');
    this.preload = preload;
    this.rendererDir = rendererDir;
    this.broadcast = broadcast;
    this.win = null;
    this.wide = null; // Écran 2 : guide en grand sur un deuxième écran
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
    return { ...this.state, inGame: this.inGame, visible: Boolean(this.win?.isVisible()), screen2: Boolean(this.wide?.isVisible()), displays: screen.getAllDisplays().length };
  }

  set(patch = {}) {
    for (const k of Object.keys(DEFAULTS)) if (k in patch && k !== 'bounds' && k !== 'wideBounds') this.state[k] = patch[k];
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
      backgroundColor: '#0B0F14',
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
    if (this.wide && !this.wide.isDestroyed()) this.wide.webContents.send('tft-event', event, data);
  }

  // ---------- Écran 2 (deuxième écran) ----------
  /** Écran qui n'affiche pas le jeu : le premier écran secondaire, sinon l'écran principal. */
  _otherDisplay() {
    const primary = screen.getPrimaryDisplay();
    return screen.getAllDisplays().find((d) => d.id !== primary.id) || primary;
  }

  _createWide() {
    const saved = this.state.wideBounds;
    const onScreen = saved && screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return saved.x >= a.x - 50 && saved.y >= a.y - 50 && saved.x < a.x + a.width && saved.y < a.y + a.height;
    });
    const area = this._otherDisplay().workArea;
    this.wide = new BrowserWindow({
      ...(onScreen ? saved : { x: area.x, y: area.y, width: area.width, height: area.height }),
      minWidth: 720,
      minHeight: 480,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#0B0F14',
      title: 'HexaRise · Écran 2',
      icon: path.join(this.rendererDir, '..', 'build', 'icon.png'),
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    if (!onScreen) this.wide.maximize();
    this.wide.loadFile(path.join(this.rendererDir, 'screen2.html'));
    this.wide.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    this.wide.webContents.on('will-navigate', (e) => e.preventDefault());
    const remember = () => {
      if (!this.wide || this.wide.isDestroyed() || this.wide.isMaximized()) return;
      this.state.wideBounds = this.wide.getBounds();
      this._save();
    };
    this.wide.on('moved', remember);
    this.wide.on('resized', remember);
    this.wide.on('close', (e) => {
      if (!this.quitting) {
        e.preventDefault();
        this.hideWide();
      }
    });
  }

  showWide({ focus = true } = {}) {
    if (!this.wide || this.wide.isDestroyed()) this._createWide();
    const reveal = () => (focus ? this.wide.show() : this.wide.showInactive());
    if (this.wide.webContents.isLoading()) this.wide.once('ready-to-show', reveal);
    else reveal();
    this.broadcast('overlay', this.get());
  }

  hideWide() {
    this.wide?.hide();
    this.wideAutoOpened = false;
    this.broadcast('overlay', this.get());
  }

  toggleWide(force) {
    const want = typeof force === 'boolean' ? force : !this.wide?.isVisible();
    if (want) this.showWide();
    else this.hideWide();
    return this.get();
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
        // Écran 2 automatique, seulement s'il y a vraiment un deuxième écran.
        if (this.state.screen2Auto && screen.getAllDisplays().length > 1 && !this.wide?.isVisible()) {
          this.showWide({ focus: false });
          this.wideAutoOpened = true;
        }
      } else {
        if (this.autoOpened) this.hide();
        if (this.wideAutoOpened) this.hideWide();
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
    if (this.wide && !this.wide.isDestroyed()) this.wide.destroy();
  }
}

module.exports = { Overlay };
