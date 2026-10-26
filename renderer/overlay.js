// Mode partie : guide de la compo choisie avant la partie, recettes et augments.
// Aucune donnée de la partie en cours n'est lue ici (règles Riot pour TFT).
import { api, isDesktop } from './api.js';
import { buildGuide, compType, levelPlan, placement, boardHtml } from './guide.js';

if (!isDesktop) document.body.classList.add('web');

const S = { static: null, meta: null, app: null, ov: null, filter: '', comp: null, content: null };
const $ = (s) => document.querySelector(s);

// ---------- Utilitaires (mêmes conventions que l'app principale) ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v, d = 2) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const initials = (n = '?') => n.replace(/[^\p{L}\p{N} ]/gu, '').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const label = (x) => (x?.en && x.en.toLowerCase() !== String(x.name).toLowerCase() ? `${x.name} (${x.en})` : x?.name || '');
const pretty = (id = '') => String(id).replace(/^(TFT\d*|DA)_(\d+_)?(Item_|Augment_)?/i, '').replace(/\d+(?=_|$)/g, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
const champ = (id) => S.static?.champions?.[id] || { apiName: id, name: pretty(id), cost: 0, traits: [], icon: '' };
const trait = (id) => S.static?.traits?.[id] || { apiName: id, name: pretty(id), icon: '' };
const item = (id) => S.static?.items?.[id] || { apiName: id, name: pretty(id), icon: '', composition: [] };
const aug = (id) => S.static?.augments?.[id] || { apiName: id, name: pretty(id), icon: '' };
const img = (src, alt) => (src ? `<img src="${esc(src)}" alt="" loading="lazy" data-fallback="${esc(initials(alt))}">` : esc(initials(alt)));
const champIcon = (id) => `<span class="ic champ cost-${champ(id).cost || 1}" data-tip="champ" data-id="${esc(id)}">${img(champ(id).icon, champ(id).name)}</span>`;
const itemIcon = (id, lg) => `<span class="ic item ${lg ? 'lg' : ''}" data-tip="item" data-id="${esc(id)}">${img(item(id).icon, item(id).name)}</span>`;
const augIcon = (id) => `<span class="ic aug" data-tip="aug" data-id="${esc(id)}">${img(aug(id).icon, aug(id).name)}</span>`;
const unitEl = (id, star = 0, items = []) => `<div class="unit"><span class="stars">${star > 1 ? '★'.repeat(star) : ''}</span>${champIcon(id)}<span class="items">${items.map((i) => itemIcon(i)).join('')}</span><span class="uname">${esc(champ(id).name)}</span></div>`;
const compName = (c) => `${label(trait(c.main))} · ${label(champ(c.carry))}`;
const bracketData = () => S.meta?.byBracket?.[S.ov?.bracket || 'all'] || S.meta?.byBracket?.all || null;

document.addEventListener('error', (e) => {
  const t = e.target;
  if (t.tagName === 'IMG' && t.dataset.fallback !== undefined) t.replaceWith(document.createTextNode(t.dataset.fallback));
}, true);

// Infobulles
const tip = $('#tooltip');
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-tip]');
  if (!el) return tip.classList.add('hidden');
  const id = el.dataset.id;
  const src = { champ, item, aug }[el.dataset.tip]?.(id);
  if (!src) return;
  const desc = el.dataset.tip === 'champ' ? src.traits.map((t) => label(trait(t))).join(' · ') : [src.stats, src.desc].filter(Boolean).join('\n\n');
  tip.innerHTML = `<div class="t">${esc(label(src))}</div>${desc ? `<div class="d">${esc(desc).slice(0, 400)}</div>` : ''}`;
  tip.classList.remove('hidden');
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  tip.style.left = `${Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2))}px`;
  tip.style.top = `${r.top - h - 6 < 6 ? r.bottom + 6 : r.top - h - 6}px`;
});

// Conseils des experts (résumés HexaRise) pour le carry choisi
function expertTips(carryId) {
  const byName = new Map();
  for (const c of Object.values(S.static?.champions || {})) if (!c.variantOf) for (const n of [c.en, c.name]) if (n) byName.set(n.toLowerCase(), c.apiName);
  const e = (S.content?.guides?.comps || []).find((x) => x.carries.some((n) => byName.get(n.toLowerCase()) === carryId));
  if (!e) return '';
  const tips = [...(e.bm?.tips || []).map((t) => ['BunnyMuffins', t]), ...(e.ta?.tips || []).map((t) => ['TFT Academy', t])].slice(0, 4);
  if (!tips.length) return '';
  return `<div class="ov-stage"><h4>Conseils des experts <span>${esc(e.name)}</span></h4>${tips.map(([src, t]) => `<p class="ov-note"><b>${src}</b> · ${esc(t)}</p>`).join('')}</div>`;
}

// ---------- Sélection de la compo ----------
function renderPick() {
  const data = bracketData();
  const comps = [...(data?.comps || [])].sort((a, b) => a.score - b.score);
  const brackets = [['all', 'Tous rangs'], ...(S.app?.brackets || []).map((b) => [b.id, b.label])].filter(([id]) => S.meta?.byBracket?.[id]);
  $('#ov-pick').innerHTML = `
    <select class="input" id="ov-comp">
      <option value="">Choisir une compo…</option>
      ${comps.map((c) => `<option value="${esc(c.id)}" ${c.id === S.ov?.compId ? 'selected' : ''}>${c.tier} · ${esc(compName(c))}</option>`).join('')}
    </select>
    <select class="input" id="ov-bracket">${brackets.map(([id, l]) => `<option value="${id}" ${id === (S.ov?.bracket || 'all') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}

// ---------- Onglets ----------
function viewGuide() {
  const c = S.comp;
  if (!c) return '<div class="ov-empty">Choisis ta compo avant la partie.<br>Le guide reste affiché pendant toute la partie.</div>';
  const g = buildGuide(c, S.static, label);
  const checks = S.ov.checks || {};
  let total = 0;
  let done = 0;
  const stars = Object.fromEntries(c.units.map((u) => [u.id, Math.round(u.star || 1)]));

  const stages = g.stages.map((st, si) => `
    <div class="ov-stage"><h4>${esc(st.stage)} <span>${esc(st.rounds)}</span></h4>
      ${st.steps.map((step, i) => {
        const key = `${si}-${i}`;
        total++;
        if (checks[key]) done++;
        let ids = '';
        if (step.kind === 'note') return `<p class="ov-note">${esc(step.text)}</p>`;
        if (step.kind === 'units' || step.kind === 'final') ids = `<div class="comp-units">${step.ids.map((id) => unitEl(id, step.kind === 'final' ? stars[id] : 0)).join('')}</div>`;
        else if (step.kind === 'items') ids = `<div class="tags">${step.ids.map((id) => `<span class="tag">${itemIcon(id)}${esc(item(id).name)}</span>`).join('')}</div>`;
        else if (step.kind === 'augs') ids = `<div class="tags">${step.ids.map((id) => `<span class="tag">${augIcon(id)}${esc(aug(id).name)}</span>`).join('')}</div>`;
        return `<label class="ov-step ${checks[key] ? 'done' : ''}"><input type="checkbox" data-check="${key}" ${checks[key] ? 'checked' : ''}><div><p>${esc(step.text)}</p>${ids}</div></label>`;
      }).join('')}
    </div>`).join('');

  return `<div class="ov-head"><span class="tier ${c.tier}">${c.tier}</span><div><div class="name">${esc(compName(c))}</div>
    <div class="sub">${esc(g.type.label)} · moy. ${nf(c.avg)} · top 4 ${nf(c.top4, 1)} %</div></div></div>
    <div class="comp-units">${g.final.map((u) => unitEl(u.id, stars[u.id], u.id === c.carry ? g.carryItems : u.id === g.tank ? g.tankItems : [])).join('')}</div>
    <details class="ov-board" ${S.ov.boardOpen === false ? '' : 'open'}><summary>Placement conseillé</summary>
      ${boardHtml(placement(c, S.static, g, { label }), { champ, img, itemIcon, esc }, { compact: true })}</details>
    <div class="ov-progress"><i style="width:${total ? (done / total) * 100 : 0}%"></i></div>
    ${expertTips(c.carry)}
    ${stages}`;
}

function viewLevels() {
  const c = S.comp;
  const type = c ? compType(c, champ(c.carry).cost || 4) : { id: 'lvl8', label: 'Niveau 8 standard' };
  const plan = levelPlan(type, S.static, c ? champ(c.carry).cost : 4);
  const rows = plan.rows.map((r) => {
    const same = r.win === r.mixed && r.mixed === r.lose;
    return `<tr class="${r.key ? 'key' : ''}"><td class="rd">${esc(r.round)}</td>${same ? `<td colspan="3">${esc(r.win)}</td>` : `<td>${esc(r.win)}</td><td>${esc(r.mixed)}</td><td>${esc(r.lose)}</td>`}</tr>`;
  }).join('');
  const ref = S.static?.reference;
  const lv = plan.rollLevel;
  const odds = ref && !ref.stale
    ? `<h5>Chances en boutique</h5><table class="ov-odds"><thead><tr><th>Niv.</th>${[1, 2, 3, 4, 5].map((k) => `<th>${k} PO</th>`).join('')}</tr></thead>
      <tbody>${[4, 5, 6, 7, 8, 9, 10].filter((l) => ref.odds[l]).map((l) => `<tr class="${l === lv ? 'hl' : ''}"><td>${l}</td>${ref.odds[l].map((v) => `<td>${v || '—'}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : '';
  return `<p class="ov-note">${c ? `${esc(type.label)} · suis la colonne de ta série.` : 'Plan type niveau 8 : choisis ta compo pour un plan adapté.'}</p>
    <table class="plan ov-plan"><thead><tr><th></th><th>Victoires</th><th>Mixte</th><th>Défaites</th></tr></thead><tbody>${rows}</tbody></table>
    ${plan.hint ? `<p class="ov-note">${esc(plan.hint)}</p>` : ''}
    ${odds}`;
}

function viewItems() {
  const c = S.comp;
  const g = c ? buildGuide(c, S.static, label) : null;
  const mine = new Set(g ? [...g.carryItems, ...g.tankItems] : []);
  const recipes = Object.values(S.static?.items || {})
    .filter((it) => it.kind === 'complet' && it.composition?.length === 2 && !it.outOfSet)
    .sort((a, b) => (mine.has(b.apiName) - mine.has(a.apiName)) || a.composition[0].localeCompare(b.composition[0]) || a.name.localeCompare(b.name, 'fr'));
  const row = (it) => `<div class="ov-recipe ${mine.has(it.apiName) ? 'hl' : ''}">${itemIcon(it.apiName)}<span>${esc(label(it))}</span><span class="parts">${itemIcon(it.composition[0])}+${itemIcon(it.composition[1])}</span></div>`;
  return `${g ? `<h5>Composants prioritaires</h5><div class="tags">${g.components.map((id) => `<span class="tag">${itemIcon(id)}${esc(item(id).name)}</span>`).join('')}</div>` : ''}
    <h5>Recettes${g ? ' (objets de ta compo en surbrillance)' : ''}</h5>
    <div class="ov-recipes">${recipes.map(row).join('') || '<div class="ov-empty">Données des objets en chargement.</div>'}</div>`;
}

function viewAugs() {
  const data = bracketData();
  const q = S.filter.toLowerCase();
  const keep = (id) => !q || label(aug(id)).toLowerCase().includes(q);
  const search = `<input class="input" id="ov-search" placeholder="Rechercher un augment…" value="${esc(S.filter)}" style="width:100%;margin-bottom:8px">`;
  if (data?.hasAugments) {
    const rows = data.augments.filter((a) => keep(a.id));
    return `${search}<table class="ov-augs"><tbody>${rows.map((a) => `<tr><td>${augIcon(a.id)}</td><td>${esc(label(aug(a.id)))}</td><td class="n ${a.avg <= 4.1 ? 'good' : a.avg >= 4.75 ? 'bad' : ''}">${nf(a.avg)}</td></tr>`).join('')}</tbody></table>
      <p class="ov-foot" style="border:0;padding:6px 0">Place moyenne quand l'augment est pris (${esc(S.app?.brackets?.find((b) => b.id === S.ov.bracket)?.label || 'tous rangs')}).</p>`;
  }
  const list = Object.values(S.static?.augments || {}).filter((a) => keep(a.apiName)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return `${search}<p class="ov-foot" style="border:0;padding:0 0 8px">Riot ne fournit pas les stats d'augments pour ce set : description uniquement.</p>
    ${list.map((a) => `<div class="ov-recipe" style="grid-template-columns:26px 1fr">${augIcon(a.apiName)}<span>${esc(label(a))}</span></div>`).join('')}`;
}

// Version Overwolf privée : compos recommandées d'après ton plateau (calculées par la fenêtre principale).
function viewReco() {
  const r = S.reco;
  if (!r || !r.comps?.length) {
    return `<div class="ov-empty">${S.live?.inGame ? 'En attente de ton plateau…<br>Les compos recommandées apparaissent dès que tu as quelques unités ou objets.' : 'Les recommandations apparaissent pendant la partie, d’après ton plateau et tes objets.'}</div>`;
  }
  return `${r.stage ? `<p class="ov-note">Manche ${esc(r.stage)} · d’après ton plateau, ton banc et tes objets</p>` : ''}
    ${r.comps.map((c, i) => `<div class="ov-reco ${c.id === S.ov?.compId ? 'on' : ''}">
      <div class="ov-reco-head"><span class="tier ${esc(c.tier)}">${esc(c.tier)}</span><div class="grow"><b>${i + 1}. ${esc(c.title)} · ${esc(c.carry)}</b><div class="sub">${String(c.top4).replace('.', ',')} % top 4 · ${String(c.pts).replace('.', ',')} pts</div></div></div>
      ${c.why ? `<p class="ov-note">${esc(c.why)}</p>` : ''}
      <button class="ov-follow" data-follow="${esc(c.id)}">${c.id === S.ov?.compId ? '✓ Compo suivie' : 'Suivre cette compo'}</button>
    </div>`).join('')}`;
}

const VIEWS = { reco: viewReco, guide: viewGuide, levels: viewLevels, items: viewItems, augs: viewAugs };

function render() {
  const data = bracketData();
  S.comp = data?.comps.find((c) => c.id === S.ov?.compId) || S.meta?.byBracket?.all?.comps.find((c) => c.id === S.ov?.compId) || null;
  const tab = VIEWS[S.ov?.tab] ? S.ov.tab : 'guide';
  document.querySelectorAll('#ov-tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  const body = $('#ov-body');
  const scroll = body.scrollTop;
  const focused = document.activeElement?.id;
  body.innerHTML = VIEWS[tab]();
  body.scrollTop = scroll;
  if (focused === 'ov-search') {
    const el = $('#ov-search');
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
  $('#ov-dot').classList.toggle('on', Boolean(S.ov?.inGame));
  $('#ov-title').textContent = S.ov?.inGame ? 'En partie · Mode partie' : 'Mode partie';
  $('#ov-foot').textContent = `${S.ov?.shortcut ? `${S.ov.shortcut} pour afficher / masquer · ` : ''}${S.live?.available ? 'Version Overwolf privée · plateau lu en direct' : 'Données statiques uniquement (règles Riot)'}`;
}

async function save(patch) {
  S.ov = { ...S.ov, ...(await api.overlaySet(patch)) };
  render();
}

// ---------- Événements ----------
$('#ov-pick').addEventListener('change', (e) => {
  if (e.target.id === 'ov-comp') save({ compId: e.target.value || null, tab: 'guide' });
  if (e.target.id === 'ov-bracket') {
    S.ov.bracket = e.target.value;
    renderPick();
    save({ bracket: e.target.value });
  }
});
$('#ov-tabs').addEventListener('click', (e) => {
  const a = e.target.closest('[data-tab]');
  if (a) save({ tab: a.dataset.tab });
});
$('#ov-body').addEventListener('click', (e) => {
  const f = e.target.closest('[data-follow]');
  if (f) save({ compId: f.dataset.follow, tab: 'guide' });
});
$('#ov-body').addEventListener('change', (e) => {
  const key = e.target.dataset.check;
  if (key) save({ checks: { ...(S.ov.checks || {}), [key]: e.target.checked } });
});
$('#ov-body').addEventListener('input', (e) => {
  if (e.target.id === 'ov-search') {
    S.filter = e.target.value;
    render();
  }
});
document.querySelector('.ov-actions').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'opacity-') save({ opacity: Math.max(0.4, (S.ov.opacity || 1) - 0.1) });
  if (act === 'opacity+') save({ opacity: Math.min(1, (S.ov.opacity || 1) + 0.1) });
  if (act === 'main') api.openMain('meta');
  if (act === 'close') (isDesktop ? api.overlayToggle(false) : window.close());
});

api.on('overlay', (ov) => {
  const changedPick = ov.compId !== S.ov?.compId || ov.bracket !== S.ov?.bracket;
  S.ov = { ...S.ov, ...ov };
  if (changedPick) renderPick();
  render();
});
api.on('meta', (m) => {
  S.meta = m;
  renderPick();
  render();
});
api.on('reco', (r) => {
  S.reco = r;
  if (S.ov?.tab === 'reco') render();
});
api.on('board', (b) => {
  const was = Boolean(S.live?.available);
  S.live = b;
  if (!was && b?.available) document.getElementById('ov-reco-tab')?.classList.remove('hidden');
  if (S.ov?.tab === 'reco') render();
});
api.on('static', (d) => {
  S.static = d;
  render();
});
api.on('content', (d) => {
  S.content = d;
  render();
});
// Version web : synchronisation avec l'onglet principal.
window.addEventListener('storage', async (e) => {
  if (e.key === 'reco') {
    try {
      S.reco = JSON.parse(e.newValue || 'null');
    } catch {
      S.reco = null;
    }
    if (S.ov?.tab === 'reco') render();
    return;
  }
  if (e.key !== 'overlay') return;
  S.ov = { ...S.ov, ...(await api.overlayGet()) };
  renderPick();
  render();
});

(async function boot() {
  [S.static, S.meta, S.app, S.ov, S.content] = await Promise.all([api.static(), api.meta(), api.state(), api.overlayGet(), api.content().catch(() => null)]);
  S.live = await api.liveBoard().catch(() => null);
  if (S.live?.available) document.getElementById('ov-reco-tab')?.classList.remove('hidden');
  try {
    S.reco = isDesktop ? null : JSON.parse(localStorage.getItem('reco') || 'null');
  } catch { /* stockage indisponible */ }
  renderPick();
  render();
})();

