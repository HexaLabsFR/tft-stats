import { api, isDesktop } from './api.js';
import { buildGuide, compType } from './guide.js';

// ===================== État =====================
const stored = (k, d) => {
  try {
    return localStorage.getItem(k) || d;
  } catch {
    return d;
  }
};
const remember = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch { /* stockage indisponible */ }
};

const S = {
  route: 'meta',
  static: null,
  meta: null,
  app: null,
  appInfo: null,
  update: null,
  overlay: null,
  sort: {},
  guideId: null,
  selComp: null,
  mode: stored('mode', 'simple'), // simple | expert
  f: {
    bracket: stored('bracket', 'all'),
    compSearch: '',
    compSort: 'reco',
    exploreTab: stored('exploreTab', 'champions'),
    cost: 0,
    champSearch: '',
    itemKind: 'complet',
    augTier: 'tous',
    augSearch: ''
  },
  player: { loading: false, error: '', data: null, live: null, query: '' }
};
const expert = () => S.mode === 'expert';

const $ = (sel) => document.querySelector(sel);
const view = $('#view');

// ===================== Utilitaires =====================
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const int = (v) => (v ?? 0).toLocaleString('fr-FR');
const pct = (v, d = 0) => `${nf(v, d)} %`;

function ago(ts) {
  if (!ts) return 'jamais';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86400)} j`;
}
const avgClass = (v) => (v <= 4.1 ? 'good' : v >= 4.75 ? 'bad' : '');
const initials = (name = '?') => name.replace(/[^\p{L}\p{N} ]/gu, '').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

const champ = (id) => S.static?.champions?.[id] || { apiName: id, name: id.replace(/^TFT\d+_/, ''), cost: 0, traits: [], icon: '' };
const trait = (id) => S.static?.traits?.[id] || { apiName: id, name: id.replace(/^TFT\d+_/, ''), icon: '' };
const item = (id) => S.static?.items?.[id] || { apiName: id, name: id.replace(/^TFT\d*_Item_/, '').replace(/([a-z])([A-Z])/g, '$1 $2'), icon: '', composition: [] };
const aug = (id) => S.static?.augments?.[id] || { apiName: id, name: id.replace(/^TFT\d*_Augment_/, '').replace(/([a-z])([A-Z])/g, '$1 $2'), icon: '' };

// « Nom français (English name) » quand les deux diffèrent.
const label = (x) => (x?.en && x.en.toLowerCase() !== String(x.name).toLowerCase() ? `${x.name} (${x.en})` : x?.name || '');
const matches = (x, q) => !q || String(x.name).toLowerCase().includes(q) || String(x.en || '').toLowerCase().includes(q);
const compTitle = (c) => label(trait(c.main));
const compName = (c) => `${label(trait(c.main))} · ${label(champ(c.carry))}`;
const DIFF = { lvl8: 'Facile', reroll: 'Moyen', fast9: 'Difficile' };

const img = (src, alt) => (src ? `<img src="${esc(src)}" alt="" loading="lazy" data-fallback="${esc(initials(alt))}">` : esc(initials(alt)));
function champIcon(id, size = '') {
  const c = champ(id);
  return `<span class="ic champ ${size} cost-${c.cost || 1}" data-tip="champ" data-id="${esc(id)}">${img(c.icon, c.name)}</span>`;
}
const itemIcon = (id, lg = false) => `<span class="ic item ${lg ? 'lg' : ''}" data-tip="item" data-id="${esc(id)}">${img(item(id).icon, item(id).name)}</span>`;
const traitIcon = (id) => `<span class="ic trait" data-tip="trait" data-id="${esc(id)}">${img(trait(id).icon, trait(id).name)}</span>`;
const augIcon = (id) => `<span class="ic aug" data-tip="aug" data-id="${esc(id)}">${img(aug(id).icon, aug(id).name)}</span>`;
const meter = (v, max = 100) => `<span class="meter"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></span>`;
function unitEl(id, { star = 0, items = [], core = false, name = true, size = 'lg' } = {}) {
  return `<div class="unit ${core ? 'core' : ''}">
    ${champIcon(id, size)}
    ${name ? `<span class="uname">${esc(champ(id).name)}</span>` : ''}
    <span class="stars">${star > 1 ? '★'.repeat(star) : ''}</span>
    ${items.length ? `<span class="items">${items.map((i) => itemIcon(i)).join('')}</span>` : ''}
  </div>`;
}
const recipeText = (id) => (item(id).composition || []).map((c) => item(c).name).join(' + ');

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
    desc = [recipeText(id) && `Recette : ${recipeText(id)}`, it.desc].filter(Boolean).join('\n\n');
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
    desc = el.dataset.desc || '';
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
  cols = cols.filter((c) => !c.expert || expert());
  const st = (S.sort[id] ||= defaultSort);
  const col = cols.find((c) => c.key === st.key) || cols[0];
  const sorted = [...rows].sort((a, b) => {
    const va = col.value ? col.value(a) : a[col.key];
    const vb = col.value ? col.value(b) : b[col.key];
    return (va > vb ? 1 : va < vb ? -1 : 0) * st.dir;
  });
  return `<div class="table-wrap"><table>
    <thead><tr>${cols.map((c) => `<th class="${c.num ? 'num-h' : ''} ${c.key === st.key ? 'sorted' : ''}" data-sort="${id}:${c.key}" ${c.help ? `data-tip="help" data-title="${esc(c.label)}" data-desc="${esc(c.help)}"` : ''}>${esc(c.label)}${c.key === st.key ? (st.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}</tr></thead>
    <tbody>${sorted.map((r) => `<tr>${cols.map((c) => `<td class="${c.num ? 'n' : ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}
const HELP = {
  top4: 'Part des parties terminées entre la 1re et la 4e place : plus c’est haut, mieux c’est.',
  avg: 'Place moyenne sur 8 joueurs : plus c’est bas, mieux c’est.',
  pick: 'Part des joueurs qui l’utilisent.'
};

// ===================== Rang =====================
const M = () => S.meta?.byBracket?.[S.f.bracket] || null;
const bracketLabel = (id) => (id === 'all' ? 'tous rangs' : S.app?.brackets?.find((b) => b.id === id)?.label || id);

function renderBracket() {
  const sel = $('#bracket');
  const avail = S.meta?.byBracket || {};
  const opts = [['all', 'Tous les rangs'], ...(S.app?.brackets || []).map((b) => [b.id, b.label])]
    .filter(([id]) => avail[id] || id === S.f.bracket || S.app?.settings?.brackets?.includes(id));
  sel.innerHTML = opts
    .map(([id, l]) => `<option value="${id}" ${id === S.f.bracket ? 'selected' : ''}>Rang · ${esc(l)}${avail[id] ? '' : ' (collecte…)'}</option>`)
    .join('');
}

function sampleText() {
  const m = M();
  if (!m?.boards) return 'Aucune partie analysée pour ce rang';
  const plat = S.app?.platforms?.find((p) => p.id === S.meta.platform)?.label || '';
  return `${int(m.boards)} parties ${bracketLabel(S.f.bracket)} · ${plat}${S.meta.patch ? ` · patch ${S.meta.patch}` : ''}`;
}

function noData() {
  if (!S.app?.hasKey) {
    return `<div class="empty"><p class="h2">Bienvenue sur HexaRise</p><p class="lede">Ajoute ta clé API Riot pour lancer l’analyse des parties de ton rang.</p>
      <a class="btn primary" data-go="settings">Ajouter ma clé</a></div>`;
  }
  const st = S.app?.status || {};
  if (st.state === 'error') return `<div class="empty"><p class="h2">Collecte interrompue</p><p class="lede">${esc(st.message)}</p><button class="btn" data-action="refresh">Réessayer</button></div>`;
  return `<div class="empty"><p class="h2">Analyse en cours</p><p class="lede">${esc(st.phase || 'Démarrage')}… Les compos s’affichent dès les premières parties analysées.</p></div>`;
}

const chips = (name, options, current) =>
  `<div class="chips">${options.map(([v, l]) => `<span class="chip ${String(v) === String(current) ? 'on' : ''}" data-chip="${name}" data-v="${esc(v)}">${esc(l)}</span>`).join('')}</div>`;

// ===================== Compos : liste + fiche =====================
function guideOf(c) {
  const g = buildGuide(c, S.static, label);
  const text = (i) => g.stages[i]?.steps.find((s) => s.kind === 'text')?.text || '';
  const keep = g.early.slice(0, 3).map((id) => champ(id).name).join(', ');
  const carry = champ(c.carry).name;
  const fin = { reroll: `Trouve ${carry} 3★`, lvl8: `Niveau 8, ${carry} 2★`, fast9: 'Monte niveau 9' }[g.type.id];
  g.summary = [
    { n: '01', title: 'Prépare le début', text: `${keep ? `Garde ${keep}. ` : ''}${text(1)}` },
    { n: '02', title: 'Stabilise', text: text(2) },
    { n: '03', title: fin, text: text(3) }
  ];
  const how = {
    lvl8: 'Une compo régulière, jouée en montant niveau 8.',
    reroll: 'On monte le carry 3 étoiles tôt, à petit niveau.',
    fast9: 'On économise pour monter niveau 9 et poser les unités 5 PO.'
  }[g.type.id];
  g.pitch = `${carry} inflige les dégâts${g.tank ? `, ${champ(g.tank).name} tient la ligne avant` : ''}. ${how}`;
  g.difficulty = DIFF[g.type.id];
  return g;
}

function sortedComps(m) {
  const q = S.f.compSearch.toLowerCase();
  const list = m.comps.filter((c) => !q || compName(c).toLowerCase().includes(q) || c.units.some((u) => matches(champ(u.id), q)));
  const by = { reco: (a, b) => a.score - b.score, pick: (a, b) => b.pick - a.pick, top4: (a, b) => b.top4 - a.top4 };
  return list.sort(by[S.f.compSort] || by.reco);
}

function viewMeta() {
  const m = M();
  if (!m?.comps?.length) return noData();
  const comps = sortedComps(m);
  let c = comps.find((x) => x.id === S.selComp) || m.comps.find((x) => x.id === S.selComp) || comps[0] || m.comps[0];
  S.selComp = c.id;

  const list = `<aside class="md-list" aria-label="Compos">
    <input class="input" id="comp-search" placeholder="Rechercher une compo ou un champion" value="${esc(S.f.compSearch)}">
    <div class="md-tools"><select class="select" id="comp-sort" aria-label="Trier">
      <option value="reco" ${S.f.compSort === 'reco' ? 'selected' : ''}>Recommandées</option>
      <option value="top4" ${S.f.compSort === 'top4' ? 'selected' : ''}>Meilleur top 4</option>
      <option value="pick" ${S.f.compSort === 'pick' ? 'selected' : ''}>Les plus jouées</option>
    </select></div>
    ${comps.map((x) => {
      const t = compType(x, champ(x.carry).cost || 4);
      return `<a class="md-item ${x.id === c.id ? 'on' : ''}" data-sel="${esc(x.id)}">
        <span class="tier ${x.tier}">${x.tier}</span>
        <span class="nm"><b>${esc(compTitle(x))} · ${esc(champ(x.carry).name)}</b><small>${esc(t.label)} · ${DIFF[t.id]}</small></span>
        <span class="v" data-tip="help" data-title="Top 4" data-desc="${esc(HELP.top4)}">${pct(x.top4)}</span>
      </a>`;
    }).join('') || '<p class="lede" style="padding:12px">Aucune compo ne correspond.</p>'}
  </aside>`;

  return `<div class="md">${list}<div class="md-main">${fiche(c, m)}</div></div>`;
}

function fiche(c, m) {
  const g = guideOf(c);
  const stars = Object.fromEntries(c.units.map((u) => [u.id, Math.round(u.star || 1)]));
  const selected = S.overlay?.compId === c.id;
  let out = `
  <div class="fiche-head">
    <div>
      <p class="eyebrow">Tier ${c.tier} · ${esc(g.type.label)} · ${g.difficulty}</p>
      <h1 class="h1">${esc(compTitle(c))}</h1>
      <p class="lede">${esc(g.pitch)}</p>
    </div>
    <div class="actions">
      <button class="btn primary" data-play="${esc(c.id)}">${selected ? 'Compo du mode partie ✓' : 'Jouer en mode partie'}</button>
      <button class="btn" data-guide="${esc(c.id)}">Guide complet</button>
    </div>
  </div>

  <div class="stats-row">
    <div><div class="stat-v">${pct(c.top4)}</div><div class="stat-k">finissent dans le top 4</div></div>
    <div><div class="stat-v">${pct(c.win)}</div><div class="stat-k">de victoires</div></div>
    <div><div class="stat-v">${nf(c.avg, 1)}</div><div class="stat-k">place moyenne sur 8</div></div>
    <div><div class="stat-v">${int(c.games)}</div><div class="stat-k">fois jouée (${esc(bracketLabel(S.f.bracket))})</div></div>
  </div>

  <section class="section">
    <h2 class="sec-title">Plateau final</h2>
    <div class="board">${g.final.map((u) => unitEl(u.id, { star: stars[u.id], items: expert() && u.id === g.tank ? g.tankItems : [], core: expert() && c.core.includes(u.id) })).join('')}</div>
  </section>

  <section class="section">
    <h2 class="sec-title">Le plan en 3 étapes</h2>
    <ol class="steps">${g.summary.map((s) => `<li><span class="step-n">${s.n}</span><b>${esc(s.title)}</b><p>${esc(s.text)}</p></li>`).join('')}</ol>
  </section>

  <section class="section">
    <h2 class="sec-title">Objets de ${esc(champ(c.carry).name)}</h2>
    <div class="rows">${g.carryItems.map((id) => `<div>${itemIcon(id, true)}<span class="grow">${esc(label(item(id)))}</span><span class="aside">${esc(recipeText(id))}</span></div>`).join('') || '<p class="lede">Pas assez de données.</p>'}</div>
  </section>`;

  if (!expert()) {
    out += `<button class="link" data-mode-switch="expert">Plus de détails : synergies, augments, statistiques (mode Expert) ›</button>`;
    return out;
  }

  const lines = (arr, iconFn, nameFn, showAvg = true) =>
    arr.map((x) => `<div class="line">${iconFn(x.id)}<span class="grow">${esc(nameFn(x.id))}</span>${meter(x.rate)}<span class="num">${pct(x.rate)}</span>${showAvg && x.avg !== undefined ? `<span class="num ${avgClass(x.avg)}">${nf(x.avg)}</span>` : ''}</div>`).join('');
  const augStages = (c.augStages || []).map((list, i) => (list.length ? `<div class="line"><span class="grow" style="color:var(--muted)">${['2-1', '3-2', '4-2'][i]}</span></div>${list.map((a) => `<div class="line">${augIcon(a.id)}<span class="grow">${esc(label(aug(a.id)))}</span><span class="num ${avgClass(a.avg)}">${nf(a.avg)}</span></div>`).join('')}` : '')).join('');
  out += `
  <section class="section">
    <h2 class="sec-title">Détails (mode Expert)</h2>
    <div class="xgrid">
      <div><p class="sec-title" style="margin-bottom:8px">Présence des champions · place moy.</p>${lines(c.units, (id) => champIcon(id, 'sm'), (id) => label(champ(id)))}</div>
      <div><p class="sec-title" style="margin-bottom:8px">Synergies</p>${lines(c.traits, traitIcon, (id) => label(trait(id)), false)}
        ${g.tank ? `<p class="sec-title" style="margin:18px 0 8px">Tank · ${esc(champ(g.tank).name)}</p>${lines(c.tankItems || [], (id) => itemIcon(id), (id) => label(item(id)))}` : ''}</div>
      <div><p class="sec-title" style="margin-bottom:8px">Augments par étape</p>${augStages || '<p class="lede">Non fournis par Riot pour ce set.</p>'}
        <p class="sec-title" style="margin:18px 0 8px">Repères</p>
        <div class="line"><span class="grow">Jouée par</span><span class="num">${pct(c.pick, 1)}</span></div>
        <div class="line"><span class="grow">Niveau final moyen</span><span class="num">${nf(c.avgLevel, 1)}</span></div>
        <div class="line"><span class="grow">Niveau 9 ou plus</span><span class="num">${pct((c.levelDist?.[2] || 0) + (c.levelDist?.[3] || 0))}</span></div>
        <div class="line"><span class="grow">${esc(champ(c.carry).name)} 3★</span><span class="num">${pct(c.carry3)}</span></div>
        <div class="line"><span class="grow">Score pondéré</span><span class="num">${nf(c.score)}</span></div>
      </div>
    </div>
  </section>`;
  return out;
}

// ===================== Guide complet =====================
function recipe(id) {
  const comp = item(id).composition || [];
  return `<div class="recipe">${itemIcon(id, true)}<div><div class="rname">${esc(label(item(id)))}</div>
    ${comp.length === 2 ? `<div class="rparts">${itemIcon(comp[0])}<span>+</span>${itemIcon(comp[1])}</div>` : ''}</div></div>`;
}

function stepIds(step) {
  if (!step.ids?.length) return '';
  if (step.kind === 'units' || step.kind === 'final') return `<div class="comp-units">${step.ids.map((id) => unitEl(id, { size: '' })).join('')}</div>`;
  if (step.kind === 'items') return `<div class="tags">${step.ids.map((id) => `<span class="tag">${itemIcon(id)}${esc(label(item(id)))}</span>`).join('')}</div>`;
  if (step.kind === 'augs') return `<div class="tags">${step.ids.map((id) => `<span class="tag">${augIcon(id)}${esc(label(aug(id)))}</span>`).join('')}</div>`;
  return '';
}

function findComp(id) {
  return M()?.comps.find((x) => x.id === id) || S.meta?.byBracket?.all?.comps.find((x) => x.id === id) || null;
}

function viewGuide() {
  const c = findComp(S.guideId);
  const back = '<a class="back" data-go="meta">‹ Retour aux compos</a>';
  if (!c) return `<div class="page">${back}<div class="empty"><p class="lede">Cette compo n’est pas assez jouée dans ce rang pour avoir un guide.</p></div></div>`;
  const g = guideOf(c);
  return `<div class="page">
  ${back}
  <div class="page-head">
    <div>
      <p class="eyebrow">Guide complet · ${esc(g.type.label)} · ${g.difficulty}</p>
      <h1 class="h1">${esc(compName(c))}</h1>
      <p class="lede">${esc(g.pitch)}</p>
    </div>
    <div class="actions"><button class="btn primary" data-play="${esc(c.id)}">${S.overlay?.compId === c.id ? 'Compo du mode partie ✓' : 'Jouer en mode partie'}</button></div>
  </div>

  <section class="guide-stages">${g.stages.map((st) => `
    <div class="gstage">
      <div><div class="gstage-name">${esc(st.stage)}</div><div class="gstage-rounds">${esc(st.rounds)}</div></div>
      <div>${st.steps.map((step) => `<div class="gstep"><p>${esc(step.text)}</p>${stepIds(step)}</div>`).join('')}</div>
    </div>`).join('')}
  </section>

  <section class="section">
    <h2 class="sec-title">Objets et recettes</h2>
    <div class="xgrid">
      <div><p class="sec-title" style="margin-bottom:8px">${esc(champ(c.carry).name)} (carry)</p>${g.carryItems.map(recipe).join('') || '<p class="lede">—</p>'}</div>
      <div><p class="sec-title" style="margin-bottom:8px">${g.tank ? `${esc(champ(g.tank).name)} (tank)` : 'Ligne avant'}</p>${g.tankItems.map(recipe).join('') || '<p class="lede">Mets les objets défensifs sur ta meilleure ligne avant.</p>'}</div>
      <div><p class="sec-title" style="margin-bottom:8px">Composants à prendre en priorité</p><div class="tags">${g.components.map((id) => `<span class="tag">${itemIcon(id)}${esc(item(id).name)}</span>`).join('')}</div></div>
    </div>
  </section>

  <section class="section">
    <h2 class="sec-title">Placement (conseil général)</h2>
    <p class="lede">Riot ne fournit pas le placement des unités. En règle générale : ${esc(champ(c.carry).name)} dans un coin de la dernière ligne, ${g.tank ? esc(champ(g.tank).name) : 'le tank principal'} devant lui, le reste de la ligne avant face aux menaces adverses.</p>
  </section>

  <p class="lede" style="font-size:13px">Guide généré à partir de ${int(c.games)} parties ${esc(bracketLabel(S.f.bracket))} du patch ${esc(S.meta?.patch || 'actuel')}.</p>
  </div>`;
}

// ===================== Guide en jeu =====================
function viewGame() {
  const ov = S.overlay || {};
  const c = ov.compId ? S.meta?.byBracket?.[ov.bracket || 'all']?.comps.find((x) => x.id === ov.compId) || findComp(ov.compId) : null;
  const head = `<div class="page-head"><div>
      <p class="eyebrow">Guide en jeu</p>
      <h1 class="h1">${c ? esc(compTitle(c)) : 'Aucune compo choisie'}</h1>
      <p class="lede">${c ? 'Ta compo s’affiche dans une petite fenêtre au-dessus du jeu, avec le plan à cocher, les recettes et les augments.' : 'Choisis une compo dans l’onglet Compos, puis clique sur « Jouer en mode partie ».'}</p>
    </div>
    <div class="actions">${c ? `<button class="btn primary" data-action="overlay-open">Ouvrir la fenêtre</button><button class="btn" data-go="meta">Changer de compo</button>` : '<button class="btn primary" data-go="meta">Choisir une compo</button>'}</div>
  </div>`;
  const g = c ? guideOf(c) : null;
  return `<div class="page">${head}
    <div class="game-hero">
      <div>${g
        ? `<section class="section"><h2 class="sec-title">Le plan</h2><ol class="steps">${g.summary.map((s) => `<li><span class="step-n">${s.n}</span><b>${esc(s.title)}</b><p>${esc(s.text)}</p></li>`).join('')}</ol></section>`
        : `<section class="section"><h2 class="sec-title">Comment ça marche</h2><ol class="steps">
            <li><span class="step-n">01</span><b>Choisis ta compo</b><p>Dans l’onglet Compos, ouvre une compo et clique sur « Jouer en mode partie ».</p></li>
            <li><span class="step-n">02</span><b>Lance ta partie</b><p>La fenêtre s’ouvre toute seule au-dessus du jeu, sans prendre le focus.</p></li>
            <li><span class="step-n">03</span><b>Suis le plan</b><p>Coche chaque étape, consulte les recettes et les augments. <kbd>${esc(ov.shortcut || 'Alt+G')}</kbd> pour l’afficher ou la masquer.</p></li>
          </ol></section>`}</div>
      <div class="kv">
        <div><span>Raccourci</span><span><kbd>${esc(ov.shortcut || 'Alt+G')}</kbd></span></div>
        ${isDesktop ? `<div><span>Ouverture automatique</span><label class="row"><input type="checkbox" id="ov-auto" ${ov.autoOpen ? 'checked' : ''}> au lancement d’une partie</label></div>` : ''}
        <div><span>Stats du rang</span><span>${esc(bracketLabel(ov.bracket || 'all'))}</span></div>
        <div><span>Partie détectée</span><span>${ov.inGame ? 'Oui' : 'Non'}</span></div>
      </div>
    </div>
    <p class="lede" style="font-size:13px">Règle TFT en « Plein écran fenêtré » pour garder la fenêtre visible. Conforme aux règles Riot : seules des infos choisies avant la partie sont affichées.</p>
  </div>`;
}

// ===================== Explorer =====================
const TABS = [['champions', 'Champions'], ['traits', 'Synergies'], ['items', 'Objets'], ['augments', 'Augments']];
function viewExplore() {
  const tab = TABS.some(([k]) => k === S.f.exploreTab) ? S.f.exploreTab : 'champions';
  const body = { champions: exploreChampions, traits: exploreTraits, items: exploreItems, augments: exploreAugments }[tab]();
  return `<div class="page">
    <div class="page-head"><div><p class="eyebrow">Explorer</p><h1 class="h1">Statistiques détaillées</h1><p class="lede">${esc(sampleText())}</p></div></div>
    <nav class="tabs">${TABS.map(([k, l]) => `<a data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</nav>
    ${body}
  </div>`;
}

function exploreChampions() {
  const m = M();
  if (!m?.champions?.length) return noData();
  const q = S.f.champSearch.toLowerCase();
  const rows = m.champions
    .filter((c) => champ(c.id).traits.length || champ(c.id).cost)
    .filter((c) => !S.f.cost || champ(c.id).cost === S.f.cost)
    .filter((c) => matches(champ(c.id), q));
  return `<div class="toolbar"><input class="input" id="champ-search" placeholder="Rechercher un champion" value="${esc(S.f.champSearch)}">
    ${chips('cost', [[0, 'Tous'], [1, '1 PO'], [2, '2 PO'], [3, '3 PO'], [4, '4 PO'], [5, '5 PO']], S.f.cost)}</div>` + table('champs', [
    { key: 'name', label: 'Champion', value: (r) => champ(r.id).name, render: (r) => `<div class="name-cell">${champIcon(r.id, 'sm')}${esc(label(champ(r.id)))}</div>` },
    { key: 'top4', label: 'Top 4', num: true, help: HELP.top4, render: (r) => pct(r.top4) },
    { key: 'avg', label: 'Place moy.', num: true, help: HELP.avg, expert: true, render: (r) => `<span class="${avgClass(r.avg)}">${nf(r.avg)}</span>` },
    { key: 'win', label: 'Victoire', num: true, expert: true, render: (r) => pct(r.win, 1) },
    { key: 'pick', label: 'Jouée', num: true, help: HELP.pick, render: (r) => pct(r.pick) },
    { key: 'three', label: '3★', num: true, expert: true, value: (r) => r.stars[2], render: (r) => pct(r.stars[2], 1) },
    { key: 'items', label: 'Objets favoris', value: (r) => r.items.length, render: (r) => `<div class="icons">${r.items.slice(0, expert() ? 5 : 3).map((i) => itemIcon(i.id)).join('')}</div>` }
  ], rows, { key: 'top4', dir: -1 });
}

function exploreTraits() {
  const m = M();
  if (!m?.traits?.length) return noData();
  const rows = m.traits.filter((t) => S.static?.traits?.[t.id]);
  return table('traits', [
    { key: 'name', label: 'Synergie', value: (r) => trait(r.id).name, render: (r) => `<div class="name-cell">${traitIcon(r.id)}${esc(label(trait(r.id)))}</div>` },
    { key: 'top4', label: 'Top 4', num: true, help: HELP.top4, render: (r) => pct(r.top4) },
    { key: 'avg', label: 'Place moy.', num: true, help: HELP.avg, expert: true, render: (r) => `<span class="${avgClass(r.avg)}">${nf(r.avg)}</span>` },
    { key: 'pick', label: 'Jouée', num: true, help: HELP.pick, render: (r) => pct(r.pick) },
    { key: 'levels', label: 'Paliers (unités · place moy.)', expert: true, value: (r) => r.levels.length, render: (r) => `<div class="icons">${r.levels.slice(0, 5).map((l) => `<span class="pill ${l.avg <= 4.1 ? 'gold' : ''}">${l.num} · ${nf(l.avg)}</span>`).join('')}</div>` }
  ], rows, { key: 'pick', dir: -1 });
}

function exploreItems() {
  const kinds = [['complet', 'Complets'], ['artefact', 'Artefacts'], ['radieux', 'Radieux'], ['embleme', 'Emblèmes'], ['composant', 'Composants'], ['tous', 'Tous']];
  const m = M();
  if (!m?.items?.length) return noData();
  const rows = m.items.filter((i) => S.f.itemKind === 'tous' || (S.static?.items?.[i.id]?.kind || 'complet') === S.f.itemKind);
  return `<div class="toolbar">${chips('itemKind', kinds, S.f.itemKind)}</div>` + table('items', [
    { key: 'name', label: 'Objet', value: (r) => item(r.id).name, render: (r) => `<div class="name-cell">${itemIcon(r.id, true)}<div>${esc(label(item(r.id)))}${recipeText(r.id) ? `<div style="color:var(--faint);font-size:12px;font-weight:400">${esc(recipeText(r.id))}</div>` : ''}</div></div>` },
    { key: 'top4', label: 'Top 4', num: true, help: HELP.top4, render: (r) => pct(r.top4) },
    { key: 'avg', label: 'Place moy.', num: true, help: HELP.avg, expert: true, render: (r) => `<span class="${avgClass(r.avg)}">${nf(r.avg)}</span>` },
    { key: 'games', label: 'Utilisations', num: true, expert: true, render: (r) => int(r.games) },
    { key: 'holders', label: 'Meilleurs porteurs', value: (r) => r.holders.length, render: (r) => `<div class="icons">${r.holders.slice(0, expert() ? 5 : 3).map((h) => champIcon(h.id, 'sm')).join('')}</div>` }
  ], rows, { key: 'games', dir: -1 });
}

const TIER_LABEL = { argent: 'Argent', or: 'Or', prismatique: 'Prismatique', inconnu: '—' };
function exploreAugments() {
  const m = M();
  const q = S.f.augSearch.toLowerCase();
  const keep = (id) => (S.f.augTier === 'tous' || aug(id).tier === S.f.augTier) && matches(aug(id), q);
  const tools = `<div class="toolbar"><input class="input" id="aug-search" placeholder="Rechercher un augment" value="${esc(S.f.augSearch)}">
    ${chips('augTier', [['tous', 'Tous'], ['argent', 'Argent'], ['or', 'Or'], ['prismatique', 'Prismatique']], S.f.augTier)}</div>`;
  if (m?.hasAugments) {
    const rows = m.augments.filter((a) => keep(a.id));
    return tools + table('augs', [
      { key: 'name', label: 'Augment', value: (r) => aug(r.id).name, render: (r) => `<div class="name-cell">${augIcon(r.id)}${esc(label(aug(r.id)))}</div>` },
      { key: 'tier', label: 'Palier', value: (r) => aug(r.id).tier, render: (r) => `<span class="pill">${TIER_LABEL[aug(r.id).tier]}</span>` },
      { key: 'top4', label: 'Top 4', num: true, help: HELP.top4, render: (r) => pct(r.top4) },
      { key: 'avg', label: 'Place moy.', num: true, help: HELP.avg, render: (r) => `<span class="${avgClass(r.avg)}">${nf(r.avg)}</span>` },
      { key: 'pick', label: 'Choisi', num: true, expert: true, render: (r) => pct(r.pick, 1) },
      { key: 's1', label: '2-1', num: true, expert: true, value: (r) => r.stages[0] ?? 9, render: (r) => nf(r.stages[0]) },
      { key: 's2', label: '3-2', num: true, expert: true, value: (r) => r.stages[1] ?? 9, render: (r) => nf(r.stages[1]) },
      { key: 's3', label: '4-2', num: true, expert: true, value: (r) => r.stages[2] ?? 9, render: (r) => nf(r.stages[2]) }
    ], rows, { key: 'avg', dir: 1 });
  }
  const list = Object.values(S.static?.augments || {}).filter((a) => keep(a.apiName)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return tools + `<div class="notice"><strong>Statistiques d’augments indisponibles.</strong> Riot ne fournit pas les augments choisis pour ce set : voici le catalogue à jour.</div>
    <div class="grid">${list.map((a) => `<div class="card"><div class="name-cell">${augIcon(a.apiName)}<div><h3 style="margin:0">${esc(label(a))}</h3><span class="pill">${TIER_LABEL[a.tier]}</span></div></div><p>${esc(a.desc)}</p></div>`).join('') || '<div class="empty">Aucun augment.</div>'}</div>`;
}

// ===================== Mon profil =====================
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
  let out = `<div class="page"><div class="page-head"><div><p class="eyebrow">Mon profil</p><h1 class="h1">Rang et historique</h1><p class="lede">Entre ton Riot ID pour voir ton rang, tes 20 dernières parties et si tu es en partie.</p></div></div>
    <form class="search" id="player-form">
      <input class="input" id="player-q" placeholder="Pseudo#TAG" value="${esc(p.query)}" autocomplete="off">
      <select class="select" id="player-platform" aria-label="Serveur">${opts}</select>
      <button class="btn primary" ${p.loading ? 'disabled' : ''}>${p.loading ? 'Recherche…' : 'Rechercher'}</button>
    </form>
    ${recent.length ? `<div class="chips">${recent.map((r) => `<span class="chip" data-recent="${esc(r)}">${esc(r)}</span>`).join('')}</div>` : ''}`;

  if (p.error) out += `<div class="notice">${esc(p.error)}</div>`;
  const d = p.data;
  if (!d) return `${out}</div>`;

  const rk = d.ranked;
  out += `<div class="profile">
    <p class="h2" style="margin:0">${esc(d.account.gameName)} <span style="color:var(--muted)">#${esc(d.account.tagLine)}</span></p>
    <div class="kpis">
      <div class="kpi"><div class="v">${rk ? `${TIER_FR[rk.tier] || rk.tier} ${['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rk.tier) ? '' : rk.rank}` : 'Non classé'}</div><div class="k">${rk ? `${int(rk.leaguePoints)} LP` : 'Rang'}</div></div>
      <div class="kpi"><div class="v">${nf(d.summary.avg, 1)}</div><div class="k">place moyenne (${d.summary.games} parties)</div></div>
      <div class="kpi"><div class="v">${d.summary.top4}</div><div class="k">top 4</div></div>
      <div class="kpi"><div class="v">${d.summary.wins}</div><div class="k">victoires</div></div>
    </div>
    <button class="btn sm" data-action="live">Partie en cours ?</button>
  </div>`;
  if (p.live) out += p.live.inGame ? `<div class="notice"><strong>En partie depuis ${Math.round((Date.now() - p.live.startedAt) / 60000)} min.</strong></div>` : '<div class="notice">Pas de partie en cours.</div>';

  out += `<section>${d.games.map((g) => {
    const board = [...g.units].sort((a, b) => b[2].length - a[2].length || champ(b[0]).cost - champ(a[0]).cost);
    const traits = [...g.traits].sort((a, b) => b[2] - a[2]).slice(0, expert() ? 6 : 3);
    return `<div class="game">
      <span class="place p${g.p}">${g.p}</span>
      <div class="meta">${g.queue === 1100 ? 'Classée' : g.queue === 1160 ? 'Double Up' : g.queue === 1090 ? 'Normale' : 'Mode spécial'}<br>${ago(g.ts)} · niv. ${g.lvl}</div>
      <div class="side">
        <div class="row">${traits.map(([id, n]) => `<span class="pill">${traitIcon(id)} ${esc(trait(id).name)} ${n}</span>`).join('')}</div>
        <div class="comp-units">${board.map(([id, star, its]) => unitEl(id, { star, items: expert() ? its : [], name: false, size: '' })).join('')}</div>
      </div>
    </div>`;
  }).join('')}</section></div>`;
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
    remember('recent', JSON.stringify(r.slice(0, 6)));
  } catch (err) {
    S.player.error = err.message;
    S.player.data = null;
  }
  S.player.loading = false;
  render();
}

// ===================== Paramètres =====================
function viewSettings() {
  const st = S.app?.settings || {};
  const plats = (S.app?.platforms || []).map((x) => `<option value="${x.id}" ${x.id === st.platform ? 'selected' : ''}>${x.label}</option>`).join('');
  const tierBox = (t, l) => `<label class="row"><input type="checkbox" name="tiers" value="${t}" ${st.tiers?.includes(t) ? 'checked' : ''}> ${l}</label>`;
  const nb = (st.brackets || []).length;
  const per = st.playersPerBracket || 0;
  const estMin = Math.ceil((nb * (8 + per + Math.round((per * (st.matchesPerPlayer || 0)) / 2))) / 50);
  const bracketBox = (b) => `<label class="row"><input type="checkbox" name="brackets" value="${b.id}" ${st.brackets?.includes(b.id) ? 'checked' : ''}> ${esc(b.label)}</label>`;
  const info = S.appInfo || {};
  const upd = S.update;

  return `<div class="page"><div class="page-head"><div><p class="eyebrow">Paramètres</p><h1 class="h1">Réglages</h1></div></div>
  <div class="form">
    <div class="section-title" style="margin-top:0">Clé API Riot</div>
    <div class="field"><label for="key">Clé (RGAPI-…)</label>
      <div class="row"><input class="input" style="flex:1" id="key" type="password" placeholder="${S.app?.hasKey ? '•••••••• (enregistrée)' : 'Colle ta clé ici'}"><button class="btn primary sm" data-action="save-key">Enregistrer</button></div></div>
    <div class="field"><span></span><span class="msg" id="key-msg"></span></div>
    <div class="field"><span></span><span class="hint">Une clé de développement expire après 24 h. Génère-la sur developer.riotgames.com.</span></div>

    <div class="section-title">Source des statistiques</div>
    <form class="form" id="settings-form">
      <div class="field"><label>Serveur</label><select class="select" name="platform">${plats}</select></div>
      <div class="field"><label>Rangs analysés</label><div class="row">${(S.app?.brackets || []).map(bracketBox).join('')}</div></div>
      <div class="field"><label>Maître+ inclut</label><div class="row">${tierBox('challenger', 'Challenger')}${tierBox('grandmaster', 'Grand Maître')}${tierBox('master', 'Maître')}</div></div>
      <div class="field"><label>Joueurs suivis par rang</label><input class="input" type="number" name="playersPerBracket" min="5" max="150" value="${st.playersPerBracket}"></div>
      <div class="field"><label>Parties par joueur</label><input class="input" type="number" name="matchesPerPlayer" min="1" max="40" value="${st.matchesPerPlayer}"></div>
      <div class="field"><label>Actualisation</label><select class="select" name="refreshMinutes">${[10, 15, 30, 60, 120, 360].map((v) => `<option value="${v}" ${Number(st.refreshMinutes) === v ? 'selected' : ''}>Toutes les ${v < 60 ? `${v} min` : `${v / 60} h`}</option>`).join('')}</select></div>
      <div class="field"><label>Patch</label><select class="select" name="patchMode"><option value="latest" ${st.patchMode === 'latest' ? 'selected' : ''}>Dernier patch uniquement</option><option value="all" ${st.patchMode === 'all' ? 'selected' : ''}>Tout le set</option></select></div>
      <div class="field"><span></span><span class="hint">Première collecte : environ ${estMin} min pour ${nb} rang${nb > 1 ? 's' : ''}. Ensuite, seules les nouvelles parties sont récupérées.</span></div>
      <div class="field"><span></span><div class="row"><button class="btn primary sm">Enregistrer</button><span class="msg" id="settings-msg"></span></div></div>
    </form>

    <div class="section-title">Application</div>
    <div class="field"><span>Version</span><span>${esc(info.version || '—')} ${isDesktop ? '' : '(version web)'}</span></div>
    <div class="field"><span>Données du jeu</span><span>${S.static ? `Set ${S.static.setNumber} · patch ${esc(S.static.version)}` : '—'}</span></div>
    <div class="field"><span>Parties en base</span><span>${int(S.app?.storedMatches)}</span></div>
    ${isDesktop ? `<div class="field"><span>Mises à jour</span><div class="row"><span>${esc(upd?.message || 'Vérification au démarrage puis toutes les 4 h')}</span><button class="btn sm" data-action="check-update">Vérifier</button>${upd?.state === 'downloaded' ? '<button class="btn primary sm" data-action="install-update">Redémarrer</button>' : ''}</div></div>` : ''}

    <div class="section-title">Journal</div>
    <div class="logs" id="logs">${(S.app?.logs || []).slice().reverse().map((l) => `<div>${new Date(l.t).toLocaleTimeString('fr-FR')} — ${esc(l.message)}</div>`).join('') || 'Aucun événement.'}</div>
  </div></div>`;
}

// ===================== Rendu et navigation =====================
const VIEWS = { meta: viewMeta, guide: viewGuide, game: viewGame, explore: viewExplore, player: viewPlayer, settings: viewSettings };
const ALIASES = { champions: 'champions', traits: 'traits', items: 'items', augments: 'augments' };

function render() {
  const scroll = view.scrollTop;
  const focused = document.activeElement?.id;
  const caret = document.activeElement?.selectionStart;
  view.innerHTML = VIEWS[S.route]();
  view.scrollTop = scroll;
  if (focused) {
    const el = document.getElementById(focused);
    if (el && view.contains(el)) {
      el.focus();
      if (caret !== undefined && el.setSelectionRange) el.setSelectionRange(caret, caret);
    }
  }
  const navRoute = S.route === 'guide' ? 'meta' : S.route;
  document.querySelectorAll('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === navRoute && !a.classList.contains('brand')));
  document.querySelectorAll('#mode [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
  renderBracket();
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
  if (ALIASES[route]) {
    S.f.exploreTab = ALIASES[route];
    route = 'explore';
  }
  S.route = VIEWS[route] ? route : 'meta';
  if (location.hash.slice(1) !== S.route) location.hash = S.route;
  view.scrollTop = 0;
  render();
}

function renderStatus() {
  const st = S.app?.status || {};
  const live = $('#live');
  live.className = `live ${st.state || ''}`;
  let text;
  if (!S.app?.hasKey) text = 'Clé API manquante';
  else if (st.state === 'running') text = `Analyse · ${st.phase}${st.total ? ` ${st.done}/${st.total}` : ''}`;
  else if (st.state === 'error') text = 'Collecte interrompue';
  else text = `À jour ${ago(st.lastUpdate)}`;
  $('#live-text').textContent = text;
  live.title = st.state === 'error' ? st.message : 'Actualiser maintenant';
  $('#progress-bar').style.width = st.state === 'running' && st.total ? `${(st.done / st.total) * 100}%` : '0';
}

function setMode(mode) {
  S.mode = mode === 'expert' ? 'expert' : 'simple';
  remember('mode', S.mode);
  render();
}

// ===================== Événements =====================
document.addEventListener('click', async (e) => {
  const t = e.target;
  const routeEl = t.closest('[data-route]');
  if (routeEl) {
    e.preventDefault();
    return go(routeEl.dataset.route);
  }
  const modeBtn = t.closest('[data-mode]');
  if (modeBtn) return setMode(modeBtn.dataset.mode);
  const modeSwitch = t.closest('[data-mode-switch]');
  if (modeSwitch) return setMode(modeSwitch.dataset.modeSwitch);
  if (t.closest('#update-banner') && S.update?.state === 'downloaded') return api.installUpdate();

  if (!view.contains(t) && !t.closest('#live')) return;
  const sortTh = t.closest('[data-sort]');
  if (sortTh) {
    const [id, key] = sortTh.dataset.sort.split(':');
    const st = S.sort[id];
    S.sort[id] = st && st.key === key ? { key, dir: -st.dir } : { key, dir: key === 'name' || key === 'avg' ? 1 : -1 };
    return render();
  }
  const chip = t.closest('[data-chip]');
  if (chip) {
    const v = chip.dataset.v;
    S.f[chip.dataset.chip] = /^\d+$/.test(v) ? Number(v) : v;
    return render();
  }
  const tab = t.closest('[data-tab]');
  if (tab) {
    S.f.exploreTab = tab.dataset.tab;
    remember('exploreTab', S.f.exploreTab);
    return render();
  }
  const sel = t.closest('[data-sel]');
  if (sel) {
    S.selComp = sel.dataset.sel;
    render();
    view.querySelector('.md-main')?.scrollTo?.(0, 0);
    return;
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
      msg.textContent = 'Colle une clé avant d’enregistrer.';
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

document.addEventListener('change', async (e) => {
  const id = e.target.id;
  if (id === 'ov-auto') {
    S.overlay = await api.overlaySet({ autoOpen: e.target.checked });
    return;
  }
  if (id === 'comp-sort') {
    S.f.compSort = e.target.value;
    return render();
  }
  if (id === 'bracket') {
    S.f.bracket = e.target.value;
    remember('bracket', S.f.bracket);
    render();
  }
});

view.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.target.id === 'player-form') return searchPlayer($('#player-q').value, $('#player-platform').value);
  if (e.target.id === 'settings-form') {
    const fd = new FormData(e.target);
    S.app = await api.setSettings({
      platform: fd.get('platform'),
      tiers: fd.getAll('tiers'),
      brackets: fd.getAll('brackets'),
      playersPerBracket: Number(fd.get('playersPerBracket')),
      matchesPerPlayer: Number(fd.get('matchesPerPlayer')),
      refreshMinutes: Number(fd.get('refreshMinutes')),
      patchMode: fd.get('patchMode')
    });
    $('#settings-msg').innerHTML = '<span class="good">Enregistré.</span>';
    renderStatus();
    renderBracket();
  }
});

window.addEventListener('hashchange', () => {
  const r = location.hash.slice(1);
  if (r && r !== S.route && (VIEWS[r] || ALIASES[r])) go(r);
});

// ===================== Flux live =====================
api.on('status', (st) => {
  if (S.app) S.app.status = st;
  renderStatus();
});
api.on('meta', async (meta) => {
  S.meta = meta;
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
    b.textContent = 'Mise à jour prête · redémarrer';
    b.classList.remove('hidden');
  } else b.classList.add('hidden');
  if (S.route === 'settings') render();
});
api.on('overlay', (ov) => {
  S.overlay = { ...S.overlay, ...ov };
  if (S.route === 'game') render();
});
api.on('navigate', (route) => go(route));

setInterval(renderStatus, 30000);

// ===================== Démarrage =====================
(async function boot() {
  try {
    [S.app, S.static, S.meta, S.appInfo, S.overlay] = await Promise.all([api.state(), api.static(), api.meta(), api.appInfo(), api.overlayGet()]);
  } catch (err) {
    view.innerHTML = `<div class="empty"><p class="h2">Erreur</p><p class="lede">${esc(err.message)}</p></div>`;
    return;
  }
  const r = location.hash.slice(1);
  if (ALIASES[r]) S.f.exploreTab = ALIASES[r];
  S.route = ALIASES[r] ? 'explore' : VIEWS[r] && r !== 'guide' ? r : S.app?.hasKey ? 'meta' : 'settings';
  renderStatus();
  render();
})();
