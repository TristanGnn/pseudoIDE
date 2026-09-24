# PseudoIDE

IDE dans le navigateur pour le pseudocode du cours **Méthodes de programmation (BLOC 1)** :
édition avec coloration syntaxique, vérification des erreurs en direct (messages en français),
exécution, pas à pas avec points d'arrêt, vue de la mémoire et tableau de traçage.

## Lancer

```bash
python3 serveur.py              # sert l'IDE et donne accès aux .txt du dossier parent
python3 serveur.py --racine ~/mes_exercices --port 9000
```

Le navigateur s'ouvre sur `http://localhost:8765/`. Sans serveur, `index.html` fonctionne aussi
(ouverture par sélection de fichier et enregistrement par téléchargement).

Installer la commande `pseudo` :

```bash
ln -s "$PWD/pseudo-ide" ~/.local/bin/pseudo
```

## Syntaxe prise en charge

```
algorithme Exemple
DEBUT
    x, y : entier            // entier, réel, caractère, booléen, texte
    lire(x)
    y <- x * 2 + aléatoire(1, 6)
    SI y > 10 ET NON (x = 3) ALORS
        écrire("grand : ", y)
    SINON SI y > 5 ALORS
        écrire("moyen")
    SINON
        écrire("petit")
    FINSI
    TANTQUE x > 0 REPETER
        x <- x - 1
    FINTANTQUE
    REPETER
        x <- x + 1
    TANTQUE x < 3
FIN
```

Opérateurs : `* / div mod + - < > <= >= = <> ET OU NON`.
Fonctions : `racine`, `carré`, `puissance`, `aléatoire`, `max`, `min`, `absolu`, `concat`.

## Raccourcis

| Touche | Action |
|---|---|
| F5 | Exécuter / continuer |
| F10 | Pas à pas |
| Maj+F5 | Arrêter |
| Ctrl+S / Ctrl+Maj+S | Enregistrer / enregistrer sous |
| Ctrl+Maj+F | Réindenter |
| Ctrl+/ | Commenter |
| Clic sur un n° de ligne | Point d'arrêt |

## Fichiers

- `interpreteur.js` : lexer, parser, vérificateur de types et machine d'exécution (utilisable aussi avec Node)
- `app.js`, `index.html`, `style.css` : interface
- `serveur.py` : serveur local (Python 3, bibliothèque standard uniquement)
