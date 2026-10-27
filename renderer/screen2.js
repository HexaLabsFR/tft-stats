// Écran 2 : le guide de la compo suivie en grand, pour un deuxième écran.
// Conformité Riot (politique TFT) : uniquement des informations choisies AVANT la partie
// (guide, plan de niveaux, placement, recettes, augments conseillés). Rien n'est lu dans la partie,
// à part « une partie TFT est-elle en cours ? » (même source que le mode partie).
import { api, isDesktop } from './api.js';
import { buildGuide, compType, levelPlan, placement, boardHtml } from './guide.js';

const S = { static: null, meta: null, app: null, ov: null, content: null };
const $ = (s) => document.querySelector(s);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v, d = 1) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const initials = (n = '?') => n.replace(/[^\p{L}\p{N} ]/gu, '').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const label = (x) => x?.name || '';
const pretty = (id = '') => String(id).replace(/^(TFT\d*|DA)_(\d+_)?(Item_|Augment_)?/i, '').replace(/\d+(?=_|$)/g, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
const champ = (id) => S.static?.champions?.[id] || { apiName: id, name: pretty(id), cost: 0, traits: [], icon: '' };
const trait = (id) => S.static?.traits?.[id] || { apiName: id, name: pretty(id), icon: '' };
const item = (id) => S.static?.items?.[id] || { apiName: id, name: pretty(id), icon: '', composition: [] };
const aug = (id) => S.static?.augments?.[id] || { apiName: id, name: pretty(id), icon: '' };
const img = (src, alt) => (src ? `<img src="${esc(src)}" alt="" loading="lazy" data-fallback="${esc(initials(alt))}">` : esc(initials(alt)));
const champIcon = (id, size = '') => `<span class="ic champ ${size} cost-${champ(id).cost || 1}" data-tip="champ" data-id="${esc(id)}">${img(champ(id).icon, champ(id).name)}</span>`;
const itemIcon = (id, lg) => `<span class="ic item ${lg ? 'lg' : ''}" data-tip="item" data-id="${esc(id)}">${img(item(id).icon, item(id).name)}</span>`;
const augIcon = (id) => `<span class="ic aug" data-tip="aug" data-id="${esc(id)}">${img(aug(id).icon, aug(id).name)}</span>`;
const compName = (c) => `${label(trait(c.main))} · ${label(champ(c.carry))}`;
const bracketData = () => S.meta?.byBracket?.[S.ov?.bracket || 'all'] || S.meta?.byBracket?.all || null;
const DIFF = { lvl8: ['Facile', 'easy'], reroll: ['Moyen', 'medium'], fast9: ['Difficile', 'hard'] };

document.addEventListener('error', (e) => {
  const t = e.target;
  if (t.tagName === 'IMG' && t.dataset.fallback !== undefined) t.replaceWith(document.createTextNode(t.dataset.fallback));
}, true);

// Infobulles
const tip = $('#tooltip');
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-tip]');
  if (!el) return tip.classList.add('hidden');
  const src = { champ, item, aug }[el.dataset.tip]?.(el.dataset.id);
  if (!src) return;
  const recipe = el.dataset.tip === 'item' && src.composition?.length === 2 ? `Recette : ${src.composition.map((c) => item(c).name).join(' + ')}` : '';
  const desc = el.dataset.tip === 'champ' ? src.traits.map((t) => label(trait(t))).join(' · ') : [recipe, src.stats, src.desc].filter(Boolean).join('\n\n');
  tip.innerHTML = `<div class="t">${esc(label(src))}</div>${desc ? `<div class="d">${esc(desc).slice(0, 500)}</div>` : ''}`;
  tip.classList.remove('hidden');
  const r = el.getBoundingClientRect();
  tip.style.left = `${Math.max(6, Math.min(innerWidth - tip.offsetWidth - 6, r.left + r.width / 2 - tip.offsetWidth / 2))}px`;
  tip.style.top = `${r.top - tip.offsetHeight - 6 < 6 ? r.bottom + 6 : r.top - tip.offsetHeight - 6}px`;
});

function renderPick() {
  const data = bracketData();
  const comps = [...(data?.comps || [])].sort((a, b) => a.score - b.score);
  const brackets = [['all', 'Tous rangs'], ...(S.app?.brackets || []).map((b) => [b.id, b.label])].filter(([id]) => S.meta?.byBracket?.[id]);
  $('#s2-pick').innerHTML = `
    <select class="input" id="s2-comp" aria-label="Compo suivie">
      <option value="">Choisir la compo à suivre…</option>
      ${comps.map((c) => `<option value="${esc(c.id)}" ${c.id === S.ov?.compId ? 'selected' : ''}>${c.tier} · ${esc(compName(c))}</option>`).join('')}
    </select>
    <select class="input" id="s2-bracket" aria-label="Rang">${brackets.map(([id, l]) => `<option value="${id}" ${id === (S.ov?.bracket || 'all') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}

function card(title, body, cls = '') {
  return `<section class="s2-card ${cls}"><h2>${title}</h2>${body}</section>`;
}

function viewEmpty() {
  const data = bracketData();
  const comps = [...(data?.comps || [])].filter((c) => c.tier !== 'D').sort((a, b) => a.score - b.score).slice(0, 8);
  return `<div class="s2-empty">
    <h1>Choisis la compo à suivre</h1>
    <p>Elle s’affichera ici en grand pendant toute la partie : plan à cocher, placement, niveaux et objets.</p>
    <div class="s2-choices">${comps.map((c) => {
      const t = compType(c, champ(c.carry).cost || 4);
      return `<button class="s2-choice" data-follow="${esc(c.id)}"><span class="tier ${c.tier}">${c.tier}</span><span class="grow"><b>${esc(compName(c))}</b><span>${esc(t.label)} · ${nf(c.top4, 0)} % top 4</span></span>${champIcon(c.carry, 'sm')}</button>`;
    }).join('') || '<p>Statistiques en cours de chargement…</p>'}</div>
  </div>`;
}

function viewComp(c) {
  const g = buildGuide(c, S.static, label);
  const type = g.type;
  const stars = Object.fromEntries(c.units.map((u) => [u.id, Math.round(u.star || 1)]));
  const checks = S.ov.checks || {};
  let total = 0;
  let done = 0;

  // Plan à cocher (mêmes cases que le mode partie : cocher ici coche là-bas)
  const stages = g.stages.map((st, si) => `<div class="s2-stage"><h3>${esc(st.stage)} <span>${esc(st.rounds)}</span></h3>${st.steps.map((step, i) => {
    if (step.kind === 'note') return `<p class="s2-note">${esc(step.text)}</p>`;
    const key = `${si}-${i}`;
    total++;
    if (checks[key]) done++;
    let ids = '';
    if (step.kind === 'units' || step.kind === 'final') ids = `<div class="icons wrap">${step.ids.map((id) => champIcon(id, 'sm')).join('')}</div>`;
    else if (step.kind === 'items') ids = `<div class="icons wrap">${step.ids.map((id) => itemIcon(id)).join('')}</div>`;
    else if (step.kind === 'augs') ids = `<div class="icons wrap">${step.ids.map((id) => augIcon(id)).join('')}</div>`;
    return `<label class="s2-step ${checks[key] ? 'done' : ''}"><input type="checkbox" data-check="${key}" ${checks[key] ? 'checked' : ''}><div><p>${esc(step.text)}</p>${ids}</div></label>`;
  }).join('')}</div>`).join('');

  // Plan de niveaux par série
  const plan = levelPlan(type, S.static, champ(c.carry).cost);
  const rows = plan.rows.map((r) => {
    const same = r.win === r.mixed && r.mixed === r.lose;
    return `<tr class="${r.key ? 'key' : ''}"><td class="rd">${esc(r.round)}</td>${same ? `<td colspan="3">${esc(r.win)}</td>` : `<td>${esc(r.win)}</td><td>${esc(r.mixed)}</td><td>${esc(r.lose)}</td>`}</tr>`;
  }).join('');
  const ref = S.static?.reference;
  const odds = ref && !ref.stale
    ? `<table class="s2-odds"><thead><tr><th>Niv.</th>${[1, 2, 3, 4, 5].map((k) => `<th><span class="cost-dot cost-${k}"></span>${k}</th>`).join('')}</tr></thead>
      <tbody>${[4, 5, 6, 7, 8, 9, 10].filter((l) => ref.odds[l]).map((l) => `<tr class="${l === plan.rollLevel ? 'hl' : ''}"><td>${l}</td>${ref.odds[l].map((v) => `<td>${v ? `${v} %` : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : '';

  // Objets et recettes
  const recipe = (id) => {
    const p = item(id).composition || [];
    return `<div class="s2-recipe">${itemIcon(id, true)}<span>${esc(item(id).name)}</span>${p.length === 2 ? `<span class="parts">${itemIcon(p[0])}<i>+</i>${itemIcon(p[1])}</span>` : ''}</div>`;
  };
  const augStages = (c.augStages || []).map((list, i) => (list.length ? `<div class="s2-aug"><span>${['2-1', '3-2', '4-2'][i]}</span><div class="icons wrap">${list.slice(0, 4).map((a) => augIcon(a.id)).join('')}</div></div>` : '')).join('');

  const [diffTxt, diffCls] = DIFF[type.id] || ['', ''];
  const board = boardHtml(placement(c, S.static, g, { label }), { champ, img, itemIcon, esc });
  return `<div class="s2-head">
      <span class="tier ${c.tier}">${c.tier}</span>
      <div><h1>${esc(compName(c))}</h1>
        <div class="ctags"><span class="ctag ${type.id === 'reroll' ? 'reroll' : 'boost'}">${esc(type.label)}</span>${diffTxt ? `<span class="ctag ${diffCls}">${diffTxt}</span>` : ''}<span class="s2-stat">${nf(c.top4, 0)} % top 4 · place moy. ${nf(c.avg, 2)}</span></div></div>
      <div class="s2-progress" title="Étapes cochées"><b>${done}/${total}</b><span><i style="width:${total ? (done / total) * 100 : 0}%"></i></span></div>
    </div>
    <div class="s2-grid">
      ${card('Plan à cocher', stages, 's2-plan')}
      <div class="s2-col">
        ${card('Placement conseillé', `${board}<p class="s2-note">Inverse le plateau si l’adversaire le plus fort est du même côté que ton carry.</p>`, 's2-board')}
        ${card('Objets', `<p class="s2-sub">${esc(champ(c.carry).name)} · carry</p>${g.carryItems.map(recipe).join('')}
          ${g.tankItems.length ? `<p class="s2-sub">${esc(champ(g.tank).name)} · tank</p>${g.tankItems.map(recipe).join('')}` : ''}
          <p class="s2-sub">Composants prioritaires</p><div class="icons wrap">${g.components.map((id) => itemIcon(id, true)).join('')}</div>`)}
      </div>
      <div class="s2-col">
        ${card('Niveaux selon ta série', `<table class="plan s2-plan-t"><thead><tr><th></th><th>Victoires</th><th>Mixte</th><th>Défaites</th></tr></thead><tbody>${rows}</tbody></table>
          ${plan.hint ? `<p class="s2-note">${esc(plan.hint)}</p>` : ''}`)}
        ${odds ? card('Chances en boutique', odds) : ''}
        ${augStages ? card('Augments conseillés', `${augStages}<p class="s2-note">Les plus réussis avec cette compo dans ton rang, avant la partie.</p>`) : ''}
      </div>
    </div>`;
}

function render() {
  const data = bracketData();
  const c = data?.comps.find((x) => x.id === S.ov?.compId) || S.meta?.byBracket?.all?.comps.find((x) => x.id === S.ov?.compId) || null;
  const body = $('#s2-body');
  const scroll = body.scrollTop;
  body.innerHTML = c ? viewComp(c) : viewEmpty();
  body.scrollTop = scroll;
  const st = $('#s2-state');
  st.textContent = S.ov?.inGame ? '● En partie' : 'Écran 2';
  st.classList.toggle('on', Boolean(S.ov?.inGame));
}

async function save(patch) {
  S.ov = { ...S.ov, ...(await api.overlaySet(patch)) };
  renderPick();
  render();
}

$('#s2-pick').addEventListener('change', (e) => {
  if (e.target.id === 's2-comp') save({ compId: e.target.value || null });
  if (e.target.id === 's2-bracket') save({ bracket: e.target.value });
});
$('#s2-body').addEventListener('click', (e) => {
  const f = e.target.closest('[data-follow]');
  if (f) save({ compId: f.dataset.follow });
});
$('#s2-body').addEventListener('change', (e) => {
  const key = e.target.dataset.check;
  if (key) save({ checks: { ...(S.ov.checks || {}), [key]: e.target.checked } });
});
$('#s2-close').addEventListener('click', () => (isDesktop ? api.screen2Toggle(false) : window.close()));

api.on('overlay', (ov) => {
  const changed = ov.compId !== S.ov?.compId || ov.bracket !== S.ov?.bracket;
  S.ov = { ...S.ov, ...ov };
  if (changed) renderPick();
  render();
});
api.on('meta', (m) => {
  S.meta = m;
  renderPick();
  render();
});
api.on('static', (d) => {
  S.static = d;
  render();
});
window.addEventListener('storage', async (e) => {
  if (e.key !== 'overlay') return;
  S.ov = { ...S.ov, ...(await api.overlayGet()) };
  renderPick();
  render();
});

(async function boot() {
  [S.static, S.meta, S.app, S.ov, S.content] = await Promise.all([api.static(), api.meta(), api.state(), api.overlayGet(), api.content().catch(() => null)]);
  renderPick();
  render();
})();
