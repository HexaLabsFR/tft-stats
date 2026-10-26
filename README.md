# HexaRise · Compagnon TFT, par Hexa Labs

Application Teamfight Tactics en français pour monter de Bronze à Diamant : compos méta de ton rang, guide étape par étape, plan de niveaux et mode partie. Version desktop (Windows) et version web, données Riot en direct, mises à jour automatiques.

## Installer

Télécharger `HexaRise-Setup-x.y.z.exe` dans les [Releases](https://github.com/HexaLabsFR/tft-stats/releases/latest), le lancer, puis coller ta clé Riot (https://developer.riotgames.com) dans la fenêtre qui s'ouvre. Les versions suivantes s'installent toutes seules.

## Ce que fait l'app

| Écran | Contenu |
|---|---|
| Compos | Tier list S → D par rang (Bronze, Argent, Or, Platine, Émeraude, Diamant, Maître+), carry, plateau final, objets, moment clé du roll. Mode Simple ou Expert. |
| Ligne | Sélection de ligne façon tftflow, en français : clique tes composants, objets, emblèmes et augments (avec quantités), HexaRise classe les compos de ton rang en Cœur, Bon et Correct, avec un classement cumulé. Infobulle complète au survol (description, stats, place moyenne par étape, meilleures lignes). |
| Guide complet | Plan de niveaux par manche selon ta série (victoires, mixte, défaites), étapes 1 à 5, objets et recettes, augments, placement conseillé sur un plateau hexagonal (inversable) |
| Explorer | Champions (stats, sort, synergies, fiche détaillée, vue liste ou grille), synergies, objets, augments, chances en boutique |
| Apprendre | Fiches en français des guides BunnyMuffins et TFT Academy (résumés HexaRise, lien vers l'original), avis des experts par compo, ouvertures, conditions (objet → compos), par composant, glossaire en info-bulles |
| Profil | Recherche `Pseudo#TAG`, rang, 20 dernières parties, partie en cours |
| Mode partie | Petite fenêtre au-dessus du jeu : plan à cocher, placement conseillé, niveaux, recettes, augments. S'ouvre seule au lancement d'une partie. Raccourci **Alt+G**. |
| Réglages | Clé API, serveur, rangs analysés, fréquence, journal, mises à jour |

## Mode partie et règles Riot

Le mode partie n'affiche que des informations choisies avant la partie (guide, plan de niveaux, recettes, stats d'augments), ce que la politique développeur Riot pour TFT autorise. Il ne lit ni ta boutique, ni ton plateau, ni ton or, ni ta série, ni les adversaires : la seule information lue est « une partie TFT est en cours », via l'API officielle du client de jeu. Le plan de niveaux affiche donc les trois séries côte à côte. Pour que la fenêtre reste visible, règle TFT en **Plein écran fenêtré** (ou Fenêtré).

## Ce qui se met à jour tout seul

| Quoi | Source | Fréquence |
|---|---|---|
| Statistiques méta | Riot API (TFT-LEAGUE, TFT-MATCH) | Toutes les 30 min par défaut |
| Champions, synergies, objets, augments en français (stats, sorts, icônes) | CommunityDragon (`fr_fr.json`, `en_us.json`) | Vérifié toutes les 6 h, rechargé à chaque patch |
| Chances en boutique et exemplaires par coût | `core/reference-data.json` de ce dépôt | Vérifié toutes les 6 h, sans nouvelle version. Masqué si le set ne correspond pas. |
| Fiches des guides, avis des experts, glossaire | `content/*.json` de ce dépôt | Vérifié toutes les 6 h, sans nouvelle version |
| Guides modifiés ou nouveaux | Action « Veille des guides » → `content/guides-watch.json` | Chaque jour ; l'app affiche « Mis à jour par l'auteur » ou « Nouveau » |
| L'application | GitHub Releases via `electron-updater` | Au démarrage puis toutes les 4 h |

## Publier une version

Augmenter `version` dans `package.json` et pousser sur `main` : l'action « Publier une version » crée l'étiquette, fabrique l'installeur et publie la Release.

Nouveau set : mettre à jour `core/reference-data.json` (chances en boutique, exemplaires) et pousser. Les apps installées le récupèrent d'elles-mêmes.

L'action « Vérifier les données du set » (chaque lundi, ou à la main) contrôle que le set en cours est bien lu (champions, sorts, icônes) et dépose un rapport sur la branche `data-check`.

## Commandes de développement

| Commande | Effet |
|---|---|
| `npm start` | App desktop |
| `npm run start:demo` | App desktop avec données simulées (sans clé) |
| `npm run web` | Version web sur http://localhost:3210 (aussi `lancer-web.bat`) |
| `npm run web:demo` | Version web avec données simulées (aussi `lancer-demo.bat`) |
| `npm test` | Tests du moteur |
| `npm run dist` | Installeur Windows en local |

## Clé API Riot

| Type | Durée | Usage |
|---|---|---|
| Développement | 24 h | Tests : à régénérer chaque jour |
| Personnelle | Permanente | Outil pour toi seul, demande sur le portail Riot |
| Production | Permanente | Distribution publique, avec un serveur qui garde la clé |

La clé est chiffrée par Windows (DPAPI) dans `%APPDATA%\TFT Stats`. Ne jamais la mettre dans le code ni la publier.

## Architecture

```
core/        moteur partagé : Riot API et limiteur, données du set, chances en boutique, agrégation, collecte
electron/    processus principal, mode partie, zone de notification, mises à jour, pont IPC sécurisé
renderer/    interface (HTML/CSS/JS), identique en desktop et en web
web/         serveur local de la version navigateur
tools/       vérification des données CommunityDragon (action GitHub)
test/        faux serveurs Riot/CommunityDragon et tests
```

HexaRise n'est pas approuvé par Riot Games et ne reflète pas les opinions de Riot Games ni de quiconque ayant officiellement participé à la production ou à la gestion des propriétés de Riot Games. Riot Games et toutes les propriétés associées sont des marques commerciales ou déposées de Riot Games, Inc.
