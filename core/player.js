'use strict';
/**
 * Recherche d'un joueur par Riot ID, partagée entre l'app (avec la clé du joueur)
 * et le serveur HexaRise API (Cloudflare Workers, avec la clé de production).
 * Ne renvoie que les données du joueur cherché : jamais celles des autres joueurs de ses parties.
 */

/** « Pseudo#TAG » -> [pseudo, tag] ; erreur claire si le format est faux. */
function parseRiotId(riotId) {
  const [gameName, tagLine] = String(riotId || '').split('#').map((s) => s?.trim());
  if (!gameName || !tagLine) {
    const err = new Error('Format attendu : Pseudo#TAG');
    err.code = 'BAD_ID';
    throw err;
  }
  return [gameName, tagLine];
}

/**
 * @param riot      RiotClient
 * @param getMatch  async (id) => partie compactée (compactMatch) ou null ; permet un cache
 */
async function fetchPlayer(riot, { platform, riotId, count = 20, getMatch }) {
  const [gameName, tagLine] = parseRiotId(riotId);
  const account = await riot.accountByRiotId(platform, gameName, tagLine);
  if (!account) {
    const err = new Error(`Joueur « ${gameName}#${tagLine} » introuvable.`);
    err.code = 'NOT_FOUND';
    throw err;
  }
  const [summoner, leagues, ids] = await Promise.all([
    riot.summonerByPuuid(platform, account.puuid),
    riot.leagueByPuuid(platform, account.puuid).catch(() => []),
    riot.matchIds(platform, account.puuid, { count })
  ]);
  const games = [];
  for (const id of ids || []) {
    const m = await getMatch(id);
    if (!m) continue;
    const me = m.players.find((p) => p.puuid === account.puuid);
    if (me) games.push({ id: m.id, ts: m.ts, queue: m.queue, set: m.set, patch: m.patch, ...me });
  }
  return {
    account: { gameName: account.gameName, tagLine: account.tagLine, puuid: account.puuid },
    platform,
    summoner: summoner ? { level: summoner.summonerLevel, icon: summoner.profileIconId } : null,
    ranked: (leagues || []).find((l) => l.queueType === 'RANKED_TFT') || null,
    games
  };
}

/** Partie en cours : uniquement « en partie ou non » (règles Riot TFT : pas d'infos sur le lobby). */
async function fetchLive(riot, { platform, puuid }) {
  const game = await riot.activeGame(platform, puuid);
  if (!game) return { inGame: false };
  return { inGame: true, startedAt: game.gameStartTime, length: game.gameLength, queue: game.gameQueueConfigId };
}

function summarize(games) {
  const places = games.map((g) => g.p);
  return {
    games: places.length,
    avg: places.length ? Math.round((places.reduce((a, b) => a + b, 0) / places.length) * 100) / 100 : null,
    top4: places.filter((p) => p <= 4).length,
    wins: places.filter((p) => p === 1).length
  };
}

module.exports = { parseRiotId, fetchPlayer, fetchLive, summarize };
