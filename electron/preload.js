'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set(['state', 'static', 'meta', 'content', 'setSettings', 'setApiKey', 'testKey', 'refresh', 'player', 'live', 'appInfo', 'checkUpdate', 'installUpdate', 'overlayGet', 'overlaySet', 'overlayToggle', 'openMain', 'appReady', 'screen2Toggle']);
const EVENTS = new Set(['status', 'meta', 'static', 'log', 'content', 'update', 'overlay', 'game', 'navigate']);
const listeners = {};

ipcRenderer.on('tft-event', (_e, event, data) => {
  (listeners[event] || []).forEach((cb) => cb(data));
});

contextBridge.exposeInMainWorld('tftDesktop', {
  invoke(channel, arg) {
    if (!CHANNELS.has(channel)) return Promise.reject(new Error('Canal non autorisé'));
    return ipcRenderer.invoke('tft', channel, arg);
  },
  on(event, cb) {
    if (EVENTS.has(event)) (listeners[event] ||= []).push(cb);
  }
});
