@echo off
chcp 65001 >nul
title TFT Stats - Installation
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est introuvable. Installe la version LTS depuis https://nodejs.org puis relance ce fichier.
  start https://nodejs.org
  pause
  exit /b 1
)

echo [1/2] Installation des dependances...
call npm install
if errorlevel 1 goto erreur

echo [2/2] Creation de l'installeur Windows...
call npm run dist
if errorlevel 1 goto erreur

echo.
echo Termine. Lance l'installeur qui vient de s'ouvrir dans le dossier dist.
start "" "%~dp0dist"
pause
exit /b 0

:erreur
echo.
echo Une erreur est survenue. Copie le message ci-dessus pour le diagnostic.
pause
exit /b 1
