import { api, isDesktop } from './api.js';
import { buildGuide, compType } from './guide.js';

// ===================== État =====================
const S = {
  route: 'meta',
  static: null,
  meta: null,
  app: null,
  appInfo: null,
  update: null,
  expanded: new Set(),
  sort: {},
  guideId: null,
  overlay: null,
  f: { bracket: (() => { try { return localStorage.getItem('bracket') || 'all'; } catch { return 'all'; } })(), compSearch: '', compSort: 'tier', cost: 0, champSearch: '', itemKind: 'complet', augTier: 'tous', augSearch: '' },
  player: { loading: false, error: '', data: null, live: null, query: '' }
};

const $ = (sel) => document.querySelector(sel);
const view = $('#view');

// ===================== Utilitaires =====================
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const int = (v) => (v ?? 0).toLocaleString('fr-FR');
const pct = (v) => `${nf(v, 1)} %`;

function ago(ts) {
  if (!ts) return 'jamais';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86400)} j`;
}
function inTime(ts) {
  if (!ts) return '';
  const m = Math.max(0, Math.round((ts - Date.now()) / 60000));
  return m < 1 ? "dans moins d'une minute" : `dans ${m} min`;
}
const avgClass = (v) => (v <= 4.1 ? 'good' : v >= 4.75 ? 'bad' : '');
const initials = (name = '?') => name.replace(/[^\p{L}\p{N} ]/gu, '').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

const champ = (id) => S.static?.champions?.[id] || { apiName: id, name: id.replace(/^TFT\d+_/, ''), cost: 0, traits: [], icon: '' };
const trait = (id) => S.static?.traits?.[id] || { apiName: id, name: id.replace(/^TFT\d+_/, ''), icon: '' };
const item = (id) => S.static?.items?.[id] || { apiName: id, name: id.replace(/^TFT\d*_Item_/, '').replace(/([a-z])([A-Z])/g, '$1 $2'), icon: '' };
const aug = (id) => S.static?.augments?.[id] || { apiName: id, name: id.replace(/^TFT\d*_Augment_/, '').replace(/([a-z])([A-Z])/g, '$1 $2'), icon: '' };

// « Nom français (English name) » quand les deux diffèrent.
const label = (x) => (x?.en && x.en.toLowerCase() !== String(x.name).toLowerCase() ? `${x.name} (${x.en})` : x?.name || '');
const matches = (x, q) => !q || String(x.name).toLowerCase().includes(q) || String(x.en || '').toLowerCase().includes(q);
const compName = (c) => `${label(trait(c.main))} · ${label(champ(c.carry))}`;

const img = (src, alt) => (src ? `<img src="${esc(src)}" alt="" loading="lazy" data-fallback="${esc(initials(alt))}">` : esc(initials(alt)));

function champIcon(id, { sm = false } = {}) {
  const c = champ(id);
  return `<span class="ic champ ${sm ? 'sm' : ''} cost-${c.cost || 1}" data-tip="champ" data-id="${esc(id)}">${img(c.icon, c.name)}</span>`;
}
function unitEl(id, { star = 0, items = [], core = false, name = true } = {}) {
  return `<div class="unit ${core ? 'core' : ''}">
    <span class="stars">${star > 1 ? '★'.repeat(star) : ''}</span>
    ${champIcon(id)}
    <span class="items">${items.map((i) => itemIcon(i)).join('')}</span>
    ${name ? `<span class="uname">${esc(champ(id).name)}</span>` : ''}
  </div>`;
}
const itemIcon = (id, lg = false) => `<span class="ic item ${lg ? 'lg' : ''}" data-tip="item" data-id="${esc(id)}">${img(item(id).icon, item(id).name)}</span>`;
const traitIcon = (id) => `<span class="ic trait" data-tip="trait" data-id="${esc(id)}">${img(trait(id).icon, trait(id).name)}</span>`;
const augIcon = (id) => `<span class="ic aug" data-tip="aug" data-id="${esc(id)}">${img(aug(id).icon, aug(id).name)}</span>`;
const meter = (v, max = 100) => `<span class="meter"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></span>`;

// Image manquante -> initiales
document.addEventListener('error', (e) => {
  const t = e.target;
  if (t.tagName === 'IMG' && t.dataset.fallback !== undefined) t.replaceWith(document.createTextNode(t.dataset.fallback));
}, true);

// ===================== Infobulles =====================
const tip = $('#tooltip');
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-tip]');
  if (!el) return tip.classList.add('hidden');
  const id = el.dataset.id;
  let title = '';
  let desc = '';
  if (el.dataset.tip === 'champ') {
    const c = champ(id);
    title = `${label(c)} · ${c.cost || '?'} PO`;
    desc = [c.traits.map((t) => label(trait(t))).join(' · '), c.ability ? `${c.ability.name} — ${c.ability.desc}` : ''].filter(Boolean).join('\n\n');
  } else if (el.dataset.tip === 'item') {
    const it = item(id);
    title = label(it);
    desc = it.desc || '';
  } else if (el.dataset.tip === 'trait') {
    const t = trait(id);
    title = label(t);
    desc = [(t.breakpoints || []).map((b) => b.min).join(' / '), t.desc].filter(Boolean).join('\n');
  } else if (el.dataset.tip === 'aug') {
    const a = aug(id);
    title = label(a);
    desc = a.desc || '';
  } else {
    title = el.dataset.title || '';
  }
  tip.innerHTML = `<div class="t">${esc(title)}</div>${desc ? `<div class="d">${esc(desc).slice(0, 600)}</div>` : ''}`;
  tip.classList.remove('hidden');
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  let x = r.left + r.width / 2 - w / 2;
  let y = r.top - h - 8;
  if (y < 8) y = r.bottom + 8;
  x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
});

// ===================== Tableaux triables =====================
function table(id, cols, rows, defaultSort) {
  const st = (S.sort[id] ||= defaultSort);
  const col = cols.find((c) => c.key === st.key) || cols[0];
  const sorted = [...rows].sort((a, b) => {
    const va = col.value ? col.value(a) : a[col.key];
    const vb = col.value ? col.value(b) : b[col.key];
    return (va > vb ? 1 : va < vb ? -1 : 0) * st.dir;
  });
  return `<div class="table-wrap"><table>
    <thead><tr>${cols.map((c) => `<th class="${c.num ? 'num-h' : ''} ${c.key === st.key ? 'sorted' : ''}" data-sort="${id}:${c.key}">${esc(c.label)}${c.key === st.key ? (st.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
    <tbody>${sorted.map((r) => `<tr>${cols.map((c) => `<td class="${c.num ? 'n' : ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

// ===================== Élo =====================
/** Statistiques de la tranche d'élo choisie. */
const M = () => S.meta?.byBracket?.[S.f.bracket] || null;
const bracketLabel = (id) => (id === 'all' ? 'tous rangs' : S.app?.brackets?.find((b) => b.id === id)?.label || id);

function bracketSelect() {
  const avail = S.meta?.byBracket || {};
  const opts = [['all', 'Tous les rangs'], ...(S.app?.brackets || []).map((b) => [b.id, b.label])]
    .filter(([id]) => avail[id] || id === S.f.bracket || S.app?.settings?.brackets?.includes(id))
    .map(([id, l]) => `<option value="${id}" ${id === S.f.bracket ? 'selected' : ''}>${esc(l)}${avail[id] ? ` · ${int(avail[id].boards)} parties` : ' · collecte en cours'}</option>`)
    .join('');
  return `<select class="input" id="bracket" title="Rang des joueurs analysés">${opts}</select>`;
}

// ===================== En-tête commun =====================
function sampleText() {
  const m = M();
  if (!m?.boards) return 'Aucune partie analysée';
  const plat = S.app?.platforms?.find((p) => p.id === S.meta.platform)?.label || '';
  return `${int(m.boards)} parties ${bracketLabel(S.f.bracket)} ${plat}${S.meta.patch ? ` · patch ${S.meta.patch}` : ''}`;
}

function head(title, subtitle, filters = '') {
  return `<div class="view-head"><div><h1>${esc(title)}</h1><p>${subtitle}</p></div><div class="filters">${filters}</div></div>`;
}

function noData() {
  if (!S.app?.hasKey) {
    return `<div class="empty"><div class="big">🔑</div><p>Ajoute ta clé API Riot pour lancer la collecte des parties.</p>
      <button class="btn primary" data-go="settings">Ouvrir les paramètres</button></div>`;
  }
  const st = S.app?.status || {};
  if (st.state === 'error') return `<div class="empty"><div class="big">⚠</div><p>${esc(st.message)}</p><button class="btn" data-action="refresh">Réessayer</button></div>`;
  return `<div class="empty"><div class="big">⏳</div><p>Collecte en cours : ${esc(st.phase || 'démarrage')}…<br>Les statistiques s'affichent dès les premières parties analysées.</p></div>`;
}

const chips = (name, options, current) =>
  `<div class="chips">${options.map(([v, l]) => `<span class="chip ${String(v) === String(current) ? 'on' : ''}" data-chip="${name}" data-v="${esc(v)}">${esc(l)}</span>`).join('')}</div>`;

// ===================== Vue : compos =====================
function viewMeta() {
  const m = M();
  const sub = `${sampleText()} · ${S.meta?.computedAt ? `calculé ${ago(S.meta.computedAt)}` : ''}`;
  const filters = `${bracketSelect()}<input class="input" id="comp-search" placeholder="Rechercher une compo, un champion…" value="${esc(S.f.compSearch)}">
    ${chips('compSort', [['tier', 'Tier'], ['pick', 'Popularité'], ['top4', 'Top 4'], ['win', 'Victoire']], S.f.compSort)}`;
  if (!m?.comps?.length) return head('Compos méta', sub, filters) + noData();

  const q = S.f.compSearch.toLowerCase();
  let comps = m.comps.filter((c) => !q || compName(c).toLowerCase().includes(q) || c.units.some((u) => matches(champ(u.id), q)));
  const by = { pick: (a, b) => b.pick - a.pick, top4: (a, b) => b.top4 - a.top4, win: (a, b) => b.win - a.win, tier: (a, b) => a.score - b.score };
  comps = comps.sort(by[S.f.compSort]);

  let body = '';
  if (S.f.compSort === 'tier') {
    for (const t of ['S', 'A', 'B', 'C', 'D']) {
      const list = comps.filter((c) => c.tier === t);
      if (!list.length) continue;
      body += `<div class="tier-group"><h2><span class="tier ${t}" style="width:24px;height:24px;font-size:13px">${t}</span>${list.length} compo${list.length > 1 ? 's' : ''}</h2>${list.map(compCard).join('')}</div>`;
    }
  } else body = comps.map(compCard).join('');

  return head('Compos méta', sub, filters) + (body || '<div class="empty">Aucune compo ne correspond.</div>');
}

function compCard(c) {
  const open = S.expanded.has(c.id);
  const carryItems = c.carryItems.slice(0, 3).map((i) => i.id);
  const units = c.units.slice(0, 9);
  return `<div class="comp">
    <div class="comp-row" data-toggle="${esc(c.id)}">
      <span class="tier ${c.tier}">${c.tier}</span>
      <div>
        <div class="comp-title">${esc(compName(c))}</div>
        <div class="comp-traits">${c.traits.slice(0, 5).map((t) => traitIcon(t.id)).join('')}<span class="pill gold">${esc(compType(c, champ(c.carry).cost || 4).label)}</span><button class="btn mini" data-guide="${esc(c.id)}">Guide ›</button></div>
      </div>
      <div class="comp-units">${units.map((u) => unitEl(u.id, { star: Math.round(u.star || (u.id === c.carry ? 2 : 1)), items: u.id === c.carry ? carryItems : [], core: c.core.includes(u.id) })).join('')}</div>
      <div class="stats">
        <div class="stat"><div class="v ${avgClass(c.avg)}">${nf(c.avg)}</div><div class="k">Moy.</div></div>
        <div class="stat"><div class="v">${pct(c.top4)}</div><div class="k">Top 4</div></div>
        <div class="stat"><div class="v">${pct(c.win)}</div><div class="k">Victoire</div></div>
        <div class="stat"><div class="v">${pct(c.pick)}</div><div class="k">Jouée</div></div>
      </div>
    </div>
    ${open ? compDetail(c) : ''}
  </div>`;
}

function compDetail(c) {
  const lines = (arr, iconFn, nameFn) =>
    arr.map((x) => `<div class="line">${iconFn(x.id)}<span class="grow">${esc(nameFn(x.id))}</span>${meter(x.rate)}<span class="num">${pct(x.rate)}</span>${x.avg !== undefined ? `<span class="num ${avgClass(x.avg)}">${nf(x.avg)}</span>` : ''}</div>`).join('');
  return `<div class="comp-detail">
    <div class="block"><h3>Champions (présence · moy.)</h3>${lines(c.units, (id) => champIcon(id, { sm: true }), (id) => label(champ(id)))}</div>
    <div class="block"><h3>Objets du carry · ${esc(label(champ(c.carry)))}</h3>${lines(c.carryItems, (id) => itemIcon(id, true), (id) => label(item(id))) || '<p class="num">—</p>'}
      <h3 style="margin-top:16px">Synergies</h3>${lines(c.traits, traitIcon, (id) => label(trait(id)))}</div>
    <div class="block"><h3>Augments</h3>${c.augments.length ? lines(c.augments, augIcon, (id) => label(aug(id))) : '<p class="num" style="text-align:left">Non fournis par Riot pour ce set.</p>'}
      <h3 style="margin-top:16px">Repères</h3>
      <div class="line"><span class="grow">Parties analysées</span><span class="num">${int(c.games)}</span></div>
      <div class="line"><span class="grow">Cœur de compo</span><span class="num">${c.core.length} unités</span></div>
      <div class="line"><span class="grow">Score pondéré</span><span class="num">${nf(c.score)}</span></div>
    </div>
  </div>`;
}

// ===================== Vue : guide de compo =====================
function recipe(id) {
  const comp = item(id).composition || [];
  return `<div class="recipe">${itemIcon(id, true)}<div><div class="rname">${esc(label(item(id)))}</div>
    ${comp.length === 2 ? `<div class="rparts">${itemIcon(comp[0])}<span>+</span>${itemIcon(comp[1])}</div>` : ''}</div></div>`;
}

function stepIds(step) {
  if (!step.ids?.length) return '';
  if (step.kind === 'units' || step.kind === 'final') return `<div class="comp-units">${step.ids.map((id) => unitEl(id)).join('')}</div>`;
  if (step.kind === 'items') return `<div class="tags">${step.ids.map((id) => `<span class="tag">${itemIcon(id)}${esc(label(item(id)))}</span>`).join('')}</div>`;
  if (step.kind === 'augs') return `<div class="tags">${step.ids.map((id) => `<span class="tag">${augIcon(id)}${esc(label(aug(id)))}</span>`).join('')}</div>`;
  return '';
}

function viewGuide() {
  const m = M();
  const c = m?.comps.find((x) => x.id === S.guideId) || S.meta?.byBracket?.all?.comps.find((x) => x.id === S.guideId);
  const back = '<a class="back" data-go="meta">‹ Compos méta</a>';
  if (!c) return `${back}<div class="empty">Cette compo n'est pas assez jouée dans ce rang pour avoir un guide.</div>`;
  const g = buildGuide(c, S.static, label);
  const finalStars = Object.fromEntries(c.units.map((u) => [u.id, Math.round(u.star || 1)]));

  return `${back}
  <div class="guide-head">
    <span class="tier ${c.tier}">${c.tier}</span>
    <div>
      <h1>${esc(compName(c))}</h1>
      <div class="row"><span class="pill gold">${esc(g.type.label)}</span><span class="pill">Carry : ${esc(label(champ(c.carry)))}</span>${g.tank ? `<span class="pill">Tank : ${esc(label(champ(g.tank)))}</span>` : ''}<span class="pill">${esc(bracketLabel(S.f.bracket))}</span></div>
      <div class="row" style="margin-top:10px"><button class="btn primary" data-play="${esc(c.id)}">▶ Jouer cette compo en mode partie</button>
        ${S.overlay?.compId === c.id ? '<span class="pill gold">Compo sélectionnée</span>' : ''}</div>
    </div>
    <div class="kpis" style="margin-left:auto">
      <div class="kpi"><div class="v ${avgClass(c.avg)}">${nf(c.avg)}</div><div class="k">Place moy.</div></div>
      <div class="kpi"><div class="v">${pct(c.top4)}</div><div class="k">Top 4</div></div>
      <div class="kpi"><div class="v">${pct(c.win)}</div><div class="k">Victoire</div></div>
      <div class="kpi"><div class="v">${int(c.games)}</div><div class="k">Parties</div></div>
    </div>
  </div>

  <div class="section-title">Plateau final</div>
  <div class="card"><div class="comp-units">${g.final.map((u) => unitEl(u.id, { star: finalStars[u.id], items: u.id === c.carry ? g.carryItems : u.id === g.tank ? g.tankItems : [], core: c.core.includes(u.id) })).join('')}</div></div>

  <div class="section-title">Plan de jeu étape par étape</div>
  <div class="timeline">${g.stages.map((st) => `
    <div class="stage">
      <div class="stage-head"><span class="stage-name">${esc(st.stage)}</span><span class="stage-rounds">${esc(st.rounds)}</span></div>
      ${st.steps.map((step) => `<div class="step"><p>${esc(step.text)}</p>${stepIds(step)}</div>`).join('')}
    </div>`).join('')}
  </div>

  <div class="section-title">Objets et recettes</div>
  <div class="grid">
    <div class="card"><h3>Carry · ${esc(label(champ(c.carry)))}</h3>${g.carryItems.map(recipe).join('') || '<p>—</p>'}</div>
    <div class="card"><h3>Tank${g.tank ? ` · ${esc(label(champ(g.tank)))}` : ''}</h3>${g.tankItems.map(recipe).join('') || '<p>Pas de tank attitré : mets les objets défensifs sur ta meilleure ligne avant.</p>'}</div>
    <div class="card"><h3>Composants à prioriser</h3><div class="tags">${g.components.map((id) => `<span class="tag">${itemIcon(id)}${esc(label(item(id)))}</span>`).join('')}</div>
      <p>Classés selon les objets à construire, du plus important au moins important.</p></div>
  </div>

  <div class="section-title">Placement (conseil général)</div>
  <div class="card"><p>Riot ne fournit pas le placement des unités. En règle générale : ${esc(label(champ(c.carry)))} dans un coin de la dernière ligne, ${g.tank ? esc(label(champ(g.tank))) : 'le tank principal'} devant lui, et les autres unités de ligne avant réparties face aux menaces adverses. Ajuste selon le carry ennemi le plus dangereux.</p></div>

  <div class="notice" style="margin-top:18px">Guide généré automatiquement à partir de <strong>${int(c.games)} parties ${esc(bracketLabel(S.f.bracket))}</strong> du patch ${esc(S.meta?.patch || 'actuel')} : plateaux finaux, objets, niveaux atteints et augments. Le tempo par étape suit les règles classiques de TFT selon le type de compo.</div>`;
}

// ===================== Vue : champions =====================
function viewChampions() {
  const filters = `${bracketSelect()}<input class="input" id="champ-search" placeholder="Rechercher…" value="${esc(S.f.champSearch)}">
    ${chips('cost', [[0, 'Tous'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], S.f.cost)}`;
  const m = M();
  if (!m?.champions?.length) return head('Champions', sampleText(), filters) + noData();
  const q = S.f.champSearch.toLowerCase();
  const rows = m.champions
    .filter((c) => champ(c.id).traits.length || champ(c.id).cost)
    .filter((c) => !S.f.cost || champ(c.id).cost === S.f.cost)
    .filter((c) => matches(champ(c.id), q));
  return head('Champions', sampleText(), filters) + table('champs', [
    { key: 'name', label: 'Champion', value: (r) => champ(r.id).name, render: (r) => `<div class="name-cell">${champIcon(r.id, { sm: true })}${esc(label(champ(r.id)))}</div>` },
    { key: 'cost', label: 'Coût', num: true, value: (r) => champ(r.id).cost, render: (r) => `${champ(r.id).cost} PO` },
    { key: 'avg', label: 'Moy.', num: true, render: (r) => `<span class="${avgClass(r.avg)}">${nf(r.avg)}</span>` },
    { key: 'top4', label: 'Top 4', num: true, render: (r) => pct(r.top4) },
    { key: 'win', label: 'Victoire', num: true, render: (r) => pct(r.win) },
    { key: 'pick', label: 'Jouée', num: true, render: (r) => pct(r.pick) },
    { key: 'three', label: '★★★', num: true, value: (r) => r.stars[2], render: (r) => pct(r.stars[2]) },
    { key: 'items', label: 'Objets favoris', value: (r) => r.items.length, render: (r) => `<div class="icons">${r.items.slice(0, 4).map((i) => itemIcon(i.id)).join('')}</div>` }
  ], rows, { key: 'avg', dir: 1 });
}

// ===================== Vue : synergies =====================
function viewTraits() {
  const m = M();
  if (!m?.traits?.length) return head('Synergies', sampleText(), bracketSelect()) + noData();
  const rows = m.traits.filter((t) => S.static?.traits?.[t.id]);
  return head('Synergies', sampleText(), bracketSelect()) + table('traits', [
    { key: 'name', label: 'Synergie', value: (r) => trait(r.id).name, render: (r) => `<div class="name-cell">${traitIcon(r.id)}${esc(label(trait(r.id)))}</div>` },
    { key: 'avg', label: 'Moy.', num: true, render: (r) => `<span class="${avgClass(r.avg)}">${nf(r.avg)}</span>` },
    { key: 'top4', label: 'Top 4', num: true, render: (r) => pct(r.top4) },
    { key: 'pick', label: 'Jouée', num: true, render: (r) => pct(r.pick) },
    { key: 'levels', label: 'Paliers (unités · moy.)', value: (r) => r.levels.length, render: (r) => `<div class="icons">${r.levels.slice(0, 5).map((l) => `<span class="pill ${l.avg <= 4.1 ? 'gold' : ''}">${l.num} · ${nf(l.avg)}</span>`).join('')}</div>` }
  ], rows, { key: 'pick', dir: -1 });
}

// ===================== Vue : objets =====================
function viewItems() {
  const kinds = [['complet', 'Complets'], ['artefact', 'Artefacts'], ['radieux', 'Radieux'], ['embleme', 'Emblèmes'], ['special', 'Spéciaux'], ['composant', 'Composants'], ['tous', 'Tous']];
  const filters = bracketSelect() + chips('itemKind', kinds, S.f.itemKind);
  const m = M();
  if (!m?.items?.length) return head('Objets', sampleText(), filters) + noData();
  const rows = m.items.filter((i) => S.f.itemKind === 'tous' || (S.static?.items?.[i.id]?.kind || 'complet') === S.f.itemKind);
  return head('Objets', sampleText(), filters) + table('items', [
    { key: 'name', label: 'Objet', value: (r) => item(r.id).name, render: (r) => `<div class="name-cell">${itemIcon(r.id, true)}${esc(label(item(r.id)))}</div>` },
    { key: 'avg', label: 'Moy.', num: true, render: (r) => `<span class="${avgClass(r.avg)}">${nf(r.avg)}</span>` },
    { key: 'top4', label: 'Top 4', num: true, render: (r) => pct(r.top4) },
    { key: 'win', label: 'Victoire', num: true, render: (r) => pct(r.win) },
    { key: 'games', label: 'Utilisations', num: true, render: (r) => int(r.games) },
    { key: 'holders', label: 'Meilleurs porteurs', value: (r) => r.holders.length, render: (r) => `<div class="icons">${r.holders.slice(0, 5).map((h) => champIcon(h.id, { sm: true })).join('')}</div>` }
  ], rows, { key: 'games', dir: -1 });
}

// ===================== Vue : augments =====================
const TIER_LABEL = { argent: 'Argent', or: 'Or', prismatique: 'Prismatique', inconnu: '—' };
function viewAugments() {
  const m = M();
  const filters = `${bracketSelect()}<input class="input" id="aug-search" placeholder="Rechercher…" value="${esc(S.f.augSearch)}">
    ${chips('augTier', [['tous', 'Tous'], ['argent', 'Argent'], ['or', 'Or'], ['prismatique', 'Prismatique']], S.f.augTier)}`;
  const q = S.f.augSearch.toLowerCase();
  const keep = (id) => (S.f.augTier === 'tous' || aug(id).tier === S.f.augTier) && matches(aug(id), q);

  if (m?.hasAugments) {
    const rows = m.augments.filter((a) => keep(a.id));
    return head('Augments', sampleText(), filters) + table('augs', [
      { key: 'name', label: 'Augment', value: (r) => aug(r.id).name, render: (r) => `<div class="name-cell">${augIcon(r.id)}${esc(label(aug(r.id)))}</div>` },
      { key: 'tier', label: 'Palier', value: (r) => aug(r.id).tier, render: (r) => `<span class="pill">${TIER_LABEL[aug(r.id).tier]}</span>` },
      { key: 'avg', label: 'Moy.', num: true, render: (r) => `<span class="${avgClass(r.avg)}">${nf(r.avg)}</span>` },
      { key: 'top4', label: 'Top 4', num: true, render: (r) => pct(r.top4) },
      { key: 'pick', label: 'Choisi', num: true, render: (r) => pct(r.pick) },
      { key: 's1', label: '2-1', num: true, value: (r) => r.stages[0] ?? 9, render: (r) => nf(r.stages[0]) },
      { key: 's2', label: '3-2', num: true, value: (r) => r.stages[1] ?? 9, render: (r) => nf(r.stages[1]) },
      { key: 's3', label: '4-2', num: true, value: (r) => r.stages[2] ?? 9, render: (r) => nf(r.stages[2]) }
    ], rows, { key: 'avg', dir: 1 });
  }

  const list = Object.values(S.static?.augments || {}).filter((a) => keep(a.apiName)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return head('Augments', `${list.length} augments du set ${S.static?.setNumber ?? ''}`, filters) +
    `<div class="notice"><strong>Statistiques d'augments indisponibles.</strong> L'API de match de Riot ne renvoie pas les augments choisis pour ce set : le catalogue ci-dessous reste à jour à chaque patch. Les stats s'activeront automatiquement si Riot les réintègre.</div>
    <div class="grid">${list.map((a) => `<div class="card"><div class="name-cell">${augIcon(a.apiName)}<div><h3>${esc(label(a))}</h3><span class="pill">${TIER_LABEL[a.tier]}</span></div></div><p>${esc(a.desc)}</p></div>`).join('') || '<div class="empty">Aucun augment.</div>'}</div>`;
}

// ===================== Vue : joueur =====================
const TIER_FR = { IRON: 'Fer', BRONZE: 'Bronze', SILVER: 'Argent', GOLD: 'Or', PLATINUM: 'Platine', EMERALD: 'Émeraude', DIAMOND: 'Diamant', MASTER: 'Maître', GRANDMASTER: 'Grand Maître', CHALLENGER: 'Challenger' };

function recentSearches() {
  try {
    return JSON.parse(localStorage.getItem('recent') || '[]');
  } catch {
    return [];
  }
}

function viewPlayer() {
  const p = S.player;
  const platform = p.platform || S.app?.settings?.platform || 'euw1';
  const opts = (S.app?.platforms || []).map((x) => `<option value="${x.id}" ${x.id === platform ? 'selected' : ''}>${x.label}</option>`).join('');
  const recent = recentSearches();
  let out = head('Recherche joueur', 'Historique classé, rang et partie en cours') +
    `<form class="search" id="player-form">
      <input class="input" id="player-q" placeholder="Pseudo#TAG" value="${esc(p.query)}" autocomplete="off">
      <select class="input" id="player-platform">${opts}</select>
      <button class="btn primary" ${p.loading ? 'disabled' : ''}>${p.loading ? 'Recherche…' : 'Rechercher'}</button>
    </form>
    ${recent.length ? `<div class="row" style="margin-top:10px">${recent.map((r) => `<span class="chip" data-recent="${esc(r)}">${esc(r)}</span>`).join('')}</div>` : ''}`;

  if (p.error) out += `<div class="notice" style="margin-top:16px">${esc(p.error)}</div>`;
  const d = p.data;
  if (!d) return out;

  const rk = d.ranked;
  out += `<div class="profile">
    <div class="who">${esc(d.account.gameName)} <span>#${esc(d.account.tagLine)}</span></div>
    <div class="kpis">
      <div class="kpi"><div class="v">${rk ? `${TIER_FR[rk.tier] || rk.tier} ${['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rk.tier) ? '' : rk.rank}` : 'Non classé'}</div><div class="k">${rk ? `${int(rk.leaguePoints)} LP · ${rk.wins} V` : 'Rang'}</div></div>
      <div class="kpi"><div class="v ${avgClass(d.summary.avg)}">${nf(d.summary.avg)}</div><div class="k">Place moy. (${d.summary.games})</div></div>
      <div class="kpi"><div class="v">${d.summary.top4}</div><div class="k">Top 4</div></div>
      <div class="kpi"><div class="v">${d.summary.wins}</div><div class="k">Victoires</div></div>
    </div>
    <button class="btn" data-action="live">● Partie en cours ?</button>
  </div>`;

  if (p.live) {
    out += p.live.inGame
      ? `<div class="notice"><strong>En partie depuis ${Math.round((Date.now() - p.live.startedAt) / 60000)} min.</strong> Adversaires : ${p.live.players.map((x) => `<span class="chip" data-recent="${esc(x.riotId)}">${esc(x.riotId)}</span>`).join(' ')}</div>`
      : '<div class="notice">Pas de partie en cours.</div>';
  }

  out += d.games.map((g) => {
    const board = [...g.units].sort((a, b) => b[2].length - a[2].length || champ(b[0]).cost - champ(a[0]).cost);
    const traits = [...g.traits].sort((a, b) => b[2] - a[2]).slice(0, 6);
    return `<div class="game">
      <span class="place p${g.p}">${g.p}</span>
      <div class="meta">${g.queue === 1100 ? 'Classée' : g.queue === 1160 ? 'Double Up' : g.queue === 1090 ? 'Normale' : 'Mode spécial'}<br>${ago(g.ts)} · niv. ${g.lvl}<br>patch ${esc(g.patch)}</div>
      <div class="side">
        <div class="row">${traits.map(([id, n]) => `<span class="pill">${traitIcon(id)} ${n}</span>`).join('')}${(g.aug || []).map((a) => augIcon(a)).join('')}</div>
        <div class="board">${board.map(([id, star, its]) => unitEl(id, { star, items: its, name: false })).join('')}</div>
      </div>
    </div>`;
  }).join('');
  return out;
}

async function searchPlayer(query, platform) {
  query = query.trim();
  if (!query) return;
  Object.assign(S.player, { query, platform, loading: true, error: '', live: null });
  render();
  try {
    S.player.data = await api.player(query, platform);
    const r = recentSearches().filter((x) => x.toLowerCase() !== query.toLowerCase());
    r.unshift(query);
    try {
      localStorage.setItem('recent', JSON.stringify(r.slice(0, 6)));
    } catch { /* stockage indisponible */ }
  } catch (err) {
    S.player.error = err.message;
    S.player.data = null;
  }
  S.player.loading = false;
  render();
}

// ===================== Vue : paramètres =====================
function viewSettings() {
  const st = S.app?.settings || {};
  const plats = (S.app?.platforms || []).map((x) => `<option value="${x.id}" ${x.id === st.platform ? 'selected' : ''}>${x.label}</option>`).join('');
  const tierBox = (t, l) => `<label class="row"><input type="checkbox" name="tiers" value="${t}" ${st.tiers?.includes(t) ? 'checked' : ''}> ${l}</label>`;
  const nb = (st.brackets || []).length;
  const per = (st.playersPerBracket || 0);
  const estCalls = nb * (8 + per + Math.round((per * (st.matchesPerPlayer || 0)) / 2));
  const estMin = Math.ceil(estCalls / 50);
  const bracketBox = (b) => `<label class="row"><input type="checkbox" name="brackets" value="${b.id}" ${st.brackets?.includes(b.id) ? 'checked' : ''}> ${esc(b.label)}</label>`;
  const info = S.appInfo || {};
  const upd = S.update;

  return head('Paramètres', 'Clé API, source des statistiques et mises à jour') + `
  <div class="form">
    <div class="section-title" style="margin-top:0">Clé API Riot</div>
    <div class="field"><label for="key">Clé (RGAPI-…)</label>
      <div class="row"><input class="input" style="flex:1" id="key" type="password" placeholder="${S.app?.hasKey ? '•••••••• (enregistrée)' : 'Colle ta clé ici'}"><button class="btn primary" data-action="save-key">Enregistrer et tester</button></div></div>
    <div class="field"><span></span><span class="msg" id="key-msg"></span></div>
    <div class="field"><span></span><span class="hint">Une clé de développement expire après 24 h. Génère-la sur developer.riotgames.com (connexion avec ton compte Riot).</span></div>

    <div class="section-title">Source des statistiques</div>
    <form class="form" id="settings-form">
      <div class="field"><label>Serveur</label><select class="input" name="platform">${plats}</select></div>
      <div class="field"><label>Rangs analysés</label><div class="row">${(S.app?.brackets || []).map(bracketBox).join('')}</div></div>
      <div class="field"><span></span><span class="hint">Chaque rang a sa propre méta : choisis-le avec le menu en haut des pages Compos, Champions, Objets…</span></div>
      <div class="field"><label>Tranche Maître+ inclut</label><div class="row">${tierBox('challenger', 'Challenger')}${tierBox('grandmaster', 'Grand Maître')}${tierBox('master', 'Maître')}</div></div>
      <div class="field"><label>Joueurs suivis par rang</label><input class="input" type="number" name="playersPerBracket" min="5" max="150" value="${st.playersPerBracket}"></div>
      <div class="field"><label>Parties récentes par joueur</label><input class="input" type="number" name="matchesPerPlayer" min="1" max="40" value="${st.matchesPerPlayer}"></div>
      <div class="field"><label>Actualisation automatique</label><select class="input" name="refreshMinutes">${[10, 15, 30, 60, 120, 360].map((v) => `<option value="${v}" ${Number(st.refreshMinutes) === v ? 'selected' : ''}>Toutes les ${v < 60 ? `${v} min` : `${v / 60} h`}</option>`).join('')}</select></div>
      <div class="field"><label>Patch</label><select class="input" name="patchMode"><option value="latest" ${st.patchMode === 'latest' ? 'selected' : ''}>Dernier patch uniquement</option><option value="all" ${st.patchMode === 'all' ? 'selected' : ''}>Tout le set</option></select></div>
      <div class="field"><span></span><span class="hint">Première collecte estimée : ~${estMin} min pour ${nb} rang${nb > 1 ? 's' : ''} avec une clé de développement (100 requêtes / 2 min). Les suivantes ne récupèrent que les nouvelles parties.</span></div>
      <div class="field"><span></span><div class="row"><button class="btn primary">Enregistrer</button><span class="msg" id="settings-msg"></span></div></div>
    </form>

    <div class="section-title">Mode partie</div>
    <div class="field"><label>Compo sélectionnée</label><span>${(() => {
      const c = S.meta?.byBracket?.[S.overlay?.bracket || 'all']?.comps.find((x) => x.id === S.overlay?.compId);
      return c ? esc(compName(c)) : 'Aucune : ouvre un guide et clique sur « Jouer cette compo »';
    })()}</span></div>
    ${isDesktop ? `<div class="field"><label>Ouverture automatique</label><label class="row"><input type="checkbox" id="ov-auto" ${S.overlay?.autoOpen ? 'checked' : ''}> Afficher la fenêtre quand une partie TFT démarre</label></div>
    <div class="field"><label>Raccourci</label><span><strong>${esc(S.overlay?.shortcut || 'Alt+G')}</strong> pour afficher / masquer, même en jeu</span></div>
    <div class="field"><span></span><span class="hint">Lance TFT en mode « Plein écran fenêtré » pour que la fenêtre reste visible au-dessus du jeu.</span></div>` : ''}
    <div class="field"><span></span><div class="row"><button class="btn" data-action="overlay-open">Ouvrir le mode partie</button></div></div>

    <div class="section-title">Application</div>
    <div class="field"><label>Version</label><span>${esc(info.version || '—')} ${isDesktop ? '' : '(version web)'}</span></div>
    <div class="field"><label>Données du jeu</label><span>${S.static ? `Set ${S.static.setNumber} « ${esc(S.static.setName)} » · patch ${esc(S.static.version)}` : '—'}</span></div>
    <div class="field"><label>Parties en base</label><span>${int(S.app?.storedMatches)}</span></div>
    ${isDesktop ? `<div class="field"><label>Mises à jour</label><div class="row"><span>${esc(upd?.message || 'Vérification automatique au démarrage puis toutes les 4 h')}</span><button class="btn" data-action="check-update">Vérifier</button>${upd?.state === 'downloaded' ? '<button class="btn primary" data-action="install-update">Redémarrer et installer</button>' : ''}</div></div>` : ''}

    <div class="section-title">Journal</div>
    <div class="logs" id="logs">${(S.app?.logs || []).slice().reverse().map((l) => `<div>${new Date(l.t).toLocaleTimeString('fr-FR')} — ${esc(l.message)}</div>`).join('') || 'Aucun événement.'}</div>
  </div>`;
}

// ===================== Rendu et navigation =====================
const VIEWS = { guide: viewGuide, meta: viewMeta, champions: viewChampions, traits: viewTraits, items: viewItems, augments: viewAugments, player: viewPlayer, settings: viewSettings };

function render() {
  const scroll = view.scrollTop;
  const focused = document.activeElement?.id;
  const caret = document.activeElement?.selectionStart;
  view.innerHTML = VIEWS[S.route]();
  view.scrollTop = scroll;
  if (focused) {
    const el = document.getElementById(focused);
    if (el) {
      el.focus();
      if (caret !== undefined && el.setSelectionRange) el.setSelectionRange(caret, caret);
    }
  }
  const navRoute = S.route === 'guide' ? 'meta' : S.route;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === navRoute));
  $('#set-label').textContent = S.static ? `Compagnon TFT · Set ${S.static.setNumber}` : 'Compagnon TFT';
  $('#sample-label').textContent = sampleText();
}

let renderTimer = null;
function softRender() {
  // Ne pas écraser un formulaire en cours d'édition.
  if (['settings', 'player'].includes(S.route)) return;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 400);
}

function go(route) {
  S.route = VIEWS[route] ? route : 'meta';
  location.hash = S.route;
  view.scrollTop = 0;
  render();
}

function renderStatus() {
  const st = S.app?.status || {};
  const live = $('#live');
  live.className = `live ${st.state || ''}`;
  let text;
  if (!S.app?.hasKey) text = 'Clé API Riot manquante';
  else if (st.state === 'running') text = `Mise à jour live · ${st.phase}${st.total ? ` ${st.done}/${st.total}` : ''}${st.message ? ` · ${st.message}` : ''}`;
  else if (st.state === 'error') text = st.message;
  else text = `À jour · ${ago(st.lastUpdate)}${st.nextUpdate ? ` · prochaine ${inTime(st.nextUpdate)}` : ''}`;
  $('#live-text').textContent = text;
  $('#progress-bar').style.width = st.state === 'running' && st.total ? `${(st.done / st.total) * 100}%` : '0';
  $('#btn-refresh').disabled = st.state === 'running';
}

// ===================== Événements =====================
document.getElementById('nav').addEventListener('click', (e) => {
  const a = e.target.closest('[data-route]');
  if (a) go(a.dataset.route);
});
$('#btn-refresh').addEventListener('click', () => api.refresh());
$('#update-banner').addEventListener('click', () => S.update?.state === 'downloaded' && api.installUpdate());

view.addEventListener('click', async (e) => {
  const t = e.target;
  const sortTh = t.closest('[data-sort]');
  if (sortTh) {
    const [id, key] = sortTh.dataset.sort.split(':');
    const st = S.sort[id];
    S.sort[id] = st && st.key === key ? { key, dir: -st.dir } : { key, dir: ['name'].includes(key) ? 1 : -1 };
    if (key === 'avg' && !(st && st.key === key)) S.sort[id].dir = 1;
    return render();
  }
  const chip = t.closest('[data-chip]');
  if (chip) {
    const v = chip.dataset.v;
    S.f[chip.dataset.chip] = /^\d+$/.test(v) ? Number(v) : v;
    return render();
  }
  const play = t.closest('[data-play]');
  if (play) {
    S.overlay = await api.overlaySet({ compId: play.dataset.play, bracket: S.f.bracket });
    await api.overlayToggle(true);
    return render();
  }
  const guideBtn = t.closest('[data-guide]');
  if (guideBtn) {
    S.guideId = guideBtn.dataset.guide;
    return go('guide');
  }
  const tog = t.closest('[data-toggle]');
  if (tog) {
    const id = tog.dataset.toggle;
    S.expanded.has(id) ? S.expanded.delete(id) : S.expanded.add(id);
    return render();
  }
  const recent = t.closest('[data-recent]');
  if (recent) return searchPlayer(recent.dataset.recent, $('#player-platform')?.value);
  const goEl = t.closest('[data-go]');
  if (goEl) return go(goEl.dataset.go);

  const action = t.closest('[data-action]')?.dataset.action;
  if (action === 'refresh') api.refresh();
  if (action === 'live' && S.player.data) {
    try {
      S.player.live = await api.live(S.player.data.account.puuid, S.player.data.platform);
    } catch (err) {
      S.player.live = null;
      S.player.error = err.message;
    }
    render();
  }
  if (action === 'save-key') {
    const msg = $('#key-msg');
    const key = $('#key').value.trim();
    if (!key) {
      msg.textContent = 'Colle une clé avant d\'enregistrer.';
      return;
    }
    msg.textContent = 'Vérification…';
    const res = await api.setApiKey(key);
    msg.innerHTML = `<span class="${res.ok ? 'good' : 'bad'}">${esc(res.message)}</span>`;
    S.app = await api.state();
    renderStatus();
  }
  if (action === 'check-update') api.checkUpdate();
  if (action === 'overlay-open') api.overlayToggle(true);
  if (action === 'install-update') api.installUpdate();
});

view.addEventListener('input', (e) => {
  const id = e.target.id;
  if (id === 'comp-search') S.f.compSearch = e.target.value;
  else if (id === 'champ-search') S.f.champSearch = e.target.value;
  else if (id === 'aug-search') S.f.augSearch = e.target.value;
  else return;
  render();
});

view.addEventListener('change', async (e) => {
  if (e.target.id === 'ov-auto') {
    S.overlay = await api.overlaySet({ autoOpen: e.target.checked });
    return;
  }
  if (e.target.id !== 'bracket') return;
  S.f.bracket = e.target.value;
  try {
    localStorage.setItem('bracket', S.f.bracket);
  } catch { /* stockage indisponible */ }
  render();
});

view.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.target.id === 'player-form') return searchPlayer($('#player-q').value, $('#player-platform').value);
  if (e.target.id === 'settings-form') {
    const fd = new FormData(e.target);
    const patch = {
      platform: fd.get('platform'),
      tiers: fd.getAll('tiers'),
      brackets: fd.getAll('brackets'),
      playersPerBracket: Number(fd.get('playersPerBracket')),
      matchesPerPlayer: Number(fd.get('matchesPerPlayer')),
      refreshMinutes: Number(fd.get('refreshMinutes')),
      patchMode: fd.get('patchMode')
    };
    S.app = await api.setSettings(patch);
    $('#settings-msg').innerHTML = '<span class="good">Enregistré.</span>';
    renderStatus();
  }
});

window.addEventListener('hashchange', () => {
  const r = location.hash.slice(1);
  if (r && r !== S.route && VIEWS[r]) go(r);
});

// ===================== Flux live =====================
api.on('status', (st) => {
  if (S.app) S.app.status = st;
  renderStatus();
});
api.on('meta', async (meta) => {
  S.meta = meta;
  // Filet de sécurité : récupère les données du jeu si elles manquent encore.
  if (!S.static) {
    try {
      S.static = await api.static();
    } catch { /* nouvel essai au prochain événement */ }
  }
  $('#sample-label').textContent = sampleText();
  softRender();
});
api.on('static', (data) => {
  S.static = data;
  softRender();
});
api.on('log', (entry) => {
  if (!S.app) return;
  S.app.logs = [...(S.app.logs || []), entry].slice(-50);
  const box = document.getElementById('logs');
  if (box) box.insertAdjacentHTML('afterbegin', `<div>${new Date(entry.t).toLocaleTimeString('fr-FR')} — ${esc(entry.message)}</div>`);
});
api.on('update', (u) => {
  S.update = u;
  const b = $('#update-banner');
  if (u.state === 'available' || u.state === 'downloading') {
    b.textContent = u.message;
    b.classList.remove('hidden');
  } else if (u.state === 'downloaded') {
    b.textContent = `${u.message} — cliquer pour redémarrer`;
    b.classList.remove('hidden');
  } else b.classList.add('hidden');
  if (S.route === 'settings') render();
});

api.on('overlay', (ov) => {
  S.overlay = { ...S.overlay, ...ov };
});
api.on('navigate', (route) => go(route));

// Rafraîchit les « il y a X min ».
setInterval(renderStatus, 30000);

// ===================== Démarrage =====================
(async function boot() {
  try {
    [S.app, S.static, S.meta, S.appInfo, S.overlay] = await Promise.all([api.state(), api.static(), api.meta(), api.appInfo(), api.overlayGet()]);
  } catch (err) {
    view.innerHTML = `<div class="empty"><div class="big">⚠</div><p>${esc(err.message)}</p></div>`;
    return;
  }
  const r = location.hash.slice(1);
  S.route = VIEWS[r] && r !== 'guide' ? r : S.app?.hasKey ? 'meta' : 'settings';
  renderStatus();
  render();
})();
