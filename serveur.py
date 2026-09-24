#!/usr/bin/env python3
"""Petit serveur local pour PseudoIDE.

Sert l'interface (ce dossier) et donne accès en lecture/écriture aux fichiers
de pseudocode d'un dossier racine (par défaut : le dossier parent, ~/hers/methode).

    python3 serveur.py                  # racine = dossier parent
    python3 serveur.py --racine ~/cours # autre dossier
"""
import argparse
import json
import os
import socket
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ICI = Path(__file__).resolve().parent
EXTENSIONS = {".txt", ".algo", ".pseudo", ".psc"}
HOTES_OK = {"localhost", "127.0.0.1", "[::1]"}


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
            if sous:
                enfants.append({"nom": p.name, "chemin": rel, "type": "dossier", "enfants": sous})
        elif p.suffix.lower() in EXTENSIONS:
            enfants.append({"nom": p.name, "chemin": rel, "type": "fichier"})
    return enfants


class Gestionnaire(SimpleHTTPRequestHandler):
    racine: Path = ICI.parent

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
            return self.repondre(200, json.dumps({"racine": str(self.racine), "nom": self.racine.name}))
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


def port_libre(depart):
    for port in range(depart, depart + 50):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    sys.exit("Aucun port libre trouvé")


def main():
    ap = argparse.ArgumentParser(description="PseudoIDE — IDE pour le pseudocode du cours")
    ap.add_argument("--racine", default=str(ICI.parent), help="dossier contenant les fichiers .txt")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--sans-navigateur", action="store_true", help="ne pas ouvrir le navigateur")
    args = ap.parse_args()

    racine = Path(args.racine).expanduser().resolve()
    if not racine.is_dir():
        sys.exit(f"Dossier introuvable : {racine}")
    Gestionnaire.racine = racine
    port = port_libre(args.port)
    serveur = ThreadingHTTPServer(("127.0.0.1", port), Gestionnaire)
    url = f"http://localhost:{port}/"
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
