'use strict';
/**
 * Version Overwolf privée : lit le plateau du joueur via Overwolf (Game Events Provider)
 * quand l'app est lancée avec ow-electron et une clé développeur Overwolf.
 * Avec Electron classique, ce module ne fait rien.
 *
 * Données lues (uniquement les siennes) : or, niveau, PV, plateau et banc (unités, étoiles,
 * objets), objets en attente, manche. Jamais les augments (interdit par Overwolf), jamais les
 * plateaux adverses.
 */
const TFT_GAME_ID = 21570;
const FEATURES = ['me', 'board', 'bench', 'match_info'];

function parseJson(v) {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/** « board_pieces » / « bench_pieces » : { cell_1: { name, level, item_1..3 } } -> [{ id, star, items }] */
function parsePieces(raw) {
  const obj = parseJson(raw);
  if (!obj || typeof obj !== 'object') return [];
  return Object.values(obj)
    .filter((p) => p && typeof p.name === 'string' && p.name)
    .map((p) => ({
      id: p.name,
      star: Math.min(3, Math.max(1, Number(p.level) || 1)),
      items: [p.item_1, p.item_2, p.item_3].filter((i) => typeof i === 'string' && i)
    }));
}

/** « item_bench » : objets en attente de tous les joueurs -> ceux du joueur uniquement. */
function parseItemBench(raw, summoner) {
  const list = parseJson(raw);
  if (!Array.isArray(list)) return [];
  const mine = list.find((p) => summoner && String(p.summoner || '').toLowerCase() === String(summoner).toLowerCase()) || (list.length === 1 ? list[0] : null);
  if (!mine) return [];
  const out = [];
  for (const it of mine.bench_items || []) for (let i = 0; i < Math.min(9, Number(it.count) || 1); i++) if (it.name) out.push(it.name);
  return out;
}

const emptyState = () => ({
  source: 'overwolf',
  available: false,
  status: 'absent',
  inGame: false,
  units: [],
  bench: [],
  benchItems: [],
  gold: null,
  level: null,
  health: null,
  stage: '',
  summoner: '',
  updatedAt: 0
});

/** Applique une mise à jour Overwolf ({ feature, category, key, value }) à l'état. */
function applyUpdate(state, data) {
  if (!data) return false;
  const key = data.key;
  const value = data.value;
  switch (key) {
    case 'gold':
      state.gold = Number(value);
      break;
    case 'xp': {
      const xp = parseJson(value);
      if (xp && xp.level !== undefined) state.level = Number(xp.level);
      break;
    }
    case 'health':
      state.health = Number(value);
      break;
    case 'summoner_name':
      state.summoner = String(value || '');
      break;
    case 'board_pieces':
      state.units = parsePieces(value);
      break;
    case 'bench_pieces':
      state.bench = parsePieces(value);
      break;
    case 'item_bench':
      state.benchItems = parseItemBench(value, state.summoner);
      break;
    case 'round_type': {
      const r = parseJson(value);
      if (r?.stage) state.stage = r.stage;
      break;
    }
    default:
      return false;
  }
  state.updatedAt = Date.now();
  return true;
}

class LiveBoard {
  constructor({ app, send, log = () => {} }) {
    this.app = app;
    this.send = send;
    this.log = log;
    this.state = emptyState();
    this.timer = null;
  }

  get() {
    return { ...this.state };
  }

  _emit() {
    this.send('board', this.get());
  }

  /** Branche Overwolf si l'app tourne sous ow-electron. Retourne false sinon. */
  start() {
    const pk = this.app?.overwolf?.packages;
    if (!pk) return false;
    this.state.available = true;
    this.state.status = 'waiting';
    pk.on('ready', (_e, name) => {
      if (name === 'gep') this._attach(pk.gep);
    });
    this._emit();
    return true;
  }

  _attach(gep) {
    if (this.attached) return;
    this.attached = true;
    this.state.status = 'ready';
    gep.on('game-detected', (event, gameId) => {
      if (gameId !== TFT_GAME_ID) return;
      event.enable();
      gep.setRequiredFeatures(TFT_GAME_ID, FEATURES).catch((err) => this.log(`Overwolf : ${err.message || err}`));
      Object.assign(this.state, { ...emptyState(), available: true, status: 'ready', inGame: true });
      this._emit();
    });
    gep.on('game-exit', (_e, gameId) => {
      if (gameId !== TFT_GAME_ID) return;
      this.state.inGame = false;
      this._emit();
    });
    gep.on('new-info-update', (_e, gameId, data) => {
      if (gameId !== TFT_GAME_ID) return;
      if (applyUpdate(this.state, data)) this._emit();
    });
    gep.on('elevated-privileges-required', () => {
      this.state.status = 'admin';
      this._emit();
    });
    gep.on('error', (_e, _gameId, error) => this.log(`Overwolf : ${error}`));
    this._emit();
  }

  /** Simulation (sans Overwolf) pour tester l'interface : plateau tiré d'une compo de la méta. */
  simulate(getStatic, getMeta) {
    const tick = () => {
      const sd = getStatic();
      const comps = getMeta()?.byBracket?.all?.comps || [];
      if (!sd || !comps.length) return;
      Object.assign(this.state, simulatedBoard(sd, comps), { available: true, status: 'simulation', inGame: true, updatedAt: Date.now() });
      this._emit();
    };
    this.timer = setInterval(tick, 15000);
    setTimeout(tick, 1500);
  }

  stop() {
    clearInterval(this.timer);
  }
}

/** Plateau plausible de milieu de partie : quelques unités d'une compo, un objet sur le carry. */
function simulatedBoard(sd, comps) {
  const c = comps[Math.floor(Date.now() / 60000) % Math.min(3, comps.length)];
  const ids = c.units.map((u) => u.id).filter((id) => sd.champions?.[id]).slice(0, 5);
  const units = ids.map((id, i) => ({ id, star: i < 2 ? 2 : 1, items: id === c.carry && c.carryItems[0] ? [c.carryItems[0].id] : [] }));
  const comp = Object.values(sd.items || {}).filter((it) => it.kind === 'composant').map((it) => it.apiName);
  return { units, bench: [], benchItems: comp.slice(0, 2), gold: 34, level: 6, health: 72, stage: '3-2' };
}

module.exports = { LiveBoard, parsePieces, parseItemBench, applyUpdate, simulatedBoard, TFT_GAME_ID, FEATURES };
