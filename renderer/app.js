import { api, isDesktop } from './api.js';
import { buildGuide, compType, STREAKS, placement, boardHtml } from './guide.js';

// ===================== État =====================
const stored = (k, d) => {
  try {
    return localStorage.getItem(k) ?? d;
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
  content: null,
  app: null,
  appInfo: null,
  update: null,
  overlay: null,
  sort: {},
  guideId: null,
  champId: null,
  selComp: null,
  setPage: 'root', // root | collecte | journal
  mode: stored('mode', 'simple'), // simple | expert
  reduceMotion: stored('reduceMotion', '0') === '1',
  f: {
    bracket: stored('bracket', 'all'),
    q: '',
    compSort: 'reco',
    style: 'all',
    exploreTab: stored('exploreTab', 'champions'),
    cost: 0,
    champTrait: '',
    learnTab: stored('learnTab', 'guides'),
    learnLevel: 'tous',
    expertSrc: 'all',
    expertFocus: null,
    condKind: 'complet',
    champView: stored('champView', 'list'),
    itemKind: 'complet',
    augTier: 'tous',
    boardMirror: 0
  },
  player: { loading: false, error: '', data: null, live: null, query: '' }
};
const expert = () => S.mode === 'expert';

const $ = (sel) => document.querySelector(sel);
const view = $('#view');
const layer = $('#layer');

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

// Nom lisible d'un identifiant inconnu (« TFT18_Maokai », « DA_18_Maokai »…).
const pretty = (id = '') => String(id).replace(/^(TFT\d*|DA)_(\d+_)?(Item_|Augment_)?/i, '').replace(/\d+(?=_|$)/g, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
const champ = (id) => S.static?.champions?.[id] || { apiName: id, name: pretty(id), cost: 0, traits: [], icon: '' };
const trait = (id) => S.static?.traits?.[id] || { apiName: id, name: pretty(id), icon: '' };
const item = (id) => S.static?.items?.[id] || { apiName: id, name: pretty(id), icon: '', composition: [] };
const aug = (id) => S.static?.augments?.[id] || { apiName: id, name: pretty(id), icon: '' };

// « Nom français (English name) » quand les deux diffèrent.
const label = (x) => (x?.en && x.en.toLowerCase() !== String(x.name).toLowerCase() ? `${x.name} (${x.en})` : x?.name || '');
const matches = (x, q) => !q || String(x.name).toLowerCase().includes(q) || String(x.en || '').toLowerCase().includes(q);
const query = () => S.f.q.trim().toLowerCase();
// ===================== Glossaire et correspondances de noms =====================
let GLOSS = null;
/** Échappe le texte et souligne la première occurrence de chaque terme du glossaire (info-bulle). */
function gloss(text) {
  const out = esc(text);
  const terms = S.content?.glossary?.terms;
  if (!terms) return out;
  if (!GLOSS || GLOSS.src !== terms) {
    const map = new Map();
    for (const t of terms) if (t.auto !== false) for (const w of [t.term, ...(t.aliases || [])]) map.set(w.toLowerCase(), t);
    const alts = [...map.keys()].sort((a, b) => b.length - a.length).map((w) => esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    GLOSS = { src: terms, map, re: alts.length ? new RegExp(`(^|[^\\p{L}\\p{N}])(${alts.join('|')})(?=$|[^\\p{L}\\p{N}])`, 'giu') : null };
  }
  if (!GLOSS.re) return out;
  const used = new Set();
  return out.replace(GLOSS.re, (m, pre, word) => {
    const t = GLOSS.map.get(word.toLowerCase());
    if (!t || used.has(t.term)) return m;
    used.add(t.term);
    return `${pre}<span class="gl" data-tip="help" data-title="${esc(t.term)}" data-desc="${esc(t.def)}">${word}</span>`;
  });
}

let IDX = null;
/** Noms anglais ou français -> identifiants du set (pour les fiches des experts). */
function nameIndex() {
  if (IDX && IDX.sd === S.static) return IDX;
  const champEn = new Map();
  const itemEn = new Map();
  for (const c of Object.values(S.static?.champions || {})) {
    if (c.variantOf) continue;
    for (const n of [c.en, c.name]) if (n) champEn.set(n.toLowerCase(), c.apiName);
  }
  const canonical = (id) => (/^TFT_Item_[A-Za-z]+$/.test(id) ? 0 : 1);
  const items = Object.values(S.static?.items || {}).filter((it) => !it.outOfSet).sort((a, b) => canonical(a.apiName) - canonical(b.apiName));
  for (const it of items) for (const n of [it.en, it.name]) if (n && !itemEn.has(n.toLowerCase())) itemEn.set(n.toLowerCase(), it.apiName);
  IDX = { sd: S.static, champEn, itemEn };
  return IDX;
}
const champByName = (n) => nameIndex().champEn.get(String(n).toLowerCase()) || null;
const itemByName = (n) => nameIndex().itemEn.get(String(n).toLowerCase()) || null;
const expertComps = () => S.content?.guides?.comps || [];
const expertsFor = (carryId) => expertComps().filter((e) => e.carries.some((n) => champByName(n) === carryId));
const watchChanges = () => S.content?.watch?.changes || [];
const frDate = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR') : '');

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

const ICON = {
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  key: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/></svg>',
  globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg>',
  window: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/></svg>',
  expert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18h18M7 15l4-4 3 3 5-6"/></svg>',
  motion: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M14 6l6 6-6 6"/></svg>',
  keyboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>',
  update: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  data: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>'
};

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
  let html = '';
  if (el.dataset.tip === 'aug' || el.dataset.tip === 'item') {
    html = richTip(el.dataset.tip, id);
  } else if (el.dataset.tip === 'champ') {
    const c = champ(id);
    title = `${label(c)} · ${c.cost || '?'} PO`;
    desc = [c.traits.map((t) => label(trait(t))).join(' · '), c.ability ? `${c.ability.name} — ${c.ability.desc}` : ''].filter(Boolean).join('\n\n');
  } else if (el.dataset.tip === 'trait') {
    const t = trait(id);
    title = label(t);
    desc = [(t.breakpoints || []).map((b) => b.min).join(' / '), t.desc].filter(Boolean).join('\n');
  } else {
    title = el.dataset.title || '';
    desc = el.dataset.desc || '';
  }
  tip.innerHTML = html || `<div class="t">${esc(title)}</div>${desc ? `<div class="d">${esc(desc).slice(0, 600)}</div>` : ''}`;
  tip.classList.toggle('rich', Boolean(html));
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

// ===================== Menus, boîtes de dialogue, messages =====================
let menuState = null;
function closeLayer() {
  const els = layer.querySelectorAll('.menu, .scrim, .dialog');
  els.forEach((el) => el.classList.remove('open'));
  menuState = null;
  setTimeout(() => {
    if (!menuState && !layer.querySelector('.open')) layer.innerHTML = '';
  }, 260);
}

/** Menu Material ancré sous un élément. items : [{ value, label, checked, aside }] */
function openMenu(anchor, items, onPick) {
  closeLayer();
  const r = anchor.getBoundingClientRect();
  layer.innerHTML = `<div class="menu" role="menu" style="left:${Math.round(r.left)}px;top:${Math.round(r.bottom + 4)}px">
    ${items.map((it, i) => `<button role="menuitemradio" aria-checked="${it.checked ? 'true' : 'false'}" data-menu="${i}"><span class="check">${it.checked ? '✓' : ''}</span>${esc(it.label)}${it.aside ? `<span class="muted">${esc(it.aside)}</span>` : ''}</button>`).join('')}
  </div>`;
  menuState = { items, onPick };
  const menu = layer.firstElementChild;
  // Ligne de réglage : le menu s'aligne sur son bord droit, comme sur Android.
  if (anchor.classList.contains('set-row')) {
    menu.style.left = `${Math.round(r.right - menu.offsetWidth - 8)}px`;
    menu.style.transformOrigin = 'top right';
  }
  const overflow = menu.getBoundingClientRect().right - window.innerWidth + 12;
  if (overflow > 0) menu.style.left = `${Math.round(r.left - overflow)}px`;
  void menu.offsetWidth; // force le rendu initial pour que la transition s'applique
  menu.classList.add('open');
  menu.querySelector('button')?.focus({ preventScroll: true });
}

/** Boîte de dialogue Material. */
function openDialog({ title, body, actions }) {
  closeLayer();
  layer.innerHTML = `<div class="scrim" data-close="1"></div>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h2>${esc(title)}</h2>${body}
      <div class="actions">${actions}</div>
    </div>`;
  const els = layer.querySelectorAll('.scrim, .dialog');
  void layer.offsetWidth; // force le rendu initial pour que la transition s'applique
  els.forEach((el) => el.classList.add('open'));
  setTimeout(() => layer.querySelector('.dialog input')?.focus(), 60);
}

/** Clé refusée pendant la collecte : on propose directement de la remplacer (une fois par session). */
let keyPrompted = false;
function promptKeyIfRefused(st) {
  if (keyPrompted || st?.state !== 'error' || st.code !== 'BAD_KEY' || layer.innerHTML) return;
  keyPrompted = true;
  openKeyDialog();
  const msg = $('#key-msg');
  if (msg) msg.innerHTML = `<span class="bad">${esc(st.message)}</span>`;
}

function openKeyDialog() {
  openDialog({
    title: 'Clé API Riot',
    body: `<label for="key-input">Clé (RGAPI-…)</label>
      <input id="key-input" type="password" placeholder="${S.app?.hasKey ? '•••••••• (enregistrée)' : 'Colle ta clé ici'}" autocomplete="off">
      <p>Une clé de développement expire après 24 h. Sur developer.riotgames.com, clique sur « Regenerate API Key » puis copie-la avec l’icône de copie.</p>
      <p class="msg" id="key-msg"></p>`,
    actions: '<button class="btn text" data-close="1">Annuler</button><button class="btn filled" data-action="save-key">Enregistrer</button>'
  });
}

let snackTimer = null;
function toast(message) {
  const bar = $('#snackbar');
  $('#snack-text').textContent = message;
  bar.classList.add('open');
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => bar.classList.remove('open'), 3200);
}
$('#snack-ok').addEventListener('click', () => $('#snackbar').classList.remove('open'));

// ===================== Tableaux triables =====================
function table(id, cols, rows, defaultSort, rowAttr = () => '') {
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
    <tbody>${sorted.map((r) => `<tr ${rowAttr(r)}>${cols.map((c) => `<td class="${c.num ? 'n' : ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="small">Aucun résultat.</td></tr>`}</tbody>
  </table></div>`;
}
const HELP = {
  top4: 'Part des parties terminées entre la 1re et la 4e place : plus c’est haut, mieux c’est.',
  avg: 'Place moyenne sur 8 joueurs : plus c’est bas, mieux c’est.',
  pick: 'Part des joueurs qui l’utilisent.'
};

// ===================== Rang et barre d'outils =====================
const M = () => S.meta?.byBracket?.[S.f.bracket] || null;
const bracketLabel = (id) => (id === 'all' ? 'Tous les rangs' : S.app?.brackets?.find((b) => b.id === id)?.label || id);

function bracketItems() {
  const avail = S.meta?.byBracket || {};
  return [['all', 'Tous les rangs'], ...(S.app?.brackets || []).map((b) => [b.id, b.label])]
    .filter(([id]) => avail[id] || id === S.f.bracket || S.app?.settings?.brackets?.includes(id))
    .map(([id, l]) => ({ value: id, label: l, checked: id === S.f.bracket, aside: avail[id] ? `${int(avail[id].boards)} parties` : 'collecte…' }));
}

function toolbar(extra = '') {
  return `<div class="toolbar">
    <button class="chip menu-chip" data-menu-open="bracket">Rang : ${esc(bracketLabel(S.f.bracket))} ${ICON.down}</button>
    <div class="seg" role="group" aria-label="Niveau de détail">
      <button data-mode="simple" class="${S.mode === 'simple' ? 'on' : ''}">${S.mode === 'simple' ? '✓ ' : ''}Simple</button>
      <button data-mode="expert" class="${S.mode === 'expert' ? 'on' : ''}">${S.mode === 'expert' ? '✓ ' : ''}Expert</button>
    </div>
    ${extra ? `<span class="divider-v"></span>${extra}` : ''}
  </div>`;
}

const chips = (name, options, current) =>
  options.map(([v, l]) => `<button class="chip ${String(v) === String(current) ? 'on' : ''}" data-chip="${name}" data-v="${esc(v)}">${String(v) === String(current) ? '✓ ' : ''}${esc(l)}</button>`).join('');

function sampleText() {
  const m = M();
  if (!m?.boards) return 'Aucune partie analysée pour ce rang';
  const plat = S.app?.platforms?.find((p) => p.id === S.meta.platform)?.label || '';
  return `${int(m.boards)} parties · ${bracketLabel(S.f.bracket)} · ${plat}${S.meta.patch ? ` · patch ${S.meta.patch}` : ''}`;
}

function noData() {
  if (!S.app?.hasKey) {
    return `<div class="card empty"><p class="h2">Bienvenue sur HexaRise</p><p class="lede">Ajoute ta clé API Riot pour lancer l’analyse des parties de ton rang.</p>
      <button class="btn filled" data-action="key-dialog">${ICON.key}Ajouter ma clé</button></div>`;
  }
  const st = S.app?.status || {};
  if (st.state === 'error') return `<div class="card empty"><p class="h2">Collecte interrompue</p><p class="lede">${esc(st.message)}</p><button class="btn" data-action="refresh">Réessayer</button></div>`;
  return `<div class="card empty"><p class="h2">Analyse en cours</p><p class="lede">${esc(st.phase || 'Démarrage')}… Les compos s’affichent dès les premières parties analysées.</p></div>`;
}

// ===================== Compos : liste + fiche =====================
function guideOf(c) {
  const g = buildGuide(c, S.static, label);
  const text = (i) => g.stages[i]?.steps.find((s) => s.kind === 'text')?.text || '';
  const keep = g.early.slice(0, 3).map((id) => champ(id).name).join(', ');
  const carry = champ(c.carry).name;
  const fin = { reroll: `Trouve ${carry} 3★`, lvl8: `Niveau 8, ${carry} 2★`, fast9: 'Monte niveau 9' }[g.type.id];
  g.summary = [
    { n: '1', title: 'Prépare le début', text: `${keep ? `Garde ${keep}. ` : ''}${text(1)}` },
    { n: '2', title: 'Stabilise', text: text(2) },
    { n: '3', title: fin, text: text(3) }
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

function filteredComps(m) {
  const q = query();
  const list = m.comps.filter((c) => {
    if (q && !compName(c).toLowerCase().includes(q) && !c.units.some((u) => matches(champ(u.id), q))) return false;
    if (S.f.style === 'all') return true;
    const t = compType(c, champ(c.carry).cost || 4).id;
    return S.f.style === 'easy' ? t === 'lvl8' : t === S.f.style;
  });
  const by = { reco: (a, b) => a.score - b.score, pick: (a, b) => b.pick - a.pick, top4: (a, b) => b.top4 - a.top4 };
  return list.sort(by[S.f.compSort] || by.reco);
}

function viewMeta() {
  const extra = chips('style', [['all', 'Toutes'], ['easy', 'Faciles'], ['reroll', 'Reroll'], ['lvl8', 'Niveau 8'], ['fast9', 'Fast 9']], S.f.style) +
    `<button class="chip menu-chip" data-menu-open="sort">${esc({ reco: 'Recommandées', top4: 'Meilleur top 4', pick: 'Les plus jouées' }[S.f.compSort])} ${ICON.down}</button>`;
  const m = M();
  if (!m?.comps?.length) return toolbar(extra) + noData();
  const comps = filteredComps(m);
  const c = comps.find((x) => x.id === S.selComp) || comps[0];
  if (!c) return `${toolbar(extra)}<div class="card empty"><p class="lede">Aucune compo ne correspond à ta recherche.</p><button class="btn" data-action="clear-filters">Effacer les filtres</button></div>`;
  S.selComp = c.id;

  const list = `<aside class="card low md-list" aria-label="Compos">
    ${comps.map((x) => {
      const t = compType(x, champ(x.carry).cost || 4);
      return `<a class="md-item ${x.id === c.id ? 'on' : ''}" data-sel="${esc(x.id)}">
        <span class="tier ${x.tier}">${x.tier}</span>
        <span class="nm"><b>${esc(compTitle(x))} · ${esc(champ(x.carry).name)}</b><small>${esc(t.label)} · ${DIFF[t.id]}</small></span>
        <span class="v" data-tip="help" data-title="Top 4" data-desc="${esc(HELP.top4)}">${pct(x.top4)}</span>
      </a>`;
    }).join('')}
  </aside>`;
  const selected = S.overlay?.compId === c.id;
  const fab = `<button class="fab" data-play="${esc(c.id)}">${ICON.play}${selected ? 'Ouvrir le mode partie' : 'Jouer en mode partie'}</button>`;
  return `${toolbar(extra)}<div class="md">${list}<div class="md-main"><div class="card fiche" id="fiche">${fiche(c)}</div></div></div>${fab}`;
}

function fiche(c) {
  const g = guideOf(c);
  const stars = Object.fromEntries(c.units.map((u) => [u.id, Math.round(u.star || 1)]));
  const diffClass = { Facile: 'green', Moyen: 'cyan', Difficile: '' }[g.difficulty];
  let out = `
  <div class="fiche-head">
    <div>
      <div class="badges"><span class="pill grad">Tier ${c.tier}</span><span class="pill">${esc(g.type.label)}</span><span class="pill ${diffClass}">${g.difficulty}</span>${keyRounds(g.plan) ? `<span class="pill" data-tip="help" data-title="Moment clé" data-desc="Manche où tu dépenses ton or pour trouver ton carry. Détails dans le plan de niveaux du guide complet.">Roll à ${keyRounds(g.plan)}</span>` : ''}</div>
      <h1 class="h1">${esc(compTitle(c))}</h1>
      <p class="lede" style="margin-top:8px">${esc(g.pitch)}</p>
    </div>
    <button class="btn tonal" data-guide="${esc(c.id)}">Guide complet ${ICON.chevron}</button>
  </div>

  <div class="stats">
    <div class="card tonal"><div class="gnum">${pct(c.top4)}</div><div>finissent dans le top 4</div></div>
    <div class="card tonal"><div class="gnum">${pct(c.win)}</div><div>de victoires</div></div>
    <div class="card tonal"><div class="gnum">${nf(c.avg, 1)}</div><div>place moyenne sur 8</div></div>
    <div class="card tonal"><div class="gnum">${int(c.games)}</div><div>fois jouée</div></div>
  </div>

  <section>
    <h2 class="title">Plateau final</h2>
    <div class="board">${g.final.map((u) => unitEl(u.id, { star: stars[u.id], items: expert() && u.id === g.tank ? g.tankItems : [], core: expert() && c.core.includes(u.id) })).join('')}</div>
  </section>

  <section>
    <h2 class="title">Le plan en 3 étapes</h2>
    <ol class="steps">${g.summary.map((s) => `<li><span class="step-n">${s.n}</span><b>${esc(s.title)}</b><p>${gloss(s.text)}</p></li>`).join('')}</ol>
  </section>
  ${expertPills(c)}
  <section>
    <h2 class="title">Objets de ${esc(champ(c.carry).name)}</h2>
    <div class="rows">${g.carryItems.map((id) => `<div>${itemIcon(id, true)}<span class="grow">${esc(label(item(id)))}</span><span class="aside">${esc(recipeText(id))}</span></div>`).join('') || '<p class="small">Pas assez de données.</p>'}</div>
  </section>`;

  if (!expert()) {
    return `${out}<button class="link" data-mode="expert">Plus de détails : synergies, augments, statistiques (mode Expert) ›</button>`;
  }

  const lines = (arr, iconFn, nameFn, showAvg = true) =>
    arr.map((x) => `<div class="line">${iconFn(x.id)}<span class="grow">${esc(nameFn(x.id))}</span>${meter(x.rate)}<span class="num">${pct(x.rate)}</span>${showAvg && x.avg !== undefined ? `<span class="num ${avgClass(x.avg)}">${nf(x.avg)}</span>` : ''}</div>`).join('');
  const augStages = (c.augStages || []).map((list, i) => (list.length ? `<p class="small" style="margin:8px 0 2px">${['2-1', '3-2', '4-2'][i]}</p>${list.map((a) => `<div class="line">${augIcon(a.id)}<span class="grow">${esc(label(aug(a.id)))}</span><span class="num ${avgClass(a.avg)}">${nf(a.avg)}</span></div>`).join('')}` : '')).join('');
  out += `
  <section>
    <h2 class="title">Détails · mode Expert</h2>
    <div class="xgrid">
      <div><p class="label-sm">Présence · place moyenne</p>${lines(c.units, (id) => champIcon(id, 'sm'), (id) => label(champ(id)))}</div>
      <div><p class="label-sm">Synergies</p>${lines(c.traits, traitIcon, (id) => label(trait(id)), false)}
        ${g.tank ? `<p class="label-sm" style="margin-top:16px">Tank · ${esc(champ(g.tank).name)}</p>${lines(c.tankItems || [], (id) => itemIcon(id), (id) => label(item(id)))}` : ''}</div>
      <div><p class="label-sm">Augments par étape</p>${augStages || '<p class="small">Non fournis par Riot pour ce set.</p>'}
        <p class="label-sm" style="margin-top:16px">Repères</p>
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

// ===================== Plan de niveaux =====================
const keyRounds = (plan) => plan?.rows.filter((r) => r.key).map((r) => r.round).slice(0, 2).join(' / ') || '';

/** Tableau manche × série. Une ligne identique pour les trois séries tient sur une seule cellule. */
function planTable(plan, short = false) {
  const head = short ? ['Victoires', 'Mixte', 'Défaites'] : STREAKS.map(([, l]) => l);
  return `<div class="table-wrap"><table class="plan">
    <thead><tr><th>Manche</th>${head.map((l) => `<th>${esc(l)}</th>`).join('')}</tr></thead>
    <tbody>${plan.rows.map((r) => {
      const same = r.win === r.mixed && r.mixed === r.lose;
      const cells = same ? `<td colspan="3">${esc(r.win)}</td>` : `<td>${esc(r.win)}</td><td>${esc(r.mixed)}</td><td>${esc(r.lose)}</td>`;
      return `<tr class="${r.key ? 'key' : ''}"><td class="rd">${esc(r.round)}${r.key ? '<span class="kb">roll</span>' : ''}</td>${cells}</tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function planCard(g) {
  return `<div class="card">
    <div class="fiche-head">
      <div><h2 class="title" style="margin:0">Plan de niveaux</h2>
        <p class="small" style="margin:6px 0 0">Suis la colonne de ta série en cours. HexaRise ne lit pas ta partie : c’est toi qui regardes la bonne colonne.</p></div>
      <button class="btn text" data-route="shop">Chances en boutique ${ICON.chevron}</button>
    </div>
    ${planTable(g.plan)}
    ${g.plan.hint ? `<div class="notice" style="margin-top:12px">${esc(g.plan.hint)}</div>` : ''}
    <ul class="tips">${g.plan.tips.map((t) => `<li>${gloss(t)}</li>`).join('')}</ul>
  </div>`;
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
  const back = `<a class="back" data-back="meta">${ICON.back}Compos</a>`;
  if (!c) return `${back}<div class="card empty"><p class="lede">Cette compo n’est pas assez jouée dans ce rang pour avoir un guide.</p></div>`;
  const g = guideOf(c);
  return `${back}
  <div class="stack" style="margin-top:8px">
  <div class="card">
    <div class="fiche-head">
      <div>
        <div class="badges"><span class="pill grad">Guide complet</span><span class="pill">${esc(g.type.label)}</span><span class="pill">${g.difficulty}</span></div>
        <h1 class="h1">${esc(compName(c))}</h1>
        <p class="lede" style="margin-top:8px">${esc(g.pitch)}</p>
      </div>
      <button class="btn filled" data-play="${esc(c.id)}">${ICON.play}Jouer en mode partie</button>
    </div>
  </div>

  ${planCard(g)}
  ${expertTipsCard(c)}

  <div class="card">${g.stages.map((st) => `
    <div class="gstage">
      <div><div class="gstage-name">${esc(st.stage)}</div><div class="small">${esc(st.rounds)}</div></div>
      <div>${st.steps.map((step) => `<div class="gstep">${step.kind === 'note' ? `<p class="small">${esc(step.text)}</p>` : `<p>${gloss(step.text)}</p>`}${stepIds(step)}</div>`).join('')}</div>
    </div>`).join('')}
  </div>

  <div class="card">
    <h2 class="title">Objets et recettes</h2>
    <div class="xgrid">
      <div><p class="label-sm">${esc(champ(c.carry).name)} · carry</p>${g.carryItems.map(recipe).join('') || '<p class="small">—</p>'}</div>
      <div><p class="label-sm">${g.tank ? `${esc(champ(g.tank).name)} · tank` : 'Ligne avant'}</p>${g.tankItems.map(recipe).join('') || '<p class="small">Mets les objets défensifs sur ta meilleure ligne avant.</p>'}</div>
      <div><p class="label-sm">Composants prioritaires</p><div class="tags">${g.components.map((id) => `<span class="tag">${itemIcon(id)}${esc(item(id).name)}</span>`).join('')}</div></div>
    </div>
  </div>

  ${placementCard(c, g)}

  <div class="card tonal"><p class="small">Guide généré à partir de ${int(c.games)} parties (${esc(bracketLabel(S.f.bracket))}, patch ${esc(S.meta?.patch || 'actuel')}).</p></div>
  </div>`;
}

function placementCard(c, g) {
  const mirror = S.f.boardMirror === 1;
  const p = placement(c, S.static, g, { mirror, label });
  return `<div class="card">
    <div class="fiche-head" style="margin-bottom:12px"><div><h2 class="title" style="margin:0">Placement conseillé</h2>
      <p class="small" style="margin:6px 0 0">Calculé par HexaRise selon le rôle de chaque unité (portée, résistance, carry, tank) : Riot ne fournit pas la position des unités dans les parties.</p></div>
      <button class="btn tonal sm" data-chip="boardMirror" data-v="${mirror ? 0 : 1}">⇄ Inverser le plateau</button></div>
    <div class="board-wrap">${boardHtml(p, { champ, img, itemIcon, esc })}
      <ul class="tips">${p.tips.map((t) => `<li>${gloss(t)}</li>`).join('')}</ul></div>
  </div>`;
}

// ===================== En jeu =====================
function viewGame() {
  const ov = S.overlay || {};
  const c = ov.compId ? S.meta?.byBracket?.[ov.bracket || 'all']?.comps.find((x) => x.id === ov.compId) || findComp(ov.compId) : null;
  const g = c ? guideOf(c) : null;
  const steps = g
    ? g.summary
    : [
      { n: '1', title: 'Choisis ta compo', text: 'Dans Compos, sélectionne une compo puis « Jouer en mode partie ».' },
      { n: '2', title: 'Lance ta partie', text: 'La fenêtre s’ouvre toute seule au-dessus du jeu, sans prendre le focus.' },
      { n: '3', title: 'Suis le plan', text: `Coche chaque étape, consulte recettes et augments. ${ov.shortcut || 'Alt+G'} pour l’afficher ou la masquer.` }
    ];
  return `<div class="stack">
    <div class="card">
      <div class="fiche-head">
        <div>
          <div class="badges"><span class="pill ${ov.inGame ? 'green' : ''}">${ov.inGame ? '● Partie détectée' : 'Pas de partie en cours'}</span></div>
          <h1 class="h1">${c ? esc(compTitle(c)) : 'Mode partie'}</h1>
          <p class="lede" style="margin-top:8px">${c ? 'Ta compo s’affiche dans une petite fenêtre au-dessus du jeu, avec le plan à cocher, les recettes et les augments.' : 'Une petite fenêtre au-dessus du jeu avec le plan de ta compo.'}</p>
        </div>
        <div class="row">${c ? `<button class="btn filled" data-action="overlay-open">${ICON.window}Ouvrir la fenêtre</button><button class="btn" data-route="meta">Changer de compo</button>` : '<button class="btn filled" data-route="meta">Choisir une compo</button>'}</div>
      </div>
    </div>
    <div class="card"><h2 class="title">${g ? 'Le plan' : 'Comment ça marche'}</h2><ol class="steps">${steps.map((s) => `<li><span class="step-n">${s.n}</span><b>${esc(s.title)}</b><p>${esc(s.text)}</p></li>`).join('')}</ol></div>
    <div class="card tonal"><p class="small">Règle TFT en « Plein écran fenêtré » pour garder la fenêtre visible. Conforme aux règles Riot : seules des infos choisies avant la partie sont affichées. Réglages du mode partie dans Réglages.</p></div>
  </div>`;
}

// ===================== Explorer =====================
const TABS = [['champions', 'Champions'], ['traits', 'Synergies'], ['items', 'Objets'], ['augments', 'Augments'], ['shop', 'Boutique']];
const VIEW_ICON = {
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>'
};
function viewExplore() {
  const tab = TABS.some(([k]) => k === S.f.exploreTab) ? S.f.exploreTab : 'champions';
  const extra = {
    champions: chips('cost', [[0, 'Tous'], [1, '1 PO'], [2, '2 PO'], [3, '3 PO'], [4, '4 PO'], [5, '5 PO']], S.f.cost) +
      `<button class="chip menu-chip ${S.f.champTrait ? 'on' : ''}" data-menu-open="champ-trait">${S.f.champTrait ? `✓ ${esc(trait(S.f.champTrait).name)}` : 'Synergie : toutes'} ${ICON.down}</button>
      <div class="seg" role="group" aria-label="Affichage">${['list', 'grid'].map((v) => `<button data-champ-view="${v}" class="${S.f.champView === v ? 'on' : ''}" aria-label="${v === 'list' ? 'Liste' : 'Grille'}" title="${v === 'list' ? 'Liste' : 'Grille'}">${VIEW_ICON[v]}</button>`).join('')}</div>`,
    shop: '',
    items: chips('itemKind', [['complet', 'Complets'], ['artefact', 'Artefacts'], ['radieux', 'Radieux'], ['embleme', 'Emblèmes'], ['composant', 'Composants'], ['tous', 'Tous']], S.f.itemKind),
    augments: chips('augTier', [['tous', 'Tous'], ['argent', 'Argent'], ['or', 'Or'], ['prismatique', 'Prismatique']], S.f.augTier),
    traits: ''
  }[tab];
  const body = { champions: exploreChampions, traits: exploreTraits, items: exploreItems, augments: exploreAugments, shop: exploreShop }[tab]();
  return `${toolbar(extra)}<div class="card" style="padding:8px 8px 16px">
    <nav class="tabs">${TABS.map(([k, l]) => `<a data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</nav>
    ${body}
  </div>`;
}

/** Champions du set (hors formes alternatives), avec les stats de parties du rang choisi. */
function champRows() {
  const all = Object.values(S.static?.champions || {});
  const stats = new Map((M()?.champions || []).map((c) => [c.id, c]));
  // Les formes (ex. « Lux (Fæ) ») sont regroupées sur le champion de base.
  const merged = new Map();
  for (const c of all) {
    const base = c.variantOf || c.apiName;
    const st = stats.get(c.apiName);
    if (!st) continue;
    const cur = merged.get(base);
    if (!cur) merged.set(base, { ...st, id: base });
    else {
      const n = cur.games + st.games;
      for (const k of ['avg', 'top4', 'win']) cur[k] = (cur[k] * cur.games + st[k] * st.games) / (n || 1);
      cur.pick += st.pick;
      if (st.games > cur.games) cur.items = st.items;
      cur.games = n;
    }
  }
  return all.filter((c) => !c.variantOf).map((c) => ({ id: c.apiName, c, st: merged.get(c.apiName) || null }));
}

function exploreChampions() {
  if (!S.static?.champions) return noData();
  const q = query();
  const rows = champRows()
    .filter((r) => !S.f.cost || r.c.cost === S.f.cost)
    .filter((r) => !S.f.champTrait || r.c.traits.includes(S.f.champTrait))
    .filter((r) => matches(r.c, q) || r.c.traits.some((t) => matches(trait(t), q)));
  if (!rows.length) return '<p class="small" style="padding:8px 16px">Aucun champion ne correspond.</p>';
  const hasStats = rows.some((r) => r.st);
  const traitsCell = (r) => `<div class="icons">${r.c.traits.map((t) => traitIcon(t)).join('')}</div>`;
  if (S.f.champView === 'grid') {
    const list = [...rows].sort((a, b) => a.c.cost - b.c.cost || a.c.name.localeCompare(b.c.name, 'fr'));
    return `<div class="champ-grid">${list.map((r) => `<button class="champ-card" data-champ="${esc(r.id)}">
      ${champIcon(r.id, 'xl')}
      <b>${esc(r.c.name)}</b>
      <span class="small">${r.c.cost} PO${r.st ? ` · top 4 ${pct(r.st.top4)}` : ''}</span>
      ${traitsCell(r)}
    </button>`).join('')}</div>`;
  }
  const st = (r, k, d = -1) => (r.st ? r.st[k] : d);
  return table('champs', [
    { key: 'name', label: 'Champion', value: (r) => r.c.name, render: (r) => `<div class="name-cell">${champIcon(r.id, 'sm')}${esc(label(r.c))}</div>` },
    { key: 'cost', label: 'Coût', num: true, value: (r) => r.c.cost, render: (r) => `${r.c.cost} PO` },
    { key: 'traits', label: 'Synergies', value: (r) => r.c.traits.length, render: traitsCell },
    { key: 'hp', label: 'PV', num: true, expert: true, value: (r) => r.c.stats?.hp ?? 0, render: (r) => int(r.c.stats?.hp) },
    { key: 'ad', label: 'AD', num: true, expert: true, value: (r) => r.c.stats?.ad ?? 0, render: (r) => int(r.c.stats?.ad) },
    { key: 'range', label: 'Portée', num: true, expert: true, value: (r) => r.c.stats?.range ?? 0, render: (r) => int(r.c.stats?.range) },
    { key: 'mana', label: 'Mana', num: true, expert: true, value: (r) => r.c.stats?.mana ?? 0, render: (r) => (r.c.stats ? `${int(r.c.stats.mana0)}/${int(r.c.stats.mana)}` : '—') },
    ...(hasStats ? [
      { key: 'top4', label: 'Top 4', num: true, help: HELP.top4, value: (r) => st(r, 'top4'), render: (r) => (r.st ? pct(r.st.top4) : '—') },
      { key: 'avg', label: 'Place moy.', num: true, help: HELP.avg, expert: true, value: (r) => st(r, 'avg', 9), render: (r) => (r.st ? `<span class="${avgClass(r.st.avg)}">${nf(r.st.avg)}</span>` : '—') },
      { key: 'pick', label: 'Jouée', num: true, help: HELP.pick, value: (r) => st(r, 'pick'), render: (r) => (r.st ? pct(r.st.pick) : '—') },
      { key: 'items', label: 'Objets favoris', value: (r) => r.st?.items?.length || 0, render: (r) => `<div class="icons">${(r.st?.items || []).slice(0, expert() ? 5 : 3).map((i) => itemIcon(i.id)).join('')}</div>` }
    ] : [])
  ], rows, hasStats ? { key: 'top4', dir: -1 } : { key: 'cost', dir: 1 }, (r) => `data-champ="${esc(r.id)}" class="clickable"`);
}

// ===================== Fiche champion =====================
const STAR = [1, 1.8, 3.24]; // PV et dégâts d'attaque à 1★, 2★, 3★
function viewChampion() {
  const back = `<a class="back" data-back="champions">${ICON.back}Champions</a>`;
  const c = S.static?.champions?.[S.champId];
  if (!c) return `${back}<div class="card empty"><p class="lede">Champion introuvable.</p></div>`;
  const row = champRows().find((r) => r.id === c.apiName);
  const s = c.stats || {};
  const forms = Object.values(S.static.champions).filter((x) => x.variantOf === c.apiName);
  const stars = (v) => STAR.map((m) => int(Math.round(v * m))).join(' / ');
  const statTile = (k, v, sub = '') => `<div class="stat"><span class="small">${esc(k)}</span><b>${v}</b>${sub ? `<span class="small">${esc(sub)}</span>` : ''}</div>`;
  const comps = (M()?.comps || []).filter((x) => x.carry === c.apiName || x.units.some((u) => u.id === c.apiName && u.rate >= 35)).slice(0, 6);
  const hasX = /\bX\b/.test(c.ability?.desc || '');
  return `${back}
  <div class="stack" style="margin-top:8px">
    <div class="card">
      <div class="champ-head">
        ${champIcon(c.apiName, 'xxl')}
        <div>
          <div class="badges"><span class="pill grad">${c.cost} PO</span>${c.traits.map((t) => `<span class="pill">${traitIcon(t)}${esc(trait(t).name)}</span>`).join('')}</div>
          <h1 class="h1">${esc(label(c))}</h1>
          ${forms.length ? `<p class="small" style="margin-top:6px">Formes : ${forms.map((f) => esc(f.form)).join(', ')}</p>` : ''}
        </div>
      </div>
    </div>

    ${s.hp ? `<div class="card">
      <h2 class="title">Statistiques</h2>
      <div class="stat-grid">
        ${statTile('PV', stars(s.hp), '1★ / 2★ / 3★')}
        ${statTile("Dégâts d'attaque", stars(s.ad), '1★ / 2★ / 3★')}
        ${statTile("Vitesse d'attaque", nf(s.as, 2))}
        ${statTile('Portée', `${int(s.range)} case${s.range > 1 ? 's' : ''}`)}
        ${statTile('Mana', `${int(s.mana0)} / ${int(s.mana)}`, 'au départ / pour lancer le sort')}
        ${statTile('Armure', int(s.armor))}
        ${statTile('Résistance magique', int(s.mr))}
        ${statTile('Coup critique', pct((s.crit || 0) * 100))}
      </div>
      <p class="small" style="margin-top:10px">PV et dégâts d'attaque × 1,8 à chaque étoile.</p>
    </div>` : ''}

    ${c.ability ? `<div class="card">
      <h2 class="title">Sort · ${esc(c.ability.name)}</h2>
      <p class="prewrap">${esc(c.ability.desc)}</p>
      ${c.ability.values?.length ? `<div class="vals">${c.ability.values.map((v) => `<span class="pill">${esc(v.name.replace(/([a-z])([A-Z])/g, '$1 $2'))} : ${esc(v.v)}</span>`).join('')}</div>` : ''}
      ${hasX ? '<p class="small" style="margin-top:10px">X : valeur calculée par le jeu, absente des données publiques de Riot.</p>' : ''}
    </div>` : ''}

    <div class="card">
      <h2 class="title">Synergies</h2>
      <div class="xgrid">${c.traits.map((t) => `<div><div class="name-cell">${traitIcon(t)}${esc(label(trait(t)))}</div><p class="small prewrap" style="margin-top:8px">${esc(trait(t).desc || '')}</p></div>`).join('')}</div>
    </div>

    ${row?.st ? `<div class="card">
      <h2 class="title">En partie · ${esc(bracketLabel(S.f.bracket))}</h2>
      <div class="stats">
        <div class="card tonal"><div class="gnum">${pct(row.st.top4)}</div><div>finissent dans le top 4</div></div>
        <div class="card tonal"><div class="gnum">${nf(row.st.avg, 1)}</div><div>place moyenne</div></div>
        <div class="card tonal"><div class="gnum">${pct(row.st.pick)}</div><div>des joueurs le prennent</div></div>
        <div class="card tonal"><div class="gnum">${int(row.st.games)}</div><div>fois joué</div></div>
      </div>
      ${row.st.items?.length ? `<p class="label-sm" style="margin-top:16px">Objets favoris</p><div class="rows">${row.st.items.slice(0, 5).map((i) => `<div>${itemIcon(i.id, true)}<span class="grow">${esc(label(item(i.id)))}</span><span class="aside">${pct(i.rate)}</span></div>`).join('')}</div>` : ''}
      ${comps.length ? `<p class="label-sm" style="margin-top:16px">Compos où il joue</p><div class="tags">${comps.map((x) => `<button class="tag" data-guide="${esc(x.id)}"><span class="tier sm ${x.tier}">${x.tier}</span>${esc(compName(x))}</button>`).join('')}</div>` : ''}
    </div>` : ''}
  </div>`;
}

// ===================== Boutique =====================
function exploreShop() {
  const ref = S.static?.reference;
  if (!ref || ref.stale) {
    return `<div class="notice" style="margin:0 8px"><strong>Chances du set ${esc(S.static?.setNumber ?? '')} pas encore disponibles.</strong> Elles arriveront automatiquement dès qu’elles seront publiées dans HexaRise, sans mise à jour à installer.</div>`;
  }
  const levels = Object.keys(ref.odds).map(Number).sort((a, b) => a - b).filter((l) => l >= 2);
  const counts = S.static.shopCounts || [];
  const cell = (v) => `<td class="n heat" style="--h:${(v / 100).toFixed(2)}">${v ? `${v} %` : '—'}</td>`;
  return `<div style="padding:0 8px">
    <p class="lede" style="margin:0 0 16px">À chaque niveau, chaque case de la boutique a ces chances de proposer un champion de chaque coût.</p>
    <div class="table-wrap"><table class="odds">
      <thead><tr><th>Niveau</th>${[1, 2, 3, 4, 5].map((c) => `<th class="num-h"><span class="cost-dot cost-${c}"></span>${c} PO</th>`).join('')}</tr></thead>
      <tbody>${levels.map((l) => `<tr><td>Niv. ${l}</td>${ref.odds[l].map(cell).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <h2 class="title" style="margin-top:24px">Exemplaires dans le jeu</h2>
    <div class="table-wrap"><table class="odds">
      <thead><tr><th>Coût</th><th class="num-h">Exemplaires de chaque champion</th><th class="num-h">Champions</th><th class="num-h">Total</th></tr></thead>
      <tbody>${ref.copies.map((n, i) => `<tr><td><span class="cost-dot cost-${i + 1}"></span>${i + 1} PO</td><td class="n">${n}</td><td class="n">${counts[i] ?? '—'}</td><td class="n">${counts[i] ? int(n * counts[i]) : '—'}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="small" style="margin-top:12px">Les exemplaires sont partagés entre les 8 joueurs : si d’autres jouent le même champion, il en reste moins pour toi. Set ${ref.set} · vérifié le ${new Date(ref.updated).toLocaleDateString('fr-FR')} · sources : ${esc(ref.sources.join(', '))}.</p>
  </div>`;
}

function exploreTraits() {
  const m = M();
  if (!m?.traits?.length) return noData();
  const q = query();
  const rows = m.traits.filter((t) => S.static?.traits?.[t.id] && matches(trait(t.id), q));
  return table('traits', [
    { key: 'name', label: 'Synergie', value: (r) => trait(r.id).name, render: (r) => `<div class="name-cell">${traitIcon(r.id)}${esc(label(trait(r.id)))}</div>` },
    { key: 'top4', label: 'Top 4', num: true, help: HELP.top4, render: (r) => pct(r.top4) },
    { key: 'avg', label: 'Place moy.', num: true, help: HELP.avg, expert: true, render: (r) => `<span class="${avgClass(r.avg)}">${nf(r.avg)}</span>` },
    { key: 'pick', label: 'Jouée', num: true, help: HELP.pick, render: (r) => pct(r.pick) },
    { key: 'levels', label: 'Paliers (unités · place moy.)', expert: true, value: (r) => r.levels.length, render: (r) => `<div class="icons">${r.levels.slice(0, 5).map((l) => `<span class="pill">${l.num} · ${nf(l.avg)}</span>`).join('')}</div>` }
  ], rows, { key: 'pick', dir: -1 });
}

function exploreItems() {
  const m = M();
  if (!m?.items?.length) return noData();
  const q = query();
  const rows = m.items.filter((i) => (S.f.itemKind === 'tous' || (S.static?.items?.[i.id]?.kind || 'complet') === S.f.itemKind) && matches(item(i.id), q));
  return table('items', [
    { key: 'name', label: 'Objet', value: (r) => item(r.id).name, render: (r) => `<div class="name-cell">${itemIcon(r.id, true)}<div>${esc(label(item(r.id)))}${recipeText(r.id) ? `<div class="small">${esc(recipeText(r.id))}</div>` : ''}</div></div>` },
    { key: 'top4', label: 'Top 4', num: true, help: HELP.top4, render: (r) => pct(r.top4) },
    { key: 'avg', label: 'Place moy.', num: true, help: HELP.avg, expert: true, render: (r) => `<span class="${avgClass(r.avg)}">${nf(r.avg)}</span>` },
    { key: 'games', label: 'Utilisations', num: true, expert: true, render: (r) => int(r.games) },
    { key: 'holders', label: 'Meilleurs porteurs', value: (r) => r.holders.length, render: (r) => `<div class="icons">${r.holders.slice(0, expert() ? 5 : 3).map((h) => champIcon(h.id, 'sm')).join('')}</div>` }
  ], rows, { key: 'games', dir: -1 });
}

const TIER_LABEL = { argent: 'Argent', or: 'Or', prismatique: 'Prismatique', inconnu: '—' };
function exploreAugments() {
  const m = M();
  const q = query();
  const keep = (id) => (S.f.augTier === 'tous' || aug(id).tier === S.f.augTier) && matches(aug(id), q);
  if (m?.hasAugments) {
    const rows = m.augments.filter((a) => keep(a.id));
    return table('augs', [
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
  return `<div class="notice" style="margin:0 8px 12px"><strong>Statistiques d’augments indisponibles.</strong> Riot ne fournit pas les augments choisis pour ce set : voici le catalogue à jour.</div>
    <div class="grid" style="padding:0 8px">${list.map((a) => `<div class="card tonal"><div class="name-cell">${augIcon(a.apiName)}<div><h3>${esc(label(a))}</h3><span class="small">${TIER_LABEL[a.tier]}</span></div></div><p>${esc(a.desc)}</p></div>`).join('') || '<p class="small">Aucun augment.</p>'}</div>`;
}

// ===================== Avis des experts (fiche et guide) =====================
const TIER_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4 };
const TREND = { hausse: '↗ en hausse', baisse: '↘ en baisse', nouveau: '✦ nouveau' };

function expertPills(c) {
  const list = expertsFor(c.carry);
  if (!list.length) return '';
  return `<section>
    <h2 class="title">Avis des experts</h2>
    <div class="tags">${list.map((e) => `<button class="tag" data-expert="${esc(e.id)}">${esc(e.name)}${e.bm ? ` · <span class="src bm">BunnyMuffins</span> <span class="tier sm ${e.bm.tier}">${e.bm.tier}</span>` : ''}${e.ta ? ` · <span class="src ta">TFT Academy</span> <span class="tier sm ${e.ta.tier}">${e.ta.tier}</span>` : ''}</button>`).join('')}</div>
  </section>`;
}

function expertTipsCard(c) {
  const list = expertsFor(c.carry);
  if (!list.length) return '';
  const e = list[0];
  const tips = [...(e.bm?.tips || []).map((t) => ['bm', t]), ...(e.ta?.tips || []).map((t) => ['ta', t])];
  if (!tips.length) return '';
  return `<div class="card">
    <div class="fiche-head"><div><h2 class="title" style="margin:0">Conseils des experts · ${esc(e.name)}</h2>
      <p class="small" style="margin:6px 0 0">Résumés HexaRise des guides BunnyMuffins (prioritaires) et TFT Academy.</p></div>
      <button class="btn text" data-expert="${esc(e.id)}">Fiche complète ${ICON.chevron}</button></div>
    <ul class="tips">${tips.map(([src, t]) => `<li><span class="src ${src}">${src === 'bm' ? 'BunnyMuffins' : 'TFT Academy'}</span> ${gloss(t)}</li>`).join('')}</ul>
  </div>`;
}

// ===================== Sélection de ligne =====================
// Choisis tes objets, emblèmes et augments : HexaRise propose les compos (« lignes ») qui en profitent le plus
// dans ton rang, classées Cœur / Bon / Correct. Calcul sur les parties Riot analysées par l'app.
const LEVELS = [['coeur', 'Cœur', 'La compo s’appuie dessus et réussit avec'], ['bon', 'Bon', 'Réussit bien avec'], ['correct', 'Correct', 'Jouable, sans plus']];
const LEVEL_NAME = Object.fromEntries(LEVELS.map(([k, l]) => [k, l]));
const LEVEL_W = { coeur: 3, bon: 2, correct: 1 };
const LINE_CATS = [['crafted', 'Objets fabriqués'], ['special', 'Objets spéciaux'], ['augments', 'Augments']];
const ROLE_GROUPS = [['tank', 'Tank'], ['ad', 'Dégâts d’attaque'], ['ap', 'Puissance'], ['hybride', 'Hybride'], ['mana', 'Mana'], ['omnivamp', 'Soins et omnivampirisme'], ['utilitaire', 'Utilitaire']];
const SPECIAL_GROUPS = [['embleme', 'Emblèmes'], ['artefact', 'Artefacts'], ['radieux', 'Radieux'], ['special', 'Autres objets spéciaux']];
const AUG_GROUPS = [['eco', 'Économie'], ['objets', 'Objets'], ['synergie', 'Synergie'], ['autres', 'Autres']];
const AUG_TIER = { argent: 'Argent', or: 'Or', prismatique: 'Prismatique' };

S.lineSel = (() => {
  try {
    const v = JSON.parse(stored('lineSel', '{}'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
})();
S.f.lineCat = stored('lineCat', 'crafted');
S.f.lineLevel = 'all';
S.f.lineTier = 'tous';
const saveLineSel = () => remember('lineSel', JSON.stringify(S.lineSel));

/**
 * Rôle d'un objet complet d'après sa recette (les objets récents donnent souvent DA et puissance à la fois,
 * les statistiques ne suffisent donc pas à les ranger).
 */
const COMP_ROLE = {
  TFT_Item_BFSword: 'ad', TFT_Item_RecurveBow: 'ad', TFT_Item_SparringGloves: 'gants', TFT_Item_NeedlesslyLargeRod: 'ap',
  TFT_Item_TearOfTheGoddess: 'mana', TFT_Item_ChainVest: 'tank', TFT_Item_NegatronCloak: 'tank', TFT_Item_GiantsBelt: 'tank'
};
function itemRole(it) {
  if (/omnivampirisme/i.test(it.stats || '')) return 'omnivamp';
  const r = (it.composition || []).map((c) => COMP_ROLE[c] || 'autre');
  const n = (k) => r.filter((x) => x === k).length;
  if (n('tank') === 2) return 'tank';
  if (n('mana')) return n('tank') ? 'tank' : 'mana';
  if (n('tank')) return n('gants') ? 'utilitaire' : n('ap') ? 'ap' : 'ad';
  if (n('ap') === 2) return 'ap';
  if (n('ap')) return 'hybride';
  if (n('ad') || n('gants')) return 'ad';
  return 'utilitaire';
}

let TRAITIDX = null;
/** Synergie liée à un augment ou un emblème (nom technique, puis nom français dans le texte). */
function linkedTrait(x) {
  if (!x) return null;
  if (!TRAITIDX || TRAITIDX.sd !== S.static) {
    const list = Object.values(S.static?.traits || {})
      .map((t) => ({ id: t.apiName, key: String(t.apiName).replace(/^TFT\d*_(Set\d+_)?/i, '').toLowerCase(), name: String(t.name || '').toLowerCase() }))
      .filter((t) => t.key.length >= 4 || t.name.length >= 4)
      .sort((a, b) => b.name.length - a.name.length);
    TRAITIDX = { sd: S.static, list, cache: new Map() };
  }
  if (TRAITIDX.cache.has(x.apiName)) return TRAITIDX.cache.get(x.apiName);
  const api = String(x.apiName || '').toLowerCase();
  const text = `${x.name || ''} ${x.desc || ''}`.toLowerCase();
  let hit = TRAITIDX.list.find((t) => t.key.length >= 4 && api.includes(t.key));
  if (!hit) {
    hit = TRAITIDX.list.find((t) => t.name.length >= 4 && new RegExp(`(^|[^\\p{L}])${t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(text));
  }
  const id = hit ? hit.id : null;
  TRAITIDX.cache.set(x.apiName, id);
  return id;
}

/** Catégorie d'un augment : économie, objets, synergie ou autres (d'après son effet principal, la 1re phrase). */
const AUG_ITEMS = /objet|composant|artefact|spatule|poêle|enclume|radieu|emblème|forge|suppresseur|duplicateur/i;
const AUG_ECO = /\bPO\b|\bor\b|intérêt|expérience|\bXP\b|niveau|relance|boutique|butin/i;
function augCategory(a) {
  if (linkedTrait(a)) return 'synergie';
  const desc = String(a.desc || '');
  const first = desc.split(/(?<=[.!])\s/)[0];
  if (AUG_ITEMS.test(first)) return 'objets';
  if (AUG_ECO.test(first)) return 'eco';
  if (AUG_ITEMS.test(desc)) return 'objets';
  if (AUG_ECO.test(`${a.name} ${desc}`)) return 'eco';
  return 'autres';
}

const augStat = (id) => M()?.augments?.find((x) => x.id === id) || null;
const itemStat = (id) => M()?.items?.find((x) => x.id === id) || null;

function levelFromTier(tier) {
  return ['S', 'A', 'B'].includes(tier) ? 'bon' : tier === 'C' ? 'correct' : null;
}
const withComp = (rows) => rows.map((r) => ({ ...r, c: findComp(r.comp) })).filter((r) => r.c);

/** Lignes déduites d'une synergie (augments sans statistiques Riot, emblèmes peu joués). */
function traitLines(traitId) {
  const comps = M()?.comps || [];
  return comps
    .map((c) => {
      const rate = c.traits.find((t) => t.id === traitId)?.rate || 0;
      let level = null;
      if (c.main === traitId) level = ['S', 'A', 'B'].includes(c.tier) ? 'coeur' : 'bon';
      else if (rate >= 60) level = 'bon';
      else if (rate >= 25) level = 'correct';
      return level && c.tier !== 'D' ? { comp: c.id, c, level, tier: c.tier, top4: c.top4, games: c.games, use: rate } : null;
    })
    .filter(Boolean)
    .sort((a, b) => LEVEL_W[b.level] - LEVEL_W[a.level] || a.c.score - b.c.score)
    .slice(0, 12);
}

/**
 * Lignes d'un élément sélectionné.
 * basis : stats (parties analysées), synergie (déduit de la synergie liée), general (aucune compo précise).
 */
function linesFor(id) {
  const m = M();
  const cond = m?.conditions || { items: {}, augments: {} };
  const fromCond = (v) => withComp(v.lines || v.comps.map((r) => ({ ...r, level: levelFromTier(r.tier) })).filter((r) => r.level));
  if (S.static?.augments?.[id]) {
    const a = aug(id);
    const cat = augCategory(a);
    const st = cond.augments?.[id];
    if (m?.hasAugments && st) return { rows: fromCond(st), basis: 'stats', cat };
    const t = linkedTrait(a);
    if (t) return { rows: traitLines(t), basis: 'synergie', trait: t, cat };
    return { rows: [], basis: 'general', cat };
  }
  if (BASE_COMPONENTS.includes(id)) {
    const recipes = Object.values(S.static?.items || {}).filter((it) => !it.outOfSet && ['complet', 'embleme'].includes(it.kind) && it.composition?.includes(id));
    const agg = new Map();
    for (const it of recipes) {
      const v = cond.items?.[it.apiName];
      for (const r of v ? v.lines || v.comps : []) {
        const x = agg.get(r.comp) || { n: 0, sum: 0, top4: 0, use: 0 };
        x.n += r.games;
        x.sum += r.avg * r.games;
        x.top4 += r.top4 * r.games;
        x.use += r.use || 0;
        agg.set(r.comp, x);
      }
    }
    const rows = [...agg.entries()]
      .filter(([, x]) => x.n >= 5)
      .map(([comp, x]) => {
        const score = (x.sum + 4.5 * 8) / (x.n + 8);
        const use = Math.min(100, x.use);
        const level = use >= 25 && score <= 4.45 ? 'coeur' : score <= 4.45 || (use >= 25 && score <= 4.7) ? 'bon' : score <= 4.7 ? 'correct' : null;
        return { comp, games: x.n, top4: round1(x.top4 / x.n), use: round1(use), score, level, tier: score <= 3.95 ? 'S' : score <= 4.2 ? 'A' : score <= 4.45 ? 'B' : 'C' };
      })
      .filter((r) => r.level)
      .sort((a, b) => LEVEL_W[b.level] - LEVEL_W[a.level] || a.score - b.score)
      .slice(0, 12);
    return { rows: withComp(rows), basis: 'stats', recipes: recipes.map((it) => it.apiName) };
  }
  const v = cond.items?.[id];
  const rows = v ? fromCond(v) : [];
  if (!rows.length && item(id).kind === 'embleme') {
    const t = linkedTrait(item(id));
    if (t) return { rows: traitLines(t), basis: 'synergie', trait: t };
  }
  return { rows, basis: 'stats' };
}

/** Classement cumulé : chaque élément vaut 3 (Cœur), 2 (Bon) ou 1 (Correct) point par exemplaire. */
function combinedLines(sel) {
  const by = new Map();
  for (const [id, n] of sel) {
    for (const r of linesFor(id).rows) {
      const x = by.get(r.comp) || { c: r.c, pts: 0, from: [] };
      x.pts += LEVEL_W[r.level] * n;
      x.from.push({ id, level: r.level });
      by.set(r.comp, x);
    }
  }
  return [...by.values()].sort((a, b) => b.pts - a.pts || a.c.score - b.c.score).slice(0, 6);
}

const selIcon = (id) => (S.static?.augments?.[id] ? augIcon(id) : itemIcon(id, true));
const selName = (id) => (S.static?.augments?.[id] ? aug(id).name : item(id).name);

/** Catalogue de la catégorie affichée, rangé en groupes. */
function lineCatalog() {
  const q = query();
  const cat = LINE_CATS.some(([k]) => k === S.f.lineCat) ? S.f.lineCat : 'crafted';
  const items = Object.values(S.static?.items || {}).filter((it) => !it.outOfSet && matches(it, q));
  const byName = (a, b) => a.name.localeCompare(b.name, 'fr');
  if (cat === 'crafted') {
    const comps = BASE_COMPONENTS.filter((id) => S.static?.items?.[id] && matches(item(id), q)).map((id) => item(id));
    const full = items.filter((it) => it.kind === 'complet' && it.composition?.length === 2).sort(byName);
    return [['composant', 'Composants', comps], ...ROLE_GROUPS.map(([k, l]) => [k, l, full.filter((it) => itemRole(it) === k)])];
  }
  if (cat === 'special') {
    return SPECIAL_GROUPS.map(([k, l]) => [k, l, items.filter((it) => it.kind === k).sort(byName)]);
  }
  const tier = S.f.lineTier;
  const augs = Object.values(S.static?.augments || {}).filter((a) => (tier === 'tous' || a.tier === tier) && matches(a, q)).sort(byName);
  return AUG_GROUPS.map(([k, l]) => [k, l, augs.filter((a) => augCategory(a) === k)]);
}

function lineTile(x) {
  const id = x.apiName;
  const n = S.lineSel[id] || 0;
  const isAug = Boolean(S.static?.augments?.[id]);
  return `<div class="ln-tile ${n ? 'on' : ''}">
    <button class="ln-pick" data-line-add="${esc(id)}" aria-label="Ajouter ${esc(x.name)}">${isAug ? augIcon(id) : itemIcon(id, true)}${n ? `<span class="ln-badge">${n}</span>` : ''}</button>
    <span class="ln-name">${esc(x.name)}</span>
    ${n ? `<span class="ln-count"><button data-line-dec="${esc(id)}" aria-label="Retirer un ${esc(x.name)}">−</button><b>${n}</b><button data-line-add="${esc(id)}" aria-label="Ajouter un ${esc(x.name)}">+</button></span>` : ''}
  </div>`;
}

const lineChip = (r) => `<button class="tag ln-comp" data-guide="${esc(r.c.id)}"><span class="tier sm ${r.tier || r.c.tier}">${r.tier || r.c.tier}</span>${esc(compTitle(r.c))} · ${esc(champ(r.c.carry).name)}${r.top4 !== undefined ? `<span class="small">${pct(r.top4)} top 4</span>` : ''}</button>`;

function lineBlock(id, n) {
  const res = linesFor(id);
  const lvl = S.f.lineLevel;
  const rows = res.rows.filter((r) => lvl === 'all' || r.level === lvl);
  const basis = {
    stats: '',
    synergie: res.trait ? `Déduit de la synergie ${label(trait(res.trait))} : Riot ne fournit pas assez de données pour cet élément.` : '',
    general: ''
  }[res.basis];
  let body;
  if (res.basis === 'general') {
    const lvlComps = (M()?.comps || []).filter((c) => compType(c, champ(c.carry).cost || 4).id !== 'reroll' && c.tier !== 'D').slice(0, 4);
    const hint = {
      eco: 'Augment d’économie : il ne mène pas à une compo précise. Il aide surtout les lignes qui montent de niveau (niveau 8, fast 9).',
      objets: 'Augment d’objets : il ne mène pas à une compo précise. Garde la ligne que tes objets indiquent déjà.',
      autres: 'Effet général : compatible avec toutes les lignes.'
    }[res.cat] || 'Compatible avec toutes les lignes.';
    body = `<p class="small" style="margin:0">${hint}</p>${res.cat === 'eco' && lvlComps.length ? `<p class="label-sm" style="margin:10px 0 6px">Lignes qui montent de niveau</p><div class="tags">${lvlComps.map((c) => lineChip({ c, tier: c.tier, top4: c.top4 })).join('')}</div>` : ''}`;
  } else if (!res.rows.length) {
    body = '<p class="small" style="margin:0">Pas assez de parties dans ce rang pour classer les compos avec cet élément.</p>';
  } else {
    body = LEVELS.filter(([k]) => lvl === 'all' || k === lvl)
      .map(([k, l]) => {
        const list = rows.filter((r) => r.level === k);
        return `<div class="ln-level ${k}"><span class="ln-lvl" data-tip="help" data-title="${l}" data-desc="${esc(LEVELS.find((x) => x[0] === k)[2])}.">${l}</span><div class="tags">${list.map(lineChip).join('') || '<span class="small">—</span>'}</div></div>`;
      })
      .join('');
  }
  return `<article class="ln-block">
    <div class="ln-head">${selIcon(id)}<div class="grow"><strong>${esc(label(S.static?.augments?.[id] ? aug(id) : item(id)))}</strong>${n > 1 ? ` <span class="pill">×${n}</span>` : ''}
      ${basis ? `<div class="small">${esc(basis)}</div>` : ''}</div>
      <button class="icon-btn" data-line-remove="${esc(id)}" aria-label="Retirer de la sélection">✕</button></div>
    ${body}
  </article>`;
}

function viewLine() {
  if (!S.static) return '<div class="card empty"><p class="lede">Chargement des données du set…</p></div>';
  const cat = LINE_CATS.some(([k]) => k === S.f.lineCat) ? S.f.lineCat : 'crafted';
  const sel = Object.entries(S.lineSel).filter(([id, n]) => n > 0 && (S.static.items?.[id] || S.static.augments?.[id]));
  const m = M();
  const extra = `${chips('lineLevel', [['all', 'Tous les niveaux'], ...LEVELS.map(([k, l]) => [k, l])], S.f.lineLevel)}`;
  const groups = lineCatalog()
    .filter(([, , list]) => list.length)
    .map(([k, l, list]) => `<section class="ln-group"><h3 class="label-sm">${esc(l)} <span class="small">${list.length}</span></h3><div class="ln-grid">${list.map(lineTile).join('')}</div></section>`)
    .join('');
  const combined = sel.length ? combinedLines(sel).filter((x) => S.f.lineLevel === 'all' || x.from.some((f) => f.level === S.f.lineLevel)) : [];
  const augNote = cat === 'augments' && m && !m.hasAugments
    ? '<div class="notice" style="margin-bottom:12px">Riot ne fournit pas les augments choisis pour ce set : les augments de synergie sont reliés aux compos par leur synergie, les autres ne mènent pas à une compo précise.</div>'
    : '';
  return `${toolbar(extra)}
  <div class="ln-layout">
    <div class="card" style="padding:8px 8px 16px">
      <nav class="tabs">${LINE_CATS.map(([k, l]) => `<a data-line-cat="${k}" class="${k === cat ? 'on' : ''}">${l}</a>`).join('')}</nav>
      <div class="learn-body">
        ${cat === 'augments' ? `<div class="toolbar" style="padding:0 0 12px">${chips('lineTier', [['tous', 'Tous'], ['argent', 'Argent'], ['or', 'Or'], ['prismatique', 'Prismatique']], S.f.lineTier)}</div>` : ''}
        ${augNote}
        <p class="small" style="margin:0 0 12px">Clique sur un élément pour l’ajouter (plusieurs fois si tu en as plusieurs). Survole-le pour voir toutes ses infos.</p>
        ${groups || '<p class="small">Aucun élément ne correspond à ta recherche.</p>'}
      </div>
    </div>
    <div class="ln-side">
      <div class="card">
        <div class="fiche-head" style="margin-bottom:10px"><h2 class="title" style="margin:0">Ta sélection</h2>${sel.length ? '<button class="btn text sm" data-line-clear="1">Tout effacer</button>' : ''}</div>
        ${sel.length
          ? `<div class="ln-sel">${sel.map(([id, n]) => `<span class="tag ln-chip">${selIcon(id)}${esc(selName(id))}${n > 1 ? ` ×${n}` : ''}<button data-line-dec="${esc(id)}" aria-label="Retirer">✕</button></span>`).join('')}</div>`
          : '<p class="small" style="margin:0">Rien de sélectionné. Ajoute tes composants, objets, emblèmes ou augments à gauche.</p>'}
        ${!m ? noData() : ''}
      </div>
      ${combined.length ? `<div class="card">
        <h2 class="title" style="margin:0 0 4px">Meilleures lignes pour ta sélection</h2>
        <p class="small" style="margin:0 0 12px">Cumul sur tout ce que tu as choisi (Cœur 3 points, Bon 2, Correct 1, par exemplaire). ${esc(bracketLabel(S.f.bracket))}.</p>
        <div class="ln-best">${combined.map((x, i) => `<button class="ln-best-row" data-guide="${esc(x.c.id)}">
          <span class="ln-rank">${i + 1}</span><span class="tier sm ${x.c.tier}">${x.c.tier}</span>
          <span class="grow"><strong>${esc(compTitle(x.c))}</strong> · ${esc(champ(x.c.carry).name)}<span class="small"> · ${pct(x.c.top4)} top 4</span></span>
          <span class="icons">${x.from.slice(0, 6).map((f) => `<span class="ln-from ${f.level}">${selIcon(f.id)}</span>`).join('')}</span>
          <span class="ln-pts">${x.pts} pts</span>${ICON.chevron}</button>`).join('')}</div>
      </div>` : ''}
      ${sel.length && m ? `<div class="card"><h2 class="title" style="margin:0 0 12px">Détail par élément</h2><div class="stack">${sel.map(([id, n]) => lineBlock(id, n)).join('')}</div></div>` : ''}
      <p class="small" style="margin:4px 8px">Référence à consulter <strong>avant</strong> la partie : cette page n’existe pas dans le mode partie (règles Riot). Inspiré de l’outil Line Selection de tftflow.com ; les classements sont calculés par HexaRise sur ${m ? int(m.boards) : 0} parties de ton rang.</p>
    </div>
  </div>`;
}

// ---------- Infobulles enrichies (augments et objets) ----------
function richTip(kind, id) {
  const m = M();
  const bestOf = (res) => res.rows.slice(0, 3).map((r) => `<div class="tt-line"><span class="tier sm ${r.tier || r.c.tier}">${r.tier || r.c.tier}</span>${esc(compTitle(r.c))} · ${esc(champ(r.c.carry).name)}<span class="tt-lvl ${r.level}">${LEVEL_NAME[r.level]}</span></div>`).join('');
  if (kind === 'aug') {
    const a = aug(id);
    const st = augStat(id);
    const res = linesFor(id);
    const t = linkedTrait(a);
    const cat = AUG_GROUPS.find(([k]) => k === res.cat)?.[1] || '';
    const stages = st?.stages?.some((v) => v !== null)
      ? `<div class="tt-row">${['2-1', '3-2', '4-2'].map((s, i) => `<span>${s} <b>${st.stages[i] === null || st.stages[i] === undefined ? '—' : nf(st.stages[i])}</b></span>`).join('')}</div>`
      : '';
    return `<div class="t">${esc(a.name)}${AUG_TIER[a.tier] ? ` <span class="tt-tier ${a.tier}">${AUG_TIER[a.tier]}</span>` : ''}</div>
      ${a.en && a.en !== a.name ? `<div class="tt-en">${esc(a.en)}</div>` : ''}
      ${a.desc ? `<div class="d">${esc(a.desc).slice(0, 900)}</div>` : ''}
      <div class="tt-sub">${esc(cat)}${t ? ` · ${traitIcon(t)} ${esc(trait(t).name)}` : ''}</div>
      ${st ? `<div class="tt-row"><span>Place moy. <b>${nf(st.avg)}</b></span><span>Top 4 <b>${pct(st.top4)}</b></span><span>Choisi <b>${pct(st.pick, 1)}</b></span></div>${stages ? `<div class="tt-sub">Place moyenne selon l’étape où il est pris</div>${stages}` : ''}` : (m && !m.hasAugments ? '<div class="tt-sub">Statistiques indisponibles : Riot ne fournit pas les augments de ce set.</div>' : '')}
      ${res.rows.length ? `<div class="tt-sub">Meilleures lignes${res.basis === 'synergie' ? ' (par la synergie)' : ''}</div>${bestOf(res)}` : ''}`;
  }
  const it = item(id);
  const st = itemStat(id);
  const res = m ? linesFor(id) : { rows: [] };
  return `<div class="t">${esc(it.name)}</div>
    ${it.en && it.en !== it.name ? `<div class="tt-en">${esc(it.en)}</div>` : ''}
    ${recipeText(id) ? `<div class="tt-sub">Recette : ${esc(recipeText(id))}</div>` : ''}
    ${it.stats ? `<div class="tt-sub">${esc(it.stats)}</div>` : ''}
    ${it.desc ? `<div class="d">${esc(it.desc).slice(0, 700)}</div>` : ''}
    ${!it.desc && it.kind === 'embleme' && linkedTrait(it) ? `<div class="d">Le porteur gagne la synergie ${esc(trait(linkedTrait(it)).name)}.</div><div class="tt-sub">${traitIcon(linkedTrait(it))} ${esc(trait(linkedTrait(it)).name)}</div><div class="d">${esc(trait(linkedTrait(it)).desc || '').slice(0, 500)}</div>` : ''}
    ${st && st.games ? `<div class="tt-row"><span>Place moy. <b>${nf(st.avg)}</b></span><span>Top 4 <b>${pct(st.top4)}</b></span><span>Vu <b>${int(st.games)}</b> fois</span></div>` : ''}
    ${res.rows.length ? `<div class="tt-sub">Meilleures lignes</div>${bestOf(res)}` : ''}`;
}

// ===================== Apprendre =====================
const LEARN_TABS = [['guides', 'Guides'], ['experts', 'Avis des experts'], ['openers', 'Ouvertures'], ['conditions', 'Conditions'], ['components', 'Par composant'], ['glossary', 'Glossaire']];
const LEVEL = { debutant: 'Débutant', intermediaire: 'Intermédiaire', avance: 'Avancé' };
const SRC = { bunnymuffins: ['bm', 'BunnyMuffins'], tftacademy: ['ta', 'TFT Academy'] };
const ext = (url, text) => `<a class="btn tonal sm" href="${esc(url)}" target="_blank" rel="noopener">${esc(text)} ↗</a>`;

function viewLearn() {
  const tab = LEARN_TABS.some(([k]) => k === S.f.learnTab) ? S.f.learnTab : 'guides';
  const extra = {
    guides: chips('learnLevel', [['tous', 'Tous'], ['debutant', 'Débutant'], ['intermediaire', 'Intermédiaire'], ['avance', 'Avancé']], S.f.learnLevel),
    experts: chips('expertSrc', [['all', 'Toutes'], ['both', 'Dans les deux'], ['bm', 'BunnyMuffins'], ['ta', 'TFT Academy']], S.f.expertSrc),
    conditions: chips('condKind', [['complet', 'Objets'], ['artefact', 'Artefacts'], ['radieux', 'Radieux'], ['embleme', 'Emblèmes'], ['augment', 'Augments']], S.f.condKind)
  }[tab] || '';
  const withRank = ['openers', 'conditions', 'components'].includes(tab);
  const body = { guides: learnGuides, experts: learnExperts, openers: learnOpeners, conditions: learnConditions, components: learnComponents, glossary: learnGlossary }[tab]();
  return `${withRank ? toolbar(extra) : `<div class="toolbar">${extra}</div>`}<div class="card" style="padding:8px 8px 16px">
    <nav class="tabs">${LEARN_TABS.map(([k, l]) => `<a data-learn-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</nav>
    <div class="learn-body">${body}</div>
  </div>`;
}

function learnGuides() {
  const g = S.content?.guides;
  if (!g) return '<p class="small">Chargement des guides…</p>';
  const lv = S.f.learnLevel;
  const keep = (x) => lv === 'tous' || x.level === lv;
  const upd = new Map(watchChanges().filter((c) => c.kind === 'updated').map((c) => [c.id, c]));
  const news = watchChanges().filter((c) => c.kind === 'new' && c.source === 'bunnymuffins');
  const dates = (x) => [x.published && `publié le ${frDate(x.published)}`, x.modified && x.modified !== x.published && `mis à jour le ${frDate(x.modified)}`].filter(Boolean).join(' · ');
  const RELATED = { 'explore:items': 'Objets dans HexaRise', 'explore:shop': 'Chances en boutique', 'learn:openers': 'Ouvertures dans HexaRise' };
  const card = (x) => {
    const [cls, src] = SRC[x.source] || ['', x.source];
    const u = upd.get(x.id);
    return `<article class="card tonal gcard">
      <div class="badges"><span class="pill src-pill ${cls}">${esc(src)}</span><span class="pill">${LEVEL[x.level] || ''}</span><span class="pill">${esc(x.topic)}</span>${u ? '<span class="pill warn">Mis à jour par l’auteur</span>' : ''}</div>
      <h3>${esc(x.title)}</h3>
      <p class="small">Titre original : ${esc(x.titleEn)}${dates(x) ? ` · ${dates(x)}` : ''}</p>
      ${x.note ? `<p class="small note">${esc(x.note)}</p>` : ''}
      ${u ? `<p class="small warn-text">L’auteur a modifié ce guide le ${frDate(u.date)} : la fiche est en cours de révision, lis l’original pour la dernière version.</p>` : ''}
      <ul class="sum">${x.summary.map((t) => `<li>${gloss(t)}</li>`).join('')}</ul>
      <div class="row">${ext(x.url, 'Lire l’original')}${x.related ? `<button class="btn text sm" data-related="${esc(x.related)}">${esc(RELATED[x.related] || 'Voir dans HexaRise')}</button>` : ''}</div>
    </article>`;
  };
  const guides = g.guides.filter(keep);
  const videos = g.videos.filter(keep);
  return `${news.length ? `<div class="notice" style="margin-bottom:14px"><strong>Nouveaux guides publiés</strong><div class="rows" style="margin-top:8px">${news.map((n) => `<div><span class="grow">${esc(n.title)} <span class="small">· BunnyMuffins · ${frDate(n.date)}</span></span>${ext(n.url, 'Lire')}</div>`).join('')}</div><p class="small" style="margin-top:6px">Leur fiche en français arrive à la prochaine révision.</p></div>` : ''}
    <p class="small" style="margin:0 0 14px">${esc(g.note)}</p>
    <div class="guide-grid">${guides.map(card).join('') || '<p class="small">Aucun guide pour ce niveau.</p>'}</div>
    ${videos.length ? `<h2 class="title" style="margin-top:24px">Vidéos de BunnyMuffins (en anglais)</h2>
      <p class="small" style="margin:-6px 0 10px">Dans YouTube : Paramètres ⚙ › Sous-titres › Traduire automatiquement › Français.</p>
      <div class="rows">${videos.map((v) => `<div><span class="play-dot">▶</span><span class="grow">${esc(v.title)}<span class="small"> · ${esc(v.titleEn)}</span></span><span class="pill">${LEVEL[v.level] || ''}</span>${ext(v.url, 'Voir')}</div>`).join('')}</div>` : ''}`;
}

function learnExperts() {
  const g = S.content?.guides;
  if (!g) return '<p class="small">Chargement…</p>';
  const src = S.f.expertSrc;
  const list = g.comps
    .filter((e) => src === 'all' || (src === 'both' ? e.bm && e.ta : src === 'bm' ? e.bm : e.ta))
    .filter((e) => {
      const q = query();
      return !q || e.name.toLowerCase().includes(q) || e.units.some((u) => u.toLowerCase().includes(q) || matches(champ(champByName(u) || ''), q));
    })
    .sort((a, b) => {
      const r = (e) => (e.bm ? TIER_RANK[e.bm.tier] ?? 5 : 9) * 10 + (e.ta ? (TIER_RANK[e.ta.tier] ?? 5) + (e.ta.situational ? 0.5 : 0) : 9);
      return r(a) - r(b);
    });
  const tl = watchChanges().filter((c) => c.kind === 'tierlist');
  const fresh = watchChanges().filter((c) => c.kind === 'new' && c.source === 'tftacademy');
  const unitIcons = (names) => names.map((n) => (champByName(n) ? champIcon(champByName(n), 'sm') : `<span class="tag">${esc(n)}</span>`)).join('');
  const itemIcons = (names) => names.map((n) => (itemByName(n) ? itemIcon(itemByName(n)) : `<span class="tag">${esc(n)}</span>`)).join('');
  const block = (e, k) => {
    const x = e[k];
    if (!x) return '';
    const name = k === 'bm' ? 'BunnyMuffins' : 'TFT Academy';
    const tier = x.situational ? `Situationnelle · ${x.tier}` : `Tier ${x.tier}`;
    return `<div class="xsrc ${k}">
      <div class="badges"><span class="pill src-pill ${k}">${name}</span>${k === 'bm' && e.ta ? '<span class="pill">Avis principal</span>' : ''}<span class="tier sm ${x.tier}">${x.tier}</span><span class="small">${esc(tier)}${x.style ? ` · ${esc(x.style)}` : ''}${x.difficulty ? ` · ${esc(x.difficulty)}` : ''}${x.trend ? ` · ${TREND[x.trend] || ''}` : ''}</span></div>
      ${x.early?.length ? `<div class="line"><span class="small" style="min-width:110px">Début de partie</span><div class="icons">${unitIcons(x.early)}</div></div>` : ''}
      ${x.items?.length ? `<div class="line"><span class="small" style="min-width:110px">Priorité objets</span><div class="icons">${itemIcons(x.items)}</div></div>` : ''}
      ${x.tips?.length ? `<ul class="sum">${x.tips.map((t) => `<li>${gloss(t)}</li>`).join('')}</ul>` : '<p class="small">Pas de conseils détaillés : voir le guide original.</p>'}
      <div class="row">${ext(x.url, `Voir sur ${name}`)}</div>
    </div>`;
  };
  const ours = (e) => {
    const ids = e.carries.map(champByName).filter(Boolean);
    return (M()?.comps || []).find((c) => ids.includes(c.carry)) || null;
  };
  return `${tl.length ? `<div class="notice" style="margin-bottom:14px">${tl.map((c) => `<div><strong>${esc(c.title)}</strong> mise à jour le ${frDate(c.date)} : les avis seront révisés sous peu.</div>`).join('')}</div>` : ''}
    ${fresh.length ? `<div class="notice" style="margin-bottom:14px"><strong>Nouvelles compos chez TFT Academy</strong><div class="rows" style="margin-top:8px">${fresh.map((n) => `<div><span class="grow">${esc(n.title)}</span>${ext(n.url, 'Voir')}</div>`).join('')}</div><p class="small" style="margin-top:6px">Leur fiche en français arrive à la prochaine révision.</p></div>` : ''}
    <p class="small" style="margin:0 0 14px">Tier lists de BunnyMuffins (mise à jour le ${frDate(g.sources.bunnymuffins.tierlistModified)}) et TFT Academy, patch ${esc(g.patch)}. Quand les deux traitent la même compo, BunnyMuffins passe en premier. Résumés HexaRise.</p>
    <div class="stack">${list.map((e) => {
      const mine = ours(e);
      return `<article class="card tonal xcard ${S.f.expertFocus === e.id ? 'focus' : ''}" id="x-${esc(e.id)}">
        <div class="fiche-head" style="margin-bottom:10px">
          <div class="name-cell"><div class="icons">${unitIcons(e.carries)}</div><div><h3 style="margin:0">${esc(e.name)}</h3><span class="small">${esc(e.units.map((u) => champ(champByName(u) || '').name || u).join(', '))}</span></div></div>
          ${mine ? `<button class="btn text sm" data-guide="${esc(mine.id)}">Guide HexaRise ${ICON.chevron}</button>` : ''}
        </div>
        <div class="xgrid2">${block(e, 'bm')}${block(e, 'ta')}</div>
      </article>`;
    }).join('') || '<p class="small">Aucune compo.</p>'}</div>`;
}

function condRows(source, filter) {
  return Object.entries(source || {})
    .filter(([id]) => filter(id))
    .map(([id, v]) => ({ id, ...v, comps: v.comps.filter((r) => expert() || r.tier !== 'D').map((r) => ({ ...r, c: findComp(r.comp) })).filter((r) => r.c) }))
    .filter((r) => r.comps.length);
}
const compChip = (r) => `<button class="tag" data-guide="${esc(r.c.id)}"><span class="tier sm ${r.tier}">${r.tier}</span>${esc(compTitle(r.c))} · ${esc(champ(r.c.carry).name)}<span class="small">${pct(r.top4)} top 4</span></button>`;

function learnConditions() {
  const m = M();
  if (!m?.conditions) return noData();
  const q = query();
  const kind = S.f.condKind;
  const isAug = kind === 'augment';
  const rows = condRows(isAug ? m.conditions.augments : m.conditions.items, (id) => (isAug || (S.static?.items?.[id]?.kind || 'complet') === kind) && matches(isAug ? aug(id) : item(id), q))
    .sort((a, b) => b.games - a.games);
  if (isAug && !m.hasAugments) return '<div class="notice">Riot ne fournit pas les augments choisis pour ce set : pas de conditions d’augments.</div>';
  return `<p class="small" style="margin:0 0 12px">Pour chaque ${isAug ? 'augment' : 'objet'}, les compos où il réussit le mieux dans ce rang (place moyenne quand il est ${isAug ? 'choisi' : 'sur le plateau'}). Calculé sur ${int(m.boards)} parties, mis à jour à chaque collecte.</p>
    <div class="cond-list">${rows.map((r) => `<div class="cond-row">
      <div class="name-cell">${isAug ? augIcon(r.id) : itemIcon(r.id, true)}<div>${esc(label(isAug ? aug(r.id) : item(r.id)))}${!isAug && recipeText(r.id) ? `<div class="small">${esc(recipeText(r.id))}</div>` : ''}<div class="small">${int(r.games)} fois</div></div></div>
      <div class="tags">${r.comps.map(compChip).join('')}</div>
    </div>`).join('') || '<p class="small">Pas assez de parties pour ce type.</p>'}</div>`;
}

function learnOpeners() {
  const m = M();
  if (!m?.comps?.length) return noData();
  const bmOpen = S.content?.guides?.guides.find((x) => x.id === 'bm-openers');
  const cond = m.conditions || { items: {}, augments: {} };
  const ifYou = [
    ...condRows(cond.items, (id) => ['embleme', 'artefact', 'radieux'].includes(S.static?.items?.[id]?.kind)).map((r) => ({ ...r, isAug: false })),
    ...condRows(cond.augments, () => true).map((r) => ({ ...r, isAug: true }))
  ]
    .map((r) => ({ ...r, best: r.comps[0] }))
    .filter((r) => ['S', 'A'].includes(r.best.tier) && r.best.games >= 4)
    .sort((a, b) => TIER_RANK[a.best.tier] - TIER_RANK[b.best.tier] || b.games - a.games)
    .slice(0, 24);
  const top = [...m.comps].sort((a, b) => a.score - b.score).slice(0, 8);
  return `${bmOpen ? `<div class="card tonal" style="margin-bottom:16px"><div class="badges"><span class="pill src-pill bm">BunnyMuffins</span></div><h3>Les bons réflexes en début de partie</h3>
      <ul class="sum">${bmOpen.summary.slice(1, 5).map((t) => `<li>${gloss(t)}</li>`).join('')}</ul>
      <div class="row"><button class="btn text sm" data-learn-tab="guides">Fiche complète</button>${ext(bmOpen.url, 'Lire l’original')}</div></div>` : ''}
    <h2 class="title">Si tu obtiens… joue…</h2>
    <p class="small" style="margin:-6px 0 10px">Emblèmes, artefacts, objets radieux et augments qui mènent le plus souvent à une compo de tier S ou A dans ce rang.</p>
    <div class="cond-list">${ifYou.map((r) => `<div class="cond-row"><div class="name-cell">${r.isAug ? augIcon(r.id) : itemIcon(r.id, true)}<div>${esc(label(r.isAug ? aug(r.id) : item(r.id)))}<div class="small">${r.isAug ? 'Augment' : { embleme: 'Emblème', artefact: 'Artefact', radieux: 'Radieux' }[S.static?.items?.[r.id]?.kind] || ''}</div></div></div><div class="tags">${r.comps.slice(0, 3).map(compChip).join('')}</div></div>`).join('') || '<p class="small">Pas encore assez de parties pour ce rang.</p>'}</div>
    <h2 class="title" style="margin-top:24px">Débuts de partie des meilleures compos</h2>
    <div class="cond-list">${top.map((c) => {
      const gg = guideOf(c);
      return `<div class="cond-row"><div class="name-cell"><span class="tier sm ${c.tier}">${c.tier}</span><div><b>${esc(compTitle(c))} · ${esc(champ(c.carry).name)}</b><div class="small">${esc(gg.type.label)}</div></div></div>
        <div class="opener"><div class="icons">${gg.early.map((id) => champIcon(id, 'sm')).join('')}</div><span class="small">Composants :</span><div class="icons">${gg.components.map((id) => itemIcon(id)).join('')}</div><button class="btn text sm" data-guide="${esc(c.id)}">Guide ${ICON.chevron}</button></div></div>`;
    }).join('')}</div>`;
}

const BASE_COMPONENTS = ['TFT_Item_BFSword', 'TFT_Item_RecurveBow', 'TFT_Item_NeedlesslyLargeRod', 'TFT_Item_TearOfTheGoddess', 'TFT_Item_ChainVest', 'TFT_Item_NegatronCloak', 'TFT_Item_GiantsBelt', 'TFT_Item_SparringGloves', 'TFT_Item_Spatula', 'TFT_Item_FryingPan'];
function learnComponents() {
  const m = M();
  if (!m?.conditions) return noData();
  const recipes = Object.values(S.static?.items || {}).filter((it) => !it.outOfSet && ['complet', 'embleme'].includes(it.kind) && it.composition?.length === 2);
  const cards = BASE_COMPONENTS.filter((id) => S.static?.items?.[id]).map((comp) => {
    const made = recipes.filter((it) => it.composition.includes(comp));
    const agg = new Map();
    for (const it of made) {
      for (const r of m.conditions.items[it.apiName]?.comps || []) {
        const a = agg.get(r.comp) || { n: 0, sum: 0, top4: 0 };
        a.n += r.games;
        a.sum += r.avg * r.games;
        a.top4 += r.top4 * r.games;
        agg.set(r.comp, a);
      }
    }
    const best = [...agg.entries()]
      .filter(([, a]) => a.n >= 5)
      .map(([comp, a]) => ({ comp, c: findComp(comp), games: a.n, top4: round1(a.top4 / a.n), score: (a.sum + 4.5 * 8) / (a.n + 8) }))
      .filter((r) => r.c)
      .sort((x, y) => x.score - y.score)
      .slice(0, 4)
      .map((r) => ({ ...r, tier: r.score <= 3.95 ? 'S' : r.score <= 4.2 ? 'A' : r.score <= 4.45 ? 'B' : 'C' }));
    const used = made.map((it) => ({ it, n: m.conditions.items[it.apiName]?.games || 0 })).sort((a, b) => b.n - a.n).slice(0, 8);
    return `<div class="card tonal">
      <div class="name-cell">${itemIcon(comp, true)}<h3 style="margin:0">${esc(label(item(comp)))}</h3></div>
      <p class="label-sm" style="margin-top:12px">Objets fabriqués avec</p><div class="icons wrap">${used.map(({ it }) => itemIcon(it.apiName)).join('')}</div>
      <p class="label-sm" style="margin-top:12px">Compos qui en profitent le plus</p><div class="tags">${best.map(compChip).join('') || '<span class="small">Pas assez de parties.</span>'}</div>
    </div>`;
  });
  return `<div class="notice" style="margin-bottom:14px">Référence à consulter <strong>avant</strong> la partie. Les règles Riot interdisent qu’un outil te dise quoi construire selon tes objets pendant la partie : cette page n’existe donc pas dans le mode partie.</div>
    <div class="guide-grid">${cards.join('')}</div>`;
}
const round1 = (v) => Math.round(v * 10) / 10;

function learnGlossary() {
  const terms = S.content?.glossary?.terms;
  if (!terms) return '<p class="small">Chargement…</p>';
  const q = query();
  const list = terms
    .filter((t) => !q || [t.term, ...(t.aliases || [])].some((w) => w.toLowerCase().includes(q)) || t.def.toLowerCase().includes(q))
    .sort((a, b) => a.term.localeCompare(b.term, 'fr'));
  return `<p class="small" style="margin:0 0 12px">Les mots soulignés en pointillés dans l’app affichent leur définition au survol.</p>
    <div class="gloss-grid">${list.map((t) => `<div class="card tonal"><h3 style="margin:0">${esc(t.term)}</h3>${t.aliases?.length ? `<p class="small" style="margin:2px 0 0">${esc(t.aliases.join(', '))}</p>` : ''}<p style="margin:8px 0 0">${esc(t.def)}</p></div>`).join('') || '<p class="small">Aucun terme.</p>'}</div>`;
}

// ===================== Profil =====================
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
  const platLabel = S.app?.platforms?.find((x) => x.id === platform)?.label || 'EUW';
  const recent = recentSearches();
  let out = `<div class="stack"><div class="card">
    <h1 class="h1">Mon profil</h1>
    <p class="lede" style="margin:8px 0 20px">Entre ton Riot ID pour voir ton rang, tes 20 dernières parties et si tu es en partie.</p>
    <form class="search-row" id="player-form">
      <input class="field-input" style="flex:1 1 260px" id="player-q" placeholder="Pseudo#TAG" value="${esc(p.query)}" autocomplete="off" aria-label="Riot ID">
      <button type="button" class="chip menu-chip" style="height:56px" data-menu-open="player-platform" data-platform="${esc(platform)}">${esc(platLabel)} ${ICON.down}</button>
      <button class="btn filled" style="height:56px" ${p.loading ? 'disabled' : ''}>${p.loading ? 'Recherche…' : 'Rechercher'}</button>
    </form>
    ${recent.length ? `<div class="chips" style="margin-top:12px">${recent.map((r) => `<button class="chip" data-recent="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : ''}
    ${p.error ? `<div class="notice" style="margin-top:16px">${esc(p.error)}</div>` : ''}
  </div>`;
  const d = p.data;
  if (!d) return `${out}</div>`;

  const rk = d.ranked;
  out += `<div class="card">
    <div class="fiche-head" style="margin-bottom:16px"><div><h2 class="h2">${esc(d.account.gameName)} <span class="small">#${esc(d.account.tagLine)}</span></h2></div>
      <button class="btn tonal sm" data-action="live">Partie en cours ?</button></div>
    <div class="kpis">
      <div class="card tonal"><div class="gnum">${rk ? `${TIER_FR[rk.tier] || rk.tier} ${['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rk.tier) ? '' : rk.rank}` : '—'}</div><div class="small">${rk ? `${int(rk.leaguePoints)} LP` : 'Non classé'}</div></div>
      <div class="card tonal"><div class="gnum">${nf(d.summary.avg, 1)}</div><div class="small">place moyenne (${d.summary.games} parties)</div></div>
      <div class="card tonal"><div class="gnum">${d.summary.top4}</div><div class="small">top 4</div></div>
      <div class="card tonal"><div class="gnum">${d.summary.wins}</div><div class="small">victoires</div></div>
    </div>
    ${p.live ? `<div class="notice" style="margin-top:12px">${p.live.inGame ? `<strong>En partie depuis ${Math.round((Date.now() - p.live.startedAt) / 60000)} min.</strong>` : 'Pas de partie en cours.'}</div>` : ''}
  </div>
  <div class="card"><h2 class="title">Dernières parties</h2>${d.games.map((g) => {
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
  }).join('')}</div></div>`;
  return out;
}

async function searchPlayer(q, platform) {
  q = q.trim();
  if (!q) return;
  Object.assign(S.player, { query: q, platform, loading: true, error: '', live: null });
  render();
  try {
    S.player.data = await api.player(q, platform);
    const r = recentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase());
    r.unshift(q);
    remember('recent', JSON.stringify(r.slice(0, 6)));
  } catch (err) {
    S.player.error = err.message;
    S.player.data = null;
  }
  S.player.loading = false;
  render();
}

// ===================== Réglages (listes Material, pastilles Apple) =====================
const sw = (on) => `<span class="switch ${on ? 'on' : ''}"><i></i></span>`;
function setRow({ tile, icon, title, sub, trail = ICON.chevron, attrs = '', role = '', cls = '' }) {
  return `<button class="set-row ${cls}" ${attrs} ${role}><span class="tile ${tile}">${ICON[icon]}</span><span class="txt"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${trail}</button>`;
}

function viewSettings() {
  if (S.setPage === 'collecte') return settingsCollecte();
  if (S.setPage === 'journal') return settingsJournal();
  const st = S.app?.settings || {};
  const ov = S.overlay || {};
  const plat = S.app?.platforms?.find((p) => p.id === st.platform)?.label || st.platform;
  const info = S.appInfo || {};
  const nb = (st.brackets || []).length;
  return `<div class="card settings">
    <div class="set-head"><h1 class="h1" style="font-size:28px">Réglages</h1></div>

    <h2 class="set-section">Compte et données</h2>
    ${setRow({ tile: 'violet', icon: 'key', title: 'Clé API Riot', sub: S.app?.hasKey ? 'Enregistrée · touche pour la remplacer' : 'Aucune clé · obligatoire pour les statistiques', attrs: 'data-action="key-dialog"' })}
    ${setRow({ tile: 'blue', icon: 'globe', title: 'Serveur', sub: plat, trail: ICON.down, attrs: 'data-menu-open="platform"' })}
    ${setRow({ tile: 'green', icon: 'chart', title: 'Collecte des données', sub: `${nb} rang${nb > 1 ? 's' : ''} · ${st.playersPerBracket} joueurs par rang · toutes les ${st.refreshMinutes} min`, attrs: 'data-subpage="collecte"' })}

    <h2 class="set-section">Mode partie et affichage</h2>
    ${isDesktop ? setRow({ tile: 'orange', icon: 'window', title: 'Ouverture automatique', sub: 'Afficher le mode partie au lancement d’une partie TFT', trail: sw(ov.autoOpen), attrs: 'data-toggle-set="autoOpen"', role: `role="switch" aria-checked="${ov.autoOpen ? 'true' : 'false'}"` }) : ''}
    ${setRow({ tile: 'pink', icon: 'keyboard', title: 'Raccourci du mode partie', sub: 'Afficher ou masquer la fenêtre, même en jeu', trail: `<span class="kbd">${esc(ov.shortcut || 'Alt+G')}</span>`, attrs: 'data-action="overlay-open"' })}
    ${setRow({ tile: 'indigo', icon: 'expert', title: 'Mode Expert', sub: 'Plus de statistiques dans les fiches et les tableaux', trail: sw(expert()), attrs: 'data-toggle-set="expert"', role: `role="switch" aria-checked="${expert()}"` })}
    ${setRow({ tile: 'gray', icon: 'motion', title: 'Réduire les animations', sub: 'Transitions instantanées', trail: sw(S.reduceMotion), attrs: 'data-toggle-set="motion"', role: `role="switch" aria-checked="${S.reduceMotion}"` })}

    <h2 class="set-section">Application</h2>
    ${setRow({ tile: 'gray', icon: 'info', title: 'Version', sub: `${info.version || '—'}${isDesktop ? '' : ' (version web)'} · données du set ${S.static?.setNumber ?? '—'}, patch ${S.static?.version ?? '—'}`, trail: '', attrs: 'tabindex="-1"', cls: 'static' })}
    ${isDesktop ? setRow({ tile: 'blue', icon: 'update', title: 'Mises à jour', sub: S.update?.message || 'Vérification au démarrage puis toutes les 4 h', trail: S.update?.state === 'downloaded' ? '<span class="pill grad">Redémarrer</span>' : '', attrs: `data-action="${S.update?.state === 'downloaded' ? 'install-update' : 'check-update'}"` }) : ''}
    ${setRow({ tile: 'gray', icon: 'data', title: 'Parties en base', sub: `${int(S.app?.storedMatches)} parties enregistrées sur ce PC`, trail: '', attrs: 'tabindex="-1"', cls: 'static' })}
    ${setRow({ tile: 'gray', icon: 'list', title: 'Journal', sub: 'Historique de la collecte et des erreurs', attrs: 'data-subpage="journal"' })}
  </div>`;
}

function subHead(title) {
  return `<div class="set-head"><button class="back" data-back="settings" aria-label="Retour aux réglages">${ICON.back}</button><h1 class="h2">${esc(title)}</h1></div>`;
}

function settingsCollecte() {
  const st = S.app?.settings || {};
  const bracketChips = (S.app?.brackets || []).map((b) => {
    const on = st.brackets?.includes(b.id);
    return `<button class="chip ${on ? 'on' : ''}" data-set-bracket="${b.id}">${on ? '✓ ' : ''}${esc(b.label)}</button>`;
  }).join('');
  const tierChips = [['challenger', 'Challenger'], ['grandmaster', 'Grand Maître'], ['master', 'Maître']].map(([t, l]) => {
    const on = st.tiers?.includes(t);
    return `<button class="chip ${on ? 'on' : ''}" data-set-tier="${t}">${on ? '✓ ' : ''}${l}</button>`;
  }).join('');
  const radio = (name, value, current, text) => `<button class="radio-row" role="radio" aria-checked="${String(value) === String(current)}" data-set-radio="${name}" data-v="${value}"><span class="radio ${String(value) === String(current) ? 'on' : ''}"><i></i></span>${esc(text)}</button>`;
  const nb = (st.brackets || []).length;
  const per = st.playersPerBracket || 0;
  const estMin = Math.ceil((nb * (8 + per + Math.round((per * (st.matchesPerPlayer || 0)) / 2))) / 50);
  return `<div class="card settings">
    ${subHead('Collecte des données')}
    <h2 class="set-section">Rangs analysés</h2>
    <div class="chips" style="padding:0 16px">${bracketChips}</div>
    <h2 class="set-section">La tranche Maître+ inclut</h2>
    <div class="chips" style="padding:0 16px">${tierChips}</div>
    <h2 class="set-section">Volume</h2>
    <div class="row" style="padding:0 16px;gap:16px">
      <label class="small">Joueurs par rang<br><input class="field-input num-input" type="number" min="5" max="150" value="${st.playersPerBracket}" data-set-num="playersPerBracket"></label>
      <label class="small">Parties par joueur<br><input class="field-input num-input" type="number" min="1" max="40" value="${st.matchesPerPlayer}" data-set-num="matchesPerPlayer"></label>
    </div>
    <p class="small" style="padding:8px 16px 0">Première collecte : environ ${estMin} min. Ensuite, seules les nouvelles parties sont récupérées.</p>
    <h2 class="set-section">Actualisation</h2>
    ${radio('refreshMinutes', 15, st.refreshMinutes, 'Toutes les 15 min')}${radio('refreshMinutes', 30, st.refreshMinutes, 'Toutes les 30 min')}${radio('refreshMinutes', 60, st.refreshMinutes, 'Toutes les heures')}${radio('refreshMinutes', 360, st.refreshMinutes, 'Toutes les 6 h')}
    <h2 class="set-section">Patch</h2>
    ${radio('patchMode', 'latest', st.patchMode, 'Dernier patch uniquement')}${radio('patchMode', 'all', st.patchMode, 'Tout le set')}
  </div>`;
}

function settingsJournal() {
  return `<div class="card settings">${subHead('Journal')}
    <div class="logs" id="logs">${(S.app?.logs || []).slice().reverse().map((l) => `<div>${new Date(l.t).toLocaleTimeString('fr-FR')} — ${esc(l.message)}</div>`).join('') || 'Aucun événement.'}</div>
  </div>`;
}

let saveTimer = null;
async function saveSettings(patch, message = 'Réglages enregistrés') {
  S.app.settings = { ...S.app.settings, ...patch };
  render();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    S.app = await api.setSettings(S.app.settings);
    toast(message);
    render();
  }, 350);
}

// ===================== Rendu et navigation =====================
const VIEWS = { meta: viewMeta, line: viewLine, guide: viewGuide, champion: viewChampion, game: viewGame, explore: viewExplore, learn: viewLearn, player: viewPlayer, settings: viewSettings };
const ALIASES = { champions: 'champions', traits: 'traits', items: 'items', augments: 'augments', shop: 'shop' };
const CHILD = { guide: 'meta', champion: 'explore' }; // vue enfant -> destination parente

function render(anim = '') {
  const scroll = view.scrollTop;
  const focused = document.activeElement?.id;
  const caret = document.activeElement?.selectionStart;
  view.innerHTML = `<div class="${anim ? `anim-${anim}` : ''}">${VIEWS[S.route]()}</div>`;
  if (!anim) view.scrollTop = scroll;
  if (focused) {
    const el = document.getElementById(focused);
    if (el && view.contains(el)) {
      el.focus();
      if (caret !== undefined && el.setSelectionRange) el.setSelectionRange(caret, caret);
    }
  }
  const navRoute = CHILD[S.route] || S.route;
  document.querySelectorAll('.rail-item').forEach((a) => a.classList.toggle('active', a.dataset.route === navRoute));
  document.body.classList.toggle('no-motion', S.reduceMotion);
  $('#sample-label').textContent = sampleText();
}

let renderTimer = null;
function softRender() {
  // Ne pas écraser un formulaire en cours d'édition.
  if (['settings', 'player'].includes(S.route) || layer.innerHTML) return;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => render(), 400);
}

/** Navigation : fondu entre destinations principales, glissement entre parent et enfant. */
function go(route, anim) {
  if (ALIASES[route]) {
    S.f.exploreTab = ALIASES[route];
    route = 'explore';
  }
  route = VIEWS[route] ? route : 'meta';
  if (route === 'settings' && S.route !== 'settings') S.setPage = 'root';
  const dir = anim || (CHILD[route] ? 'fwd' : CHILD[S.route] === route ? 'back' : 'fade');
  S.route = route;
  if (location.hash.slice(1) !== route) location.hash = route;
  closeLayer();
  view.scrollTop = 0;
  render(dir);
}

function renderStatus() {
  const st = S.app?.status || {};
  const live = $('#live');
  live.className = `live ${st.state || ''}`;
  let text;
  if (!S.app?.hasKey) text = 'Clé API manquante';
  else if (st.state === 'running') text = `Analyse · ${st.phase}${st.total ? ` ${st.done}/${st.total}` : ''}`;
  else if (st.state === 'error') text = 'Collecte interrompue';
  else text = `Live · à jour ${ago(st.lastUpdate)}`;
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
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && layer.innerHTML) closeLayer();
  if (e.key === 'Enter' && e.target.id === 'key-input') layer.querySelector('[data-action="save-key"]')?.click();
});

document.addEventListener('click', async (e) => {
  const t = e.target;

  // Couche menus / dialogues
  const menuBtn = t.closest('[data-menu]');
  if (menuBtn && menuState) {
    const it = menuState.items[Number(menuBtn.dataset.menu)];
    const pick = menuState.onPick;
    closeLayer();
    return pick(it.value);
  }
  if (t.closest('[data-close]')) return closeLayer();
  if (layer.innerHTML && !t.closest('#layer') && !t.closest('[data-menu-open]')) closeLayer();

  const routeEl = t.closest('[data-route]');
  if (routeEl) {
    e.preventDefault();
    return go(routeEl.dataset.route);
  }
  const backEl = t.closest('[data-back]');
  if (backEl) {
    if (backEl.dataset.back === 'settings') {
      S.setPage = 'root';
      return render('back');
    }
    return go(backEl.dataset.back, 'back');
  }
  const modeBtn = t.closest('[data-mode]');
  if (modeBtn) return setMode(modeBtn.dataset.mode);
  if (t.closest('#update-banner') && S.update?.state === 'downloaded') return api.installUpdate();

  const opener = t.closest('[data-menu-open]');
  if (opener) {
    const kind = opener.dataset.menuOpen;
    if (kind === 'bracket') {
      return openMenu(opener, bracketItems(), (v) => {
        S.f.bracket = v;
        remember('bracket', v);
        render();
      });
    }
    if (kind === 'champ-trait') {
      const list = Object.values(S.static?.traits || {}).filter((t) => (t.breakpoints || []).length > 1 || t.breakpoints?.[0]?.min > 1).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      return openMenu(opener, [{ value: '', label: 'Toutes les synergies', checked: !S.f.champTrait }, ...list.map((t) => ({ value: t.apiName, label: t.name, checked: t.apiName === S.f.champTrait }))], (v) => {
        S.f.champTrait = v;
        render();
      });
    }
    if (kind === 'sort') {
      return openMenu(opener, [['reco', 'Recommandées'], ['top4', 'Meilleur top 4'], ['pick', 'Les plus jouées']].map(([v, l]) => ({ value: v, label: l, checked: v === S.f.compSort })), (v) => {
        S.f.compSort = v;
        render();
      });
    }
    if (kind === 'platform' || kind === 'player-platform') {
      const current = kind === 'platform' ? S.app?.settings?.platform : opener.dataset.platform;
      return openMenu(opener, (S.app?.platforms || []).map((p) => ({ value: p.id, label: p.label, checked: p.id === current })), (v) => {
        if (kind === 'platform') saveSettings({ platform: v }, 'Serveur changé : nouvelle collecte lancée');
        else {
          S.player.platform = v;
          render();
        }
      });
    }
  }

  const sub = t.closest('[data-subpage]');
  if (sub) {
    S.setPage = sub.dataset.subpage;
    view.scrollTop = 0;
    return render('fwd');
  }
  const tog = t.closest('[data-toggle-set]');
  if (tog) {
    const k = tog.dataset.toggleSet;
    if (k === 'expert') return setMode(expert() ? 'simple' : 'expert');
    if (k === 'motion') {
      S.reduceMotion = !S.reduceMotion;
      remember('reduceMotion', S.reduceMotion ? '1' : '0');
      return render();
    }
    if (k === 'autoOpen') {
      S.overlay = await api.overlaySet({ autoOpen: !S.overlay?.autoOpen });
      toast(S.overlay.autoOpen ? 'Ouverture automatique activée' : 'Ouverture automatique désactivée');
      return render();
    }
  }
  const setBracket = t.closest('[data-set-bracket]');
  if (setBracket) {
    const id = setBracket.dataset.setBracket;
    const cur = S.app.settings.brackets || [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    if (!next.length) return toast('Garde au moins un rang');
    return saveSettings({ brackets: next });
  }
  const setTier = t.closest('[data-set-tier]');
  if (setTier) {
    const id = setTier.dataset.setTier;
    const cur = S.app.settings.tiers || [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    if (!next.length) return toast('Garde au moins un palier');
    return saveSettings({ tiers: next });
  }
  const setRadio = t.closest('[data-set-radio]');
  if (setRadio) {
    const v = setRadio.dataset.v;
    return saveSettings({ [setRadio.dataset.setRadio]: /^\d+$/.test(v) ? Number(v) : v });
  }

  if (!view.contains(t) && !t.closest('#live') && !t.closest('#layer')) return;
  const sortTh = t.closest('[data-sort]');
  if (sortTh) {
    const [id, key] = sortTh.dataset.sort.split(':');
    const st = S.sort[id];
    S.sort[id] = st && st.key === key ? { key, dir: -st.dir } : { key, dir: key === 'name' || key === 'avg' ? 1 : -1 };
    return render();
  }
  const lnAdd = t.closest('[data-line-add]');
  if (lnAdd) {
    const id = lnAdd.dataset.lineAdd;
    S.lineSel[id] = Math.min(9, (S.lineSel[id] || 0) + 1);
    saveLineSel();
    return render();
  }
  const lnDec = t.closest('[data-line-dec]');
  if (lnDec) {
    const id = lnDec.dataset.lineDec;
    S.lineSel[id] = (S.lineSel[id] || 0) - 1;
    if (S.lineSel[id] <= 0) delete S.lineSel[id];
    saveLineSel();
    return render();
  }
  const lnRem = t.closest('[data-line-remove]');
  if (lnRem) {
    delete S.lineSel[lnRem.dataset.lineRemove];
    saveLineSel();
    return render();
  }
  if (t.closest('[data-line-clear]')) {
    S.lineSel = {};
    saveLineSel();
    return render();
  }
  const lnCat = t.closest('[data-line-cat]');
  if (lnCat) {
    S.f.lineCat = lnCat.dataset.lineCat;
    remember('lineCat', S.f.lineCat);
    return render('fade');
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
    return render('fade');
  }
  const sel = t.closest('[data-sel]');
  if (sel) {
    S.selComp = sel.dataset.sel;
    render();
    const f = $('#fiche');
    if (f) {
      f.classList.remove('anim-fade');
      void f.offsetWidth;
      f.classList.add('anim-fade');
    }
    return;
  }
  const ltab = t.closest('[data-learn-tab]');
  if (ltab) {
    S.f.learnTab = ltab.dataset.learnTab;
    remember('learnTab', S.f.learnTab);
    return render('fade');
  }
  const rel = t.closest('[data-related]');
  if (rel) {
    const [where, tab] = rel.dataset.related.split(':');
    if (where === 'learn') {
      S.f.learnTab = tab;
      return go('learn');
    }
    S.f.exploreTab = tab;
    return go('explore');
  }
  const ex = t.closest('[data-expert]');
  if (ex) {
    S.f.learnTab = 'experts';
    S.f.expertSrc = 'all';
    S.f.expertFocus = ex.dataset.expert;
    go('learn');
    setTimeout(() => document.getElementById(`x-${S.f.expertFocus}`)?.scrollIntoView({ block: 'center' }), 50);
    return;
  }
  const cv = t.closest('[data-champ-view]');
  if (cv) {
    S.f.champView = cv.dataset.champView;
    remember('champView', S.f.champView);
    return render('fade');
  }
  const champEl = t.closest('[data-champ]');
  if (champEl) {
    S.champId = champEl.dataset.champ;
    return go('champion');
  }
  const play = t.closest('[data-play]');
  if (play) {
    S.overlay = await api.overlaySet({ compId: play.dataset.play, bracket: S.f.bracket });
    await api.overlayToggle(true);
    toast(isDesktop ? 'Compo envoyée au mode partie' : 'Mode partie ouvert dans une nouvelle fenêtre');
    return render();
  }
  const guideBtn = t.closest('[data-guide]');
  if (guideBtn) {
    S.guideId = guideBtn.dataset.guide;
    return go('guide');
  }
  const recent = t.closest('[data-recent]');
  if (recent) return searchPlayer(recent.dataset.recent, S.player.platform || S.app?.settings?.platform);

  const action = t.closest('[data-action]')?.dataset.action;
  if (action === 'refresh') {
    api.refresh();
    toast('Actualisation lancée');
  }
  if (action === 'clear-filters') {
    S.f.q = '';
    S.f.style = 'all';
    $('#q').value = '';
    render();
  }
  if (action === 'key-dialog') openKeyDialog();
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
    const key = $('#key-input').value.trim();
    if (!key) {
      msg.textContent = 'Colle une clé avant d’enregistrer.';
      return;
    }
    msg.textContent = 'Vérification…';
    const res = await api.setApiKey(key);
    if (!res.ok) {
      msg.innerHTML = `<span class="bad">${esc(res.message)}</span>`;
      return;
    }
    closeLayer();
    toast('Clé enregistrée et vérifiée');
    S.app = await api.state();
    renderStatus();
    render();
  }
  if (action === 'check-update') {
    api.checkUpdate();
    toast('Recherche de mise à jour…');
  }
  if (action === 'overlay-open') api.overlayToggle(true);
  if (action === 'install-update') api.installUpdate();
});

$('#q').addEventListener('input', (e) => {
  S.f.q = e.target.value;
  if (!['meta', 'line', 'explore', 'learn'].includes(S.route)) go('meta');
  else render();
});

view.addEventListener('change', (e) => {
  const k = e.target.dataset?.setNum;
  if (k) saveSettings({ [k]: Number(e.target.value) });
});

view.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'player-form') searchPlayer($('#player-q').value, S.player.platform || S.app?.settings?.platform);
});

window.addEventListener('hashchange', () => {
  const r = location.hash.slice(1);
  if (r && r !== S.route && (VIEWS[r] || ALIASES[r])) go(r);
});
window.addEventListener('resize', () => menuState && closeLayer());

// ===================== Flux live =====================
api.on('status', (st) => {
  if (S.app) S.app.status = st;
  renderStatus();
  promptKeyIfRefused(st);
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
api.on('content', (c) => {
  S.content = c;
  softRender();
});

setInterval(renderStatus, 30000);

// ===================== Démarrage =====================
(async function boot() {
  try {
    [S.app, S.static, S.meta, S.appInfo, S.overlay, S.content] = await Promise.all([api.state(), api.static(), api.meta(), api.appInfo(), api.overlayGet(), api.content().catch(() => null)]);
  } catch (err) {
    view.innerHTML = `<div class="card empty"><p class="h2">Erreur</p><p class="lede">${esc(err.message)}</p></div>`;
    return;
  }
  const r = location.hash.slice(1);
  if (ALIASES[r]) S.f.exploreTab = ALIASES[r];
  S.route = ALIASES[r] ? 'explore' : VIEWS[r] && !CHILD[r] ? r : 'meta';
  renderStatus();
  render('fade');
  if (!S.app?.hasKey) setTimeout(openKeyDialog, 400);
  else setTimeout(() => promptKeyIfRefused(S.app?.status), 400);
})();
