'use strict';
/**
 * Collecteur Hexa Labs : calcule la méta sur un serveur avec la clé Riot de production,
 * pour que l'app n'ait plus besoin de clé (Riot interdit d'intégrer une clé dans une app distribuée).
 *
 * Usage : RIOT_API_KEY=… node tools/collect-meta.js euw1 [dossier-de-sortie]
 * Lancé par .github/workflows/collect-meta.yml ; la clé vient d'un secret GitHub, jamais du code.
 * Les parties déjà téléchargées sont gardées dans .collect/<serveur> (cache entre deux passages).
 */
const fs = require('fs');
const path = require('path');
const { Engine, memoryKeyStore } = require('../core/engine');

const platform = process.argv[2] || 'euw1';
const outDir = path.resolve(process.argv[3] || 'publish');
const key = (process.env.RIOT_API_KEY || '').trim();

(async () => {
  if (!key) {
    console.log('::notice::Pas de secret RIOT_API_KEY : collecte Hexa Labs désactivée.');
    return;
  }
  const dataDir = path.resolve('.collect', platform);
  fs.mkdirSync(dataDir, { recursive: true });
  // Réglages du serveur : tous les rangs, échantillon plus large que dans l'app.
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
    platform,
    brackets: ['apex', 'diamond', 'emerald', 'platinum', 'gold', 'silver', 'bronze'],
    tiers: ['challenger', 'grandmaster', 'master'],
    playersPerBracket: Number(process.env.PLAYERS_PER_BRACKET) || 40,
    matchesPerPlayer: Number(process.env.MATCHES_PER_PLAYER) || 10,
    refreshMinutes: 720,
    patchMode: 'latest',
    autoStart: false,
    dataSource: 'perso'
  }));

  // HEXALABS_MOCK=1 : données simulées, pour tester le collecteur sans appeler Riot.
  const fetchImpl = process.env.HEXALABS_MOCK ? require('../test/mock-fetch').createMockFetch({ players: 60, matchesPerPlayer: 14 }) : undefined;
  const engine = new Engine({ dataDir, keyStore: memoryKeyStore(key), fetchImpl });
  engine.on('status', (st) => {
    if (st.phase && st.state === 'running' && st.total && st.done === st.total) console.log(`${st.phase} : ${st.message || 'ok'}`);
  });
  await engine.start();
  await engine.refreshNow();
  engine.stop();

  const st = await engine.getState();
  if (st.status.state === 'error') {
    console.log(`::error::Collecte interrompue : ${st.status.message}`);
    process.exitCode = 1;
    return;
  }
  const meta = engine.getMeta();
  if (!meta?.byBracket?.all?.boards) {
    console.log('::warning::Aucune partie analysée, rien à publier.');
    return;
  }
  fs.mkdirSync(outDir, { recursive: true });
  const published = { ...meta, source: 'hexalabs', requests: st.status.requests };
  fs.writeFileSync(path.join(outDir, `meta-${platform}.json`), JSON.stringify(published));
  const index = {
    updated: new Date(meta.computedAt).toISOString(),
    platforms: { [platform]: { patch: meta.patch, boards: meta.byBracket.all.boards, brackets: Object.keys(meta.byBracket) } }
  };
  fs.writeFileSync(path.join(outDir, `index-${platform}.json`), JSON.stringify(index, null, 2));
  const kb = Math.round(fs.statSync(path.join(outDir, `meta-${platform}.json`)).size / 1024);
  console.log(`Publié : meta-${platform}.json (${kb} Ko) · ${meta.byBracket.all.boards} parties · patch ${meta.patch} · ${st.status.requests} requêtes Riot`);
})().catch((err) => {
  console.log(`::error::${err.message}`);
  process.exitCode = 1;
});
