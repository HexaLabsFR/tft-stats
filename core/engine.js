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

const META_FORMAT = 3; // 2 : niveaux Cœur / Bon / Correct · 3 : objets et augments en double fusionnés
const { Content } = require('./content');
const { parseRiotId, fetchPlayer, fetchLive, summarize } = require('./player');
const API_CONFIG = 'https://hexalabsfr.github.io/tft-stats/api.json';

const KEY_FORMAT = /^RGAPI-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  autoStart: true,
  // auto : données Hexa Labs si elles sont publiées et récentes, sinon collecte avec ta clé Riot
  // hexalabs : uniquement les données Hexa Labs · perso : uniquement ta clé Riot
  dataSource: 'auto',
  // Bouton fermer de la fenêtre : tray = reste près de l'horloge (mode partie automatique), quit = quitte l'app
  closeAction: 'tray'
};
const DATA_SOURCES = ['auto', 'hexalabs', 'perso'];

/**
 * Méta publiée par Hexa Labs : calculée sur un serveur avec la clé de production
 * (jamais dans l'app), mise à jour plusieurs fois par jour. Voir tools/collect-meta.js.
 */
const REMOTE_META = (platform) => `https://raw.githubusercontent.com/HexaLabsFR/tft-stats/donnees/meta-${platform}.json`;
const REMOTE_MAX_AGE_MS = 24 * 3600 * 1000;

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
    this.content = new Content({ dataDir, fetchImpl, log: (m) => this.log(m) });

    this.settings = { ...DEFAULT_SETTINGS, ...this._read('settings.json', {}) };
    const saved = this._read('matches.json', { matches: [], lastRun: 0, platform: null });
    // Parties des versions 1.0.x : collectées en Challenger/GM.
    for (const m of saved.matches) if (!m.br) m.br = ['apex'];
    this.matches = new Map(saved.matches.map((m) => [m.id, m]));
    const samePlatform = saved.platform === this.settings.platform;
    this.lastRun = samePlatform ? saved.lastRunByBracket || { apex: saved.lastRun || 0 } : {};
    this.meta = this._read('meta.json', null);
    // Format 1.0.x, ou méta d'avant la sélection de ligne (1.9.0) : recalculée au démarrage.
    if (this.meta && (!this.meta.byBracket || this.meta.format !== META_FORMAT)) this.meta = null;

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
    if (await this.content.refresh()) this.emit('content', this.content.get());
    // L'interface a pu s'ouvrir avant la fin du téléchargement : on la prévient.
    if (this.static.data) this.emit('static', this.getStatic());
    if (!this.meta && this.static.data && this.matches.size) this._recompute();
    if (this.meta) this.emit('meta', this.meta);
    // Sans clé, les données Hexa Labs suffisent : on lance quand même (mode auto ou Hexa Labs).
    const canRun = (await this.keyStore.get()) || this.settings.dataSource !== 'perso';
    if (this.settings.autoStart && canRun) this.refreshNow();
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
      dataSource: this.meta?.source === 'hexalabs' ? 'hexalabs' : 'perso',
      logs: this.logs.slice(-50)
    };
  }

  /** Données du set + chances en boutique (si elles correspondent au set en cours). */
  getStatic() {
    if (!this.static.data) return null;
    return { ...this.static.data, reference: this.reference.forSet(this.static.data.setNumber) };
  }

  getContent() {
    return this.content.get();
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
    if (!DATA_SOURCES.includes(next.dataSource)) next.dataSource = 'auto';
    if (!['tray', 'quit'].includes(next.closeAction)) next.closeAction = 'tray';
    next.tiers = (next.tiers || []).filter((t) => ['challenger', 'grandmaster', 'master'].includes(t));
    if (!next.tiers.length) next.tiers = ['challenger'];

    const platformChanged = next.platform !== this.settings.platform;
    const sourceChanged = next.dataSource !== this.settings.dataSource;
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
    } else if (sourceChanged) {
      if (next.dataSource === 'perso' && this.meta?.source === 'hexalabs') this.meta = null;
      this.refreshNow();
    } else if (added) {
      if (this.meta?.source !== 'hexalabs') this._recompute();
      this.refreshNow();
    } else {
      if (this.meta?.source !== 'hexalabs') this._recompute();
      this._schedule();
    }
    return this.getState();
  }

  async setApiKey(key) {
    // Copie depuis le portail : on retire espaces et retours à la ligne éventuels.
    const clean = String(key || '').replace(/\s+/g, '');
    if (clean && !KEY_FORMAT.test(clean)) {
      return {
        ok: false,
        message: `Cette clé ne ressemble pas à une clé Riot (RGAPI- suivi de 36 caractères, ici ${clean.length} au total). Recopie-la avec l’icône de copie du portail.`
      };
    }
    await this.keyStore.set(clean);
    const ok = await this.testKey();
    if (ok.ok && !this.running) this.refreshNow();
    return ok;
  }

  /**
   * Teste la clé en deux temps pour distinguer une clé refusée d'un accès refusé à une API précise.
   */
  async testKey() {
    const key = (await this.keyStore.get()) || '';
    const end = key ? ` (clé enregistrée se terminant par …${key.slice(-4)})` : '';
    try {
      await this.riot.tftStatus(this.settings.platform);
    } catch (err) {
      if (err.code === 'BAD_KEY') {
        return {
          ok: false,
          code: err.status,
          message: `Riot refuse cette clé${end} : code ${err.status}${err.detail ? ` « ${err.detail} »` : ''}. ${err.status === 401 ? 'La clé est mal copiée ou incomplète.' : 'La clé est expirée ou désactivée : régénère-la sur developer.riotgames.com, puis vérifie que « Expires » affiche demain.'}`
        };
      }
      return { ok: false, message: err.message };
    }
    try {
      await this.riot.apexLeague(this.settings.platform, 'challenger');
      return { ok: true, message: 'Clé valide.' };
    } catch (err) {
      if (err.code === 'BAD_KEY') {
        return {
          ok: false,
          code: err.status,
          message: `Ta clé est acceptée par Riot${end}, mais l’accès au classement TFT est refusé (code ${err.status}${err.detail ? ` « ${err.detail} »` : ''} sur ${err.path}). Ce n’est pas la clé : envoie ce message pour diagnostic.`
        };
      }
      return { ok: false, message: err.message };
    }
  }

  refreshNow() {
    if (this.running) return this.running;
    this.abort = false;
    this.running = this._run()
      .catch((err) => {
        this.log(`Erreur : ${err.message}`);
        this._setStatus({ state: 'error', message: err.message, code: err.code || '' });
      })
      .finally(() => {
        this.running = null;
        this._schedule();
      });
    return this.running;
  }

  /** Choisit la source : données Hexa Labs publiées, ou collecte avec la clé Riot du joueur. */
  async _run() {
    const src = this.settings.dataSource || 'auto';
    if (src !== 'perso') {
      if (await this._collectRemote()) return;
      if (src === 'hexalabs') {
        const err = new Error('Données Hexa Labs pas encore disponibles pour ce serveur. Choisis « Ma clé Riot » dans Réglages › Source des données.');
        err.code = 'NO_REMOTE';
        throw err;
      }
    }
    if (this.meta?.source === 'hexalabs') this.meta = null;
    return this._collect();
  }

  /** Récupère la méta publiée par Hexa Labs. Renvoie true si elle est valable et récente. */
  async _collectRemote() {
    const platform = this.settings.platform;
    this._setStatus({ state: 'running', phase: 'Données Hexa Labs', done: 0, total: 0, message: '', code: '' });
    const changed = await this.static.refresh().catch((e) => {
      this.log(`Données statiques : ${e.message}`);
      return false;
    });
    const refChanged = await this.reference.refresh();
    if (await this.content.refresh()) this.emit('content', this.content.get());
    if (changed || refChanged) this.emit('static', this.getStatic());
    let remote;
    try {
      const res = await this.static.fetch(REMOTE_META(platform), { cache: 'no-store' });
      if (!res.ok) return false;
      remote = await res.json();
    } catch {
      return false;
    }
    if (!remote || remote.format !== META_FORMAT || !remote.byBracket?.all || remote.platform !== platform) return false;
    if (Date.now() - (remote.computedAt || 0) > REMOTE_MAX_AGE_MS) {
      this.log('Données Hexa Labs trop anciennes : collecte avec ta clé si elle est enregistrée.');
      return false;
    }
    const isNew = !this.meta || this.meta.source !== 'hexalabs' || this.meta.computedAt !== remote.computedAt;
    this.meta = { ...remote, source: 'hexalabs' };
    if (isNew) {
      this._write('meta.json', this.meta);
      this.emit('meta', this.meta);
      this.log(`Données Hexa Labs reçues : ${remote.byBracket.all.boards} parties, patch ${remote.patch || '—'}.`);
    }
    this._setStatus({
      state: 'idle',
      phase: 'À jour',
      message: `Données Hexa Labs · ${remote.byBracket.all.boards} parties`,
      lastUpdate: remote.computedAt
    });
    return true;
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
    this._setStatus({ state: 'running', phase: 'Données du set', done: 0, total: 0, message: '', code: '' });

    const changed = await this.static.refresh().catch((e) => {
      this.log(`Données statiques : ${e.message}`);
      return false;
    });
    const refChanged = await this.reference.refresh();
    if (await this.content.refresh()) this.emit('content', this.content.get());
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
    this.meta = { format: META_FORMAT, computedAt: Date.now(), platform: this.settings.platform, patch, byBracket };
    this._write('meta.json', this.meta);
    this.emit('meta', this.meta);
  }

  // ---------------- Joueur ----------------
  async lookupPlayer({ riotId, platform }) {
    platform = PLATFORMS[platform] ? platform : this.settings.platform;
    parseRiotId(riotId);
    const raw = await this._playerSource(
      () => this._remote('/v1/player', { riotId, platform }),
      () => fetchPlayer(this.riot, {
        platform,
        riotId,
        getMatch: async (id) => {
          let m = this.matches.get(id);
          if (!m) {
            m = compactMatch(await this.riot.match(platform, id));
            // Les parties classées du set en cours enrichissent aussi les statistiques.
            if (m && m.queue === RANKED_QUEUE && m.set === this.static.data?.setNumber) this.matches.set(m.id, m);
          }
          return m;
        }
      })
    );
    this._saveMatches();
    const games = raw.games.map((g) => ({ id: g.id, ts: g.ts, queue: g.queue, patch: g.patch, ...canonPlayer(this.static, g), puuid: undefined, set: g.set }));
    return { account: raw.account, platform: raw.platform, summoner: raw.summoner, ranked: raw.ranked, summary: summarize(games), games, via: raw.via || 'perso' };
  }

  async liveGame({ puuid, platform }) {
    platform = PLATFORMS[platform] ? platform : this.settings.platform;
    // Pas de liste des joueurs du lobby : les règles Riot pour TFT interdisent le suivi des adversaires en partie.
    return this._playerSource(() => this._remote('/v1/live', { puuid, platform }), () => fetchLive(this.riot, { platform, puuid }));
  }

  /**
   * Recherche de joueur : serveur HexaRise API (clé de production côté serveur) quand le joueur n'a pas
   * de clé ou a choisi les données Hexa Labs, sinon sa propre clé. Repli sur sa clé si le serveur est injoignable.
   */
  async _playerSource(remote, local) {
    const hasKey = Boolean(await this.keyStore.get());
    const wantRemote = this.settings.dataSource === 'hexalabs' || (this.settings.dataSource !== 'perso' && !hasKey);
    if (wantRemote) {
      try {
        return await remote();
      } catch (err) {
        if (err.code !== 'API_DOWN' || !hasKey) throw err;
        this.log(`HexaRise API injoignable, recherche avec ta clé : ${err.message}`);
      }
    }
    return local();
  }

  /** Adresse du serveur HexaRise API, publiée sur le site (modifiable sans nouvelle version de l'app). */
  async _apiBase() {
    if (this._api && Date.now() - this._api.at < 6 * 3600 * 1000) return this._api.base;
    let base = null;
    try {
      const res = await this.static.fetch(API_CONFIG, { cache: 'no-store' });
      if (res.ok) base = (await res.json())?.profile || null;
    } catch { /* hors ligne */ }
    this._api = { at: Date.now(), base };
    return base;
  }

  async _remote(pathname, params) {
    const base = await this._apiBase();
    if (!base) {
      const err = new Error('La recherche de profil sans clé arrive bientôt (serveur Hexa Labs en préparation). En attendant, ajoute ta clé Riot dans Réglages.');
      err.code = 'NO_KEY';
      throw err;
    }
    const url = `${base.replace(/\/$/, '')}${pathname}?${new URLSearchParams(params)}`;
    let res;
    try {
      res = await this.static.fetch(url, { headers: { Accept: 'application/json', 'X-Client': 'HexaRise' } });
    } catch (e) {
      const err = new Error(e.message);
      err.code = 'API_DOWN';
      throw err;
    }
    let body = null;
    try {
      body = await res.json();
    } catch { /* corps vide */ }
    if (!res.ok) {
      const err = new Error(body?.error || `Serveur Hexa Labs indisponible (${res.status}).`);
      err.code = body?.code || (res.status >= 500 ? 'API_DOWN' : 'HTTP');
      throw err;
    }
    return { ...body, via: 'hexalabs' };
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
