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

  // Doublons CommunityDragon (versions DA_, jetons de mécanique) : une seule entrée par objet
  {
    const { buildStatic, StaticData } = require('../core/static-data');
    const it = (apiName, name, desc = '', composition = []) => ({ apiName, name, desc, effects: {}, icon: 'a.tex', composition });
    const raw = {
      items: [
        it('TFT_Item_BFSword', 'Épée longue', 'x'), it('TFT_Item_SparringGloves', 'Gants d’entraînement', 'x'),
        it('TFT_Item_InfinityEdge', 'Lame d’infini', 'Critiques', ['TFT_Item_BFSword', 'TFT_Item_SparringGloves']),
        it('DA_InfinityEdge', 'Lame d’infini', '', ['DA_Component_BFSword', 'DA_Component_SparringGloves']),
        it('TFT_Assist_RandomOrnnItem', 'Artefact', 'Artefact')
      ],
      setData: [{ number: 18, mutator: 'TFTSet18', name: 'Set18', champions: [{ apiName: 'TFT18_A', name: 'A', cost: 1, traits: [] }], traits: [], items: [], augments: [] }]
    };
    const built = buildStatic(raw, '1');
    assert.ok(!built.items.DA_InfinityEdge && built.items.TFT_Item_InfinityEdge.desc === 'Critiques', 'doublon DA_ fusionné');
    assert.strictEqual(built.items.TFT_Assist_RandomOrnnItem.kind, 'consommable');
    const st = new StaticData({ dataDir: os.tmpdir() });
    st.data = built;
    assert.strictEqual(st.canon('items', 'DA_InfinityEdge'), 'TFT_Item_InfinityEdge', 'parties DA_ comptées sur l’objet gardé');
  }

  // Placement conseillé : carry à distance dans le coin arrière, tank devant, aucune case en double
  {
    const { placement } = await import('../renderer/guide.js');
    const ch = (apiName, range, hp = 600) => ({ apiName, name: apiName, cost: 2, traits: [], stats: { range, hp, armor: 40, mr: 40 } });
    const sd = { champions: Object.fromEntries([ch('C', 4), ch('T', 1, 1000), ch('M1', 1), ch('M2', 1), ch('R1', 6), ch('R2', 4), ch('X', 2)].map((c) => [c.apiName, c])) };
    const comp = { carry: 'C', tank: 'T', units: ['C', 'T', 'M1', 'M2', 'R1', 'R2', 'X'].map((id) => ({ id, rate: 90, star: 2 })) };
    const g = { final: comp.units, carryItems: ['i1', 'i2', 'i3'], tankItems: ['t1'] };
    const p = placement(comp, sd, g);
    const at = (id) => p.cells.find((c) => c.id === id);
    assert.deepStrictEqual([at('C').row, at('C').col], [3, 0], 'carry dans le coin arrière');
    assert.strictEqual(at('T').row, 0, 'tank en ligne avant');
    assert.strictEqual(at('X').row, 1, 'portée 2 en deuxième rangée');
    assert.strictEqual(new Set(p.cells.map((c) => `${c.row}:${c.col}`)).size, 7, 'une unité par case');
    assert.deepStrictEqual(at('C').items, ['i1', 'i2', 'i3']);
    const m = placement(comp, sd, g, { mirror: true });
    assert.strictEqual(m.cells.find((c) => c.id === 'C').col, 6, 'plateau inversé');
  }

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

  // Sélection de ligne : niveaux Cœur / Bon / Correct par objet et par augment
  const { lineLevel } = require('../core/aggregate');
  assert.strictEqual(lineLevel(4.1, 40), 'coeur');
  assert.strictEqual(lineLevel(4.1, 10), 'bon');
  assert.strictEqual(lineLevel(4.6, 30), 'bon');
  assert.strictEqual(lineLevel(4.6, 10), 'correct');
  assert.strictEqual(lineLevel(4.9, 50), null);
  const condLines = [...Object.values(meta.conditions.items), ...Object.values(meta.conditions.augments)].flatMap((v) => v.lines);
  assert.ok(condLines.length > 0, 'lignes de sélection');
  assert.ok(condLines.every((r) => ['coeur', 'bon', 'correct'].includes(r.level) && r.use > 0 && r.use <= 100), 'niveaux et taux d’utilisation');
  assert.strictEqual(engine.getMeta().format, 3, 'format de méta');
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
  assert.ok(live.inGame && !('players' in live), 'pas de liste du lobby pendant la partie');

  // Données Hexa Labs : une app sans clé reçoit la méta publiée par le serveur
  {
    const published = { ...engine.getMeta(), computedAt: Date.now() };
    const remoteFetch = createMockFetch({ remoteMeta: published });
    const e3 = new Engine({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tft-')), keyStore: memoryKeyStore(''), fetchImpl: remoteFetch });
    e3.settings.autoStart = false;
    await e3.start();
    await e3.refreshNow();
    const st3 = await e3.getState();
    assert.strictEqual(st3.status.state, 'idle', st3.status.message);
    assert.strictEqual(st3.dataSource, 'hexalabs');
    assert.strictEqual(e3.getMeta().byBracket.all.boards, published.byBracket.all.boards);
    assert.ok(!remoteFetch.calls.some((c) => c.includes('api.riotgames.com')), 'aucun appel Riot sans clé');
    // Données trop anciennes : repli sur la clé (absente ici) -> erreur de clé
    const oldFetch = createMockFetch({ remoteMeta: { ...published, computedAt: Date.now() - 48 * 3600 * 1000 } });
    const e4 = new Engine({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tft-')), keyStore: memoryKeyStore(''), fetchImpl: oldFetch });
    e4.settings.autoStart = false;
    await e4.start();
    await e4.refreshNow();
    assert.strictEqual((await e4.getState()).status.code, 'NO_KEY');
  }

  // Serveur HexaRise API (Cloudflare Worker) : profil sans les autres joueurs, partie en cours sans lobby
  {
    const realFetch = globalThis.fetch;
    globalThis.fetch = createMockFetch();
    try {
      const { default: api } = await import('../worker/src/index.js');
      const env = { RIOT_API_KEY: 'RGAPI-test' };
      const get = async (q) => { const r = await api.fetch(new Request(`https://api.test${q}`, { headers: { 'cf-connecting-ip': '1.2.3.4' } }), env); return { status: r.status, body: await r.json() }; };
      const health = await get('/health');
      assert.strictEqual(health.body.ready, true);
      const pl = await get('/v1/player?riotId=' + encodeURIComponent('Mika#EUW') + '&platform=euw1');
      assert.strictEqual(pl.status, 200, JSON.stringify(pl.body));
      assert.ok(pl.body.games.length > 0 && pl.body.games.every((g) => g.puuid === pl.body.account.puuid), 'seulement le joueur cherché');
      assert.ok(!JSON.stringify(pl.body).includes('"players"'), 'pas les autres joueurs des parties');
      assert.strictEqual((await get('/v1/player?riotId=Inconnu%23EUW')).status, 404);
      assert.strictEqual((await get('/v1/player?riotId=SansTag')).status, 400);
      const lv = await get('/v1/live?puuid=puuid-0000000000000000000000&platform=euw1');
      assert.strictEqual(lv.status, 200);
      assert.ok(!('players' in lv.body));
      const noKey = await api.fetch(new Request('https://api.test/v1/player?riotId=Mika%23EUW'), {});
      assert.strictEqual(noKey.status, 503);

      // L'app sans clé passe par ce serveur
      const appFetch = createMockFetch();
      const viaApi = async (url, opts) => {
        if (String(url).endsWith('/tft-stats/api.json')) return { ok: true, status: 200, json: async () => ({ profile: 'https://api.test' }) };
        if (String(url).startsWith('https://api.test/')) return api.fetch(new Request(url, opts), env);
        return appFetch(url, opts);
      };
      const e5 = new Engine({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tft-')), keyStore: memoryKeyStore(''), fetchImpl: viaApi });
      const p5 = await e5.lookupPlayer({ riotId: 'Mika#EUW', platform: 'euw1' });
      assert.strictEqual(p5.via, 'hexalabs');
      assert.ok(p5.games.length > 0 && p5.summary.games === p5.games.length);
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  // Clé absente
  const e2 = new Engine({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tft-')), keyStore: memoryKeyStore(''), fetchImpl });
  const t = await e2.testKey();
  assert.ok(!t.ok && /clé API/i.test(t.message));

  // Détection de partie : sans client de jeu, aucune partie en cours
  const { gameMode } = require('../core/live-client');
  assert.strictEqual(await gameMode(), null);

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
