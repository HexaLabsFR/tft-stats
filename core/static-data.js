'use strict';
/**
 * Données statiques TFT en français (champions, traits, objets, augments)
 * depuis CommunityDragon. Rechargées automatiquement à chaque nouveau patch.
 */
const fs = require('fs');
const path = require('path');

const CDRAGON = 'https://raw.communitydragon.org/latest';
const REFRESH_MS = 6 * 60 * 60 * 1000;
// Incrémenté quand la structure change : force un nouveau téléchargement.
const FORMAT = 3; // 3 : doublons fusionnés (versions DA_ et anciennes versions d'un même objet ou augment)

const COMPONENTS = new Set([
  'TFT_Item_BFSword', 'TFT_Item_RecurveBow', 'TFT_Item_NeedlesslyLargeRod',
  'TFT_Item_TearOfTheGoddess', 'TFT_Item_ChainVest', 'TFT_Item_NegatronCloak',
  'TFT_Item_GiantsBelt', 'TFT_Item_SparringGloves', 'TFT_Item_Spatula', 'TFT_Item_FryingPan'
]);

function iconUrl(p) {
  if (!p) return '';
  return `${CDRAGON}/game/${p.toLowerCase().replace(/\.(tex|dds)$/, '.png')}`;
}

const roundNum = (v) => Math.round(v * 100) / 100;
const fmtNum = (v) => String(roundNum(v)).replace('.', ',');

/** Valeurs d'un sort par étoile (1★/2★/3★) : « 350/400/475 », ou une seule si identiques. */
function starValues(value, pct) {
  const vals = [1, 2, 3].map((i) => value?.[i]).filter((v) => typeof v === 'number').map((v) => (pct ? v * 100 : v));
  if (!vals.length) return null;
  return vals.every((v) => roundNum(v) === roundNum(vals[0])) ? fmtNum(vals[0]) : vals.map(fmtNum).join('/');
}

/**
 * Remplace les variables @Var@ par leurs valeurs et nettoie le balisage.
 * effects : { Nom: valeur } (synergies, objets) ou [{ name, value: [..] }] (sorts, valeurs par étoile).
 * Les valeurs calculées par le jeu et absentes des données deviennent « X ».
 */
function formatDesc(desc, effects = {}) {
  if (!desc) return '';
  const lower = {};
  if (Array.isArray(effects)) {
    for (const v of effects) if (v?.name) lower[v.name.toLowerCase()] = { star: v.value };
  } else {
    for (const [k, v] of Object.entries(effects || {})) lower[k.toLowerCase()] = v;
  }
  let out = desc.replace(/@([\w.:]+?)(\*100)?@/g, (_, key, pct) => {
    if (/^TFTUnitProperty/i.test(key)) return '';
    let v = lower[key.toLowerCase()];
    if (v && typeof v === 'object' && 'star' in v) return starValues(v.star, pct) ?? 'X';
    if (v === undefined || v === null || typeof v === 'object') return 'X';
    if (typeof v === 'number') v = fmtNum(pct ? v * 100 : v);
    return String(v);
  });
  out = out
    .replace(/\r/g, '')
    .replace(/\\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/%i:[^%]+%/g, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ +([.,:)])/g, '$1')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out;
}

// Statistiques de base d'un objet (le jeu les affiche en icônes, pas dans le texte).
const ITEM_STATS = [
  ['AD', "dégâts d'attaque", 'ratio'], ['AP', 'puissance', 'flat'], ['AS', "vitesse d'attaque", 'pct'],
  ['Armor', 'armure', 'flat'], ['MagicResist', 'résistance magique', 'flat'], ['Health', 'PV', 'flat'],
  ['Mana', 'mana', 'flat'], ['CritChance', 'chances de coup critique', 'pct'], ['Omnivamp', 'omnivampirisme', 'ratio']
];
function itemStats(effects = {}) {
  const out = [];
  for (const [key, label, kind] of ITEM_STATS) {
    const v = effects?.[key];
    if (typeof v !== 'number' || !v) continue;
    if (kind === 'ratio' && Math.abs(v) < 1) out.push(`+${fmtNum(v * 100)} % ${label}`);
    else if (kind === 'pct') out.push(`+${fmtNum(v)} % ${label}`);
    else out.push(`+${fmtNum(v)} ${label}`);
  }
  return out.join(' · ');
}

/** Description d'une synergie : chaque ligne <row> reçoit les valeurs de son palier. */
function formatTraitDesc(t) {
  const effects = t.effects || [];
  const fill = (text, e = {}) => formatDesc(
    text.replace(/@MinUnits@/gi, String(e.minUnits ?? 'X')).replace(/@MaxUnits@/gi, String(e.maxUnits ?? 'X')),
    e.variables
  );
  let desc = t.desc || '';
  // <expandRow> : une ligne répétée pour chaque palier
  desc = desc.replace(/<expandRow>([\s\S]*?)<\/expandRow>/gi, (_, row) => effects.map((e) => `<row>${row}</row>`).join('<br>'));
  let i = 0;
  const rows = [];
  const head = desc.replace(/<row>([\s\S]*?)<\/row>/gi, (_, row) => {
    rows.push(fill(row, effects[i++]));
    return '';
  });
  return [fill(head, effects[0]), ...rows].filter(Boolean).join('\n');
}

const isAugLike = (it) => /Augment/i.test(it.apiName);

function itemKind(apiName) {
  if (COMPONENTS.has(apiName)) return 'composant';
  // Jetons de mécanique (enclumes, Artefactification, objets aléatoires…) : pas des objets portés.
  if (/Assist_|Artifactinate|Anvil|Reforger|Remover|Duplicator|Neutralizer|RandomOrnn|LesserDuplicator/i.test(apiName)) return 'consommable';
  if (/Radiant/i.test(apiName)) return 'radieux';
  if (/Artifact|Ornn/i.test(apiName)) return 'artefact';
  if (/Emblem/i.test(apiName)) return 'embleme';
  if (/Support|Shimmerscale|Zaun|Bilgewater/i.test(apiName)) return 'special';
  return 'complet';
}

function augmentTier(a) {
  const s = `${a.icon || ''} ${a.apiName}`;
  if (/(_III|3)\.(tex|png|dds)|Prismatic|_Plus_Plus|\+\+/i.test(s)) return 'prismatique';
  if (/(_II|2)\.(tex|png|dds)|Gold/i.test(s)) return 'or';
  if (/(_I|1)\.(tex|png|dds)|Silver/i.test(s)) return 'argent';
  return 'inconnu';
}

function prettyApiName(apiName = '') {
  return apiName
    .replace(/^(TFT\d*|DA)_?(\d+_)?(Augment_|Item_|Set\d+_)?/i, '')
    .replace(/\d+(?=_|$)/g, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
}

/**
 * Clé tolérante d'un identifiant : « DA_18_Maokai », « TFT18_Maokai » et « DA_Maokai18 » donnent « maokai ».
 * Les identifiants du set 18 ont changé de format ; si l'API de match n'emploie pas exactement
 * celui de CommunityDragon, on retrouve quand même le nom français et l'image.
 */
function idKey(id = '') {
  return String(id).toLowerCase().replace(/^(tft\d*|da)_/, '').replace(/^set\d+_/, '').replace(/\d+/g, '').replace(/_/g, '');
}
const LOOSE = /(base|small|big|mini|ap|ad)$/;

function buildAliases(map) {
  const out = {};
  for (const id of Object.keys(map)) {
    const k = idKey(id);
    if (!(k in out)) out[k] = id;
    const loose = k.replace(LOOSE, '');
    if (loose && loose !== k && !(loose in out)) out[loose] = id;
  }
  return out;
}

/**
 * Fusionne les entrées qui désignent le même objet ou augment (même nom affiché) :
 * versions DA_ sans description, anciennes versions d'un set précédent, variantes techniques.
 * Garde l'entrée la plus complète, complète ses champs vides avec les autres et
 * renvoie { idSupprimé: idGardé } pour que les parties Riot comptent sur une seule ligne.
 */
function mergeDuplicates(map, keyOf) {
  const quality = (e) =>
    (/^DA_/i.test(e.apiName) ? 0 : 1000) +
    (/^TFT_Item_[A-Za-z]+$/.test(e.apiName) ? 100 : 0) +
    (e.desc ? 50 + Math.min(40, e.desc.length / 10) : 0) +
    (e.outOfSet ? 0 : 20) +
    (/_(HR|Plus|Upgrade)$/i.test(e.apiName) ? 0 : 5);
  const groups = new Map();
  for (const e of Object.values(map)) {
    const k = keyOf(e);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const merged = {};
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => quality(b) - quality(a) || a.apiName.length - b.apiName.length);
    const keep = list[0];
    for (const other of list.slice(1)) {
      for (const f of ['desc', 'en', 'icon', 'stats']) if (!keep[f] && other[f]) keep[f] = other[f];
      if (keep.tier === 'inconnu' && other.tier && other.tier !== 'inconnu') keep.tier = other.tier;
      if ((!keep.composition || !keep.composition.length) && other.composition?.length) keep.composition = other.composition;
      if (keep.outOfSet && !other.outOfSet) delete keep.outOfSet;
      merged[other.apiName] = keep.apiName;
      delete map[other.apiName];
    }
  }
  return merged;
}

/** Noms anglais par apiName, pour l'affichage « Français (English) ». */
function englishNames(rawEn) {
  const names = {};
  if (!rawEn) return names;
  for (const it of rawEn.items || []) if (it.apiName && it.name) names[it.apiName] = it.name;
  for (const set of rawEn.setData || []) {
    for (const c of set.champions || []) if (c.apiName && c.name) names[c.apiName] = c.name;
    for (const t of set.traits || []) if (t.apiName && t.name) names[t.apiName] = t.name;
  }
  return names;
}

/** Transforme le JSON brut de CommunityDragon en structure compacte. */
function buildStatic(raw, version, rawEn) {
  const en = englishNames(rawEn);
  const sets = (raw.setData || []).filter(
    (s) => /^TFTSet\d+$/i.test(s.mutator || '') && (s.champions || []).length
  );
  sets.sort((a, b) => (b.number || 0) - (a.number || 0));
  const set = sets[0];
  if (!set) throw new Error('Set TFT introuvable dans les données CommunityDragon.');

  const traits = {};
  const traitByName = {};
  for (const t of set.traits || []) {
    traits[t.apiName] = {
      apiName: t.apiName,
      name: t.name,
      en: en[t.apiName] || '',
      desc: formatTraitDesc(t),
      icon: iconUrl(t.icon),
      breakpoints: (t.effects || []).map((e) => ({ min: e.minUnits, max: e.maxUnits, style: e.style }))
    };
    traitByName[t.name] = t.apiName;
  }

  const champions = {};
  for (const c of set.champions || []) {
    if (!c.apiName || !c.traits?.length) continue; // ignore les unités non jouables
    const st = c.stats || {};
    const vars = (c.ability?.variables || []).filter((v) => v?.name && Array.isArray(v.value));
    champions[c.apiName] = {
      apiName: c.apiName,
      name: c.name,
      en: en[c.apiName] || '',
      cost: c.cost,
      traits: c.traits.map((n) => traitByName[n] || n),
      icon: iconUrl(c.squareIcon || c.tileIcon || c.icon),
      stats: c.stats
        ? { hp: st.hp, ad: st.damage, as: st.attackSpeed, armor: st.armor, mr: st.magicResist, range: st.range, mana: st.mana, mana0: st.initialMana, crit: st.critChance }
        : null,
      ability: c.ability
        ? {
          name: c.ability.name,
          desc: formatDesc(c.ability.desc, vars),
          values: vars.map((v) => ({ name: v.name, v: starValues(v.value) })).filter((v) => v.v !== null).slice(0, 8)
        }
        : null
    };
  }
  // Formes d'un même champion (ex. « Lux (Fæ) ») : pas des unités de boutique à part.
  const byName = {};
  for (const c of Object.values(champions)) byName[c.name] = c.apiName;
  for (const c of Object.values(champions)) {
    const m = c.name.match(/^(.+) \((.+)\)$/);
    if (m && byName[m[1]] && byName[m[1]] !== c.apiName) {
      c.variantOf = byName[m[1]];
      c.form = m[2];
    }
  }
  const shopCounts = [1, 2, 3, 4, 5].map((cost) => Object.values(champions).filter((c) => c.cost === cost && !c.variantOf).length);

  const setItemNames = new Set(set.items || []);
  const setAugNames = new Set(set.augments || []);
  const items = {};
  const augments = {};
  for (const it of raw.items || []) {
    if (!it.apiName || !it.name) continue;
    const isAug = /Augment/i.test(it.apiName) || setAugNames.has(it.apiName);
    const entry = {
      apiName: it.apiName,
      name: it.name,
      en: en[it.apiName] || '',
      desc: formatDesc(it.desc, it.effects),
      stats: isAugLike(it) ? '' : itemStats(it.effects),
      icon: iconUrl(it.icon),
      composition: it.composition || []
    };
    if (isAug) {
      if (setAugNames.size && !setAugNames.has(it.apiName)) continue;
      entry.tier = augmentTier(it);
      augments[it.apiName] = entry;
    } else {
      if (setItemNames.size && !setItemNames.has(it.apiName) && !COMPONENTS.has(it.apiName)) {
        // Garde quand même l'objet : l'API de match peut le renvoyer.
        entry.outOfSet = true;
      }
      entry.kind = itemKind(it.apiName);
      items[it.apiName] = entry;
    }
  }

  // Composants des recettes DA_ : on pointe vers les vrais composants.
  const normName = (n) => String(n || '').trim().toLowerCase();
  const mergedItems = mergeDuplicates(items, (it) => (it.kind === 'consommable' ? `c:${normName(it.name)}` : normName(it.name)));
  const mergedAugs = mergeDuplicates(augments, (a) => normName(a.name));
  for (const it of Object.values(items)) {
    if (it.composition?.length) it.composition = it.composition.map((c) => mergedItems[c] || c);
  }
  // Un composant fusionné garde son type « composant ».
  for (const id of COMPONENTS) if (items[id]) items[id].kind = 'composant';

  const aliases = { champions: buildAliases(champions), traits: buildAliases(traits), items: buildAliases(items), augments: buildAliases(augments) };
  for (const [from, to] of Object.entries(mergedItems)) aliases.items[idKey(from)] = to;
  for (const [from, to] of Object.entries(mergedAugs)) aliases.augments[idKey(from)] = to;

  return {
    format: FORMAT,
    version,
    hasEn: Boolean(rawEn),
    fetchedAt: Date.now(),
    setNumber: set.number,
    // CommunityDragon renvoie parfois un nom de set erroné (« Set10 » pour le set 18).
    setName: /^Set\d+$/i.test(set.name || '') ? '' : set.name || '',
    champions,
    traits,
    items,
    augments,
    shopCounts,
    merged: { items: mergedItems, augments: mergedAugs },
    aliases
  };
}

class StaticData {
  constructor({ dataDir, fetchImpl, log = () => {} }) {
    this.file = path.join(dataDir, 'static-fr.json');
    this.fetch = fetchImpl || globalThis.fetch.bind(globalThis);
    this.log = log;
    this.data = null;
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      /* premier lancement */
    }
  }

  async remoteVersion() {
    const res = await this.fetch(`${CDRAGON}/content-metadata.json`);
    if (!res.ok) throw new Error(`CommunityDragon indisponible (${res.status})`);
    const meta = await res.json();
    return meta.version || 'inconnue';
  }

  /** Retourne true si les données ont changé (nouveau patch). */
  async refresh({ force = false } = {}) {
    // Anciennes données (sans noms anglais, sans stats…) : on retélécharge.
    if (this.data && (!this.data.hasEn || this.data.format !== FORMAT)) force = true;
    const fresh = this.data && Date.now() - this.data.fetchedAt < REFRESH_MS;
    if (fresh && !force) return false;
    let version;
    try {
      version = await this.remoteVersion();
    } catch (err) {
      if (this.data) {
        this.log(`Données statiques : ${err.message}, cache conservé.`);
        return false;
      }
      throw err;
    }
    if (this.data && this.data.version === version && !force) {
      this.data.fetchedAt = Date.now();
      this._save();
      return false;
    }
    this.log(`Téléchargement des données TFT en français (patch ${version})…`);
    const res = await this.fetch(`${CDRAGON}/cdragon/tft/fr_fr.json`);
    if (!res.ok) throw new Error(`Téléchargement CommunityDragon impossible (${res.status})`);
    const raw = await res.json();
    let rawEn = null;
    try {
      const resEn = await this.fetch(`${CDRAGON}/cdragon/tft/en_us.json`);
      if (resEn.ok) rawEn = await resEn.json();
    } catch (err) {
      this.log(`Noms anglais indisponibles : ${err.message}`);
    }
    this.data = buildStatic(raw, version, rawEn);
    this._save();
    this.log(`Set ${this.data.setNumber} « ${this.data.setName} » chargé.`);
    return true;
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data));
  }

  /** Identifiant tel que connu de CommunityDragon (gère les variations de format). */
  canon(kind, id) {
    const map = this.data?.[kind];
    if (!map || !id || map[id]) return id;
    if (this._canonData !== this.data) {
      this._canonData = this.data;
      this._canon = new Map();
    }
    const key = `${kind}:${id}`;
    if (this._canon.has(key)) return this._canon.get(key);
    const direct = this.data.merged?.[kind]?.[id];
    if (direct) {
      this._canon.set(key, direct);
      return direct;
    }
    const al = this.data.aliases?.[kind] || {};
    const k = idKey(id);
    const found = al[k] || al[k.replace(LOOSE, '')] || id;
    this._canon.set(key, found);
    return found;
  }
  champion(id) {
    return this.data?.champions[this.canon('champions', id)] || { apiName: id, name: prettyApiName(id), cost: 0, traits: [], icon: '' };
  }
  trait(id) {
    return this.data?.traits[this.canon('traits', id)] || { apiName: id, name: prettyApiName(id), icon: '', breakpoints: [] };
  }
  item(id) {
    return this.data?.items[this.canon('items', id)] || { apiName: id, name: prettyApiName(id), icon: '', kind: itemKind(id) };
  }
  augment(id) {
    return this.data?.augments[this.canon('augments', id)] || { apiName: id, name: prettyApiName(id), icon: '', tier: 'inconnu' };
  }
}

module.exports = { StaticData, buildStatic, formatDesc, iconUrl, itemKind, prettyApiName, idKey };
