'use strict';
/**
 * Données statiques TFT en français (champions, traits, objets, augments)
 * depuis CommunityDragon. Rechargées automatiquement à chaque nouveau patch.
 */
const fs = require('fs');
const path = require('path');

const CDRAGON = 'https://raw.communitydragon.org/latest';
const REFRESH_MS = 6 * 60 * 60 * 1000;

const COMPONENTS = new Set([
  'TFT_Item_BFSword', 'TFT_Item_RecurveBow', 'TFT_Item_NeedlesslyLargeRod',
  'TFT_Item_TearOfTheGoddess', 'TFT_Item_ChainVest', 'TFT_Item_NegatronCloak',
  'TFT_Item_GiantsBelt', 'TFT_Item_SparringGloves', 'TFT_Item_Spatula', 'TFT_Item_FryingPan'
]);

function iconUrl(p) {
  if (!p) return '';
  return `${CDRAGON}/game/${p.toLowerCase().replace(/\.(tex|dds)$/, '.png')}`;
}

/** Remplace les variables @Var@ par leurs valeurs et nettoie le balisage. */
function formatDesc(desc, effects = {}) {
  if (!desc) return '';
  const lower = {};
  for (const [k, v] of Object.entries(effects || {})) lower[k.toLowerCase()] = v;
  let out = desc.replace(/@([\w.]+?)(\*100)?@/g, (_, key, pct) => {
    let v = lower[key.toLowerCase()];
    if (v === undefined || v === null) return '?';
    if (typeof v === 'number') {
      if (pct) v *= 100;
      v = Math.round(v * 100) / 100;
    }
    return String(v);
  });
  out = out
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/%i:[^%]+%/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out;
}

function itemKind(apiName) {
  if (COMPONENTS.has(apiName)) return 'composant';
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
    .replace(/^TFT\d*_?(Augment_|Item_|Set\d+_)?/i, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
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
      desc: formatDesc(t.desc, (t.effects?.[0] || {}).variables),
      icon: iconUrl(t.icon),
      breakpoints: (t.effects || []).map((e) => ({ min: e.minUnits, max: e.maxUnits, style: e.style }))
    };
    traitByName[t.name] = t.apiName;
  }

  const champions = {};
  for (const c of set.champions || []) {
    if (!c.apiName || !c.traits?.length) continue; // ignore les unités non jouables
    champions[c.apiName] = {
      apiName: c.apiName,
      name: c.name,
      en: en[c.apiName] || '',
      cost: c.cost,
      traits: c.traits.map((n) => traitByName[n] || n),
      icon: iconUrl(c.squareIcon || c.tileIcon || c.icon),
      ability: c.ability ? { name: c.ability.name, desc: formatDesc(c.ability.desc) } : null
    };
  }

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

  return {
    version,
    hasEn: Boolean(rawEn),
    fetchedAt: Date.now(),
    setNumber: set.number,
    setName: set.name,
    champions,
    traits,
    items,
    augments
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
    // Anciennes données sans noms anglais : on retélécharge.
    if (this.data && !this.data.hasEn) force = true;
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

  champion(id) {
    return this.data?.champions[id] || { apiName: id, name: prettyApiName(id), cost: 0, traits: [], icon: '' };
  }
  trait(id) {
    return this.data?.traits[id] || { apiName: id, name: prettyApiName(id), icon: '', breakpoints: [] };
  }
  item(id) {
    return this.data?.items[id] || { apiName: id, name: prettyApiName(id), icon: '', kind: itemKind(id) };
  }
  augment(id) {
    return this.data?.augments[id] || { apiName: id, name: prettyApiName(id), icon: '', tier: 'inconnu' };
  }
}

module.exports = { StaticData, buildStatic, formatDesc, iconUrl, itemKind, prettyApiName };
