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
- **Modes** : Débutant (grands noms aux styles marqués), Les Américains, Les Italiens, Magazines français (histoires parues en France depuis 20 ans).
- **Défi du jour** : les mêmes cases pour tout le monde, une tentative, résultat à partager en carrés de couleur.
- **Défi entre amis** : un lien qui rejoue exactement les mêmes cases, avec le score à battre.
- **Statistiques et médailles** gardées dans le navigateur (rien n'est envoyé nulle part).
- Clavier : touches 1 à 9 pour répondre, Entrée pour passer à la case suivante.

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
- Les images ne sont pas copiées dans le dépôt : le navigateur les affiche depuis Inducks.

Lancer la mise à jour à la main : onglet *Actions*, workflow *Données Inducks*, *Run workflow*.

## Organisation

```
pipeline/   construction des données (Python, sans dépendance) et ses tests
site/       le site statique publié (HTML, CSS, JavaScript sans framework)
  data/     données générées par le workflow, à ne pas modifier à la main
scripts/    vérifications avant publication, génération des icônes
```

## En local

```bash
python -m unittest discover -s pipeline        # tests du pipeline
python -m http.server -d site 8000             # puis http://localhost:8000
node scripts/check-site.mjs                    # vérifie la cohérence des données
python scripts/make_icons.py                   # régénère les icônes (Playwright)
```

## Crédits

- Données : [Inducks](https://inducks.org), utilisées selon [la licence Inducks](https://inducks.org/inducks/COPYING).
- Idée originale : Duckguessr, par l'équipe de [DucksManager](https://github.com/bperel/DucksManager).
- Les personnages et histoires Disney sont © Disney. Projet de fan, sans lien avec Disney.
- Police : [Shantell Sans](https://fonts.google.com/specimen/Shantell+Sans).
