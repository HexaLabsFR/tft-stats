/**
 * Guide étape par étape généré à partir des statistiques d'une compo.
 * Riot ne fournit que le plateau final de chaque joueur : le plan par étape est
 * déduit des données (coût du carry, taux de 3★, niveau final, objets, augments)
 * et des règles de tempo classiques de TFT.
 */

const unique = (arr) => [...new Set(arr)];

// ===================== Plan de niveaux =====================
// Plan type par style de compo, selon ta série en cours. HexaRise ne lit pas ta partie
// (règles Riot) : les trois colonnes sont affichées, tu suis celle qui te correspond.
export const STREAKS = [['win', 'Série de victoires'], ['mixed', 'Mixte'], ['lose', 'Série de défaites']];

const W = (win, mixed, lose, key = false) => ({ win, mixed, lose: lose ?? mixed, key });
const PLANS = {
  lvl8: [
    ['2-1', W('Niv. 4', 'Niv. 4', 'Niv. 4')],
    ['2-5', W('Niv. 5', 'Niv. 5', 'Économise')],
    ['3-2', W('Niv. 6', 'Niv. 6', 'Niv. 6')],
    ['3-5', W('Niv. 7 s’il reste 30 PO', 'Niv. 7 s’il reste 30 PO', 'Niv. 7 s’il reste 40 PO')],
    ['4-1', W('Niv. 8, roll un peu pour garder la série', 'Garde 50 PO', 'Niv. 8 et gros roll', true)],
    ['4-2', W('Roll jusqu’à stabiliser', 'Niv. 8 et gros roll', 'Finis le plateau', true)],
    ['4-5', W('Remonte à 50 PO', 'Remonte à 50 PO', 'Remonte à 50 PO')],
    ['5-1', W('Niv. 9 si le plateau tient', 'Niv. 9 à 5-1 ou 5-2', 'Roll si PV < 40, sinon niv. 9')]
  ],
  fast9: [
    ['2-1', W('Niv. 4', 'Niv. 4', 'Niv. 4')],
    ['2-5', W('Niv. 5', 'Niv. 5', 'Économise')],
    ['3-2', W('Niv. 6', 'Niv. 6', 'Niv. 6')],
    ['3-5', W('Niv. 7', 'Niv. 7 s’il reste 30 PO', 'Économise, vise 50 PO')],
    ['4-1', W('Niv. 8, garde 50 PO', 'Garde 50 PO', 'Niv. 8 et roll pour tenir')],
    ['4-2', W('Roll juste assez pour tenir', 'Niv. 8, roll juste assez', 'Garde au moins 30 PO')],
    ['4-5', W('Niv. 9', 'Remonte à 50 PO', 'Remonte à 50 PO')],
    ['5-1', W('Roll pour les unités 5 PO', 'Niv. 9 et roll pour les 5 PO', 'Niv. 9 si PV > 40, sinon roll niv. 8', true)]
  ],
  reroll1: [
    ['2-1', W('Niv. 4', 'Niv. 4', 'Niv. 4')],
    ['2-5', W('Reste niv. 4', 'Reste niv. 4', 'Reste niv. 4, économise')],
    ['3-1', W('Roll ce qui dépasse 50 PO', 'Roll ce qui dépasse 50 PO', 'Gros roll jusqu’à ~30 PO', true)],
    ['3-2', W('Continue jusqu’aux 3★', 'Continue jusqu’aux 3★', 'Continue jusqu’aux 3★', true)],
    ['3-5', W('3★ trouvés : niv. 6', '3★ trouvés : niv. 6', 'Stabilise, garde 20 PO')],
    ['4-1', W('Niv. 7', 'Niv. 7', 'Niv. 6 puis 7')],
    ['4-5', W('Niv. 8', 'Niv. 8 s’il reste 30 PO', 'Niv. 8')],
    ['5-1', W('Ajoute les unités 4 PO', 'Ajoute les unités 4 PO', 'Ajoute les unités 4 PO')]
  ],
  reroll2: [
    ['2-1', W('Niv. 4', 'Niv. 4', 'Niv. 4')],
    ['2-5', W('Niv. 5', 'Niv. 5', 'Économise')],
    ['3-1', W('Niv. 6', 'Niv. 6', 'Niv. 6')],
    ['3-2', W('Roll ce qui dépasse 50 PO', 'Roll ce qui dépasse 50 PO', 'Gros roll jusqu’à ~20 PO', true)],
    ['3-5', W('Continue jusqu’aux 3★', 'Continue jusqu’aux 3★', 'Continue jusqu’aux 3★', true)],
    ['4-1', W('3★ trouvés : niv. 7', '3★ trouvés : niv. 7', 'Niv. 7 dès les 3★')],
    ['4-5', W('Niv. 8', 'Niv. 8', 'Niv. 8 s’il reste 30 PO')],
    ['5-1', W('Ajoute les unités 4 PO', 'Ajoute les unités 4 PO', 'Ajoute les unités 4 PO')]
  ],
  reroll3: [
    ['2-1', W('Niv. 4', 'Niv. 4', 'Niv. 4')],
    ['2-5', W('Niv. 5', 'Niv. 5', 'Économise')],
    ['3-2', W('Niv. 6', 'Niv. 6', 'Niv. 6')],
    ['3-5', W('Niv. 7 et roll ce qui dépasse 50 PO', 'Niv. 7 et roll ce qui dépasse 50 PO', 'Niv. 7 et gros roll', true)],
    ['4-1', W('Continue jusqu’aux 3★', 'Continue jusqu’aux 3★', 'Continue jusqu’aux 3★', true)],
    ['4-2', W('Continue jusqu’aux 3★', 'Continue jusqu’aux 3★', 'Stabilise, garde 20 PO')],
    ['4-5', W('3★ trouvés : niv. 8', '3★ trouvés : niv. 8', 'Niv. 8 s’il reste 30 PO')],
    ['5-1', W('Ajoute les unités 4 PO', 'Ajoute les unités 4 PO', 'Ajoute les unités 4 PO')]
  ]
};

// Niveau de référence où l'on cherche le carry, pour citer les chances en boutique.
const ROLL_LEVEL = { reroll1: 4, reroll2: 6, reroll3: 7, lvl8: 8, fast9: 9 };

const planKey = (type) => (type.id === 'reroll' ? `reroll${Math.min(3, Math.max(1, type.cost || 1))}` : type.id);

/** Chances (en %) d'un coût donné à un niveau, si les données du set en cours sont connues. */
export function oddsAt(sd, level, cost) {
  const ref = sd?.reference;
  if (!ref || ref.stale) return null;
  return ref.odds?.[level]?.[cost - 1] ?? null;
}

/** Plan de niveaux : lignes (manche, 3 colonnes), conseils généraux, chances citées. */
export function levelPlan(type, sd, carryCost) {
  const key = planKey(type);
  const rows = (PLANS[key] || PLANS.lvl8).map(([round, cells]) => ({ round, ...cells }));
  const lvl = ROLL_LEVEL[key];
  const cost = type.id === 'fast9' ? 5 : type.id === 'lvl8' ? 4 : carryCost;
  const odds = oddsAt(sd, lvl, cost);
  const hint = odds !== null && cost
    ? `Au niveau ${lvl}, ${odds} % des champions de la boutique coûtent ${cost} PO${type.id === 'reroll' ? ' : c’est le meilleur niveau pour chercher ton carry' : ''}.`
    : '';
  return {
    key,
    rows,
    rollLevel: lvl,
    hint,
    tips: [
      'Intérêts : 1 PO par tranche de 10 PO, jusqu’à 50 PO. Garde-les tant que tes PV le permettent.',
      'Une série (victoires ou défaites) rapporte de l’or en plus : évite d’alterner.',
      '« Roll ce qui dépasse 50 PO » : tu ne dépenses que l’or au-dessus de 50 et tu gardes les intérêts.',
      'Sous 40 PV, arrête d’économiser : roll pour renforcer ton plateau.'
    ]
  };
}


/** Type de compo : reroll, niveau 8 standard ou fast 9. */
export function compType(comp, carryCost) {
  const lvl9 = (comp.levelDist?.[2] || 0) + (comp.levelDist?.[3] || 0);
  if (carryCost <= 2 && comp.carry3 >= 30) return { id: 'reroll', cost: carryCost, label: `Reroll ${carryCost} PO` };
  if (carryCost === 3 && comp.carry3 >= 20) return { id: 'reroll', cost: 3, label: 'Reroll 3 PO' };
  if (carryCost >= 5 || lvl9 >= 45) return { id: 'fast9', label: 'Fast 9' };
  return { id: 'lvl8', label: 'Niveau 8 standard' };
}

export function buildGuide(comp, sd, label = (x) => x.name) {
  const champ = (id) => sd?.champions?.[id] || { apiName: id, name: id, cost: 0, traits: [] };
  const item = (id) => sd?.items?.[id] || { apiName: id, name: id, composition: [] };
  const carry = champ(comp.carry);
  const type = compType(comp, carry.cost || 4);

  // Synergies structurantes (hors synergies uniques à 1 unité)
  const isUnique = (id) => {
    const bp = sd?.traits?.[id]?.breakpoints || [];
    return bp.length === 1 && bp[0].min === 1;
  };
  const coreTraits = comp.traits.map((t) => t.id).filter((id) => !isUnique(id)).slice(0, 4);
  const finalIds = new Set(comp.units.map((u) => u.id));
  const unitRate = Object.fromEntries(comp.units.map((u) => [u.id, u.rate]));

  // Unités de transition : coût bas, synergies communes avec la compo finale
  const pool = Object.values(sd?.champions || {}).filter((c) => c.cost >= 1 && c.cost <= 5);
  const score = (c) => {
    const shared = c.traits.filter((t) => coreTraits.includes(t)).length;
    return shared * 2 + (finalIds.has(c.apiName) ? 3 + (unitRate[c.apiName] || 0) / 50 : 0);
  };
  const pick = (maxCost, n, must = []) => {
    const list = pool
      .filter((c) => c.cost <= maxCost && score(c) >= 2)
      .sort((a, b) => score(b) - score(a) || a.cost - b.cost)
      .map((c) => c.apiName);
    return unique([...must.filter((id) => champ(id).cost <= maxCost), ...list]).slice(0, n);
  };
  const early = pick(2, 5, type.id === 'reroll' && carry.cost <= 2 ? [comp.carry] : []);
  const mid = pick(3, 7, [comp.carry, comp.tank].filter(Boolean));
  const final = comp.units.filter((u) => u.rate >= 35).slice(0, 9);
  const cappers = comp.units.filter((u) => champ(u.id).cost >= 4 && u.id !== comp.carry && u.rate >= 35).map((u) => u.id);

  // Objets : 3 du carry + 2 du tank, puis composants à prioriser
  const carryItems = comp.carryItems.slice(0, 3).map((i) => i.id);
  const tankItems = (comp.tankItems || []).slice(0, 2).map((i) => i.id);
  const compCount = new Map();
  [...carryItems, ...tankItems].forEach((id, idx) => {
    for (const c of item(id).composition || []) compCount.set(c, (compCount.get(c) || 0) + (idx < 3 ? 2 : 1));
  });
  const components = [...compCount.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 4);
  // Premier objet à fabriquer tôt : un objet de tank si dispo, sinon le plus joué du carry
  const firstSlam = tankItems[0] || carryItems[0];

  const aug = (i) => comp.augStages?.[i] || [];
  const lvl9 = Math.round((comp.levelDist?.[2] || 0) + (comp.levelDist?.[3] || 0));

  // ---- Plan par étape ----
  const stages = [];
  stages.push({
    stage: 'Étape 1',
    rounds: '1-1 → 1-4',
    steps: [
      { kind: 'items', text: 'Prends en priorité ces composants au carrousel et sur les sbires :', ids: components },
      { kind: 'units', text: 'Garde les unités qui serviront plus tard :', ids: early.slice(0, 3) }
    ]
  });

  const plan = levelPlan(type, sd, carry.cost);
  const cName = label(carry);
  const SAY = {
    lvl8: [
      'Niveau 4 à 2-1, niveau 5 à 2-5. Vise 50 PO au début de l’étape 3 sans perdre trop de PV.',
      'Niveau 6 à 3-2, niveau 7 à 3-5 s’il te reste au moins 30 PO. Garde 50 PO.',
      `Niveau 8 à 4-1 ou 4-2, puis gros roll pour ${cName} 2★ et le cœur de compo.`,
      'Remonte à 50 PO, puis niveau 9 à 5-1 ou 5-2 si ton plateau tient.'
    ],
    fast9: [
      'Niveau 4 à 2-1, niveau 5 à 2-5. Vise 50 PO au début de l’étape 3.',
      'Niveau 6 à 3-2, niveau 7 à 3-5. Économise au maximum en restant sur une série.',
      'Niveau 8 à 4-1 ou 4-2, roll juste assez pour tenir, puis remonte à 50 PO.',
      'Niveau 9 à 4-5 ou 5-1, puis roll pour les unités 5 PO.'
    ],
    reroll1: [
      'Niveau 4 à 2-1, puis reste niveau 4 : c’est là que les unités 1 PO sortent le plus. Garde ton or pour les intérêts.',
      `À partir de 3-1, roll tout ce qui dépasse 50 PO jusqu’à ${cName} 3★.`,
      'Une fois les 3★ trouvés, monte niveau 6, 7 puis 8 pour ajouter des unités plus chères.',
      'Niveau 8 et ajoute les unités 4 PO de la compo finale.'
    ],
    reroll2: [
      'Niveau 4 à 2-1, niveau 5 à 2-5. Garde ton or pour les intérêts.',
      `Niveau 6 à 3-1, puis roll tout ce qui dépasse 50 PO jusqu’à ${cName} 3★.`,
      '3★ trouvés : niveau 7 à 4-1, niveau 8 à 4-5.',
      'Niveau 8 et ajoute les unités 4 PO de la compo finale.'
    ],
    reroll3: [
      'Niveau 4 à 2-1, niveau 5 à 2-5. Garde ton or pour les intérêts.',
      `Niveau 6 à 3-2, niveau 7 à 3-5, puis roll tout ce qui dépasse 50 PO jusqu’à ${cName} 3★.`,
      'Continue le roll lent jusqu’aux 3★, puis niveau 8 à 4-5.',
      'Niveau 8 et ajoute les unités 4 PO de la compo finale.'
    ]
  }[plan.key];
  const eco2 = SAY[0];
  stages.push({
    stage: 'Étape 2',
    rounds: '2-1 → 2-7',
    steps: [
      aug(0).length ? { kind: 'augs', text: 'Augments à 2-1 (meilleure place moyenne) :', ids: aug(0).map((a) => a.id) } : null,
      { kind: 'units', text: 'Plateau de début de partie :', ids: early },
      firstSlam ? { kind: 'items', text: `Fabrique tôt cet objet${comp.tank && firstSlam === tankItems[0] ? ' sur ta ligne avant' : ''} pour gagner des rounds :`, ids: [firstSlam] } : null,
      { kind: 'text', text: eco2 }
    ].filter(Boolean)
  });

  const tempo3 = SAY[1];
  stages.push({
    stage: 'Étape 3',
    rounds: '3-1 → 3-7',
    steps: [
      aug(1).length ? { kind: 'augs', text: 'Augments à 3-2 :', ids: aug(1).map((a) => a.id) } : null,
      { kind: 'units', text: 'Plateau de milieu de partie :', ids: mid },
      { kind: 'text', text: tempo3 },
      carryItems.length ? { kind: 'items', text: `Termine les objets de ${label(carry)} :`, ids: carryItems } : null
    ].filter(Boolean)
  });

  const tempo4 = SAY[2];
  stages.push({
    stage: 'Étape 4',
    rounds: '4-1 → 4-7',
    steps: [
      aug(2).length ? { kind: 'augs', text: 'Augments à 4-2 :', ids: aug(2).map((a) => a.id) } : null,
      { kind: 'text', text: tempo4 },
      cappers.length ? { kind: 'units', text: 'Unités à ajouter :', ids: cappers } : null,
      tankItems.length ? { kind: 'items', text: `Objets du tank${comp.tank ? ` (${label(champ(comp.tank))})` : ''} :`, ids: tankItems } : null
    ].filter(Boolean)
  });

  stages.push({
    stage: 'Étape 5+',
    rounds: 'Fin de partie',
    steps: [
      { kind: 'final', text: 'Plateau final :', ids: final.map((u) => u.id) },
      { kind: 'text', text: SAY[3] },
      {
        kind: 'note',
        text: `Niveau final moyen : ${String(comp.avgLevel).replace('.', ',')} · ${lvl9} % des parties atteignent le niveau 9 ou plus.`
      }
    ]
  });

  return {
    type,
    plan,
    carry: comp.carry,
    tank: comp.tank,
    coreTraits,
    components,
    carryItems,
    tankItems,
    early,
    mid,
    final,
    stages
  };
}

// ===================== Placement conseillé =====================
// Riot ne fournit pas la position des unités : HexaRise place le plateau final selon le rôle de chaque unité
// (portée, résistance, carry, tank, objets). Plateau de 4 rangées × 7 cases, rangée 0 = ligne avant.
export const BOARD_ROWS = 4;
export const BOARD_COLS = 7;

const toughness = (c) => {
  const s = c?.stats || {};
  return (s.hp || 500) * (1 + ((s.armor || 30) + (s.mr || 30)) / 100);
};

/**
 * @param mirror true : carry dans le coin droit au lieu du gauche.
 * @returns { cells: [{ id, row, col, role, items, star }], carryCol, tips }
 */
export function placement(comp, sd, guide, { mirror = false, label = (x) => x.name } = {}) {
  const champ = (id) => sd?.champions?.[id] || { apiName: id, name: id, cost: 0, traits: [], stats: null };
  const units = (guide?.final || comp.units.filter((u) => u.rate >= 35).slice(0, 9)).map((u) => u.id || u);
  const stars = Object.fromEntries((comp.units || []).map((u) => [u.id, Math.round(u.star || 1)]));
  const range = (id) => champ(id).stats?.range ?? (id === comp.carry ? 4 : 1);
  const taken = new Set();
  const cells = [];
  const col = (c) => (mirror ? BOARD_COLS - 1 - c : c);
  const put = (id, row, order, role) => {
    for (const c of order) {
      const k = `${row}:${col(c)}`;
      if (!taken.has(k)) {
        taken.add(k);
        cells.push({ id, row, col: col(c), role });
        return true;
      }
    }
    return false;
  };

  const carry = comp.carry;
  const tank = comp.tank || null;
  const melee = units.filter((id) => id !== carry && range(id) <= 1).sort((a, b) => (b === tank) - (a === tank) || toughness(champ(b)) - toughness(champ(a)));
  const mid = units.filter((id) => id !== carry && range(id) >= 2 && range(id) <= 3);
  const ranged = units.filter((id) => id !== carry && range(id) >= 4).sort((a, b) => champ(b).cost - champ(a).cost);

  // Carry : coin arrière s'il tire à distance, sinon juste derrière le tank.
  const carryMelee = range(carry) <= 1;
  if (carryMelee) put(carry, 0, [2, 1, 3], 'carry');
  else if (range(carry) <= 3) put(carry, 2, [0, 1], 'carry');
  else put(carry, 3, [0], 'carry');

  // Ligne avant : le tank devant le carry, puis les plus solides vers le centre.
  const FRONT = [1, 2, 3, 0, 4, 5, 6];
  for (const id of melee) if (!put(id, 0, FRONT, id === tank ? 'tank' : 'front')) put(id, 1, FRONT, 'front');
  // Portée moyenne : deuxième rangée, côté carry.
  for (const id of mid) if (!put(id, 1, [1, 2, 0, 3, 4, 5, 6], 'mid')) put(id, 2, [1, 2, 3, 4, 5, 6, 0], 'mid');
  // Distance : dernière rangée à côté du carry, puis l'avant-dernière.
  const BACK = range(carry) >= 4 ? [1, 2, 3, 6, 5, 4] : [0, 1, 2, 3, 6, 5, 4];
  for (const id of ranged) if (!put(id, 3, BACK, 'back')) put(id, 2, [0, 1, 2, 3, 4, 5, 6], 'back');

  for (const c of cells) {
    c.star = stars[c.id] || 1;
    c.items = c.id === carry ? guide?.carryItems || [] : c.id === tank ? guide?.tankItems || [] : [];
  }

  const cName = label(champ(carry));
  const tCell = cells.find((c) => c.role === 'tank') || cells.find((c) => c.role === 'front');
  const side = mirror ? 'droit' : 'gauche';
  const tips = [
    carryMelee
      ? `${cName} se bat au corps à corps : en ligne avant, avec ${tCell && tCell.id !== carry ? label(champ(tCell.id)) : 'ton tank'} juste à côté.`
      : `${cName} dans le coin arrière ${side} : c’est la case la plus loin des ennemis.`,
    tCell && tCell.id !== carry ? `${label(champ(tCell.id))} en ligne avant, du même côté que ${cName}, pour encaisser en premier.` : null,
    'Contre des unités qui sautent sur ta ligne arrière (assassins), décale le carry d’une case vers le centre et place une unité solide juste à côté de lui.',
    `Si l’adversaire le plus fort se place du côté ${side}, inverse ton plateau.`
  ].filter(Boolean);
  return { cells, carryCol: col(0), tips };
}

/** Plateau hexagonal en HTML. h : { champ, img, itemIcon, esc } fournis par la page. */
export function boardHtml(p, h, { compact = false } = {}) {
  const at = new Map(p.cells.map((c) => [`${c.row}:${c.col}`, c]));
  const ROLE = { carry: 'Carry', tank: 'Tank' };
  const rows = [];
  for (let r = 0; r < BOARD_ROWS; r++) {
    const cells = [];
    for (let c = 0; c < BOARD_COLS; c++) {
      const u = at.get(`${r}:${c}`);
      if (!u) {
        cells.push('<div class="hx hx-free"></div>');
        continue;
      }
      const ch = h.champ(u.id);
      cells.push(`<div class="hx unit-hx cost-${ch.cost || 1} ${u.role}" data-tip="champ" data-id="${h.esc(u.id)}">
        <div class="hx-in">${h.img(ch.icon, ch.name)}</div>
        ${u.star > 1 ? `<span class="hx-star">${'★'.repeat(u.star)}</span>` : ''}
        ${ROLE[u.role] && !compact ? `<span class="hx-role ${u.role}">${ROLE[u.role]}</span>` : ''}
        ${u.items.length ? `<span class="hx-items">${u.items.map((i) => h.itemIcon(i)).join('')}</span>` : ''}
        ${compact ? '' : `<span class="hx-name">${h.esc(ch.name)}</span>`}
      </div>`);
    }
    rows.push(`<div class="hx-row">${cells.join('')}</div>`);
  }
  return `<div class="hx-board ${compact ? 'compact' : ''}"><div class="hx-enemy">↑ Côté adversaire</div>${rows.join('')}</div>`;
}
