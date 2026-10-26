// HexaRise API · Hexa Labs
// Recherche de profil TFT pour l'app HexaRise, avec la clé Riot de production gardée côté serveur.
// Ne renvoie que les données du joueur cherché, jamais celles des autres joueurs de ses parties,
// et pour une partie en cours uniquement « en partie ou non » (règles Riot pour TFT).
import riotModule from '../../core/riot.js';
import aggregateModule from '../../core/aggregate.js';
import playerModule from '../../core/player.js';

const { RiotClient, PLATFORMS } = riotModule;
const { compactMatch } = aggregateModule;
const { fetchPlayer, fetchLive, parseRiotId } = playerModule;

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Accept, Content-Type, X-Client',
  'x-content-type-options': 'nosniff'
};
const TTL = { player: 120, live: 30, match: 7 * 24 * 3600 };
const LIMIT = { perMinute: 30 }; // par adresse IP, en plus du cache

const json = (body, status = 200, maxAge = 0) =>
  new Response(JSON.stringify(body), { status, headers: { ...HEADERS, 'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store' } });
const fail = (status, code, error) => json({ error, code }, status);

// Un client Riot par instance : le limiteur de débit est partagé entre les requêtes.
let client = null;
function riot(env) {
  if (!client || client.key !== env.RIOT_API_KEY) {
    client = new RiotClient({ getApiKey: () => env.RIOT_API_KEY });
    client.key = env.RIOT_API_KEY;
  }
  return client;
}

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now > h.reset) {
    hits.set(ip, { n: 1, reset: now + 60_000 });
    if (hits.size > 5000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    return false;
  }
  h.n += 1;
  return h.n > LIMIT.perMinute;
}

async function cached(cache, key, ttl, produce) {
  const req = new Request(key);
  const hit = await cache?.match(req);
  if (hit) return hit.json();
  const value = await produce();
  if (value !== null && value !== undefined) {
    await cache?.put(req, new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` } }));
  }
  return value;
}

function riotError(err) {
  if (err.code === 'NOT_FOUND') return fail(404, 'NOT_FOUND', err.message);
  if (err.code === 'BAD_ID') return fail(400, 'BAD_ID', err.message);
  if (err.code === 'RATE' || err.status === 429) return fail(429, 'RATE', 'Trop de recherches en ce moment, réessaie dans une minute.');
  // Clé refusée, réseau, erreur Riot : le joueur n'a pas à voir le détail de la clé du serveur.
  console.log(`Erreur Riot : ${err.code || ''} ${err.message}`);
  return fail(503, 'API_DOWN', 'Serveur Hexa Labs momentanément indisponible.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...HEADERS, 'access-control-allow-methods': 'GET, OPTIONS' } });
    if (request.method !== 'GET') return fail(405, 'METHOD', 'Méthode non prise en charge.');
    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ service: 'HexaRise API', by: 'Hexa Labs', ready: Boolean(env.RIOT_API_KEY) });
    }
    if (!env.RIOT_API_KEY) return fail(503, 'API_DOWN', 'Le serveur Hexa Labs attend sa clé Riot de production.');
    const ip = request.headers.get('cf-connecting-ip') || 'local';
    if (limited(ip)) return fail(429, 'RATE', 'Trop de recherches, réessaie dans une minute.');

    const q = url.searchParams;
    const platform = PLATFORMS[q.get('platform')] ? q.get('platform') : 'euw1';
    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const base = `https://cache.hexarise.internal`;
    try {
      if (url.pathname === '/v1/player') {
        const riotId = q.get('riotId') || '';
        const [name, tag] = parseRiotId(riotId);
        const key = `${base}/player/${platform}/${encodeURIComponent(`${name}#${tag}`.toLowerCase())}`;
        const body = await cached(cache, key, TTL.player, () =>
          fetchPlayer(riot(env), {
            platform,
            riotId,
            getMatch: (id) => cached(cache, `${base}/match/${encodeURIComponent(id)}`, TTL.match, async () => compactMatch(await riot(env).match(platform, id)))
          })
        );
        return json(body, 200, TTL.player);
      }
      if (url.pathname === '/v1/live') {
        const puuid = q.get('puuid') || '';
        if (!/^[\w-]{20,100}$/.test(puuid)) return fail(400, 'BAD_ID', 'Identifiant de joueur invalide.');
        const body = await cached(cache, `${base}/live/${platform}/${puuid}`, TTL.live, () => fetchLive(riot(env), { platform, puuid }));
        return json(body, 200, TTL.live);
      }
      return fail(404, 'NOT_FOUND', 'Adresse inconnue.');
    } catch (err) {
      return riotError(err);
    }
  }
};
