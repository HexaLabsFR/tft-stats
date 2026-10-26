'use strict';
/**
 * Faux serveurs CommunityDragon + Riot API pour tester sans clé ni réseau.
 * Utilisé par les tests et par `npm run web:demo`.
 */

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const TRAITS = [
  ['TFT15_Duelist', 'Duelliste', [2, 4, 6]],
  ['TFT15_Sorcerer', 'Sorcier', [2, 4, 6]],
  ['TFT15_Bastion', 'Bastion', [2, 4, 6]],
  ['TFT15_Sniper', 'Tireur d\'élite', [2, 3, 4]],
  ['TFT15_StarGuardian', 'Gardienne des étoiles', [3, 5, 7]],
  ['TFT15_Juggernaut', 'Mastodonte', [2, 4, 6]],
  ['TFT15_Prodigy', 'Prodige', [2, 3, 4]],
  ['TFT15_Unique', 'Le Champion', [1]]
];

const CHAMPS = [
  ['TFT15_Ahri', 'Ahri', 4, ['Gardienne des étoiles', 'Sorcier']],
  ['TFT15_Syndra', 'Syndra', 2, ['Gardienne des étoiles', 'Prodige']],
  ['TFT15_Xayah', 'Xayah', 4, ['Gardienne des étoiles', 'Tireur d\'élite']],
  ['TFT15_Jinx', 'Jinx', 3, ['Gardienne des étoiles', 'Tireur d\'élite']],
  ['TFT15_Yasuo', 'Yasuo', 4, ['Duelliste']],
  ['TFT15_Kayle', 'Kayle', 1, ['Duelliste']],
  ['TFT15_Gwen', 'Gwen', 3, ['Duelliste', 'Sorcier']],
  ['TFT15_Leona', 'Leona', 1, ['Bastion']],
  ['TFT15_Shen', 'Shen', 3, ['Bastion', 'Duelliste']],
  ['TFT15_Braum', 'Braum', 2, ['Bastion', 'Mastodonte']],
  ['TFT15_Garen', 'Garen', 1, ['Mastodonte', 'Bastion']],
  ['TFT15_Sett', 'Sett', 4, ['Mastodonte']],
  ['TFT15_Lux', 'Lux', 2, ['Sorcier', 'Prodige']],
  ['TFT15_Ziggs', 'Ziggs', 3, ['Sorcier']],
  ['TFT15_Caitlyn', 'Caitlyn', 1, ['Tireur d\'élite']],
  ['TFT15_Ezreal', 'Ezreal', 2, ['Prodige', 'Tireur d\'élite']],
  ['TFT15_Seraphine', 'Seraphine', 5, ['Gardienne des étoiles', 'Prodige']],
  ['TFT15_Gangplank', 'Gangplank', 5, ['Duelliste', 'Le Champion']],
  ['TFT15_Varus', 'Varus', 5, ['Tireur d\'élite', 'Le Champion']],
  ['TFT15_Poppy', 'Poppy', 2, ['Bastion', 'Gardienne des étoiles']]
];

const ITEMS = [
  ['TFT_Item_BFSword', 'Épée longue', []],
  ['TFT_Item_RecurveBow', 'Arc courbe', []],
  ['TFT_Item_NeedlesslyLargeRod', 'Baguette surdimensionnée', []],
  ['TFT_Item_TearOfTheGoddess', 'Larme de la déesse', []],
  ['TFT_Item_ChainVest', 'Cotte de mailles', []],
  ['TFT_Item_NegatronCloak', 'Cape négatron', []],
  ['TFT_Item_GiantsBelt', 'Ceinture du géant', []],
  ['TFT_Item_SparringGloves', 'Gants d\'entraînement', []],
  ['TFT_Item_InfinityEdge', 'Lame d\'infini', ['TFT_Item_BFSword', 'TFT_Item_SparringGloves']],
  ['TFT_Item_GuinsoosRageblade', 'Lame furieuse de Guinsoo', ['TFT_Item_RecurveBow', 'TFT_Item_NeedlesslyLargeRod']],
  ['TFT_Item_JeweledGauntlet', 'Gantelet serti', ['TFT_Item_NeedlesslyLargeRod', 'TFT_Item_SparringGloves']],
  ['TFT_Item_SpearOfShojin', 'Lance de Shojin', ['TFT_Item_BFSword', 'TFT_Item_TearOfTheGoddess']],
  ['TFT_Item_Bloodthirster', 'Soif-de-sang', ['TFT_Item_BFSword', 'TFT_Item_NegatronCloak']],
  ['TFT_Item_WarmogsArmor', 'Armure de Warmog', ['TFT_Item_GiantsBelt', 'TFT_Item_GiantsBelt']],
  ['TFT_Item_GargoyleStoneplate', 'Plaque de gargouille', ['TFT_Item_ChainVest', 'TFT_Item_NegatronCloak']],
  ['TFT_Item_RedBuff', 'Feu solaire', ['TFT_Item_RecurveBow', 'TFT_Item_GiantsBelt']],
  ['TFT_Item_GiantSlayer', 'Tueur de géants', ['TFT_Item_BFSword', 'TFT_Item_RecurveBow']],
  ['TFT_Item_ArchangelsStaff', 'Bâton de l\'archange', ['TFT_Item_NeedlesslyLargeRod', 'TFT_Item_TearOfTheGoddess']]
];

const AUGS = [
  ['TFT9_Augment_Pandoras', 'Objets de Pandore', 'pandora_I.tex'],
  ['TFT9_Augment_Tiny', 'Titans miniatures', 'tiny_II.tex'],
  ['TFT9_Augment_Cluttered', 'Esprit encombré', 'cluttered_II.tex'],
  ['TFT9_Augment_Prismatic', 'Pinceau prismatique', 'prism_III.tex'],
  ['TFT9_Augment_Celestial', 'Bénédiction céleste', 'celestial_I.tex'],
  ['TFT9_Augment_Ascension', 'Ascension', 'ascension_III.tex']
];

// Archétypes : [traits principaux, unités, carry, objets du carry, force (place moyenne visée)]
const ARCHETYPES = [
  [['TFT15_StarGuardian', 7, 3], ['TFT15_Ahri', 'TFT15_Syndra', 'TFT15_Xayah', 'TFT15_Jinx', 'TFT15_Seraphine', 'TFT15_Poppy', 'TFT15_Lux', 'TFT15_Shen'], 'TFT15_Ahri', ['TFT_Item_JeweledGauntlet', 'TFT_Item_SpearOfShojin', 'TFT_Item_ArchangelsStaff'], 3.4],
  [['TFT15_Duelist', 6, 3], ['TFT15_Yasuo', 'TFT15_Kayle', 'TFT15_Gwen', 'TFT15_Shen', 'TFT15_Gangplank', 'TFT15_Braum', 'TFT15_Leona', 'TFT15_Sett'], 'TFT15_Yasuo', ['TFT_Item_Bloodthirster', 'TFT_Item_InfinityEdge', 'TFT_Item_GiantSlayer'], 4.1],
  [['TFT15_Sniper', 4, 3], ['TFT15_Xayah', 'TFT15_Jinx', 'TFT15_Caitlyn', 'TFT15_Ezreal', 'TFT15_Varus', 'TFT15_Braum', 'TFT15_Garen', 'TFT15_Sett'], 'TFT15_Jinx', ['TFT_Item_GuinsoosRageblade', 'TFT_Item_InfinityEdge', 'TFT_Item_GiantSlayer'], 4.5],
  [['TFT15_Juggernaut', 6, 3], ['TFT15_Sett', 'TFT15_Garen', 'TFT15_Braum', 'TFT15_Leona', 'TFT15_Shen', 'TFT15_Poppy', 'TFT15_Gangplank', 'TFT15_Ziggs'], 'TFT15_Sett', ['TFT_Item_WarmogsArmor', 'TFT_Item_Bloodthirster', 'TFT_Item_GargoyleStoneplate'], 5.0],
  [['TFT15_Sorcerer', 4, 2], ['TFT15_Lux', 'TFT15_Ziggs', 'TFT15_Gwen', 'TFT15_Ahri', 'TFT15_Syndra', 'TFT15_Leona', 'TFT15_Braum', 'TFT15_Seraphine'], 'TFT15_Ziggs', ['TFT_Item_JeweledGauntlet', 'TFT_Item_ArchangelsStaff', 'TFT_Item_SpearOfShojin'], 4.6]
];

function cdragonJson() {
  return {
    items: [
      ...ITEMS.map(([apiName, name, composition]) => ({
        apiName, name, composition,
        desc: 'Confère @AD*100@% de dégâts d\'attaque.<br>Effet passif.',
        effects: { AD: 0.15 },
        icon: `ASSETS/Maps/TFT/Icons/Items/${apiName}.tex`
      })),
      ...AUGS.map(([apiName, name, icon]) => ({
        apiName, name, composition: [],
        desc: 'Gagnez @Gold@ PO et un objet.',
        effects: { Gold: 10 },
        icon: `ASSETS/Maps/TFT/Icons/Augments/Hexcore/${icon}`
      }))
    ],
    setData: [
      {
        number: 18, mutator: 'TFTSet18', name: 'Démonstration',
        traits: TRAITS.map(([apiName, name, bps]) => ({
          apiName, name, desc: `Bonus de ${name}.`, icon: `ASSETS/UX/TraitIcons/${apiName}.tex`,
          effects: bps.map((min, i) => ({ minUnits: min, maxUnits: bps[i + 1] ? bps[i + 1] - 1 : 25000, style: bps.length === 1 ? 3 : i + 1, variables: {} }))
        })),
        champions: CHAMPS.map(([apiName, name, cost, traits]) => ({
          apiName, name, cost, traits,
          squareIcon: `ASSETS/Characters/${apiName}/HUD/${apiName}_Square.tex`,
          stats: { hp: 450 + cost * 150, damage: 40 + cost * 8, attackSpeed: 0.7 + cost * 0.02, armor: 30 + cost * 5, magicResist: 30 + cost * 5, range: cost % 2 ? 1 : 4, mana: 60 + cost * 10, initialMana: 20, critChance: 0.25 },
          ability: {
            name: `Sort de ${name}`,
            desc: 'Inflige <magicDamage>@Damage@ (%i:scaleAP%)</magicDamage> pts de dégâts magiques à la cible et @ModifiedHeal@ PV aux alliés proches pendant @Duration@ sec.',
            variables: [{ name: 'Damage', value: [0, 180 + cost * 20, 270 + cost * 30, 420 + cost * 60, 0, 0, 0] }, { name: 'Duration', value: [0, 3, 3, 3, 3, 3, 3] }]
          }
        })),
        augments: AUGS.map((a) => a[0])
      }
    ]
  };
}

function buildMatch(id, puuids, r, withAug) {
  const ts = Date.now() - Math.floor(r() * 3 * 24 * 3600 * 1000);
  const picks = puuids.map((puuid) => {
    const arch = ARCHETYPES[Math.floor(r() * ARCHETYPES.length)];
    const strength = arch[4] + (r() - 0.5) * 6;
    return { puuid, arch, strength };
  });
  picks.sort((a, b) => a.strength - b.strength);
  return {
    metadata: { match_id: id, participants: puuids },
    info: {
      game_datetime: ts,
      game_version: 'Version 15.20.715.1234 (Oct 10 2026/12:00:00) [PUBLIC] ',
      queue_id: 1100,
      tft_set_number: 18,
      participants: picks.map((pk, idx) => {
        const [mainTrait, units, carry, carryItems] = pk.arch;
        const n = 6 + Math.floor(r() * 3);
        const chosen = units.slice(0, n);
        return {
          puuid: pk.puuid,
          placement: idx + 1,
          level: 7 + Math.floor(r() * 3),
          last_round: 30 + Math.floor(r() * 10),
          augments: withAug ? AUGS.slice(0).sort(() => r() - 0.5).slice(0, 3).map((a) => a[0]) : undefined,
          traits: [
            { name: mainTrait[0], num_units: mainTrait[1], style: mainTrait[2], tier_current: 2 },
            { name: 'TFT15_Bastion', num_units: 2, style: 1, tier_current: 1 },
            { name: 'TFT15_Unique', num_units: 1, style: 3, tier_current: 1 }
          ],
          units: chosen.map((c) => ({
            character_id: c,
            tier: c === carry ? 2 + (r() > 0.7 ? 1 : 0) : 1 + (r() > 0.5 ? 1 : 0),
            rarity: 1,
            itemNames: c === carry
              ? carryItems.filter(() => r() > 0.1)
              : c === chosen.find((u) => u !== carry) && r() > 0.15
                ? ['TFT_Item_WarmogsArmor', 'TFT_Item_GargoyleStoneplate']
                : r() > 0.8 ? ['TFT_Item_WarmogsArmor'] : []
          }))
        };
      })
    }
  };
}

function createMockFetch({ seed = 42, players = 40, matchesPerPlayer = 10, withAugments = true, remoteMeta = null } = {}) {
  const r = rng(seed);
  const puuids = Array.from({ length: players }, (_, i) => `puuid-${i}`);
  const matchIdsByPlayer = new Map(puuids.map((p) => [p, []]));
  const matches = new Map();
  for (let i = 0; i < Math.ceil((players * matchesPerPlayer) / 8); i++) {
    const id = `EUW1_${7000000 + i}`;
    const lobby = [...puuids].sort(() => r() - 0.5).slice(0, 8);
    matches.set(id, buildMatch(id, lobby, r, withAugments));
    for (const p of lobby) matchIdsByPlayer.get(p).push(id);
  }
  const cd = cdragonJson();
  // Version anglaise : mêmes apiName, noms traduits.
  const EN = { 'Duelliste': 'Duelist', 'Sorcier': 'Sorcerer', "Tireur d'élite": 'Sniper', 'Gardienne des étoiles': 'Star Guardian', 'Mastodonte': 'Juggernaut', 'Prodige': 'Prodigy', 'Le Champion': 'The Champ', "Lame d'infini": 'Infinity Edge', 'Gantelet serti': 'Jeweled Gauntlet', 'Lance de Shojin': 'Spear of Shojin', "Bâton de l'archange": "Archangel's Staff", 'Titans miniatures': 'Tiny Titans' };
  const cdEn = JSON.parse(JSON.stringify(cd));
  for (const it of cdEn.items) it.name = EN[it.name] || it.name;
  for (const t of cdEn.setData[0].traits) t.name = EN[t.name] || t.name;

  const json = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h.toLowerCase() === 'x-app-rate-limit' ? '500:1,30000:600' : null) },
    json: async () => body
  });

  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.host === 'raw.communitydragon.org') {
      if (u.pathname.endsWith('content-metadata.json')) return json({ version: '15.20.1' });
      if (u.pathname.endsWith('fr_fr.json')) return json(cd);
      if (u.pathname.endsWith('en_us.json')) return json(cdEn);
      return json({}, 404);
    }
    if (u.host === 'raw.githubusercontent.com' && /\/donnees\/meta-[a-z0-9]+\.json$/.test(u.pathname)) {
      const meta = typeof remoteMeta === 'function' ? remoteMeta() : remoteMeta;
      return meta ? json(meta) : json(null, 404);
    }
    const p = u.pathname;
    let m;
    if ((m = p.match(/^\/tft\/league\/v1\/(challenger|grandmaster|master)$/))) {
      const slice = m[1] === 'challenger' ? puuids.slice(0, 20) : m[1] === 'grandmaster' ? puuids.slice(20) : [];
      return json({ tier: m[1].toUpperCase(), entries: slice.map((puuid, i) => ({ puuid, leaguePoints: 1500 - i * 10 - (m[1] === 'challenger' ? 0 : 600), wins: 50, losses: 40 })) });
    }
    if ((m = p.match(/^\/tft\/league\/v1\/entries\/([A-Z]+)\/(I|II|III|IV)$/))) {
      // Joueurs 30 à 59 répartis dans les rangs inférieurs.
      const tiers = ['DIAMOND', 'EMERALD', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE', 'IRON'];
      const ti = tiers.indexOf(m[1]);
      const pool = puuids.slice(30).filter((_, i) => i % tiers.length === ti);
      return json(pool.map((puuid) => ({ puuid, tier: m[1], rank: m[2], leaguePoints: 50, wins: 30, losses: 30 })));
    }
    if ((m = p.match(/matches\/by-puuid\/([^/]+)\/ids$/))) return json((matchIdsByPlayer.get(m[1]) || []).slice(0, Number(u.searchParams.get('count') || 20)));
    if ((m = p.match(/\/tft\/match\/v1\/matches\/([^/]+)$/))) return matches.has(m[1]) ? json(matches.get(m[1])) : json(null, 404);
    if ((m = p.match(/by-riot-id\/([^/]+)\/([^/]+)$/))) {
      const name = decodeURIComponent(m[1]);
      if (name.toLowerCase() === 'inconnu') return json(null, 404);
      return json({ puuid: 'puuid-0', gameName: name, tagLine: decodeURIComponent(m[2]) });
    }
    if (p.startsWith('/tft/summoner/v1/summoners/by-puuid/')) return json({ summonerLevel: 412, profileIconId: 29 });
    if (p.startsWith('/tft/league/v1/by-puuid/')) return json([{ queueType: 'RANKED_TFT', tier: 'CHALLENGER', rank: 'I', leaguePoints: 1500, wins: 120, losses: 95 }]);
    if (p.startsWith('/lol/spectator/tft/v5/active-games/by-puuid/')) {
      return json({ gameStartTime: Date.now() - 900000, gameLength: 900, gameQueueConfigId: 1100, participants: puuids.slice(0, 8).map((pu, i) => ({ puuid: pu, riotId: `Joueur${i}#EUW`, profileIconId: 29 })) });
    }
    return json(null, 404);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

module.exports = { createMockFetch };
