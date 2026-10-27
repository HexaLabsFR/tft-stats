// Analyse APRÈS la partie (autorisée et encouragée par les règles Riot pour TFT) :
// à partir du plateau final réel d'une partie terminée (données Riot), compare avec la méta du rang.
// Aucune donnée d'une partie en cours n'est utilisée ici.
import { placement } from './guide.js';

/** Dernière manche jouée (last_round de Riot) -> « étape-manche » (1-1 à 1-4, puis 7 manches par étape). */
export function roundLabel(r) {
  if (!r || r < 1) return '';
  if (r <= 4) return `1-${r}`;
  const n = r - 5;
  return `${2 + Math.floor(n / 7)}-${(n % 7) + 1}`;
}

const DEFENSIVE = /armure|résistance magique|PV/i;

/** Carry (le plus d'objets, puis le plus cher) et tank (corps à corps le plus équipé en défense) d'un plateau. */
export function boardRoles(units, sd) {
  const champ = (id) => sd?.champions?.[id] || { cost: 0, stats: null };
  const item = (id) => sd?.items?.[id] || {};
  const sorted = [...units].sort((a, b) => (b[2]?.length || 0) - (a[2]?.length || 0) || (champ(b[0]).cost || 0) - (champ(a[0]).cost || 0) || (b[1] || 0) - (a[1] || 0));
  const carry = sorted[0]?.[0] || null;
  const melee = units.filter(([id]) => id !== carry && (champ(id).stats?.range ?? 1) <= 1);
  const def = (its = []) => its.filter((i) => DEFENSIVE.test(item(i).stats || '')).length;
  const tankU = [...melee].sort((a, b) => def(b[2]) - def(a[2]) || (b[2]?.length || 0) - (a[2]?.length || 0) || (champ(b[0]).cost || 0) - (champ(a[0]).cost || 0))[0];
  return { carry, tank: tankU?.[0] || null };
}

/** Proximité entre un plateau et une compo méta (0 à 1), pondérée par la présence des unités dans la compo. */
function closeness(boardIds, traitIds, comp) {
  const weights = comp.units.filter((u) => u.rate >= 20);
  const total = weights.reduce((s, u) => s + u.rate, 0) || 1;
  const shared = weights.filter((u) => boardIds.has(u.id)).reduce((s, u) => s + u.rate, 0);
  let score = shared / total;
  if (boardIds.has(comp.carry)) score += 0.15;
  if (traitIds.has(comp.main)) score += 0.1;
  return Math.min(1, score);
}

/**
 * @param game  partie du profil : { p, lvl, round, traits: [[id, n, style]], units: [[id, star, items]], aug }
 * @param meta  données du rang (comps, conditions)
 * @param sd    données statiques (champions, objets)
 */
export function analyzeGame(game, meta, sd, { label = (x) => x?.name || '' } = {}) {
  const champ = (id) => sd?.champions?.[id] || { apiName: id, name: id, cost: 0, traits: [], stats: null };
  const item = (id) => sd?.items?.[id] || { apiName: id, name: id, kind: 'complet' };
  const comps = (meta?.comps || []).filter((c) => c.tier !== 'D' || c.games >= 30);
  const units = game.units || [];
  const boardIds = new Set(units.map((u) => u[0]));
  const traitIds = new Set((game.traits || []).filter(([, , style]) => style > 0).map(([id]) => id));
  const held = units.flatMap((u) => u[2] || []).filter((i) => item(i).kind !== 'composant');
  const roles = boardRoles(units, sd);
  const carryItems = units.find((u) => u[0] === roles.carry)?.[2] || [];
  const tankItems = units.find((u) => u[0] === roles.tank)?.[2] || [];

  // 1) La compo méta la plus proche de ce qui a été joué
  const ranked = comps.map((c) => ({ c, close: closeness(boardIds, traitIds, c) })).sort((a, b) => b.close - a.close);
  const closest = ranked[0] && ranked[0].close >= 0.35 ? ranked[0] : null;

  // 2) Compos qui auraient mieux collé : unités déjà en main + objets fabriqués + force de la compo
  const lineOf = (itemId, compId) => (meta?.conditions?.items?.[itemId]?.lines || []).find((r) => r.comp === compId)?.level || null;
  const LV = { coeur: 3, bon: 2, correct: 1 };
  const better = comps
    .map((c) => {
      const fit = held.reduce((s, i) => s + (LV[lineOf(i, c.id)] || 0), 0);
      const close = closeness(boardIds, traitIds, c);
      const strength = Math.max(0, 4.6 - (c.score || 4.5)) * 4; // ~0 à 3 pour une compo très forte
      return { c, fit, close, value: fit + close * 4 + strength };
    })
    .filter((x) => x.c.id !== closest?.c.id && (x.fit >= 2 || x.close >= 0.3) && (x.c.score || 5) <= (closest?.c.score ?? 5))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);

  // 3) Points à retenir
  const tips = [];
  const top4 = game.p <= 4;
  const c = closest?.c;
  if (c) {
    const level = c.avgLevel || 8;
    if (game.lvl < Math.floor(level) && !top4) {
      tips.push({ kind: 'level', text: `Tu as fini niveau ${game.lvl}, alors que cette compo se joue en moyenne au niveau ${String(level).replace('.', ',')} : il a manqué du niveau pour la stabiliser.` });
    }
    if (roles.carry && roles.carry !== c.carry && !boardIds.has(c.carry)) {
      tips.push({ kind: 'carry', text: `Le carry de cette compo est ${label(champ(c.carry))}, absent de ton plateau : ${label(champ(roles.carry))} portait tes objets.`, ids: [c.carry] });
    }
    const want = (c.carryItems || []).slice(0, 3).map((x) => x.id);
    const onCarry = new Set(units.find((u) => u[0] === c.carry)?.[2] || []);
    const missing = want.filter((id) => !onCarry.has(id));
    if (boardIds.has(c.carry) && missing.length) {
      tips.push({ kind: 'items', text: `Objets les plus réussis sur ${label(champ(c.carry))} dans ton rang :`, items: want, missing });
    }
    const missingCore = (c.core || []).filter((id) => !boardIds.has(id));
    if (missingCore.length && missingCore.length <= 3) {
      tips.push({ kind: 'units', text: `Unités clés de la compo absentes de ton plateau final :`, ids: missingCore });
    }
  } else {
    tips.push({ kind: 'flex', text: 'Ton plateau ne ressemble à aucune compo forte de ton rang : choisir une direction plus tôt (vers l’étape 3) aide à garder les bonnes unités et les bons objets.' });
  }
  if (game.p >= 7 && game.round && game.round < 26) {
    tips.push({ kind: 'early', text: `Éliminé vers ${roundLabel(game.round)} : la difficulté est venue tôt. Pense à renforcer ton plateau quand tes PV passent sous 40.` });
  }
  if (!tips.length) {
    tips.push(top4
      ? { kind: 'good', text: 'Bonne partie : ta compo et tes objets correspondent à ce qui marche dans ton rang.' }
      : { kind: 'tempo', text: 'Ta compo et tes objets étaient les bons : la différence s’est sans doute jouée sur le tempo (montées de niveau, moment du roll) ou le placement. Revois le plan de niveaux du guide.' });
  }

  // 4) Placement conseillé du plateau final (Riot ne fournit pas la vraie position des unités)
  const asComp = { carry: roles.carry, tank: roles.tank, units: units.map(([id, star]) => ({ id, star, rate: 100 })) };
  const board = units.length
    ? placement(asComp, sd, { final: units.map(([id]) => ({ id })), carryItems, tankItems }, { label })
    : null;

  return {
    place: game.p,
    level: game.lvl,
    round: roundLabel(game.round),
    roles,
    closest: closest ? { comp: closest.c, match: Math.round(closest.close * 100) } : null,
    better: better.map((x) => ({ comp: x.c, fit: x.fit, close: Math.round(x.close * 100) })),
    tips,
    board
  };
}
