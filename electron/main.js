'use strict';
/**
 * Application desktop (Electron), même architecture que MetaTFT / Mobalytics :
 *  - interface web embarquée (renderer/)
 *  - moteur de collecte Riot dans le processus principal
 *  - mises à jour automatiques via electron-updater (fichier app-update.yml)
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, safeStorage, shell, Tray, Menu, nativeImage, globalShortcut } = require('electron');
const { Engine } = require('../core/engine');
const { Overlay } = require('./overlay');

const OVERLAY_SHORTCUT = 'Alt+G';

app.setAppUserModelId('fr.tftstats.app');
// L'app s'appelait « TFT Stats » : on garde son dossier de données (clé, parties, réglages).
app.setPath('userData', path.join(app.getPath('appData'), 'TFT Stats'));
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let tray = null;
let engine = null;
let overlay = null;
let quitting = false;
let updateState = { state: 'idle', message: '' };

// ---------- Clé API chiffrée par Windows (DPAPI) ----------
function keyStore(dir) {
  const file = path.join(dir, 'riot-key.bin');
  return {
    async get() {
      if (process.env.RIOT_API_KEY) return process.env.RIOT_API_KEY;
      try {
        const buf = fs.readFileSync(file);
        return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
      } catch {
        return '';
      }
    },
    async set(key) {
      const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key) : Buffer.from(key, 'utf8');
      fs.writeFileSync(file, data);
    }
  };
}

function send(event, data) {
  if (win && !win.isDestroyed()) win.webContents.send('tft-event', event, data);
  overlay?.send(event, data);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: 'HexaRise',
    backgroundColor: '#0a0e18',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Liens externes dans le navigateur, jamais dans l'app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // Fermer = réduire dans la zone de notification : la collecte live continue.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('HexaRise');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Ouvrir HexaRise', click: () => win.show() },
      { label: `Mode partie (${OVERLAY_SHORTCUT})`, click: () => overlay.toggle() },
      { label: 'Actualiser les statistiques', click: () => engine.refreshNow() },
      { type: 'separator' },
      { label: 'Quitter', click: () => { quitting = true; app.quit(); } }
    ])
  );
  tray.on('double-click', () => win.show());
}

// ---------- Mises à jour automatiques ----------
function setUpdate(state, message, extra = {}) {
  updateState = { state, message, ...extra };
  send('update', updateState);
}

// Chargé seulement dans l'app installée (lit resources/app-update.yml).
let autoUpdater = null;

function setupUpdater() {
  if (!app.isPackaged) {
    setUpdate('idle', 'Mises à jour désactivées en mode développement.');
    return () => setUpdate('idle', 'Mises à jour désactivées en mode développement.');
  }
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdate('checking', 'Recherche de mise à jour…'));
  autoUpdater.on('update-available', (i) => setUpdate('available', `Version ${i.version} disponible, téléchargement…`));
  autoUpdater.on('update-not-available', () => setUpdate('idle', `Tu as la dernière version (${app.getVersion()}).`));
  autoUpdater.on('download-progress', (p) => setUpdate('downloading', `Téléchargement de la mise à jour : ${Math.round(p.percent)} %`));
  autoUpdater.on('update-downloaded', (i) => setUpdate('downloaded', `Version ${i.version} prête`));
  autoUpdater.on('error', (err) => setUpdate('error', `Mise à jour impossible : ${err.message.split('\n')[0]}`));

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 4 * 60 * 60 * 1000);
  return check;
}

// ---------- IPC ----------
function registerIpc(checkUpdate) {
  const handlers = {
    state: () => engine.getState(),
    static: () => engine.getStatic(),
    meta: () => engine.getMeta(),
    setSettings: (s) => engine.setSettings(s),
    setApiKey: (k) => engine.setApiKey(k),
    testKey: () => engine.testKey(),
    refresh: () => {
      engine.refreshNow();
      return true;
    },
    player: (a) => engine.lookupPlayer(a),
    live: (a) => engine.liveGame(a),
    appInfo: () => ({ version: app.getVersion(), desktop: true, update: updateState }),
    checkUpdate: () => checkUpdate(),
    overlayGet: () => ({ ...overlay.get(), shortcut: OVERLAY_SHORTCUT }),
    overlaySet: (patch) => overlay.set(patch),
    overlayToggle: (force) => overlay.toggle(force),
    openMain: (route) => {
      win.show();
      win.focus();
      if (route) send('navigate', route);
    },
    installUpdate: () => {
      if (!autoUpdater) return;
      quitting = true;
      autoUpdater.quitAndInstall();
    }
  };
  ipcMain.handle('tft', async (_e, channel, arg) => {
    const h = handlers[channel];
    if (!h) throw new Error(`Canal inconnu : ${channel}`);
    return h(arg);
  });
}

app.whenReady().then(() => {
  const demo = !app.isPackaged && process.argv.includes('--demo');
  const dataDir = demo ? path.join(app.getPath('userData'), 'demo') : app.getPath('userData');
  engine = demo
    ? new Engine({
        dataDir,
        keyStore: { get: async () => 'RGAPI-demo', set: async () => {} },
        fetchImpl: require('../test/mock-fetch').createMockFetch({ players: 60, matchesPerPlayer: 14 })
      })
    : new Engine({ dataDir, keyStore: keyStore(dataDir) });
  for (const ev of ['status', 'meta', 'static', 'log']) engine.on(ev, (d) => send(ev, d));

  createWindow();
  overlay = new Overlay({
    dataDir,
    preload: path.join(__dirname, 'preload.js'),
    rendererDir: path.join(__dirname, '..', 'renderer'),
    broadcast: send
  });
  globalShortcut.register(OVERLAY_SHORTCUT, () => overlay.toggle());
  overlay.startWatching();
  createTray();
  const checkUpdate = setupUpdater();
  registerIpc(checkUpdate);
  engine.start();
});

app.on('second-instance', () => {
  if (win) {
    win.show();
    win.focus();
  }
});
app.on('before-quit', () => {
  quitting = true;
  engine?.stop();
  overlay?.destroy();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  /* reste actif dans la zone de notification */
});
