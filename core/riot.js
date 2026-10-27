'use strict';
/**
 * Client Riot API pour TFT, avec limiteur de débit par hôte.
 * Clé de développement : 20 requêtes / 1 s et 100 requêtes / 2 min.
 * Les limites réelles sont relues dans les en-têtes X-App-Rate-Limit.
 */

const PLATFORMS = {
  euw1: { label: 'EUW', region: 'europe' },
  eun1: { label: 'EUNE', region: 'europe' },
  tr1: { label: 'TR', region: 'europe' },
  ru: { label: 'RU', region: 'europe' },
  me1: { label: 'ME', region: 'europe' },
  na1: { label: 'NA', region: 'americas' },
  br1: { label: 'BR', region: 'americas' },
  la1: { label: 'LAN', region: 'americas' },
  la2: { label: 'LAS', region: 'americas' },
  kr: { label: 'KR', region: 'asia' },
  jp1: { label: 'JP', region: 'asia' },
  oc1: { label: 'OCE', region: 'sea' },
  sg2: { label: 'SEA', region: 'sea' },
  tw2: { label: 'TW', region: 'sea' },
  vn2: { label: 'VN', region: 'sea' }
};

// Le compte Riot (Riot ID) n'existe que sur americas / asia / europe.
function accountRegion(platform) {
  const r = PLATFORMS[platform]?.region || 'europe';
  return r === 'sea' ? 'asia' : r;
}

class RiotError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fenêtres glissantes : [[nbRequêtes, duréeMs], ...] */
class HostLimiter {
  constructor(limits) {
    this.limits = limits;
    this.stamps = [];
    this.chain = Promise.resolve();
    this.pausedUntil = 0;
  }

  setLimits(limits) {
    if (limits && limits.length) this.limits = limits;
  }

  pause(ms) {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
  }

  async _wait() {
    for (;;) {
      const now = Date.now();
      if (this.pausedUntil > now) {
        await sleep(this.pausedUntil - now);
        continue;
      }
      const longest = Math.max(...this.limits.map((l) => l[1]));
      this.stamps = this.stamps.filter((t) => now - t < longest);
      let waitMs = 0;
      for (const [count, windowMs] of this.limits) {
        const inWindow = this.stamps.filter((t) => now - t < windowMs);
        // Marge de sécurité d'une requête.
        if (inWindow.length >= count - 1) {
          waitMs = Math.max(waitMs, inWindow[0] + windowMs - now + 50);
        }
      }
      if (waitMs <= 0) {
        this.stamps.push(now);
        return;
      }
      await sleep(waitMs);
    }
  }

  /** Réserve un créneau (sérialisé pour éviter les courses). */
  acquire() {
    const p = this.chain.then(() => this._wait());
    this.chain = p.catch(() => {});
    return p;
  }
}

function parseLimitHeader(value) {
  if (!value) return null;
  const out = value
    .split(',')
    .map((part) => part.trim().split(':').map(Number))
    .filter(([c, s]) => c > 0 && s > 0)
    .map(([c, s]) => [c, s * 1000]);
  return out.length ? out : null;
}

class RiotClient {
  constructor({ getApiKey, fetchImpl } = {}) {
    this.getApiKey = getApiKey || (() => process.env.RIOT_API_KEY || '');
    this.fetch = fetchImpl || globalThis.fetch.bind(globalThis);
    this.limiters = new Map();
    this.requestCount = 0;
  }

  _limiter(host) {
    if (!this.limiters.has(host)) {
      this.limiters.set(host, new HostLimiter([[20, 1000], [100, 120000]]));
    }
    return this.limiters.get(host);
  }

  async request(host, path, { retries = 3 } = {}) {
    const key = (await this.getApiKey()) || '';
    if (!key) throw new RiotError('Aucune clé API Riot configurée. Ajoute-la dans Paramètres.', 401, 'NO_KEY');

    const limiter = this._limiter(host);
    for (let attempt = 0; attempt <= retries; attempt++) {
      await limiter.acquire();
      let res;
      try {
        res = await this.fetch(`https://${host}.api.riotgames.com${path}`, {
          headers: { 'X-Riot-Token': key, Accept: 'application/json' }
        });
      } catch (err) {
        if (attempt === retries) throw new RiotError(`Réseau indisponible : ${err.message}`, 0, 'NETWORK');
        await sleep(1000 * (attempt + 1));
        continue;
      }
      this.requestCount++;
      limiter.setLimits(parseLimitHeader(res.headers.get('x-app-rate-limit')));

      if (res.ok) return res.json();
      if (res.status === 404) return null;
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after')) || 10;
        limiter.pause(retryAfter * 1000);
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        let detail = '';
        try {
          detail = (await res.json())?.status?.message || '';
        } catch { /* corps vide */ }
        const err = new RiotError(
          `Clé API Riot refusée (code ${res.status}${detail ? ` : ${detail}` : ''}). Une clé de développement expire après 24 h et la précédente ne marche plus après « Regenerate » : copie la nouvelle sur developer.riotgames.com.`,
          res.status,
          'BAD_KEY'
        );
        err.detail = detail;
        err.path = path.split('?')[0];
        throw err;
      }
      if (res.status >= 500 && attempt < retries) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw new RiotError(`Erreur Riot API ${res.status} sur ${path}`, res.status, 'HTTP');
    }
    throw new RiotError('Trop de tentatives auprès de Riot API.', 429, 'RATE');
  }

  // ---------- Endpoints ----------

  accountByRiotId(platform, gameName, tagLine) {
    return this.request(
      accountRegion(platform),
      `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
    );
  }

  accountByPuuid(platform, puuid) {
    return this.request(accountRegion(platform), `/riot/account/v1/accounts/by-puuid/${puuid}`);
  }

  summonerByPuuid(platform, puuid) {
    return this.request(platform, `/tft/summoner/v1/summoners/by-puuid/${puuid}`);
  }

  summonerById(platform, summonerId) {
    return this.request(platform, `/tft/summoner/v1/summoners/${summonerId}`);
  }

  leagueByPuuid(platform, puuid) {
    return this.request(platform, `/tft/league/v1/by-puuid/${puuid}`);
  }

  /** État du serveur TFT : accessible avec n'importe quelle clé valide (sert au test de la clé). */
  tftStatus(platform) {
    return this.request(platform, '/tft/status/v1/platform-data', { retries: 1 });
  }

  /** tier : challenger | grandmaster | master */
  apexLeague(platform, tier) {
    return this.request(platform, `/tft/league/v1/${tier}?queue=RANKED_TFT`);
  }

  /** tier : DIAMOND | EMERALD | PLATINUM | GOLD | SILVER | BRONZE | IRON ; division : I à IV */
  leagueEntries(platform, tier, division, page = 1) {
    return this.request(platform, `/tft/league/v1/entries/${tier}/${division}?queue=RANKED_TFT&page=${page}`);
  }

  matchIds(platform, puuid, { count = 20, startTime } = {}) {
    const q = new URLSearchParams({ count: String(count) });
    if (startTime) q.set('startTime', String(Math.floor(startTime / 1000)));
    return this.request(PLATFORMS[platform]?.region || 'europe', `/tft/match/v1/matches/by-puuid/${puuid}/ids?${q}`);
  }

  match(platform, matchId) {
    return this.request(PLATFORMS[platform]?.region || 'europe', `/tft/match/v1/matches/${matchId}`);
  }

  activeGame(platform, puuid) {
    return this.request(platform, `/lol/spectator/tft/v5/active-games/by-puuid/${puuid}`, { retries: 1 });
  }
}

module.exports = { RiotClient, RiotError, PLATFORMS, HostLimiter, parseLimitHeader };
