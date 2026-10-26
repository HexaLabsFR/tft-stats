'use strict';
/**
 * API officielle du client de jeu (127.0.0.1:2999, certificat Riot auto-signé, uniquement en local).
 * HexaRise ne lit que le mode de jeu : « une partie TFT est-elle en cours ? ».
 * Ni la boutique, ni le plateau, ni les adversaires.
 */
const https = require('https');

function gameMode() {
  return new Promise((resolve) => {
    const req = https.get(
      { host: '127.0.0.1', port: 2999, path: '/liveclientdata/gamestats', rejectUnauthorized: false, timeout: 1500 },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw).gameMode || null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/** Surveille le début et la fin des parties TFT ; onChange(inGame) à chaque changement. */
function watchGame(onChange, intervalMs = 5000) {
  let inGame = false;
  const tick = async () => {
    const now = (await gameMode()) === 'TFT';
    if (now !== inGame) {
      inGame = now;
      onChange(inGame);
    }
  };
  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  tick();
  return { stop: () => clearInterval(timer), get inGame() { return inGame; } };
}

module.exports = { gameMode, watchGame };
