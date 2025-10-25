<p align="center"><img src="./app/assets/images/SealCircle.png" width="150" height="150" alt="Multigames Launcher"></p>

# Multigames Launcher — BETA

Un lanceur multiplateforme, léger et ergonomique pour gérer et lancer vos jeux et mods.

Ce README a été enrichi avec des sections pratiques : guide rapide, scripts utiles, packaging, détail technique sur l'auto-updater, procédure de rapport de bugs, et conseils pour contribuer.

## Badges

<!-- Vous pouvez remplacer ou ajouter des badges CI/releases ici -->

![CI](https://img.shields.io/github/actions/workflow/status/Multigames-Studio-fr/MGS-next-launcher/build.yml?branch=main)
![Downloads](https://img.shields.io/github/downloads/Multigames-Studio-fr/MGS-next-launcher/total)

## Fonctionnalités principales

- Interface moderne et personnalisable (EJS + Tailwind).
- Gestion multi-comptes (Microsoft, Mojang, etc.).
- Téléchargement et mise à jour automatiques des composants.
- Support des mods et des configurations personnalisées.
- Système de rapport de bugs intégré (Ctrl + Shift + L) qui collecte logs et infos système.
- Auto-updater avec logique de récupération défensive sur Windows pour atténuer les erreurs ENOENT.

## Prérequis

- Node.js 20.x (voir `engines` dans `package.json`).
- Git pour cloner le dépôt.
- Sur Windows : pour générer des installateurs, `electron-builder` est utilisé (voir section Packaging).

## Installation et démarrage (développement)

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

4. Pour une exécution locale en mode production :

```powershell
npm start
```

5. Compiler les styles Tailwind (si vous éditez le CSS) :

```powershell
npm run build-css
```

6. Pour surveiller les changements CSS en continu :

```powershell
npm run watch-css
```

## Scripts utiles (extrait de `package.json`)

- `start` : lance l'app avec Electron.
- `dev` : mode développement (variable d'environnement `--dev` passée au processus main).
- `dist` : construit des artefacts via `electron-builder`.
- `dist:win`, `dist:mac`, `dist:linux` : builds ciblés.
- `build-css`, `watch-css` : compilation Tailwind.
- `lint` : lance ESLint.
- `create-icon` : script utilitaire pour générer des icônes.

Utilisez ces scripts tels quels avec `npm run <script>`.

## Packaging & Releases

Le projet est configuré pour `electron-builder`. Les options de publication et les conventions de nom d'artefact se trouvent dans `package.json` (`build.publish`, `win`, `nsis`).

Exemples de commandes :

```powershell
# build pour toutes les plateformes configurées
npm run dist

# build spécifique (Windows/macOS/Linux)
npm run dist:win
npm run dist:mac
npm run dist:linux
```

Notes importantes :

- Sur Windows l'artefact NSIS est configuré (`artifactName`), vérifiez les options de `nsis` si vous modifiez la génération d'installateur.
- La signature de builds (codesign / signtool) n'est pas couverte ici — pour les releases publiques signées, préparez des certificats et adaptez la config `electron-builder`.
- Les builds CI peuvent être reliés à la publication GitHub (voir `build.publish`).

## Détail technique : auto-updater et ENOENT (Windows)

Contexte : certains utilisateurs ont rencontré des erreurs ENOENT lors de la tentative de renommage d'un installeur temporaire vers le dossier `pending` de l'updater. Causes fréquentes : antivirus qui supprime le fichier, nom de fichier altéré, ou erreur de FS transitoire.

Mesures prises :

- Le process principal inclut maintenant une logique défensive qui scanne le dossier `pending` et tente des renommages alternatifs sûrs si un installeur correspondant est trouvé.
- Journaux plus explicites pour aider au diagnostic.

Si vous voyez encore des erreurs :

- Vérifiez le dossier :

```text
%USERPROFILE%\.multigames-studio-launcher-updater\pending
```

- Vérifiez votre antivirus / quarantaine (il peut avoir supprimé le fichier temp).
- Relancez la mise à jour après avoir désactivé temporairement l'antivirus pour tester.

Si vous voulez améliorer la logique d'auto-récupération, éditez `index.js` (initialisation de l'updater) et ajoutez des logs/strategies supplémentaires.

## Rapport de bugs — détails techniques

Méthode intégrée (recommandée) :

1. Ouvrir le formulaire : `Ctrl + Shift + L`.
2. Renseigner pseudo, titre et description. Les logs et infos système (OS, versions, stack traces) sont joints automatiquement.
3. Envoyer.

Si vous préférez la méthode manuelle :

- Ouvrez la console de dev : `Ctrl + Shift + I` -> onglet `Console`.
- Copiez les logs et joignez-les à votre issue.
- Donnez les informations : OS, RAM, CPU, version du launcher (affichée en bas ou dans les logs), étapes pour reproduire.

Ouvrez une issue ici : https://github.com/Multigames-Studio-fr/MGS-next-launcher/issues

## Contribuer — guide rapide et checklist PR

Merci pour votre contribution ! Voici une checklist minimale pour une PR propre :

- [ ] Forkez et créez une branche nommée clairement (ex. `fix/updater-rename`, `feat/microsoft-auth`).
- [ ] Ajoutez des tests ou une procédure manuelle pour vérifier le changement (si pertinent).
- [ ] Respectez le style (EJS pour vues, Tailwind pour styles, Node/Electron pour le main).
- [ ] Lancez `npm run lint` et corrigez les warnings bloquants.
- [ ] Décrivez la PR (quoi, pourquoi, comment tester).

Commandes utiles :

```powershell
git checkout -b feat/ma-fonctionnalite
git add .
git commit -m "feat: description courte"
git push origin feat/ma-fonctionnalite
```

## Structure du dépôt (guide rapide)

- `index.js` — point d'entrée principal (main process Electron, auto-updater init).
- `app/` — templates EJS, assets (css, images, js), vues.
- `app/assets/js/` — scripts frontend, utilitaires (auth, config, ipc).
- `app/assets/css/` — sources Tailwind et fichiers compilés.
- `build/` — sortie des builds (selon CI/config local).

## Dépannage & FAQ

Q : L'updater échoue avec ENOENT lors du renommage

A : Vérifiez l'antivirus et le dossier `pending` de l'updater (voir section Auto-updater). Les logs dans `electron-log` (ou console) donnent plus de détails.

Q : Les builds échouent en CI

A : Assurez-vous que la machine CI utilise Node 20.x et dispose des outils natifs requis pour `electron-builder` (par ex. outils Windows pour la signature/packaging). Activez le verbose logging pour `electron-builder` pour diagnostiquer.

Q : Où sont les logs ?

A : Le projet utilise `electron-log` — les logs sont généralement écrits dans le répertoire utilisateur spécifique à l'application (selon OS). Vous pouvez aussi consulter la console DevTools (`Ctrl + Shift + I`).

## Internationalisation & traduction

Le launcher contient des fichiers de langue dans `app/lang/` (ex. `en_US.toml`). Pour ajouter une langue :

1. Créez un nouveau fichier `.toml` suivant la structure existante.
2. Mettez à jour le loader de langues si nécessaire (`app/assets/js/langloader.js`).

## Licence et crédits

Consultez `LICENSE.txt` pour la licence complète. Les crédits et notices se trouvent dans `NOTICE.md`.

## Contact & support

- Ouvrez une issue : https://github.com/Multigames-Studio-fr/MGS-next-launcher/issues
- Pour un rapport de bug rapide, utilisez le raccourci `Ctrl + Shift + L` depuis l'app.

---

Si vous voulez :

- que j'ajoute des captures d'écran et un guide visuel étape par étape, dites quelles vues vous voulez montrer (landing, settings, updater) ;
- une version anglaise parallèle (README.en.md) ;
- ou que j'intègre des badges supplémentaires (build, release, license), je peux les ajouter.

Merci — dites-moi quelle amélioration prioritaire vous voulez (captures, traduction, badges, ou guide de packaging détaillé) et je m'en occupe.
