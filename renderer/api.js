// Pont unique : IPC dans l'app desktop, HTTP + flux SSE dans la version web.
const desktop = window.tftDesktop;

async function http(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

export const isDesktop = Boolean(desktop);

function webOverlay() {
  try {
    return { compId: null, bracket: 'all', autoOpen: false, opacity: 1, checks: {}, tab: 'guide', ...JSON.parse(localStorage.getItem('overlay') || '{}') };
  } catch {
    return { compId: null, bracket: 'all', checks: {}, tab: 'guide' };
  }
}

export const api = desktop
  ? {
      state: () => desktop.invoke('state'),
      static: () => desktop.invoke('static'),
      meta: () => desktop.invoke('meta'),
      content: () => desktop.invoke('content'),
      setSettings: (s) => desktop.invoke('setSettings', s),
      setApiKey: (k) => desktop.invoke('setApiKey', k),
      testKey: () => desktop.invoke('testKey'),
      refresh: () => desktop.invoke('refresh'),
      player: (riotId, platform) => desktop.invoke('player', { riotId, platform }),
      live: (puuid, platform) => desktop.invoke('live', { puuid, platform }),
      appInfo: () => desktop.invoke('appInfo'),
      appReady: () => desktop.invoke('appReady'),
      installUpdate: () => desktop.invoke('installUpdate'),
      checkUpdate: () => desktop.invoke('checkUpdate'),
      overlayGet: () => desktop.invoke('overlayGet'),
      overlaySet: (p) => desktop.invoke('overlaySet', p),
      overlayToggle: (force) => desktop.invoke('overlayToggle', force),
      openMain: (route) => desktop.invoke('openMain', route),
      on: (event, cb) => desktop.on(event, cb)
    }
  : {
      state: () => http('GET', '/api/state'),
      static: () => http('GET', '/api/static'),
      meta: () => http('GET', '/api/meta'),
      content: () => http('GET', '/api/content'),
      setSettings: (s) => http('POST', '/api/settings', s),
      setApiKey: (k) => http('POST', '/api/key', { key: k }),
      testKey: () => http('POST', '/api/key/test'),
      refresh: () => http('POST', '/api/refresh'),
      player: (riotId, platform) => http('GET', `/api/player?riotId=${encodeURIComponent(riotId)}&platform=${platform}`),
      live: (puuid, platform) => http('GET', `/api/live?puuid=${encodeURIComponent(puuid)}&platform=${platform}`),
      appInfo: async () => ({ version: 'web', desktop: false }),
      appReady: async () => true,
      installUpdate: async () => {},
      checkUpdate: async () => {},
      // Version web : réglages du mode partie dans le navigateur, fenêtre pop-up.
      overlayGet: async () => ({ ...webOverlay(), shortcut: null, inGame: false }),
      overlaySet: async (p) => {
        const next = { ...webOverlay(), ...p };
        if ('compId' in p) next.checks = {};
        try {
          localStorage.setItem('overlay', JSON.stringify(next));
        } catch { /* stockage indisponible */ }
        window.dispatchEvent(new CustomEvent('tft-overlay', { detail: next }));
        return next;
      },
      overlayToggle: async () => {
        window.open('overlay.html', 'tft-overlay', 'width=390,height=700');
      },
      openMain: async () => window.opener?.focus(),
      on: (() => {
        const handlers = {};
        let source;
        const connect = () => {
          source = new EventSource('/api/events');
          source.onmessage = (e) => {
            const { event, data } = JSON.parse(e.data);
            (handlers[event] || []).forEach((cb) => cb(data));
          };
          source.onerror = () => {
            source.close();
            setTimeout(connect, 3000);
          };
        };
        connect();
        return (event, cb) => {
          (handlers[event] ||= []).push(cb);
        };
      })()
    };
