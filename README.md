<p align="center"><img src="./app/assets/images/SealCircle.png" width="150" height="150" alt="Multigames Launcher"></p>

# Multigames Launcher — BETA

Un lanceur multiplateforme, léger et ergonomique pour gérer et lancer vos jeux et mods.

Principales orientations : simplicité d'utilisation, mise à jour automatique des composants, prise en charge des comptes (Microsoft/Mojang), et outils pour les mods.

## Fonctionnalités

- Interface moderne et personnalisable (EJS + Tailwind).
- Gestion multi-comptes (Microsoft, Mojang...)
- Téléchargement et mise à jour automatiques des composants du jeu.
- Support des mods et des configurations personnalisées.
- Système de rapport de bugs intégré (Ctrl + Shift + L).
- Auto-updater avec logique de récupération défensive sur Windows.

## Prérequis

- Node.js 20.x (voir `engines` dans `package.json`).
- Git pour cloner le dépôt.
- Sur Windows : outils de packaging si vous voulez créer des installateurs (electron-builder est déjà configuré).

## Installation rapide (développement)

1. Clonez le dépôt :

```powershell
git clone https://github.com/Multigames-Studio-fr/MGS-next-launcher.git
cd MGS-next-launcher
```

2. Installez les dépendances :

```powershell
npm install
```

3. Lancer l'application en mode développement :

```powershell
npm run dev
```

Ou pour démarrer la build Electron (mode production local) :

```powershell
npm start
```

Pour compiler les styles Tailwind au besoin :

```powershell
npm run build-css
```

## Générer des builds / installer

Le projet utilise `electron-builder` pour produire des artefacts :

```powershell
# build pour toutes les plateformes configurées
npm run dist

# build spécifique Windows / macOS / Linux
npm run dist:win
npm run dist:mac
npm run dist:linux
```

Les noms d'artefacts et la publication vers GitHub sont configurés dans `package.json`.

## Rapport de bugs

Méthode recommandée (intégrée) :

1. Ouvrez le launcher et appuyez sur `Ctrl + Shift + L`.
2. Remplissez le formulaire (pseudo, titre, description). Les logs et infos système sont inclus automatiquement.
3. Cliquez sur `Envoyer`.

Si l'outil intégré ne fonctionne pas, procédez manuellement :

- Ouvrez la console de développement dans le launcher : `Ctrl + Shift + I`.
- Récupérez l'onglet `Console` et copiez les logs.
- Indiquez : système d'exploitation, RAM, CPU, version du launcher, étapes pour reproduire, et collez les logs.

Les issues publiques peuvent être ouvertes ici : https://github.com/Multigames-Studio-fr/MGS-next-launcher/issues

## Contribuer

Contributions bienvenues — petite marche à suivre :

1. Forkez le dépôt.
2. Créez une branche descriptive :

```powershell
git checkout -b feat/ma-fonctionnalite
```

3. Faites vos modifications, testez localement.
4. Ouvrez une pull request en décrivant le problème et la solution.

Conseils :

- Respectez le style existant (EJS/Tailwind pour le front, Node/Electron pour le main).
- Ajoutez des tests ou instructions de vérification si vous modifiez une logique importante.

## Structure utile du dépôt

- `index.js` — point d'entrée (initialisation d'Electron et de l'auto-updater).
- `app/` — vues EJS, assets, scripts frontend.
- `app/assets/js/` — scripts UI et utilitaires.
- `package.json` — scripts et configuration de build.

## Licence

Consultez `LICENSE.txt` pour les détails de la licence et les conditions d'utilisation.

## Notes techniques et dépannage

- Auto-updater Windows — en cas d'erreurs ENOENT liées au renommage d'installateurs temporaires, vérifiez l'antivirus et le dossier :

  `%USERPROFILE%\\.multigames-studio-launcher-updater\\pending`

- Pour tout problème de build, vérifiez la version de Node (20.x) et les dépendances dev (`electron-builder`, `electron`).

---

Si vous voulez que je peaufine la page d'accueil (ex. sections en anglais/français, badges, captures d'écran, ou un guide pas-à-pas pour packager), dites-moi ce que vous voulez ajouter et je le ferai.<p align="center">
