# Coup de Patte

**Une case de BD Disney s'affiche. Tu as quinze secondes pour trouver qui l'a dessinée.**

Jouer : **https://jonathan8520.github.io/coup-de-patte/**

[![Données Inducks](https://github.com/Jonathan8520/coup-de-patte/actions/workflows/data.yml/badge.svg)](https://github.com/Jonathan8520/coup-de-patte/actions/workflows/data.yml)
[![Site](https://github.com/Jonathan8520/coup-de-patte/actions/workflows/pages.yml/badge.svg)](https://github.com/Jonathan8520/coup-de-patte/actions/workflows/pages.yml)

Un jeu pour reconnaître le trait des dessinateurs Disney (Barks, Rosa, Scarpa, Cavazzano, Vicar…), dans l'esprit de Duckguessr, le jeu de l'équipe DucksManager aujourd'hui hors ligne.

## Le jeu

- **8 cases par partie, 9 dessinateurs proposés.** Chaque dessinateur n'est la bonne réponse qu'une fois : l'un des neuf est un leurre, et les réponses déjà données sont grisées.
- **15 secondes par case.** 100 points par bonne réponse, plus un bonus de rapidité (jusqu'à 100 points) tant que la barre est jaune, soit 7,5 secondes.
- **La case s'ouvre sur un détail puis s'élargit.** La bande du haut de la planche (titre, crédits) reste cachée jusqu'à la réponse, puis toute la page se dévoile avec le titre et le lien vers Inducks.
- **Modes** :
  - *Pour commencer* : Débutant (grands noms aux styles marqués) et Tous les dessinateurs (les 60 plus publiés).
  - *Par pays* : un mode par école nationale, créé automatiquement dès que neuf dessinateurs de ce pays ont assez de planches (aujourd'hui Argentine, Brésil, Danemark, Espagne, France, Italie, Pays-Bas, États-Unis).
  - *Au kiosque* : tout ce qui a paru dans un pays depuis 20 ans, d'où que ça vienne (France, Italie, Allemagne, Espagne, Brésil, Pays-Bas, Danemark, Norvège, Suède, Finlande, monde anglophone). Le kiosque du pays de la langue choisie passe en premier.
  - *Autrement* : L'école Egmont (les histoires produites pour l'Europe du Nord).
- **L'atelier** : quelques planches de chaque dessinateur, pour apprendre à reconnaître son trait.
- **Défis précédents** : les défis des jours passés, à rejouer sans toucher à la série.
- **Défi du jour** : les mêmes cases pour tout le monde, une tentative, résultat à partager en carrés de couleur.
- **Défi entre amis** : un lien qui rejoue exactement les mêmes cases, avec le score à battre.
- **Statistiques et médailles** gardées dans le navigateur (rien n'est envoyé nulle part).
- Clavier : touches 1 à 9 pour répondre, Entrée pour passer à la case suivante.
- **Onze langues** : français, anglais, italien, allemand, espagnol, portugais, néerlandais, danois, norvégien, suédois et finnois. La langue du navigateur est choisie d'office, le globe en haut permet d'en changer. Les titres des histoires s'affichent dans la langue choisie quand Inducks en connaît une traduction.

## Comment le dépôt se met à jour tout seul

```
chaque lundi            ┌──────────────────────────────┐
GitHub Actions  ──────▶ │ data.yml                      │
                        │  1. tests du pipeline         │
                        │  2. export public Inducks     │
                        │  3. pipeline/build_data.py    │
                        │  4. commit de site/data       │
                        └──────────────┬───────────────┘
                                       ▼
                        ┌──────────────────────────────┐
                        │ pages.yml                     │
                        │  vérifications, puis          │
                        │  publication sur gh-pages     │
                        └──────────────────────────────┘
```

- `pipeline/build_data.py` lit l'export `isv.tgz` d'Inducks, garde les scans publics de premières pages d'histoires (pas de couvertures ni de strips de journaux) dessinées par **un seul** dessinateur, choisit de préférence un scan d'une édition française, puis construit les modes.
- Le calendrier des défis du jour est prolongé de cinq semaines à chaque passage. **Un jour déjà publié n'est jamais modifié**, et ses cases restent dans `site/data/archive.json`.
- Les titres traduits sont écrits dans `site/data/titles/<langue>.json`, seulement pour les histoires en jeu.
- Les images ne sont pas copiées dans le dépôt : le navigateur les affiche depuis Inducks.

Lancer la mise à jour à la main : onglet *Actions*, workflow *Données Inducks*, *Run workflow*. Décocher *publish* fait un essai à blanc : les données sont jointes au run comme artefact, sans commit.

Savoir pourquoi un dessinateur est absent : workflow *Pourquoi ce dessinateur ?*, avec les noms séparés par des virgules. Le résumé du run indique, étape par étape, combien de ses histoires passent les filtres (histoires dessinées, en planches, seul dessinateur, scan public de la première page).

## Organisation

```
pipeline/   construction des données (Python, sans dépendance) et ses tests
site/       le site statique publié (HTML, CSS, JavaScript sans framework)
  data/     données générées par le workflow, à ne pas modifier à la main
  i18n/     textes de l'interface, un fichier par langue (fr.json fait référence)
scripts/    vérifications avant publication, génération des icônes
```

## En local

```bash
python -m unittest discover -s pipeline        # tests du pipeline
python -m http.server -d site 8000             # puis http://localhost:8000
node scripts/check-site.mjs                    # vérifie les données et les traductions
python scripts/make_icons.py                   # régénère les icônes (Playwright)
```

## Traduire

Chaque langue est un fichier `site/i18n/<code>.json` avec les mêmes clés que `fr.json`. Les pluriels sont des objets (`one`, `other`, et `few` ou `many` si la langue en a besoin). `node scripts/check-site.mjs` signale une clé ou une variable oubliée. Pour ajouter une langue : créer son fichier et l'ajouter à la liste `LANGS` de `site/js/i18n.js`.

## Crédits

- Données : [Inducks](https://inducks.org), utilisées selon [la licence Inducks](https://inducks.org/inducks/COPYING).
- Idée originale : Duckguessr, par l'équipe de [DucksManager](https://github.com/bperel/DucksManager).
- Les personnages et histoires Disney sont © Disney. Projet de fan, sans lien avec Disney.
- Police : [Shantell Sans](https://fonts.google.com/specimen/Shantell+Sans).
