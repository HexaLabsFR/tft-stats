/**
 * Guide étape par étape généré à partir des statistiques d'une compo.
 * Riot ne fournit que le plateau final de chaque joueur : le plan par étape est
 * déduit des données (coût du carry, taux de 3★, niveau final, objets, augments)
 * et des règles de tempo classiques de TFT.
 */

const unique = (arr) => [...new Set(arr)];

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

  const eco2 = type.id === 'reroll'
    ? 'Niveau 4 à 2-1, niveau 5 à 2-5. Garde ton or pour les intérêts (10, 20, 30 PO).'
    : 'Niveau 4 à 2-1, niveau 5 à 2-5. Vise 50 PO au début de l’étape 3 sans perdre trop de PV.';
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

  const tempo3 = {
    reroll: {
      1: 'Niveau 5 à 3-1 et roll jusqu’à avoir ton carry 3★, en gardant environ 50 PO quand c’est possible.',
      2: 'Niveau 6 à 3-1 et roll lentement au-dessus de 50 PO jusqu’aux 3★.',
      3: 'Niveau 7 à 3-2 (ou 3-5) et roll pour les 3★ de ton carry.'
    }[type.cost],
    lvl8: 'Niveau 6 à 3-1, niveau 7 à 3-2. Stabilise avec ton meilleur plateau et garde 50 PO.',
    fast9: 'Niveau 6 à 3-1, niveau 7 à 3-2, puis économise au maximum (série de victoires ou de défaites).'
  }[type.id];
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

  const tempo4 = {
    reroll: `Une fois les 3★ trouvés, monte niveau 7 puis 8 pour ajouter ${cappers.length ? 'les unités 4 PO de la compo finale' : 'des unités plus chères'}.`,
    lvl8: `Niveau 8 à 4-1 (ou 4-2 si tu as moins de 50 PO) et roll pour ${label(carry)} 2★ et le cœur de compo.`,
    fast9: 'Niveau 8 à 4-2, roll juste assez pour stabiliser, puis remonte à 50 PO.'
  }[type.id];
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
      {
        kind: 'text',
        text: type.id === 'fast9'
          ? `Niveau 9 à 5-1 avec 50 PO et cherche les unités 5 PO (${lvl9} % des parties finissent niveau 9 ou plus).`
          : `Niveau final moyen : ${String(comp.avgLevel).replace('.', ',')} (${lvl9} % des parties atteignent le niveau 9).`
      }
    ]
  });

  return {
    type,
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
