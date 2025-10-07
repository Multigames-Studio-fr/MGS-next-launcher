# Configuration du Système de Rapport de Bugs

Ce launcher inclut un système automatique de rapport de bugs qui permet aux utilisateurs d'envoyer facilement des rapports avec leurs logs système.

## Activation du raccourci

Les utilisateurs peuvent ouvrir le modal de rapport de bugs en appuyant sur `Ctrl + Shift + L`.

## Configuration du Webhook Discord

Pour que le système fonctionne, vous devez configurer un webhook Discord :

### 1. Créer un webhook Discord

1. Allez sur votre serveur Discord
2. Cliquez sur Paramètres du serveur > Intégrations
3. Cliquez sur "Webhooks" puis "Nouveau Webhook"
4. Donnez-lui un nom (ex: "Bug Reporter")
5. Sélectionnez le canal où vous voulez recevoir les rapports
6. Copiez l'URL du webhook

### 2. Configurer le launcher

1. Ouvrez le fichier `app/assets/config/bug-reporter.json`
2. Remplacez `https://discord.com/api/webhooks/1425202414314586227/oy-Q5BiSmN10jFmvcDZW2fyPAzx8pBfUccMNOG_7BtuD-RCsNqHyrspXyzQ02H9fk47R` par l'URL de votre webhook
3. Assurez-vous que `enabled` est défini sur `true`

Exemple de configuration :
```json
{
  "discord": {
    "webhookUrl": "https://discord.com/api/webhooks/1234567890/ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "enabled": true
  },
  "logs": {
    "maxLogLength": 1024,
    "includeSystemInfo": true,
    "includeLauncherVersion": true
  }
}
```

## Fonctionnalités

Le système collecte automatiquement :
- Le pseudo de l'utilisateur
- Le titre et la description du problème
- Les informations système (OS, RAM, CPU si disponibles)
- La version du launcher
- Les logs de la console
- Les informations de performance et mémoire

## Format du rapport

Les rapports sont envoyés sous forme d'embed Discord avec :
- Un titre préfixé par 🐛
- Les informations utilisateur
- La description du problème
- Les données techniques dans des blocs de code
- Un timestamp automatique

## Utilisation pour les utilisateurs

1. Appuyez sur `Ctrl + Shift + L`
2. Remplissez votre pseudo
3. Donnez un titre au problème
4. Décrivez le problème en détail
5. Cliquez sur "Envoyer le rapport"

Les informations système et les logs sont collectés automatiquement.