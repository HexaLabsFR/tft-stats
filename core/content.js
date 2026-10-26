'use strict';
/**
 * Contenu éditorial d'HexaRise : fiches des guides, avis des experts par compo, glossaire,
 * et veille des guides (nouveaux ou modifiés par leurs auteurs).
 * Livré avec l'application et mis à jour depuis le dépôt GitHub, sans nouvelle version.
 */
const fs = require('fs');
const path = require('path');

const FILES = ['guides', 'glossary', 'guides-watch'];
const REMOTE = 'https://raw.githubusercontent.com/ZayKololo/tft-stats/main/content';
const REFRESH_MS = 6 * 60 * 60 * 1000;
const BUILTIN_DIR = path.join(__dirname, '..', 'content');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Le plus récent des deux (champ « updated » ou « checkedAt »). */
function newest(a, b) {
  if (!a) return b;
  if (!b) return a;
  const da = a.updated || a.checkedAt || '';
  const db = b.updated || b.checkedAt || '';
  return db > da ? b : a;
}

function valid(name, d) {
  if (!d || typeof d !== 'object') return false;
  if (name === 'guides') return Array.isArray(d.guides) && Array.isArray(d.comps);
  if (name === 'glossary') return Array.isArray(d.terms);
  return Array.isArray(d.changes);
}

class Content {
  constructor({ dataDir, fetchImpl, log = () => {} }) {
    this.dir = path.join(dataDir, 'content');
    this.fetch = fetchImpl || globalThis.fetch.bind(globalThis);
    this.log = log;
    this.checkedAt = 0;
    this.data = {};
    for (const name of FILES) {
      const builtin = readJson(path.join(BUILTIN_DIR, `${name}.json`));
      const cached = readJson(path.join(this.dir, `${name}.json`));
      this.data[name] = newest(valid(name, builtin) ? builtin : null, valid(name, cached) ? cached : null);
    }
  }

  /** Retourne true si quelque chose a changé. */
  async refresh() {
    if (Date.now() - this.checkedAt < REFRESH_MS) return false;
    this.checkedAt = Date.now();
    let changed = false;
    for (const name of FILES) {
      try {
        const res = await this.fetch(`${REMOTE}/${name}.json`);
        if (!res.ok) continue;
        const d = await res.json();
        if (!valid(name, d) || newest(this.data[name], d) !== d || this.data[name] === d) continue;
        if (JSON.stringify(d) === JSON.stringify(this.data[name])) continue;
        this.data[name] = d;
        fs.mkdirSync(this.dir, { recursive: true });
        fs.writeFileSync(path.join(this.dir, `${name}.json`), JSON.stringify(d));
        changed = true;
      } catch {
        /* hors ligne : on garde ce qu'on a */
      }
    }
    if (changed) this.log('Guides et glossaire mis à jour.');
    return changed;
  }

  get() {
    return {
      guides: this.data.guides || null,
      glossary: this.data.glossary || null,
      watch: this.data['guides-watch'] || null
    };
  }
}

module.exports = { Content };
