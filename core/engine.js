'use strict';
/**
 * Moteur commun à l'app desktop et à la version web :
 * collecte live des parties du haut du classement, agrégation, recherche joueur.
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { RiotClient, PLATFORMS } = require('./riot');
const { StaticData } = require('./static-data');
const { Reference } = require('./reference');
const { aggregate, canonPlayer, compactMatch, latestPatch, RANKED_QUEUE } = require('./aggregate');

/** Tranches d'élo analysées séparément (les lobbys Riot regroupent des joueurs de niveau proche). */
const BRACKETS = [
  { id: 'apex', label: 'Maître+', tiers: null },
  { id: 'diamond', label: 'Diamant', tiers: ['DIAMOND'] },
  { id: 'emerald', label: 'Émeraude', tiers: ['EMERALD'] },
  { id: 'platinum', label: 'Platine', tiers: ['PLATINUM'] },
  { id: 'gold', label: 'Or', tiers: ['GOLD'] },
  { id: 'silver', label: 'Argent', tiers: ['SILVER'] },
  { id: 'bronze', label: 'Fer / Bronze', tiers: ['BRONZE', 'IRON'] }
];
const BRACKET_IDS = BRACKETS.map((b) => b.id);
const DIVISIONS = ['I', 'II', 'III', 'IV'];

const DEFAULT_SETTINGS = {
  platform: 'euw1',
  brackets: ['apex', 'diamond', 'platinum', 'gold', 'silver', 'bronze'],
  tiers: ['challenger', 'grandmaster'], // composition de la tranche Maître+
  playersPerBracket: 20,
  matchesPerPlayer: 8,
  refreshMinutes: 30,
  patchMode: 'latest', // latest | all
  autoStart: true
};

const MAX_STORED_MATCHES = 15000;
const FIRST_RUN_WINDOW_MS = 7 * 24 * 3600 * 1000;

class Engine extends EventEmitter {
  constructor({ dataDir, keyStore, fetchImpl } = {}) {
    super();
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.keyStore = keyStore || memoryKeyStore();
    this.riot = new RiotClient({ getApiKey: () => this.keyStore.get(), fetchImpl });
    this.static = new StaticData({ dataDir, fetchImpl, log: (m) => this.log(m) });
    this.reference = new Reference({ dataDir, fetchImpl, log: (m) => this.log(m) });

    this.settings = { ...DEFAULT_SETTINGS, ...this._read('settings.json', {}) };
    const saved = this._read('matches.json', { matches: [], lastRun: 0, platform: null });
    // Parties des versions 1.0.x : collectées en Challenger/GM.
    for (const m of saved.matches) if (!m.br) m.br = ['apex'];
    this.matches = new Map(saved.matches.map((m) => [m.id, m]));
    const samePlatform = saved.platform === this.settings.platform;
    this.lastRun = samePlatform ? saved.lastRunByBracket || { apex: saved.lastRun || 0 } : {};
    this.meta = this._read('meta.json', null);
    if (this.meta && !this.meta.byBracket) this.meta = null; // format 1.0.x

    this.status = {
      state: 'idle', // idle | running | error
      phase: '',
      done: 0,
      total: 0,
      message: '',
      lastUpdate: this.meta?.computedAt || null,
      nextUpdate: null
    };
    this.logs = [];
    this.timer = null;
    this.running = null;
    this.abort = false;
  }

  // ---------------- Persistance ----------------
  _read(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dataDir, name), 'utf8'));
    } catch {
      return fallback;
    }
  }
  _write(name, value) {
    const file = path.join(this.dataDir, name);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(value));
    fs.renameSync(`${file}.tmp`, file);
  }
  _saveMatches() {
    let list = [...this.matches.values()].sort((a, b) => b.ts - a.ts);
    if (list.length > MAX_STORED_MATCHES) {
      list = list.slice(0, MAX_STORED_MATCHES);
      this.matches = new Map(list.map((m) => [m.id, m]));
    }
    this._write('matches.json', { matches: list, lastRunByBracket: this.lastRun, platform: this.settings.platform });
  }

  log(message) {
    const entry = { t: Date.now(), message };
    this.logs.push(entry);
    if (this.logs.length > 200) this.logs.shift();
    this.emit('log', entry);
  }

  _setStatus(patch) {
    Object.assign(this.status, patch);
    this.emit('status', { ...this.status, requests: this.riot.requestCount });
  }

  // ---------------- API publique ----------------
  async start() {
    try {
      await this.static.refresh();
    } catch (err) {
      this.log(`Données statiques : ${err.message}`);
    }
    await this.reference.refresh();
    // L'interface a pu s'ouvrir avant la fin du téléchargement : on la prévient.
    if (this.static.data) this.emit('static', this.getStatic());
    if (!this.meta && this.static.data && this.matches.size) this._recompute();
    if (this.meta) this.emit('meta', this.meta);
    if (this.settings.autoStart && (await this.keyStore.get())) this.refreshNow();
    else this._schedule();
  }

  stop() {
    clearTimeout(this.timer);
    this.abort = true;
  }

  async getState() {
    return {
      settings: this.settings,
      hasKey: Boolean(await this.keyStore.get()),
      status: { ...this.status, requests: this.riot.requestCount },
      platforms: Object.entries(PLATFORMS).map(([id, p]) => ({ id, label: p.label })),
      brackets: BRACKETS.map(({ id, label }) => ({ id, label })),
      static: this.static.data
        ? { version: this.static.data.version, setNumber: this.static.data.setNumber, setName: this.static.data.setName }
        : null,
      storedMatches: this.matches.size,
      logs: this.logs.slice(-50)
    };
  }

  /** Données du set + chances en boutique (si elles correspondent au set en cours). */
  getStatic() {
    if (!this.static.data) return null;
    return { ...this.static.data, reference: this.reference.forSet(this.static.data.setNumber) };
  }

  getMeta() {
    return this.meta;
  }

  async setSettings(patch = {}) {
    const allowed = Object.keys(DEFAULT_SETTINGS);
    const next = { ...this.settings };
    for (const k of allowed) if (k in patch) next[k] = patch[k];
    next.playersPerBracket = clamp(Number(next.playersPerBracket) || 20, 5, 150);
    next.matchesPerPlayer = clamp(Number(next.matchesPerPlayer) || 8, 1, 40);
    next.brackets = BRACKET_IDS.filter((b) => (next.brackets || []).includes(b));
    if (!next.brackets.length) next.brackets = ['apex'];
    next.refreshMinutes = clamp(Number(next.refreshMinutes) || 30, 5, 720);
    if (!PLATFORMS[next.platform]) next.platform = DEFAULT_SETTINGS.platform;
    next.tiers = (next.tiers || []).filter((t) => ['challenger', 'grandmaster', 'master'].includes(t));
    if (!next.tiers.length) next.tiers = ['challenger'];

    const platformChanged = next.platform !== this.settings.platform;
    const added = next.brackets.some((b) => !this.settings.brackets.includes(b));
    this.settings = next;
    this._write('settings.json', next);
    this.emit('settings', next);
    if (platformChanged) {
      this.matches.clear();
      this.lastRun = {};
      this.meta = null;
      this._saveMatches();
      this.log(`Serveur changé pour ${PLATFORMS[next.platform].label} : nouvelle collecte.`);
      this.refreshNow();
    } else if (added) {
      this._recompute();
      this.refreshNow();
    } else {
      this._recompute();
      this._schedule();
    }
    return this.getState();
  }

  async setApiKey(key) {
    await this.keyStore.set((key || '').trim());
    const ok = await this.testKey();
    if (ok.ok && !this.running) this.refreshNow();
    return ok;
  }

  async testKey() {
    try {
      await this.riot.apexLeague(this.settings.platform, 'challenger');
      return { ok: true, message: 'Clé valide.' };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  refreshNow() {
    if (this.running) return this.running;
    this.abort = false;
    this.running = this._collect()
      .catch((err) => {
        this.log(`Erreur : ${err.message}`);
        this._setStatus({ state: 'error', message: err.message });
      })
      .finally(() => {
        this.running = null;
        this._schedule();
      });
    return this.running;
  }

  _schedule() {
    clearTimeout(this.timer);
    const ms = this.settings.refreshMinutes * 60 * 1000;
    const next = Date.now() + ms;
    this._setStatus({ nextUpdate: next });
    this.timer = setTimeout(() => this.refreshNow(), ms);
    if (this.timer.unref) this.timer.unref();
  }

  // ---------------- Collecte ----------------
  /** Joueurs d'une tranche : top LP pour Maître+, échantillon réparti sur les divisions sinon. */
  async _bracketPlayers(bracket) {
    const { platform, tiers, playersPerBracket } = this.settings;
    let entries = [];
    if (!bracket.tiers) {
      for (const tier of tiers) {
        const league = await this.riot.apexLeague(platform, tier);
        for (const e of league?.entries || []) entries.push(e);
      }
      entries.sort((a, b) => b.leaguePoints - a.leaguePoints);
      return entries.slice(0, playersPerBracket);
    }
    for (const tier of bracket.tiers) {
      for (const div of DIVISIONS) {
        const page = (await this.riot.leagueEntries(platform, tier, div)) || [];
        entries.push(...page.filter((e) => !e.inactive));
      }
    }
    // Mélange pour couvrir toutes les divisions, en privilégiant les joueurs actifs.
    entries.sort((a, b) => b.wins + b.losses - (a.wins + a.losses));
    entries = entries.slice(0, playersPerBracket * 4);
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }
    return entries.slice(0, playersPerBracket);
  }

  async _collect() {
    const { platform, matchesPerPlayer } = this.settings;
    this._setStatus({ state: 'running', phase: 'Données du set', done: 0, total: 0, message: '' });

    const changed = await this.static.refresh().catch((e) => {
      this.log(`Données statiques : ${e.message}`);
      return false;
    });
    const refChanged = await this.reference.refresh();
    if (changed || refChanged) this.emit('static', this.getStatic());
    const currentSet = this.static.data?.setNumber;
    if (currentSet) {
      for (const [id, m] of this.matches) if (m.set !== currentSet) this.matches.delete(id);
    }

    let newTotal = 0;
    // Rangs bas d'abord : ce sont les plus demandés et les plus longs à remplir.
    const brackets = BRACKETS.filter((b) => this.settings.brackets.includes(b.id)).reverse();
    for (const bracket of brackets) {
      if (this.abort) return;
      const startedAt = Date.now();
      const tag = bracket.label;

      // 1) Joueurs de la tranche
      this._setStatus({ phase: `${tag} · classement`, done: 0, total: 0, message: '' });
      let players;
      try {
        players = await this._bracketPlayers(bracket);
      } catch (err) {
        if (err.code === 'BAD_KEY' || err.code === 'NO_KEY') throw err;
        this.log(`${tag} ignoré : ${err.message}`);
        continue;
      }

      // 2) Identifiants de parties
      const last = this.lastRun[bracket.id];
      const since = last ? last - 3600 * 1000 : Date.now() - FIRST_RUN_WINDOW_MS;
      const newIds = new Set();
      this._setStatus({ phase: `${tag} · historiques`, done: 0, total: players.length });
      for (let i = 0; i < players.length; i++) {
        if (this.abort) return;
        const e = players[i];
        try {
          let puuid = e.puuid;
          if (!puuid && e.summonerId) puuid = (await this.riot.summonerById(platform, e.summonerId))?.puuid;
          if (!puuid) continue;
          const ids = (await this.riot.matchIds(platform, puuid, { count: matchesPerPlayer, startTime: since })) || [];
          for (const id of ids) {
            const known = this.matches.get(id);
            if (known) {
              if (!known.br.includes(bracket.id)) known.br.push(bracket.id);
            } else newIds.add(id);
          }
        } catch (err) {
          if (err.code === 'BAD_KEY' || err.code === 'NO_KEY') throw err;
          this.log(`Joueur ignoré : ${err.message}`);
        }
        this._setStatus({ done: i + 1, message: `${newIds.size} nouvelles parties` });
      }

      // 3) Détails des parties (mise à jour live tous les 15 matchs)
      const ids = [...newIds];
      this._setStatus({ phase: `${tag} · analyse des parties`, done: 0, total: ids.length });
      let done = 0;
      const worker = async () => {
        while (ids.length && !this.abort) {
          const id = ids.shift();
          try {
            const m = compactMatch(await this.riot.match(platform, id));
            if (m && m.queue === RANKED_QUEUE) {
              m.br = [bracket.id];
              this.matches.set(m.id, m);
            }
          } catch (err) {
            if (err.code === 'BAD_KEY' || err.code === 'NO_KEY') throw err;
            this.log(`Partie ${id} ignorée : ${err.message}`);
          }
          done++;
          this._setStatus({ done, message: `${this.matches.size} parties en base` });
          if (done % 15 === 0) this._recompute();
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      if (this.abort) return;
      newTotal += done;
      this.lastRun[bracket.id] = startedAt;
      this._saveMatches();
      this._recompute();
      this.log(`${tag} : ${done} nouvelles parties.`);
    }

    this._setStatus({
      state: 'idle',
      phase: 'À jour',
      message: `${this.matches.size} parties analysées`,
      lastUpdate: Date.now()
    });
    this.log(`Mise à jour terminée : ${newTotal} nouvelles parties.`);
  }

  _recompute() {
    if (!this.static.data) return;
    const list = [...this.matches.values()];
    const set = this.static.data.setNumber;
    const patch = this.settings.patchMode === 'latest' ? latestPatch(list, set) : null;
    const byBracket = {};
    for (const b of BRACKETS) {
      const sub = list.filter((m) => m.br?.includes(b.id));
      if (sub.length) byBracket[b.id] = aggregate(sub, this.static, { set, patch });
    }
    // « Tous » : ensemble des tranches collectées.
    byBracket.all = aggregate(list, this.static, { set, patch });
    this.meta = { computedAt: Date.now(), platform: this.settings.platform, patch, byBracket };
    this._write('meta.json', this.meta);
    this.emit('meta', this.meta);
  }

  // ---------------- Joueur ----------------
  async lookupPlayer({ riotId, platform }) {
    platform = PLATFORMS[platform] ? platform : this.settings.platform;
    const [gameName, tagLine] = String(riotId || '').split('#').map((s) => s?.trim());
    if (!gameName || !tagLine) throw new Error('Format attendu : Pseudo#TAG');

    const account = await this.riot.accountByRiotId(platform, gameName, tagLine);
    if (!account) throw new Error(`Joueur « ${riotId} » introuvable.`);
    const [summoner, leagues, ids] = await Promise.all([
      this.riot.summonerByPuuid(platform, account.puuid),
      this.riot.leagueByPuuid(platform, account.puuid).catch(() => []),
      this.riot.matchIds(platform, account.puuid, { count: 20 })
    ]);

    const games = [];
    for (const id of ids || []) {
      let m = this.matches.get(id);
      if (!m) {
        m = compactMatch(await this.riot.match(platform, id));
        if (m && m.queue === RANKED_QUEUE && m.set === this.static.data?.setNumber) this.matches.set(m.id, m);
      }
      if (!m) continue;
      const me = m.players.find((p) => p.puuid === account.puuid);
      if (me) games.push({ id: m.id, ts: m.ts, queue: m.queue, patch: m.patch, ...canonPlayer(this.static, me), puuid: undefined });
    }
    this._saveMatches();

    const ranked = (leagues || []).find((l) => l.queueType === 'RANKED_TFT') || null;
    const places = games.map((g) => g.p);
    return {
      account: { gameName: account.gameName, tagLine: account.tagLine, puuid: account.puuid },
      platform,
      summoner: summoner ? { level: summoner.summonerLevel, icon: summoner.profileIconId } : null,
      ranked,
      summary: {
        games: places.length,
        avg: places.length ? Math.round((places.reduce((a, b) => a + b, 0) / places.length) * 100) / 100 : null,
        top4: places.filter((p) => p <= 4).length,
        wins: places.filter((p) => p === 1).length
      },
      games
    };
  }

  async liveGame({ puuid, platform }) {
    platform = PLATFORMS[platform] ? platform : this.settings.platform;
    const game = await this.riot.activeGame(platform, puuid);
    if (!game) return { inGame: false };
    return {
      inGame: true,
      startedAt: game.gameStartTime,
      length: game.gameLength,
      queue: game.gameQueueConfigId,
      players: (game.participants || []).map((p) => ({ riotId: p.riotId, puuid: p.puuid, icon: p.profileIconId }))
    };
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function memoryKeyStore(initial = process.env.RIOT_API_KEY || '') {
  let key = initial;
  return { get: async () => key, set: async (k) => { key = k; } };
}

/** Stockage simple de la clé dans un fichier (version web locale). */
function fileKeyStore(file) {
  return {
    get: async () => {
      if (process.env.RIOT_API_KEY) return process.env.RIOT_API_KEY;
      try {
        return fs.readFileSync(file, 'utf8').trim();
      } catch {
        return '';
      }
    },
    set: async (k) => fs.writeFileSync(file, k, { mode: 0o600 })
  };
}

module.exports = { Engine, DEFAULT_SETTINGS, BRACKETS, memoryKeyStore, fileKeyStore };
