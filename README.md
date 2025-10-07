<p align="center"><img src="./app/assets/images/SealCircle.png" width="150" height="150" alt="Multigames Luncher"></p>

<h1 align="center">Multigames Luncher — BETA</h1>

<p align="center"><em>(anciennement Electron Launcher / HeliosLauncher)</em></p>

<p align="center">
	<a href="https://github.com/kasycorp/multigames/actions"><img src="https://img.shields.io/github/actions/workflow/status/dscalzi/HeliosLauncher/build.yml?branch=master&style=for-the-badge" alt="CI"></a>
	<a href="https://github.com/kasycorp/multigames"><img src="https://img.shields.io/github/downloads/dscalzi/HeliosLauncher/total.svg?style=for-the-badge" alt="downloads"></a>
	<img src="https://forthebadge.com/images/badges/winter-is-coming.svg" height="28" alt="tag">
</p>

<p align="center">Un lanceur multiplateforme simple et léger pour lancer vos jeux/mods — en développement.</p>

---

Remarque rapide : la documentation est disponible dans le dossier <code>docs/</code>. Pour contribuer ou lancer le projet en local, consultez la section « Installation » plus bas.

## Fonctionnalités principales

- Lanceur multiplateforme pour jeux et mods.
- Interface utilisateur moderne et personnalisable.
- Gestion des comptes (Microsoft, Mojang, etc.).
- Téléchargement et mise à jour automatiques des fichiers nécessaires.
- Support des mods et des configurations personnalisées.
- **Système de rapport de bugs intégré** (Ctrl + Shift + L).

## Prérequis

Avant de commencer, assurez-vous d'avoir :

- [Node.js](https://nodejs.org/) (version 16 ou supérieure).
- [Git](https://git-scm.com/) pour cloner le dépôt.
- Un éditeur de texte comme [Visual Studio Code](https://code.visualstudio.com/).

## Installation

1. Clonez le dépôt :

   ```powershell
   git clone https://github.com/kasycorp/multigames.git
   cd multigames
   ```

2. Installez les dépendances :

   ```powershell
   npm install
   ```

3. Lancez le projet en mode développement :

   ```powershell
   npm run dev
   ```

4. Pour générer une version de production :

   ```powershell
   npm run build
   ```

## Contribution

Les contributions sont les bienvenues ! Pour contribuer :

1. Forkez le dépôt.
2. Créez une branche pour votre fonctionnalité ou correction de bug :

   ```powershell
   git checkout -b ma-nouvelle-fonctionnalite
   ```

3. Faites vos modifications et testez-les.
4. Soumettez une pull request en expliquant vos changements.

---

Pour toute question ou problème, n'hésitez pas à ouvrir une issue dans le dépôt GitHub.
