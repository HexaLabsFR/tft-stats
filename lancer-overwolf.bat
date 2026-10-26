@echo off
chcp 65001 >nul
title HexaRise - version Overwolf privée
cd /d "%~dp0"

rem Version privée : lit ton plateau pendant la partie via Overwolf (mode développeur).
rem Nécessite Node.js, un compte développeur Overwolf approuvé et ta Developer Key.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est introuvable. Installe la version LTS depuis https://nodejs.org puis relance ce fichier.
  start https://nodejs.org
  pause
  exit /b 1
)

if not exist overwolf-key.txt (
  echo Il manque ta clé développeur Overwolf ^(Developer Key, profil sur dev.overwolf.com^).
  echo Colle-la dans le fichier qui va s'ouvrir, enregistre, ferme-le, puis relance ce fichier.
  type nul > overwolf-key.txt
  notepad overwolf-key.txt
  exit /b 0
)
set /p OW_DEV_KEY=<overwolf-key.txt
if "%OW_DEV_KEY%"=="" (
  echo Le fichier overwolf-key.txt est vide : colle ta clé dedans puis relance.
  notepad overwolf-key.txt
  exit /b 0
)

echo Ferme HexaRise ^(version normale^) s'il est ouvert : les deux versions partagent tes données.
taskkill /im HexaRise.exe /f >nul 2>nul

where git >nul 2>nul
if not errorlevel 1 (
  echo Récupération de la dernière version...
  git pull --quiet
)
if not exist node_modules (
  echo Installation des dépendances...
  call npm install
)
echo Lancement de HexaRise avec Overwolf...
call npx --yes -p @overwolf/ow-electron@44.9.0 ow-electron .
