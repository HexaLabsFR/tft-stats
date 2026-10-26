'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Engine, memoryKeyStore } = require('../core/engine');
const { createMockFetch } = require('./mock-fetch');
const { formatDesc, iconUrl } = require('../core/static-data');
const { parseLimitHeader } = require('../core/riot');

(async () => {
  // Utilitaires
  assert.strictEqual(formatDesc('Confère @AD*100@% DA.<br>Passif', { AD: 0.15 }), 'Confère 15% DA.\nPassif');
  assert.ok(iconUrl('ASSETS/A/B.tex').endsWith('/game/assets/a/b.png'));
  assert.deepStrictEqual(parseLimitHeader('20:1,100:120'), [[20, 1000], [100, 120000]]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-'));
  const fetchImpl = createMockFetch();
  const engine = new Engine({ dataDir: dir, keyStore: memoryKeyStore('RGAPI-test'), fetchImpl });
  let metaEvents = 0;
  engine.on('meta', () => metaEvents++);
  engine.settings.autoStart = false;
  await engine.start();
  await engine.refreshNow();

  const state = await engine.getState();
  assert.strictEqual(state.status.state, 'idle', state.status.message);
  assert.ok(state.storedMatches > 30, `parties stockées : ${state.storedMatches}`);

  const sd = engine.getStatic();
  assert.strictEqual(sd.traits.TFT15_StarGuardian.en, 'Star Guardian');
  assert.strictEqual(sd.items.TFT_Item_JeweledGauntlet.en, 'Jeweled Gauntlet');
  assert.strictEqual(sd.champions.TFT15_Ahri.en, 'Ahri');
  const all = engine.getMeta();
  assert.ok(all.byBracket.apex && all.byBracket.all, 'méta par élo');
  assert.ok(Object.keys(all.byBracket).length >= 3, `tranches : ${Object.keys(all.byBracket)}`);
  const meta = all.byBracket.all;
  assert.ok(meta.comps.length >= 4, `compos : ${meta.comps.length}`);
  assert.strictEqual(meta.patch, '15.20');
  assert.ok(meta.hasAugments);
  const sg = meta.comps.find((c) => c.carry === 'TFT15_Ahri');
  assert.ok(sg, 'compo Gardienne des étoiles détectée');
  assert.strictEqual(sg.name, 'Gardienne des étoiles · Ahri');
  assert.ok(['S', 'A'].includes(sg.tier), `tier SG = ${sg.tier}`);
  assert.ok(meta.comps[0].avg <= meta.comps[meta.comps.length - 1].avg);
  assert.ok(metaEvents >= 2, 'mises à jour live émises');
  assert.ok(meta.items.some((i) => i.id === 'TFT_Item_JeweledGauntlet'));

  // Deuxième passe : aucune requête de match en double
  const before = fetchImpl.calls.filter((c) => /matches\/EUW1_/.test(c)).length;
  await engine.refreshNow();
  const after = fetchImpl.calls.filter((c) => /matches\/EUW1_/.test(c)).length;
  assert.strictEqual(after, before, 'les parties en cache ne sont pas re-téléchargées');

  // Joueur
  const player = await engine.lookupPlayer({ riotId: 'Mika#EUW', platform: 'euw1' });
  assert.strictEqual(player.account.gameName, 'Mika');
  assert.ok(player.games.length > 0);
  assert.strictEqual(player.ranked.tier, 'CHALLENGER');
  await assert.rejects(engine.lookupPlayer({ riotId: 'Inconnu#EUW' }), /introuvable/);
  await assert.rejects(engine.lookupPlayer({ riotId: 'SansTag' }), /Pseudo#TAG/);
  const live = await engine.liveGame({ puuid: 'puuid-0' });
  assert.ok(live.inGame && live.players.length === 8);

  // Clé absente
  const e2 = new Engine({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tft-')), keyStore: memoryKeyStore(''), fetchImpl });
  const t = await e2.testKey();
  assert.ok(!t.ok && /clé API/i.test(t.message));

  // Contenu éditorial et conditions
  const ct = engine.getContent();
  assert.ok(ct.guides.comps.length >= 30 && ct.guides.guides.length >= 8 && ct.glossary.terms.length >= 40, 'guides et glossaire');
  for (const g of [...ct.guides.guides, ...ct.guides.videos]) assert.ok(/^https:\/\//.test(g.url) && ['debutant', 'intermediaire', 'avance'].includes(g.level), `fiche ${g.id}`);
  for (const g of ct.guides.guides) assert.ok(g.summary.length >= 3 && g.summary.every((t) => typeof t === 'string' && t.length > 10), `résumé ${g.id}`);
  for (const c of ct.guides.comps) {
    assert.ok(c.carries.length && (c.bm || c.ta), `compo ${c.id}`);
    for (const k of ['bm', 'ta']) if (c[k]) assert.ok(/^https:\/\//.test(c[k].url) && 'SABCD'.includes(c[k].tier), `${c.id}.${k}`);
  }
  assert.strictEqual(new Set(ct.guides.comps.map((c) => c.id)).size, ct.guides.comps.length, 'identifiants uniques');
  assert.ok(Object.keys(meta.conditions.items).length > 0 && Object.keys(meta.conditions.augments).length > 0, 'conditions');

  // Chances en boutique du set en cours
  const ref = engine.getStatic().reference;
  assert.ok(ref && !ref.stale && ref.odds[7][2] === 43, 'chances en boutique du set 18');
  assert.deepStrictEqual(engine.getStatic().shopCounts.length, 5);

  // Identifiants au format du set 18 (« DA_18_… ») retrouvés depuis un autre format
  const { buildStatic, StaticData } = require('../core/static-data');
  const sd18 = buildStatic({
    items: [],
    setData: [{
      number: 18, mutator: 'TFTSet18', name: 'Set10',
      traits: [{ apiName: 'DA_18_Elderwood', name: 'Sylvestre', desc: 'Intro<br><row>(@MinUnits@) Bonus @X@.</row><br><row>(@MinUnits@) Bonus @X@.</row>', effects: [{ minUnits: 3, variables: { X: 10 } }, { minUnits: 5, variables: { X: 25 } }] }],
      champions: [
        { apiName: 'DA_18_Maokai', name: 'Maokai', cost: 5, traits: ['Sylvestre'], stats: { hp: 1000, damage: 50 }, ability: { name: 'S', desc: 'Soigne @Heal@ PV et @HealthCalc1@.\\nFin', variables: [{ name: 'Heal', value: [0, 350, 400, 475] }] } },
        { apiName: 'DA_Lux18_Base', name: 'Lux', cost: 5, traits: ['Sylvestre'] },
        { apiName: 'DA_18_Lux_Fae', name: 'Lux (Fæ)', cost: 5, traits: ['Sylvestre'] }
      ]
    }]
  }, 'test');
  const st18 = new StaticData({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tft-')), fetchImpl });
  st18.data = sd18;
  assert.strictEqual(st18.champion('TFT18_Maokai').name, 'Maokai');
  assert.strictEqual(st18.champion('TFT18_Lux').name, 'Lux');
  assert.strictEqual(st18.trait('TFT18_Elderwood').name, 'Sylvestre');
  assert.strictEqual(sd18.setName, '');
  assert.deepStrictEqual(sd18.shopCounts, [0, 0, 0, 0, 2]);
  assert.strictEqual(sd18.champions.DA_18_Lux_Fae.variantOf, 'DA_Lux18_Base');
  assert.strictEqual(sd18.champions.DA_18_Maokai.ability.desc, 'Soigne 350/400/475 PV et X.\nFin');
  assert.strictEqual(sd18.traits.DA_18_Elderwood.desc, 'Intro\n(3) Bonus 10.\n(5) Bonus 25.');
  assert.strictEqual(formatDesc('Tick @V*100@ %', { V: 0.155 }), 'Tick 15,5 %');

  // Clé refusée : code et fin de clé affichés ; clé mal copiée détectée avant l'appel à Riot
  const deny = async () => ({ ok: false, status: 403, headers: { get: () => null }, json: async () => ({ status: { message: 'Forbidden', status_code: 403 } }) });
  const e3 = new Engine({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tft-')), keyStore: memoryKeyStore('RGAPI-00000000-0000-0000-0000-00000000abcd'), fetchImpl: deny });
  const t3 = await e3.testKey();
  assert.ok(!t3.ok && /403/.test(t3.message) && /…abcd/.test(t3.message), t3.message);
  const bad = await e3.setApiKey('RGAPI-1234 5678');
  assert.ok(!bad.ok && /ne ressemble pas/.test(bad.message), bad.message);

  engine.stop();
  const sgc = meta.comps.find((c) => c.carry === 'TFT15_Ahri');
  assert.ok(typeof sgc.carry3 === 'number' && sgc.levelDist.length === 4 && sgc.augStages.length === 3);
  assert.ok(meta.comps.some((c) => c.tank), 'tank détecté');
  console.log(`Tranches : ${Object.entries(all.byBracket).map(([k, v]) => `${k}=${v.boards}`).join(', ')}`);
  console.log(`OK — ${meta.boards} parties, ${meta.comps.length} compos, top : ${meta.comps[0].name} (${meta.comps[0].tier}, ${meta.comps[0].avg})`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
