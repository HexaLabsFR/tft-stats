# TFT Stats

Application de statistiques Teamfight Tactics en français, sur le modèle de MetaTFT et Mobalytics :
même architecture (Electron + interface web), données Riot en direct et mises à jour automatiques.

## Ce que fait l'app

| Écran | Contenu |
|---|---|
| Compos méta | Tier list S → D calculée sur les parties Challenger / GM, carry, objets, unités cœur, synergies, augments |
| Champions | Place moyenne, top 4, victoire, taux de jeu, % 3 étoiles, objets favoris |
| Synergies | Performance par synergie et par palier |
| Objets | Par catégorie (complets, artefacts, radieux, emblèmes…) avec meilleurs porteurs |
| Augments | Stats si Riot les fournit, sinon catalogue français à jour |
| Joueur | Recherche `Pseudo#TAG`, rang, 20 dernières parties, partie en cours |
| Mode partie | Petite fenêtre au premier plan pendant la partie : plan à cocher de la compo choisie avant la partie, recettes, augments. S'ouvre seule au lancement d'une partie TFT. Raccourci **Alt+G**. |
| Paramètres | Clé API, serveur, rangs suivis, fréquence d'actualisation, journal, mises à jour |

## Mode partie et règles Riot

Le mode partie n'affiche que des données statiques choisies avant la partie (guide, recettes, stats d'augments), ce que la politique développeur Riot pour TFT autorise. Il ne lit ni ta boutique, ni ton plateau, ni les adversaires : la seule information lue est « une partie TFT est en cours », via l'API officielle du client de jeu. Pour qu'il reste visible au-dessus du jeu, règle TFT en **Plein écran fenêtré** (ou Fenêtré).

## Ce qui se met à jour tout seul

| Quoi | Source | Fréquence |
|---|---|---|
| Statistiques méta | Riot API (TFT-LEAGUE, TFT-MATCH) | Toutes les 30 min par défaut, affichage live pendant la collecte |
| Champions, objets, augments en français | CommunityDragon (`fr_fr.json`) | Vérifié toutes les 6 h, rechargé à chaque patch |
| L'application elle-même | GitHub Releases via `electron-updater` (fichier `app-update.yml`) | Au démarrage puis toutes les 4 h |

## Installation sur Windows

1. Installer **Node.js LTS** : https://nodejs.org
2. Double-cliquer sur `installer.bat` (installe les dépendances et génère l'installeur)
3. Lancer `dist\TFT-Stats-Setup-1.0.0.exe` : l'app s'installe dans `AppData\Local\Programs\TFT Stats`, comme MetaTFT
4. Dans **Paramètres**, coller ta clé Riot (https://developer.riotgames.com)

Autres lanceurs : `lancer-demo.bat` (données simulées, sans clé) et `lancer-web.bat` (version navigateur sur http://localhost:3210).

## Activer les mises à jour automatiques de l'app

1. Créer un dépôt GitHub `tft-stats`
2. Dans `package.json`, remplacer `TON-PSEUDO-GITHUB` par ton pseudo GitHub
3. Créer un jeton GitHub (droit `repo`) et le définir : `set GH_TOKEN=ton_jeton`
4. À chaque nouvelle version : augmenter `version` dans `package.json`, puis `npm run release`

Les apps installées détectent la nouvelle version, la téléchargent et proposent de redémarrer.

## Commandes

| Commande | Effet |
|---|---|
| `npm start` | Lance l'app desktop |
| `npm run start:demo` | App desktop avec données simulées |
| `npm run web` | Version web locale |
| `npm run web:demo` | Version web avec données simulées |
| `npm test` | Tests du moteur |
| `npm run dist` | Génère l'installeur Windows |
| `npm run release` | Publie une mise à jour sur GitHub |

## Clé API Riot

| Type | Durée | Limite | Usage |
|---|---|---|---|
| Développement | 24 h | 100 requêtes / 2 min | Usage perso, tests |
| Personnelle | Permanente | Identique | Demande sur le portail Riot (outil pour toi seul) |
| Production | Permanente | Bien plus élevée | Obligatoire pour distribuer l'app au public, avec un serveur qui garde la clé |

La clé est chiffrée par Windows (DPAPI) dans `%APPDATA%\TFT Stats`. Ne jamais la mettre dans le code ni la publier.

## Architecture

```
core/        moteur partagé (Riot API + limiteur, données FR, agrégation, collecte live)
electron/    processus principal, zone de notification, auto-update, pont IPC sécurisé
renderer/    interface (HTML/CSS/JS), identique en desktop et en web
web/         serveur local pour la version navigateur
test/        faux serveurs Riot/CommunityDragon + tests
```

TFT Stats n'est pas approuvé par Riot Games et ne reflète pas les opinions de Riot Games ni de quiconque ayant officiellement participé à la production ou à la gestion des propriétés de Riot Games. Riot Games et toutes les propriétés associées sont des marques commerciales ou déposées de Riot Games, Inc.
