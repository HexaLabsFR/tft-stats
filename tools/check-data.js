'use strict';
/**
 * Vérifie que les données CommunityDragon du set en cours sont bien lues par HexaRise :
 * set détecté, champions par coût, sorts, stats, icônes accessibles.
 * Écrit aussi un extrait réel dans check/cdragon-sample.json pour les tests.
 * Lancé par .github/workflows/check-data.yml (les serveurs GitHub ont accès à internet).
 */
const fs = require('fs');
const path = require('path');
const { buildStatic } = require('../core/static-data');

const CDRAGON = 'https://raw.communitydragon.org/latest';

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function head(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.status;
  } catch (err) {
    return `erreur ${err.message}`;
  }
}

(async () => {
  const meta = await getJson(`${CDRAGON}/content-metadata.json`);
  const [fr, en] = await Promise.all([getJson(`${CDRAGON}/cdragon/tft/fr_fr.json`), getJson(`${CDRAGON}/cdragon/tft/en_us.json`)]);
  const sd = buildStatic(fr, meta.version, en);
  console.log(`Version : ${meta.version} · set ${sd.setNumber} « ${sd.setName} »`);

  const byCost = {};
  for (const c of Object.values(sd.champions)) (byCost[c.cost] ||= []).push(c.name);
  for (const [cost, names] of Object.entries(byCost)) console.log(`Coût ${cost} : ${names.length} · ${names.join(', ')}`);
  console.log(`Synergies : ${Object.keys(sd.traits).length} · objets : ${Object.keys(sd.items).length} · augments : ${Object.keys(sd.augments).length}`);
  console.log(`Champions de boutique par coût : ${sd.shopCounts.join(' / ')} · formes alternatives : ${Object.values(sd.champions).filter((c) => c.variantOf).map((c) => c.name).join(', ') || 'aucune'}`);
  const ref = require('../core/reference-data.json');
  console.log(ref.set === sd.setNumber ? `Chances en boutique : à jour (set ${ref.set}, ${ref.updated})` : `::warning::Chances en boutique du set ${ref.set}, set en cours ${sd.setNumber} : mettre à jour core/reference-data.json`);
  const ex = Object.values(sd.champions).find((c) => c.cost === 1 && c.ability);
  if (ex) console.log(`Exemple de sort (${ex.name}) : ${ex.ability.desc.replace(/\n/g, ' ')}`);

  // Extrait brut du set en cours
  const set = (fr.setData || []).find((s) => s.number === sd.setNumber && /^TFTSet\d+$/i.test(s.mutator || ''));
  const setEn = (en.setData || []).find((s) => s.mutator === set.mutator);
  const used = new Set([...(set.items || []), ...(set.augments || [])]);
  const keepItem = (it) => used.has(it.apiName) || /^TFT_Item_(BFSword|RecurveBow|NeedlesslyLargeRod|TearOfTheGoddess|ChainVest|NegatronCloak|GiantsBelt|SparringGloves|Spatula|FryingPan)$/.test(it.apiName);
  const sample = {
    version: meta.version,
    fr: { items: fr.items.filter(keepItem), setData: [set] },
    en: { items: en.items.filter(keepItem).map(({ apiName, name }) => ({ apiName, name })), setData: [{ ...setEn, champions: setEn.champions.map(({ apiName, name }) => ({ apiName, name })), traits: setEn.traits.map(({ apiName, name }) => ({ apiName, name })) }] }
  };
  fs.mkdirSync(path.join(__dirname, '..', 'check'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'check', 'cdragon-sample.json'), JSON.stringify(sample));
  console.log(`Extrait écrit : ${(JSON.stringify(sample).length / 1e6).toFixed(1)} Mo`);

  // Trois champions bruts pour voir le format des sorts et des stats
  const raw = set.champions.filter((c) => c.traits?.length);
  for (const cost of [1, 3, 5]) {
    const c = raw.find((x) => x.cost === cost);
    if (c) console.log(`\n--- ${c.apiName} ---\n${JSON.stringify({ stats: c.stats, ability: c.ability, role: c.role }, null, 1)}`);
  }
  const keys = new Set();
  raw.forEach((c) => Object.keys(c).forEach((k) => keys.add(k)));
  console.log(`\nClés d'un champion : ${[...keys].join(', ')}`);

  // Icônes : une de chaque type
  const pick = (o) => Object.values(o).find((x) => x.icon)?.icon;
  for (const [k, url] of [['champion', pick(sd.champions)], ['synergie', pick(sd.traits)], ['objet', pick(sd.items)], ['augment', pick(sd.augments)]]) {
    console.log(`Icône ${k} : ${await head(url)} · ${url}`);
  }
  const missing = [];
  for (const c of Object.values(sd.champions)) if ((await head(c.icon)) !== 200) missing.push(c.name);
  console.log(`Portraits manquants : ${missing.length ? missing.join(', ') : 'aucun'}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
