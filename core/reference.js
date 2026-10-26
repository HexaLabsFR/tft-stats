'use strict';
/**
 * Données de référence du set qui ne figurent pas dans les fichiers du jeu :
 * chances en boutique par niveau et nombre d'exemplaires par coût.
 * Livrées avec l'application et mises à jour depuis le dépôt GitHub sans nouvelle version.
 * Si le set en cours ne correspond pas, elles sont marquées « périmées » et masquées.
 */
const fs = require('fs');
const path = require('path');
const BUILTIN = require('./reference-data.json');

const REMOTE = 'https://raw.githubusercontent.com/HexaLabsFR/tft-stats/main/core/reference-data.json';
const REFRESH_MS = 6 * 60 * 60 * 1000;

function valid(d) {
  if (!d || !Number.isInteger(d.set) || typeof d.updated !== 'string') return false;
  const levels = Object.values(d.odds || {});
  return levels.length >= 9 && levels.every((r) => Array.isArray(r) && r.length === 5) && Array.isArray(d.copies) && d.copies.length === 5;
}

const newer = (a, b) => (a.set !== b.set ? a.set > b.set : a.updated > b.updated);

class Reference {
  constructor({ dataDir, fetchImpl, log = () => {} }) {
    this.file = path.join(dataDir, 'reference.json');
    this.fetch = fetchImpl || globalThis.fetch.bind(globalThis);
    this.log = log;
    this.data = BUILTIN;
    this.checkedAt = 0;
    try {
      const cached = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (valid(cached) && newer(cached, this.data)) this.data = cached;
    } catch {
      /* pas de cache */
    }
  }

  /** Retourne true si de nouvelles données ont été récupérées. */
  async refresh() {
    if (Date.now() - this.checkedAt < REFRESH_MS) return false;
    this.checkedAt = Date.now();
    try {
      const res = await this.fetch(REMOTE);
      if (!res.ok) return false;
      const d = await res.json();
      if (!valid(d) || !newer(d, this.data)) return false;
      this.data = d;
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(d));
      this.log(`Chances en boutique mises à jour (set ${d.set}, ${d.updated}).`);
      return true;
    } catch {
      return false; // hors ligne : on garde ce qu'on a
    }
  }

  /** Données valables pour ce set, sinon { stale: true }. */
  forSet(setNumber) {
    if (!setNumber || this.data.set !== setNumber) return { stale: true, set: this.data.set };
    return this.data;
  }
}

module.exports = { Reference, BUILTIN };
