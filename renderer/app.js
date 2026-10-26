import { api, isDesktop } from './api.js';
import { buildGuide, compType, STREAKS } from './guide.js';

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
    champView: stored('champView', 'list'),
    itemKind: 'complet',
    augTier: 'tous'
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
  if (el.dataset.tip === 'champ') {
    const c = champ(id);
    title = `${label(c)} · ${c.cost || '?'} PO`;
    desc = [c.traits.map((t) => label(trait(t))).join(' · '), c.ability ? `${c.ability.name} — ${c.ability.desc}` : ''].filter(Boolean).join('\n\n');
  } else if (el.dataset.tip === 'item') {
    const it = item(id);
    title = label(it);
    desc = [recipeText(id) && `Recette : ${recipeText(id)}`, it.stats, it.desc].filter(Boolean).join('\n\n');
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

function openKeyDialog() {
  openDialog({
    title: 'Clé API Riot',
    body: `<label for="key-input">Clé (RGAPI-…)</label>
      <input id="key-input" type="password" placeholder="${S.app?.hasKey ? '•••••••• (enregistrée)' : 'Colle ta clé ici'}" autocomplete="off">
      <p>Une clé de développement expire après 24 h. Génère-la sur developer.riotgames.com.</p>
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
    <ol class="steps">${g.summary.map((s) => `<li><span class="step-n">${s.n}</span><b>${esc(s.title)}</b><p>${esc(s.text)}</p></li>`).join('')}</ol>
  </section>

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
    <ul class="tips">${g.plan.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
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

  <div class="card">${g.stages.map((st) => `
    <div class="gstage">
      <div><div class="gstage-name">${esc(st.stage)}</div><div class="small">${esc(st.rounds)}</div></div>
      <div>${st.steps.map((step) => `<div class="gstep">${step.kind === 'note' ? `<p class="small">${esc(step.text)}</p>` : `<p>${esc(step.text)}</p>`}${stepIds(step)}</div>`).join('')}</div>
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

  <div class="card tonal"><p class="small">Placement (conseil général) : Riot ne fournit pas la position des unités. ${esc(champ(c.carry).name)} dans un coin de la dernière ligne, ${g.tank ? esc(champ(g.tank).name) : 'le tank principal'} devant lui. Guide généré à partir de ${int(c.games)} parties (${esc(bracketLabel(S.f.bracket))}, patch ${esc(S.meta?.patch || 'actuel')}).</p></div>
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
const VIEWS = { meta: viewMeta, guide: viewGuide, champion: viewChampion, game: viewGame, explore: viewExplore, player: viewPlayer, settings: viewSettings };
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
  if (!['meta', 'explore'].includes(S.route)) go('meta');
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
    view.innerHTML = `<div class="card empty"><p class="h2">Erreur</p><p class="lede">${esc(err.message)}</p></div>`;
    return;
  }
  const r = location.hash.slice(1);
  if (ALIASES[r]) S.f.exploreTab = ALIASES[r];
  S.route = ALIASES[r] ? 'explore' : VIEWS[r] && !CHILD[r] ? r : 'meta';
  renderStatus();
  render('fade');
  if (!S.app?.hasKey) setTimeout(openKeyDialog, 400);
})();
