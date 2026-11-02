# Rapport Photo — Chantier

Application web (HTML/CSS/JS, sans dépendance de build) pour faire un
reportage photo de chantier : photos avec commentaires, annotations
(flèches, texte), mise en page multi-photos par page, export PDF.
Installable en PWA (icône sur l'écran d'accueil, fonctionne hors-ligne).

## Pourquoi ce projet, et pas juste le fichier .html unique

Un fichier HTML ouvert localement sur iPhone (via l'app Fichiers, Mail,
ou l'aperçu de Claude) tourne dans une visionneuse restreinte
("Quick Look") qui bloque l'accès à l'appareil photo, à la photothèque,
au clavier et aux téléchargements. C'est une limite d'iOS, pas un bug de
l'app : **la seule solution fiable est de servir cette application via
une vraie URL https (même minimaliste), pour qu'elle s'ouvre dans le
vrai moteur de Safari.** Une fois hébergée, toutes les fonctionnalités
marchent normalement, et on peut même l'ajouter à l'écran d'accueil de
l'iPhone comme une vraie app (icône, plein écran, hors-ligne).

## Structure du projet

```
index.html   → page principale
style.css    → tous les styles
app.js       → toute la logique (photos, annotations, PDF, sauvegarde)
vendor/      → jsPDF embarqué (fonctionnement 100% hors-ligne)
manifest.json + sw.js → PWA (icône sur écran d'accueil + cache hors-ligne)
icons/       → icônes de l'app
```

## Déployer (choisir une option)

### Option A — GitHub Pages (gratuit, durable, recommandé)

Si vous avez Claude Code en local sur un ordinateur, donnez-lui ce
dossier et demandez-lui simplement :

> « Initialise un dépôt git dans ce dossier, crée un repo GitHub nommé
> rapport-photo-chantier, pousse le code, et active GitHub Pages sur la
> branche main. »

Claude Code peut exécuter les commandes `git init`, `gh repo create`,
`git push`, et activer Pages via `gh api` ou l'interface web. Une fois
activé, l'app sera accessible à une adresse du type :

```
https://<votre-utilisateur>.github.io/rapport-photo-chantier/
```

Ouvrez cette adresse dans Safari sur l'iPhone, puis **Partager → Ajouter
à l'écran d'accueil** pour l'installer comme une vraie app.

### Option B — Netlify Drop (le plus simple, sans compte ni ligne de commande)

1. Allez sur https://app.netlify.com/drop depuis un ordinateur.
2. Glissez-déposez ce dossier entier dans la page.
3. Netlify vous donne immédiatement une URL https publique.
4. Ouvrez cette URL dans Safari sur l'iPhone, puis « Ajouter à l'écran
   d'accueil ».

### Option C — Test local rapide (sur le même réseau Wi-Fi que l'iPhone)

Depuis ce dossier, sur un ordinateur connecté au même Wi-Fi que
l'iPhone :

```bash
npx serve .
```

Cela affiche une adresse du type `http://192.168.x.x:3000` —
ouvrez-la dans Safari sur l'iPhone (même réseau Wi-Fi requis). Pratique
pour tester avant de déployer définitivement, mais l'adresse change à
chaque lancement : pour un usage quotidien sur chantier, préférez
l'option A ou B.

## Une fois installée en PWA sur l'iPhone

- L'icône apparaît sur l'écran d'accueil, s'ouvre en plein écran (sans
  barre Safari).
- L'appareil photo, la photothèque, le clavier et le téléchargement du
  PDF fonctionnent normalement.
- Les photos et rapports en cours sont sauvegardés automatiquement en
  local sur le téléphone (IndexedDB) — aucune photo n'est jamais envoyée
  sur un serveur, même une fois l'app hébergée : seul le code de l'app
  (HTML/CSS/JS) est servi depuis l'hébergement, les données restent sur
  l'appareil.
- Le bouton **Exporter la sauvegarde** reste disponible pour faire une
  copie de secours transférable (fichier `.json`) à tout moment.
