'use strict';
/**
 * Calcul des statistiques méta à partir des parties classées collectées.
 * Les parties sont stockées sous une forme compacte pour économiser le disque.
 */

const RANKED_QUEUE = 1100;

function parsePatch(gameVersion = '') {
  const m = gameVersion.match(/(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}` : 'inconnu';
}

/** Match brut Riot -> forme compacte. */
function compactMatch(raw) {
  const info = raw?.info;
  if (!info) return null;
  return {
    id: raw.metadata?.match_id,
    ts: info.game_datetime,
    queue: info.queue_id,
    set: info.tft_set_number,
    patch: parsePatch(info.game_version),
    players: (info.participants || []).map((p) => ({
      puuid: p.puuid,
      p: p.placement,
      lvl: p.level,
      round: p.last_round,
      traits: (p.traits || [])
        .filter((t) => t.tier_current > 0)
        .map((t) => [t.name, t.num_units, t.style]),
      units: (p.units || []).map((u) => [u.character_id, u.tier, u.itemNames || []]),
      aug: p.augments || []
    }))
  };
}

class Acc {
  constructor() {
    this.n = 0;
    this.sum = 0;
    this.top4 = 0;
    this.win = 0;
  }
  add(place) {
    this.n++;
    this.sum += place;
    if (place <= 4) this.top4++;
    if (place === 1) this.win++;
  }
  out(totalPlayers) {
    const n = this.n || 1;
    return {
      games: this.n,
      avg: round(this.sum / n),
      top4: round((this.top4 / n) * 100, 1),
      win: round((this.win / n) * 100, 1),
      pick: totalPlayers ? round((this.n / totalPlayers) * 100, 2) : 0
    };
  }
}

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Moyenne pondérée vers 4,5 pour éviter qu'un petit échantillon soit classé S. */
function bayesAvg(sum, n, k = 12) {
  return (sum + 4.5 * k) / (n + k);
}

function tierOf(score) {
  if (score <= 3.95) return 'S';
  if (score <= 4.2) return 'A';
  if (score <= 4.45) return 'B';
  if (score <= 4.7) return 'C';
  return 'D';
}

function mapInc(map, key, place) {
  let a = map.get(key);
  if (!a) map.set(key, (a = new Acc()));
  a.add(place);
  return a;
}

function isUniqueTrait(sd, traitId) {
  const bp = sd.trait(traitId).breakpoints || [];
  return bp.length === 1 && bp[0].min === 1;
}

/** Choisit le carry : l'unité la plus équipée, puis étoiles, puis coût. */
function pickCarry(sd, units) {
  let best = null;
  let bestScore = -1;
  for (const [id, star, items] of units) {
    const full = items.filter((i) => sd.item(i).kind !== 'composant').length;
    const score = full * 100 + star * 10 + (sd.champion(id).cost || 0);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

function pickMainTrait(sd, traits) {
  const candidates = traits.filter(([id]) => !isUniqueTrait(sd, id));
  candidates.sort((a, b) => b[2] - a[2] || b[1] - a[1]);
  return candidates[0]?.[0] || traits[0]?.[0] || 'aucun';
}

function topN(map, total, n, extra = () => ({})) {
  return [...map.entries()]
    .map(([id, a]) => ({ id, ...a.out(total), rate: total ? round((a.n / total) * 100, 1) : 0, ...extra(id, a) }))
    .sort((x, y) => y.games - x.games)
    .slice(0, n);
}

function aggregate(matches, sd, { patch, set } = {}) {
  const pool = matches.filter(
    (m) => m && m.queue === RANKED_QUEUE && (!set || m.set === set) && (!patch || m.patch === patch)
  );

  let totalPlayers = 0;
  const comps = new Map();
  const champs = new Map();
  const items = new Map();
  const augs = new Map();
  const traits = new Map();

  for (const m of pool) {
    for (const pl of m.players) {
      if (!pl.p) continue;
      totalPlayers++;
      const place = pl.p;

      // ---- Compo ----
      const carry = pickCarry(sd, pl.units);
      const main = pickMainTrait(sd, pl.traits);
      const key = `${main}|${carry}`;
      let c = comps.get(key);
      if (!c) {
        c = {
          key, main, carry, acc: new Acc(), units: new Map(), traits: new Map(), carryItems: new Map(), augs: new Map(),
          levels: 0, levelDist: [0, 0, 0, 0], carryStars: [0, 0, 0, 0], unitItems: new Map(), unitStars: new Map(),
          augStages: [new Map(), new Map(), new Map()]
        };
        comps.set(key, c);
      }
      c.acc.add(place);
      c.levels += pl.lvl || 0;
      c.levelDist[Math.max(0, Math.min(3, (pl.lvl || 7) - 7))]++; // 7-, 8, 9, 10
      const seen = new Set();
      for (const [id, star, its] of pl.units) {
        if (seen.has(id)) continue;
        seen.add(id);
        mapInc(c.units, id, place);
        const st = c.unitStars.get(id) || [0, 0];
        st[0] += star;
        st[1]++;
        c.unitStars.set(id, st);
        if (id === carry) {
          c.carryStars[Math.min(star, 3)]++;
          for (const it of its) mapInc(c.carryItems, it, place);
        } else if (its.length) {
          let m = c.unitItems.get(id);
          if (!m) c.unitItems.set(id, (m = { n: 0, items: new Map() }));
          m.n += its.length;
          for (const it of its) mapInc(m.items, it, place);
        }
      }
      for (const [id] of pl.traits) mapInc(c.traits, id, place);
      pl.aug.forEach((a, idx) => {
        mapInc(c.augs, a, place);
        if (idx < 3) mapInc(c.augStages[idx], a, place);
      });

      // ---- Champions et objets ----
      const seenChamp = new Set();
      for (const [id, star, its] of pl.units) {
        let ch = champs.get(id);
        if (!ch) {
          ch = { acc: new Acc(), stars: [0, 0, 0, 0], items: new Map() };
          champs.set(id, ch);
        }
        if (!seenChamp.has(id)) {
          ch.acc.add(place);
          seenChamp.add(id);
        }
        ch.stars[Math.min(star, 3)]++;
        for (const it of its) {
          mapInc(ch.items, it, place);
          let ia = items.get(it);
          if (!ia) items.set(it, (ia = { acc: new Acc(), holders: new Map() }));
          ia.acc.add(place);
          mapInc(ia.holders, id, place);
        }
      }

      // ---- Augments (si fournis par Riot) ----
      pl.aug.forEach((a, idx) => {
        let aa = augs.get(a);
        if (!aa) augs.set(a, (aa = { acc: new Acc(), byStage: [new Acc(), new Acc(), new Acc()] }));
        aa.acc.add(place);
        if (idx < 3) aa.byStage[idx].add(place);
      });

      // ---- Traits ----
      for (const [id, num, style] of pl.traits) {
        let t = traits.get(id);
        if (!t) traits.set(id, (t = { acc: new Acc(), byStyle: new Map() }));
        t.acc.add(place);
        mapInc(t.byStyle, `${style}:${num}`, place);
      }
    }
  }

  const minComp = Math.max(4, Math.round(totalPlayers * 0.004));
  const compList = [...comps.values()]
    .filter((c) => c.acc.n >= minComp)
    .map((c) => {
      const base = c.acc.out(totalPlayers);
      const score = bayesAvg(c.acc.sum, c.acc.n);
      const units = topN(c.units, c.acc.n, 12).map((u) => {
        const st = c.unitStars.get(u.id) || [1, 1];
        return { id: u.id, rate: u.rate, avg: u.avg, star: round(st[0] / st[1], 1) };
      });
      // Tank / second porteur : l'unité hors carry qui reçoit le plus d'objets.
      const tankEntry = [...c.unitItems.entries()].sort((a, b) => b[1].n - a[1].n)[0];
      const tank = tankEntry && tankEntry[1].n / c.acc.n >= 0.6 ? tankEntry[0] : null;
      const n = c.acc.n;
      return {
        id: c.key,
        main: c.main,
        carry: c.carry,
        name: `${sd.trait(c.main).name} · ${sd.champion(c.carry).name}`,
        ...base,
        score: round(score),
        tier: tierOf(score),
        avgLevel: round(c.levels / c.acc.n, 1),
        core: units.filter((u) => u.rate >= 60).map((u) => u.id),
        flex: units.filter((u) => u.rate < 60 && u.rate >= 20).map((u) => u.id),
        units,
        traits: topN(c.traits, c.acc.n, 8).map((t) => ({ id: t.id, rate: t.rate })),
        carryItems: topN(c.carryItems, c.acc.n, 6).map((i) => ({ id: i.id, rate: i.rate, avg: i.avg })),
        augments: topN(c.augs, c.acc.n, 6).map((a) => ({ id: a.id, rate: a.rate, avg: a.avg })),
        carry3: round((c.carryStars[3] / n) * 100, 1),
        carry2: round(((c.carryStars[2] + c.carryStars[3]) / n) * 100, 1),
        levelDist: c.levelDist.map((v) => round((v / n) * 100, 1)),
        tank,
        tankItems: tank ? topN(c.unitItems.get(tank).items, n, 4).map((i) => ({ id: i.id, rate: i.rate, avg: i.avg })) : [],
        augStages: c.augStages.map((m) => [...m.entries()]
          .filter(([, a]) => a.n >= 3)
          .map(([id, a]) => ({ id, avg: round(a.sum / a.n), games: a.n }))
          .sort((x, y) => x.avg - y.avg)
          .slice(0, 4))
      };
    })
    .sort((a, b) => a.score - b.score);

  const champList = [...champs.entries()]
    .map(([id, ch]) => {
      const starTotal = ch.stars.reduce((s, v) => s + v, 0) || 1;
      return {
        id,
        ...ch.acc.out(totalPlayers),
        stars: ch.stars.slice(1).map((v) => round((v / starTotal) * 100, 1)),
        items: topN(ch.items, ch.acc.n, 6).map((i) => ({ id: i.id, rate: i.rate, avg: i.avg }))
      };
    })
    .sort((a, b) => a.avg - b.avg);

  const itemList = [...items.entries()]
    .map(([id, it]) => ({
      id,
      ...it.acc.out(0),
      holders: topN(it.holders, it.acc.n, 5).map((h) => ({ id: h.id, rate: h.rate, avg: h.avg }))
    }))
    .sort((a, b) => b.games - a.games);

  const augList = [...augs.entries()]
    .map(([id, a]) => ({
      id,
      ...a.acc.out(totalPlayers),
      stages: a.byStage.map((s) => (s.n ? round(s.sum / s.n) : null))
    }))
    .sort((a, b) => a.avg - b.avg);

  const traitList = [...traits.entries()]
    .map(([id, t]) => ({
      id,
      ...t.acc.out(totalPlayers),
      levels: [...t.byStyle.entries()]
        .map(([k, a]) => {
          const [style, num] = k.split(':').map(Number);
          return { style, num, ...a.out(totalPlayers) };
        })
        .sort((a, b) => a.num - b.num)
    }))
    .sort((a, b) => b.games - a.games);

  return {
    computedAt: Date.now(),
    patch: patch || null,
    set: set || null,
    boards: pool.length,
    players: totalPlayers,
    hasAugments: augList.length > 0,
    comps: compList,
    champions: champList,
    items: itemList,
    augments: augList,
    traits: traitList
  };
}

/** Patch le plus récent présent dans l'échantillon. */
function latestPatch(matches, set) {
  let best = null;
  for (const m of matches) {
    if (!m || (set && m.set !== set)) continue;
    if (!best || comparePatch(m.patch, best) > 0) best = m.patch;
  }
  return best;
}

function comparePatch(a = '0.0', b = '0.0') {
  const [a1, a2] = a.split('.').map(Number);
  const [b1, b2] = b.split('.').map(Number);
  return a1 - b1 || a2 - b2;
}

module.exports = { aggregate, compactMatch, parsePatch, latestPatch, comparePatch, tierOf, RANKED_QUEUE };
