'use strict';
/**
 * Veille des guides : repère les guides modifiés par leurs auteurs, les nouveaux guides
 * et les changements de patch des tier lists (bunnymuffins.lol, tftacademy.com).
 * Écrit content/guides-watch.json, lu par l'application. Lancé chaque jour par
 * .github/workflows/watch-guides.yml ; les fiches sont ensuite réécrites à la main.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GUIDES = require(path.join(ROOT, 'content', 'guides.json'));
const OUT = path.join(ROOT, 'content', 'guides-watch.json');
const UA = { 'User-Agent': 'HexaRise-veille/1.0 (+https://github.com/HexaLabsFR/tft-stats)' };
const day = (s) => (s ? String(s).slice(0, 10) : '');
// Les dates des fiches sont en heure locale de l'auteur, celles de l'API en UTC : un jour de marge.
const after = (a, b) => Boolean(a) && (!b || new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`) > 86400000);
const norm = (u) => String(u || '').replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();

async function get(url, type = 'json') {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return type === 'json' ? res.json() : res.text();
}

async function bunnymuffins(changes, errors) {
  const base = 'https://bunnymuffins.lol/wp-json/wp/v2';
  const fields = '_fields=link,modified_gmt,date_gmt,title,categories';
  let items = [];
  try {
    const [pages, posts] = await Promise.all([get(`${base}/pages?per_page=100&${fields}`), get(`${base}/posts?per_page=100&${fields}`)]);
    items = [...pages, ...posts];
  } catch (err) {
    errors.push(`bunnymuffins : ${err.message}`);
    return;
  }
  const byUrl = new Map(items.map((p) => [norm(p.link), p]));
  // Guides suivis modifiés depuis la fiche
  for (const g of GUIDES.guides.filter((x) => x.source === 'bunnymuffins')) {
    const p = byUrl.get(norm(g.url));
    if (p && after(day(p.modified_gmt), g.modified)) changes.push({ kind: 'updated', id: g.id, source: 'bunnymuffins', title: g.title, url: g.url, date: day(p.modified_gmt) });
  }
  // Tier list
  const meta = byUrl.get(norm(GUIDES.sources.bunnymuffins.tierlist));
  if (meta && after(day(meta.modified_gmt), GUIDES.sources.bunnymuffins.tierlistModified)) {
    changes.push({ kind: 'tierlist', source: 'bunnymuffins', title: 'Tier list BunnyMuffins', url: GUIDES.sources.bunnymuffins.tierlist, date: day(meta.modified_gmt) });
  }
  // Nouveaux guides : catégorie « Guide », publiés après la dernière révision des fiches
  let guideCat = null;
  try {
    guideCat = (await get(`${base}/categories?slug=guide&_fields=id`))[0]?.id ?? null;
  } catch (err) {
    errors.push(`bunnymuffins catégories : ${err.message}`);
  }
  const known = new Set(GUIDES.guides.map((g) => norm(g.url)));
  for (const p of items) {
    const isGuide = guideCat !== null && (p.categories || []).includes(guideCat);
    if (!isGuide || known.has(norm(p.link)) || day(p.date_gmt) <= GUIDES.updated) continue;
    const title = String(p.title?.rendered || '').replace(/<[^>]+>/g, '').replace(/&#8217;/g, '’').replace(/&amp;/g, '&');
    changes.push({ kind: 'new', source: 'bunnymuffins', title, url: p.link, date: day(p.date_gmt) });
  }
}

async function tftacademy(changes, errors) {
  let html = '';
  try {
    html = await get(GUIDES.sources.tftacademy.tierlist, 'text');
  } catch (err) {
    errors.push(`tftacademy : ${err.message}`);
    return;
  }
  const patch = (html.match(/Patch\s+(\d+\.\d+[a-z]?)/i) || [])[1] || '';
  if (patch && patch !== GUIDES.patch) {
    changes.push({ kind: 'tierlist', source: 'tftacademy', title: `Tier list TFT Academy (patch ${patch})`, url: GUIDES.sources.tftacademy.tierlist, date: day(new Date().toISOString()), patch });
  }
  const links = new Set([...html.matchAll(/\/tierlist\/comps\/(set-\d+-[a-z0-9-]+)/gi)].map((m) => `https://tftacademy.com/tierlist/comps/${m[1].toLowerCase()}`));
  const known = new Set(GUIDES.comps.filter((c) => c.ta).map((c) => norm(c.ta.url)));
  for (const url of links) {
    if (!known.has(norm(url))) {
      const slug = url.split('/').pop().replace(/^set-\d+-/, '').replace(/-copy$/, '').replace(/-/g, ' ');
      changes.push({ kind: 'new', source: 'tftacademy', title: `Compo « ${slug} »`, url, date: day(new Date().toISOString()) });
    }
  }
  // Les compos absentes de la page ne sont pas signalées : la page charge une partie de ses liens après coup.
}

(async () => {
  const changes = [];
  const errors = [];
  await bunnymuffins(changes, errors);
  await tftacademy(changes, errors);
  let previous = null;
  try {
    previous = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch { /* premier passage */ }
  const key = (c) => `${c.kind}|${c.source}|${c.url}`;
  // Date de première détection conservée
  const firstSeen = new Map((previous?.changes || []).map((c) => [key(c), c.seen]));
  const today = day(new Date().toISOString());
  for (const c of changes) c.seen = firstSeen.get(key(c)) || today;
  const out = { checkedAt: new Date().toISOString(), fichesUpdated: GUIDES.updated, changes, errors };
  const same = previous && JSON.stringify(previous.changes) === JSON.stringify(changes) && JSON.stringify(previous.errors || []) === JSON.stringify(errors);
  if (!same) fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`${changes.length} changement(s)${same ? ' (inchangé)' : ''}`);
  for (const c of changes) console.log(`- ${c.kind} · ${c.source} · ${c.title} · ${c.url} · ${c.date}`);
  for (const e of errors) console.log(`::warning::${e}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
