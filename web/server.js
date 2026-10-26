'use strict';
/**
 * Version web : même interface, servie en local sur http://localhost:3210.
 * La clé Riot reste côté serveur (Riot interdit de l'exposer dans un navigateur).
 *   npm run web          -> données réelles (clé dans Paramètres ou RIOT_API_KEY)
 *   npm run web:demo     -> données simulées, sans clé
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Engine, fileKeyStore, memoryKeyStore } = require('../core/engine');
const { watchGame } = require('../core/live-client');
const { LiveBoard } = require('../core/live-board');

const DEMO = process.argv.includes('--demo');
const PORT = Number(process.env.PORT) || 3210;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.join(__dirname, '..', 'renderer');
const DATA = path.join(__dirname, '..', DEMO ? 'data-demo' : 'data');

let fetchImpl;
if (DEMO) fetchImpl = require('../test/mock-fetch').createMockFetch({ players: 60, matchesPerPlayer: 14 });

const engine = new Engine({
  dataDir: DATA,
  keyStore: DEMO ? memoryKeyStore('RGAPI-demo') : fileKeyStore(path.join(DATA, '.riot-key')),
  fetchImpl
});

const clients = new Set();
for (const event of ['status', 'meta', 'static', 'log', 'content']) {
  engine.on(event, (data) => {
    const payload = `data: ${JSON.stringify({ event, data })}\n\n`;
    for (const res of clients) res.write(payload);
  });
}

// Détection de partie : la recommandation se verrouille pendant une partie TFT (règles Riot).
const broadcast = (event, data) => {
  const payload = `data: ${JSON.stringify({ event, data })}\n\n`;
  for (const res of clients) res.write(payload);
};
const game = watchGame((inGame) => broadcast('overlay', { inGame }));
// Plateau en direct : pas d'Overwolf dans la version web ; simulation possible avec --demo-board.
const liveBoard = new LiveBoard({ send: broadcast });
if (process.argv.includes('--demo-board')) liveBoard.simulate(() => engine.getStatic(), () => engine.getMeta());

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e5) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const routes = {
  'GET /api/state': () => engine.getState(),
  'GET /api/static': () => engine.getStatic(),
  'GET /api/meta': () => engine.getMeta(),
  'GET /api/content': () => engine.getContent(),
  'GET /api/game': () => ({ inGame: game.inGame }),
  'GET /api/board': () => liveBoard.get(),
  'POST /api/settings': (q, body) => engine.setSettings(body),
  'POST /api/key': (q, body) => engine.setApiKey(body.key),
  'POST /api/key/test': () => engine.testKey(),
  'POST /api/refresh': () => {
    engine.refreshNow();
    return { ok: true };
  },
  'GET /api/player': (q) => engine.lookupPlayer({ riotId: q.get('riotId'), platform: q.get('platform') }),
  'GET /api/live': (q) => engine.liveGame({ puuid: q.get('puuid'), platform: q.get('platform') })
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': ok\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  const handler = routes[`${req.method} ${url.pathname}`];
  if (handler) {
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      send(res, 200, (await handler(url.searchParams, body)) ?? null);
    } catch (err) {
      send(res, err.status === 404 ? 404 : 400, { error: err.message });
    }
    return;
  }

  // Fichiers statiques de l'interface
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) return send(res, 403, { error: 'Interdit' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'Introuvable' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`HexaRise ${DEMO ? '(démo) ' : ''}disponible sur http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  engine.start();
});
