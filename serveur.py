#!/usr/bin/env python3
"""Petit serveur local pour PseudoIDE.

Sert l'interface (ce dossier) et donne accès en lecture/écriture aux fichiers
de pseudocode d'un dossier racine (par défaut : le dossier parent, ~/hers/methode).

    python3 serveur.py                  # racine = dossier parent
    python3 serveur.py --racine ~/cours # autre dossier
    python3 serveur.py --hote 100.x.y.z # écouter sur une IP (ex : Tailscale)
"""
import argparse
import json
import os
import socket
import sys
import shutil
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ICI = Path(__file__).resolve().parent
EXTENSIONS = {".txt", ".algo", ".pseudo", ".psc"}
HOTES_OK = {"localhost", "127.0.0.1", "[::1]"}


class ErreurApi(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


ACTIONS = {
    "/api/racine": "api_racine", "/api/dossier": "api_dossier", "/api/renommer": "api_renommer",
    "/api/deplacer": "api_deplacer", "/api/supprimer": "api_supprimer",
}


def nom_libre(dossier: Path, nom: str, est_dossier: bool):
    base, ext = (nom, "") if est_dossier else (Path(nom).stem, Path(nom).suffix)
    i = 1
    while True:
        cand = f"{base} copie{'' if i == 1 else ' ' + str(i)}{ext}"
        if not (dossier / cand).exists():
            return cand
        i += 1


def dossier_vide(p: Path):
    """Vrai si le dossier ne contient rien de visible (pour afficher les dossiers qu'on vient de créer)."""
    try:
        return not any(not e.name.startswith(".") for e in p.iterdir())
    except OSError:
        return False


def construire_arbre(dossier: Path, racine: Path):
    enfants = []
    try:
        entrees = sorted(dossier.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except OSError:
        return enfants
    for p in entrees:
        if p.name.startswith(".") or p.resolve() == ICI:
            continue
        rel = p.relative_to(racine).as_posix()
        if p.is_dir():
            sous = construire_arbre(p, racine)
            if sous or dossier_vide(p):
                enfants.append({"nom": p.name, "chemin": rel, "type": "dossier", "enfants": sous})
        elif p.suffix.lower() in EXTENSIONS:
            enfants.append({"nom": p.name, "chemin": rel, "type": "fichier"})
    return enfants


class Gestionnaire(SimpleHTTPRequestHandler):
    racine: Path = ICI.parent  # dossier actuellement ouvert (changeable depuis l'IDE)
    base: Path = ICI.parent    # limite : on ne peut ouvrir que base ou l'un de ses sous-dossiers

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ICI), **kwargs)

    def log_message(self, fmt, *args):
        pass

    # --- sécurité : uniquement en local, chemins confinés à la racine
    def hote_ok(self):
        hote = (self.headers.get("Host") or "").rsplit(":", 1)[0]
        return hote in HOTES_OK

    def chemin_sur(self, rel):
        if not rel:
            return None
        p = (self.racine / rel).resolve()
        if p != self.racine and self.racine not in p.parents:
            return None
        return p

    def dossier_base(self, rel):
        """Dossier de la base (chemin relatif à la base ; vide = la base elle-même)."""
        p = (self.base / rel).resolve() if rel else self.base
        if p != self.base and self.base not in p.parents:
            return None
        return p if p.is_dir() else None

    def rel_base(self, p):
        return "" if p == self.base else p.relative_to(self.base).as_posix()

    def info(self):
        return {"racine": str(self.racine), "nom": self.racine.name,
                "base": self.base.name, "courant": self.rel_base(self.racine)}

    def repondre(self, code, corps, type_="application/json; charset=utf-8"):
        data = corps.encode("utf-8") if isinstance(corps, str) else corps
        self.send_response(code)
        self.send_header("Content-Type", type_)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def erreur(self, code, message):
        self.repondre(code, json.dumps({"erreur": message}))

    def do_GET(self):
        if not self.hote_ok():
            return self.erreur(403, "accès local uniquement")
        url = urlparse(self.path)
        q = parse_qs(url.query)
        if url.path == "/api/info":
            return self.repondre(200, json.dumps(self.info()))
        if url.path == "/api/dossiers":
            rel = q.get("chemin", [""])[0]
            d = self.dossier_base(rel)
            if not d:
                return self.erreur(404, "dossier introuvable")
            try:
                sous = sorted((p for p in d.iterdir() if p.is_dir() and not p.name.startswith(".") and p.resolve() != ICI),
                              key=lambda p: p.name.lower())
            except OSError:
                sous = []
            return self.repondre(200, json.dumps({
                "chemin": rel, "nom": d.name,
                "parent": None if d == self.base else self.rel_base(d.parent),
                "dossiers": [{"nom": p.name, "chemin": self.rel_base(p.resolve())} for p in sous if p.resolve().parent == d],
            }))
        if url.path == "/api/arbre":
            return self.repondre(200, json.dumps(construire_arbre(self.racine, self.racine)))
        if url.path == "/api/fichier":
            p = self.chemin_sur(q.get("chemin", [""])[0])
            if not p or not p.is_file():
                return self.erreur(404, "fichier introuvable")
            return self.repondre(200, p.read_text(encoding="utf-8", errors="replace"), "text/plain; charset=utf-8")
        return super().do_GET()

    def do_PUT(self):
        if not self.hote_ok() or self.headers.get("X-Pseudo-IDE") != "1":
            return self.erreur(403, "refusé")
        url = urlparse(self.path)
        if url.path != "/api/fichier":
            return self.erreur(404, "inconnu")
        p = self.chemin_sur(parse_qs(url.query).get("chemin", [""])[0])
        if not p or p.suffix.lower() not in EXTENSIONS:
            return self.erreur(400, "chemin invalide (extensions permises : " + ", ".join(sorted(EXTENSIONS)) + ")")
        n = int(self.headers.get("Content-Length") or 0)
        texte = self.rfile.read(n).decode("utf-8")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(texte, encoding="utf-8")
        return self.repondre(200, json.dumps({"ok": True, "chemin": p.relative_to(self.racine).as_posix()}))

    # --- actions (POST) : toutes confinées au dossier ouvert, chemins relatifs à celui-ci

    def do_POST(self):
        if not self.hote_ok() or self.headers.get("X-Pseudo-IDE") != "1":
            return self.erreur(403, "refusé")
        action = ACTIONS.get(urlparse(self.path).path)
        if not action:
            return self.erreur(404, "inconnu")
        try:
            n = int(self.headers.get("Content-Length") or 0)
            corps = json.loads(self.rfile.read(n).decode("utf-8")) if n else {}
            if not isinstance(corps, dict):
                raise ValueError
        except ValueError:
            return self.erreur(400, "requête invalide")
        try:
            return self.repondre(200, json.dumps(getattr(self, action)(corps)))
        except ErreurApi as e:
            return self.erreur(e.code, str(e))
        except OSError as e:
            return self.erreur(400, "opération impossible : " + str(e))

    def element(self, rel):
        """Fichier ou dossier existant du dossier ouvert (jamais la racine, jamais un élément caché)."""
        rel = str(rel or "").strip().strip("/")
        p = self.chemin_sur(rel)
        if not p or p == self.racine:
            raise ErreurApi(400, "chemin invalide")
        if any(part.startswith(".") for part in p.relative_to(self.racine).parts):
            raise ErreurApi(400, "élément protégé")
        if not p.exists():
            raise ErreurApi(404, "« " + rel + " » introuvable")
        if p.is_file() and p.suffix.lower() not in EXTENSIONS:
            raise ErreurApi(400, "type de fichier non géré : " + p.name)
        return p

    def rel(self, p):
        return p.relative_to(self.racine).as_posix()

    def api_racine(self, corps):
        d = self.dossier_base(corps.get("chemin", ""))
        if not d:
            raise ErreurApi(400, "dossier invalide")
        Gestionnaire.racine = d
        return self.info()

    def api_dossier(self, corps):
        rel = str(corps.get("chemin", "")).strip().strip("/")
        p = self.chemin_sur(rel)
        if not p or p == self.racine:
            raise ErreurApi(400, "nom de dossier invalide")
        if p.name.startswith("."):
            raise ErreurApi(400, "le nom ne peut pas commencer par un point")
        if p.exists():
            raise ErreurApi(409, "« " + p.name + " » existe déjà")
        p.mkdir(parents=True)
        return {"ok": True, "chemin": self.rel(p)}

    def api_renommer(self, corps):
        src = self.element(corps.get("chemin"))
        nom = str(corps.get("nom", "")).strip()
        if not nom or "/" in nom or "\\" in nom or nom in (".", "..") or nom.startswith("."):
            raise ErreurApi(400, "nom invalide")
        if src.is_file() and Path(nom).suffix.lower() not in EXTENSIONS:
            if Path(nom).suffix:
                raise ErreurApi(400, "extensions permises : " + ", ".join(sorted(EXTENSIONS)))
            nom += ".txt"
        cible = src.parent / nom
        if cible != src and cible.exists():
            raise ErreurApi(409, "« " + nom + " » existe déjà")
        src.rename(cible)
        return {"ok": True, "chemin": self.rel(cible)}

    def api_deplacer(self, corps):
        """Déplace (ou copie si "copier") un ou plusieurs éléments vers un dossier."""
        rels = corps.get("sources") or [corps.get("source")]
        srcs = [self.element(r) for r in rels]
        dest = corps.get("dossier", "")
        dossier = self.racine if not dest else self.chemin_sur(str(dest).strip("/"))
        if not dossier or not dossier.is_dir():
            raise ErreurApi(400, "dossier de destination invalide")
        copier = bool(corps.get("copier"))
        plan = []
        for src in srcs:
            if src.is_dir() and (dossier == src or src in dossier.parents):
                raise ErreurApi(400, "impossible de mettre « " + src.name + " » dans lui-même")
            cible = dossier / src.name
            if cible == src and not copier:
                continue
            if cible.exists():
                if not copier:
                    raise ErreurApi(409, "« " + src.name + " » existe déjà dans ce dossier")
                cible = dossier / nom_libre(dossier, src.name, src.is_dir())
            plan.append((src, cible))
        resultat = []
        for src, cible in plan:
            if copier:
                shutil.copytree(src, cible) if src.is_dir() else shutil.copy2(src, cible)
            else:
                shutil.move(str(src), str(cible))
            resultat.append(self.rel(cible))
        return {"ok": True, "chemins": resultat, "chemin": resultat[0] if resultat else None}

    def api_supprimer(self, corps):
        """Envoie à la corbeille (.corbeille/ dans le dossier ouvert) : rien n'est effacé pour de bon."""
        srcs = [self.element(r) for r in (corps.get("chemins") or [])]
        if not srcs:
            raise ErreurApi(400, "rien à supprimer")
        corbeille = self.racine / ".corbeille" / time.strftime("%Y%m%d-%H%M%S")
        for src in srcs:
            cible = corbeille / src.relative_to(self.racine)
            cible.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(cible))
        return {"ok": True, "nombre": len(srcs)}

def port_libre(depart, hote="127.0.0.1"):
    for port in range(depart, depart + 50):
        with socket.socket() as s:
            try:
                s.bind((hote, port))
                return port
            except OSError:
                continue
    sys.exit("Aucun port libre trouvé")


def main():
    ap = argparse.ArgumentParser(description="PseudoIDE — IDE pour le pseudocode du cours")
    ap.add_argument("--racine", default=str(ICI.parent), help="dossier de départ ; on pourra ouvrir ce dossier ou ses sous-dossiers depuis l'IDE")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--hote", default="127.0.0.1",
                    help="adresse d'écoute (ex : l'IP Tailscale du serveur, ou 0.0.0.0 dans Docker)")
    ap.add_argument("--hotes-autorises", default="",
                    help="noms d'hôte acceptés en plus de localhost, séparés par des virgules (ex : ide.savitime.com)")
    ap.add_argument("--sans-navigateur", action="store_true", help="ne pas ouvrir le navigateur")
    args = ap.parse_args()

    racine = Path(args.racine).expanduser().resolve()
    if not racine.is_dir():
        sys.exit(f"Dossier introuvable : {racine}")
    Gestionnaire.racine = Gestionnaire.base = racine
    HOTES_OK.update(h.strip() for h in args.hotes_autorises.split(",") if h.strip())
    if args.hote not in ("127.0.0.1", "0.0.0.0", "::"):
        HOTES_OK.add(args.hote)
    port = port_libre(args.port, args.hote)
    serveur = ThreadingHTTPServer((args.hote, port), Gestionnaire)
    url = f"http://{'localhost' if args.hote in ('127.0.0.1', '0.0.0.0', '::') else args.hote}:{port}/"
    print(f"PseudoIDE : {url}", flush=True)
    print(f"Dossier des fichiers : {racine}")
    print("Ctrl+C pour arrêter.", flush=True)
    if not args.sans_navigateur:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        serveur.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt.")


if __name__ == "__main__":
    main()
