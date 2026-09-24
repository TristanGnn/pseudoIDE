/*
 * Interpréteur de pseudocode — syntaxe du cours "Méthodes de programmation" (BLOC 1).
 * Lexer -> Parser -> Vérificateur (types, déclarations) -> Machine (exécution pas à pas).
 * Utilisable dans le navigateur (window.Pseudo) et dans Node (module.exports).
 */
(function (global) {
  'use strict';

  // ------------------------------------------------------------------ outils

  function norm(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  const TYPE_LABEL = {
    entier: 'entier', reel: 'réel', caractere: 'caractère',
    booleen: 'booléen', texte: 'texte', inconnu: '?'
  };
  const TYPE_NAMES = ['entier', 'reel', 'caractere', 'booleen', 'texte'];
  const TYPE_HINTS = {
    int: 'entier', integer: 'entier', float: 'reel', double: 'reel', real: 'reel',
    string: 'texte', chaine: 'texte', str: 'texte', char: 'caractere', car: 'caractere',
    boolean: 'booleen', bool: 'booleen', reels: 'reel', entiers: 'entier'
  };

  const KEYWORDS = new Set([
    'debut', 'fin', 'algorithme', 'si', 'alors', 'sinon', 'finsi', 'tantque', 'repeter',
    'fintantque', 'et', 'ou', 'non', 'vrai', 'faux', 'div', 'mod', 'lire', 'ecrire',
    'entier', 'reel', 'caractere', 'booleen', 'texte'
  ]);
  const CLOSERS = new Set(['fin', 'finsi', 'sinon', 'fintantque']);

  const FUNCS = {
    racine: { label: 'racine', arity: 1 },
    carre: { label: 'carré', arity: 1 },
    aleatoire: { label: 'aléatoire', arity: 2 },
    max: { label: 'max', arity: 2 },
    min: { label: 'min', arity: 2 },
    puissance: { label: 'puissance', arity: 2 },
    concat: { label: 'concat', arity: 2 },
    absolu: { label: 'absolu', arity: 1 }
  };

  function diag(severity, message, line, col, len) {
    return { severity, message, line: line || 1, col: col || 1, len: len || 1 };
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const d = [];
    for (let i = 0; i <= m; i++) { d[i] = [i]; }
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1,
          d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[m][n];
  }

  function isNumType(t) { return t === 'entier' || t === 'reel'; }
  function isTextType(t) { return t === 'texte' || t === 'caractere'; }

  // ------------------------------------------------------------------ lexer

  function tokenize(src) {
    const toks = [];
    const diags = [];
    let i = 0, line = 1, col = 1;
    const n = src.length;

    function adv(k) {
      for (k = k || 1; k > 0 && i < n; k--) {
        if (src[i] === '\n') { line++; col = 1; } else { col++; }
        i++;
      }
    }
    function push(type, value, text, l, c) {
      toks.push({ type, value, text, line: l, col: c, len: text.length });
    }

    while (i < n) {
      const c = src[i];
      if (c === '\n' || c === ' ' || c === '\t' || c === '\r' || c === ' ' || c === '﻿') { adv(); continue; }
      const sl = line, sc = col, start = i;

      // commentaires
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') adv(); continue; }
      if (c === '/' && src[i + 1] === '*') {
        adv(2);
        let closed = false;
        while (i < n) {
          if (src[i] === '*' && src[i + 1] === '/') { adv(2); closed = true; break; }
          adv();
        }
        if (!closed) diags.push(diag('error', 'Commentaire /* jamais fermé : il manque */', sl, sc, 2));
        continue;
      }

      // texte
      if (c === '"' || c === '“' || c === '«') {
        adv();
        let s = '', closed = false;
        while (i < n && src[i] !== '\n') {
          const d = src[i];
          if (d === '"' || d === '”' || d === '»') { adv(); closed = true; break; }
          s += d; adv();
        }
        if (!closed) diags.push(diag('error', 'Texte jamais fermé : il manque le " de fin', sl, sc, i - start));
        push('str', s, src.slice(start, i), sl, sc);
        continue;
      }

      // caractère
      if (c === "'" || c === '‘' || c === '’') {
        adv();
        let s = '', closed = false;
        while (i < n && src[i] !== '\n') {
          const d = src[i];
          if (d === "'" || d === '’') { adv(); closed = true; break; }
          s += d; adv();
        }
        if (!closed) {
          diags.push(diag('error', "Caractère jamais fermé : il manque l'apostrophe de fin", sl, sc, i - start));
        } else if ([...s].length !== 1) {
          diags.push(diag('error', [...s].length === 0
            ? "Caractère vide : il faut exactement un symbole entre apostrophes, ex : 'a'"
            : 'Un caractère contient un seul symbole. Pour du texte, utilise des guillemets : "' + s + '"',
          sl, sc, i - start));
        }
        push('char', s, src.slice(start, i), sl, sc);
        continue;
      }

      // nombres
      if (/[0-9]/.test(c)) {
        while (i < n && /[0-9]/.test(src[i])) adv();
        let isInt = true;
        if (src[i] === '.' && /[0-9]/.test(src[i + 1] || '')) {
          isInt = false; adv();
          while (i < n && /[0-9]/.test(src[i])) adv();
        }
        const text = src.slice(start, i);
        if (i < n && /[\p{L}_]/u.test(src[i])) {
          diags.push(diag('error', 'Un nom ne peut pas commencer par un chiffre', sl, sc, text.length + 1));
        }
        const t = { type: 'num', value: Number(text), isInt, text, line: sl, col: sc, len: text.length };
        toks.push(t);
        continue;
      }

      // identifiants / mots-clés
      if (/[\p{L}_]/u.test(c)) {
        while (i < n && /[\p{L}\p{N}_]/u.test(src[i])) adv();
        const text = src.slice(start, i);
        const k = norm(text);
        if (KEYWORDS.has(k)) push('kw', k, text, sl, sc);
        else push('id', text, text, sl, sc);
        continue;
      }

      // opérateurs
      const two = src.substr(i, 2);
      const twoMap = {
        '<-': ['<-'], '<=': ['<='], '>=': ['>='], '<>': ['<>'],
        '==': ['=', "L'égalité s'écrit avec un seul = en pseudocode"],
        '!=': ['<>', "« différent de » s'écrit <> en pseudocode"],
        ':=': ['<-', "L'affectation s'écrit <- en pseudocode"],
        '&&': ['ET', 'Le « et » logique s\'écrit ET'],
        '||': ['OU', 'Le « ou » logique s\'écrit OU']
      };
      if (twoMap[two]) {
        const [v, msg] = twoMap[two];
        adv(2);
        if (msg) diags.push(diag('error', msg, sl, sc, 2));
        if (v === 'ET' || v === 'OU') push('kw', v.toLowerCase(), two, sl, sc);
        else push('op', v, two, sl, sc);
        continue;
      }
      const oneMap = {
        '←': '<-', '≤': '<=', '≥': '>=', '≠': '<>', '–': '-', '—': '-', '−': '-',
        '×': '*', '÷': '/', '<': '<', '>': '>', '=': '=', '+': '+', '-': '-', '*': '*',
        '/': '/', '(': '(', ')': ')', ',': ',', ':': ':'
      };
      if (oneMap[c]) { adv(); push('op', oneMap[c], c, sl, sc); continue; }
      if (c === ';') {
        adv();
        diags.push(diag('warning', 'Pas de point-virgule en pseudocode : il est ignoré', sl, sc, 1));
        continue;
      }
      adv();
      diags.push(diag('error', 'Symbole inattendu « ' + c + ' »', sl, sc, 1));
    }

    // fusion des mots-clés écrits en deux mots : TANT QUE, FIN SI, FIN TANTQUE
    const out = [];
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k], u = toks[k + 1], w = toks[k + 2];
      const same = (a, b) => a && b && a.line === b.line;
      if (t.type === 'id' && norm(t.text) === 'tant' && u && u.type === 'id' && norm(u.text) === 'que' && same(t, u)) {
        diags.push(diag('warning', 'TANTQUE s\'écrit en un seul mot', t.line, t.col, u.col + u.len - t.col));
        out.push({ type: 'kw', value: 'tantque', text: t.text + ' ' + u.text, line: t.line, col: t.col, len: u.col + u.len - t.col });
        k++; continue;
      }
      if (t.type === 'kw' && t.value === 'fin' && same(t, u)) {
        if (u.type === 'kw' && u.value === 'si') {
          diags.push(diag('warning', 'FINSI s\'écrit en un seul mot', t.line, t.col, u.col + u.len - t.col));
          out.push({ type: 'kw', value: 'finsi', text: t.text + ' ' + u.text, line: t.line, col: t.col, len: u.col + u.len - t.col });
          k++; continue;
        }
        if (u.type === 'kw' && u.value === 'tantque') {
          diags.push(diag('warning', 'FINTANTQUE s\'écrit en un seul mot', t.line, t.col, u.col + u.len - t.col));
          out.push({ type: 'kw', value: 'fintantque', text: t.text + ' ' + u.text, line: t.line, col: t.col, len: u.col + u.len - t.col });
          k++; continue;
        }
        if (u.type === 'id' && norm(u.text) === 'tant' && w && w.type === 'id' && norm(w.text) === 'que' && same(u, w)) {
          diags.push(diag('warning', 'FINTANTQUE s\'écrit en un seul mot', t.line, t.col, w.col + w.len - t.col));
          out.push({ type: 'kw', value: 'fintantque', text: 'FIN TANT QUE', line: t.line, col: t.col, len: w.col + w.len - t.col });
          k += 2; continue;
        }
      }
      out.push(t);
    }
    const last = out[out.length - 1];
    out.push({ type: 'eof', value: null, text: '', line: last ? last.line + 1 : 1, col: 1, len: 1 });
    return { tokens: out, diags };
  }

  // ------------------------------------------------------------------ parser

  class ParseError extends Error {
    constructor(message, tok, len) {
      super(message);
      this.tok = tok;
      this.len = len;
    }
  }

  function describe(t) {
    if (t.type === 'eof') return 'la fin du fichier';
    return '« ' + t.text + ' »';
  }

  class Parser {
    constructor(tokens) {
      this.t = tokens;
      this.p = 0;
      this.diags = [];
      this.lastLine = 0;
      this.argDepth = 0;
    }
    peek(k) { return this.t[Math.min(this.p + (k || 0), this.t.length - 1)]; }
    prev() { return this.t[this.p - 1]; }
    next() {
      const t = this.t[this.p];
      if (this.p < this.t.length - 1) this.p++;
      this.lastLine = t.line;
      return t;
    }
    isKw(v, k) { const t = this.peek(k); return t.type === 'kw' && t.value === v; }
    isOp(v, k) { const t = this.peek(k); return t.type === 'op' && t.value === v; }
    error(msg, tok, len) {
      tok = tok || this.peek();
      this.diags.push(diag('error', msg, tok.line, tok.col, len || tok.len));
    }
    fail(msg, tok) { throw new ParseError(msg, tok || this.peek()); }
    expectOp(v, msg) {
      if (this.isOp(v)) return this.next();
      this.fail(msg || ('« ' + v + ' » attendu, trouvé ' + describe(this.peek())));
    }

    // saute jusqu'à la ligne suivante (reprise après erreur)
    sync(line) {
      while (this.peek().type !== 'eof' && this.peek().line <= line) this.next();
    }

    endOfStatement() {
      const t = this.peek();
      if (t.type !== 'eof' && t.line === this.lastLine) {
        this.error('Une seule instruction par ligne : ' + describe(t) + ' est en trop', t);
        this.sync(t.line);
      }
    }

    parseProgram() {
      const prog = { kind: 'Program', name: null, body: [], line: 1 };
      if (this.isKw('algorithme')) {
        const a = this.next();
        if (this.peek().type === 'id' && this.peek().line === a.line) prog.name = this.next().text;
        else this.error('Nom de l\'algorithme attendu après « algorithme »', a);
      }
      if (this.isKw('debut')) {
        const d = this.next();
        prog.line = d.line;
        this.endOfStatement();
      } else {
        this.error('Le programme doit commencer par DEBUT');
      }
      for (;;) {
        prog.body.push(...this.parseBlock(false));
        const t = this.peek();
        if (t.type === 'eof') {
          this.error('FIN manquant : le programme doit se terminer par FIN', this.prev() || t);
          break;
        }
        if (t.type === 'kw' && t.value === 'fin') {
          prog.endLine = t.line;
          this.next();
          const after = this.peek();
          if (after.type !== 'eof') {
            this.error('Il y a du code après FIN : tout doit être entre DEBUT et FIN', after);
          }
          break;
        }
        // fermeture orpheline
        const names = { finsi: 'FINSI sans SI correspondant', sinon: 'SINON sans SI correspondant',
          fintantque: 'FINTANTQUE sans TANTQUE correspondant', tantque: 'TANTQUE inattendu' };
        this.error(names[t.value] || ('Inattendu : ' + describe(t)), t);
        this.sync(t.line);
      }
      return prog;
    }

    // Bloc d'instructions ; s'arrête sur un mot de fermeture (non consommé).
    parseBlock(inRepeat) {
      const body = [];
      for (;;) {
        const t = this.peek();
        if (t.type === 'eof') return body;
        if (t.type === 'kw' && CLOSERS.has(t.value)) return body;
        if (inRepeat && t.type === 'kw' && t.value === 'tantque' && !this.isWhileStart()) return body;
        try {
          const s = this.parseStatement();
          if (s) body.push(s);
        } catch (e) {
          if (!(e instanceof ParseError)) throw e;
          this.argDepth = 0;
          this.diags.push(diag('error', e.message, e.tok.line, e.tok.col, e.len || e.tok.len));
          this.sync(Math.max(e.tok.line, t.line));
        }
      }
    }

    // Dans un REPETER : « TANTQUE cond REPETER » ouvre une boucle, « TANTQUE cond » ferme.
    isWhileStart() {
      const save = this.p, saveDiags = this.diags.length, saveLast = this.lastLine;
      let res = false;
      try {
        this.next();
        this.parseExpr();
        res = this.isKw('repeter');
      } catch (e) {
        res = false;
      }
      this.p = save; this.diags.length = saveDiags; this.lastLine = saveLast;
      return res;
    }

    parseStatement() {
      const t = this.peek();
      if (t.type === 'kw') {
        switch (t.value) {
          case 'si': return this.parseIf();
          case 'tantque': return this.parseWhile();
          case 'repeter': return this.parseRepeat();
          case 'lire': return this.parseRead();
          case 'ecrire': return this.parseWrite();
          case 'debut': this.fail('DEBUT en double : il ne doit apparaître qu\'une fois');
          // falls through
          case 'alors': this.fail('ALORS sans SI');
          // falls through
          default:
            if (TYPE_NAMES.includes(t.value)) {
              this.fail('Dans une déclaration, le nom vient avant le type : x : ' + t.text);
            }
            this.fail('Mot-clé ' + describe(t) + ' inattendu ici');
        }
      }
      if (t.type === 'id') {
        const u = this.peek(1);
        if (u.type === 'op' && (u.value === ',' || u.value === ':')) return this.parseDecl();
        if (u.type === 'op' && u.value === '<-') return this.parseAssign();
        if (u.type === 'op' && u.value === '=') {
          this.error('Pour donner une valeur, utilise <- (le = sert à comparer) : ' + t.text + ' <- …', u);
          return this.parseAssign();
        }
        if (u.type === 'op' && u.value === '(') {
          const k = norm(t.text);
          if (FUNCS[k]) this.fail('Le résultat de ' + FUNCS[k].label + '(…) doit être utilisé, ex : x <- ' + FUNCS[k].label + '(…)');
          const hint = { afficher: 'écrire', print: 'écrire', ecrir: 'écrire', saisir: 'lire', lir: 'lire', input: 'lire', ecrit: 'écrire', ecris: 'écrire' }[k];
          this.fail('« ' + t.text + ' » n\'est pas une instruction connue' + (hint ? ' — tu voulais dire ' + hint + '(…) ?' : ''));
        }
        this.fail('Instruction incomprise après « ' + t.text + ' ». Attendu : une affectation (' + t.text + ' <- …) ou une déclaration (' + t.text + ' : type)');
      }
      if (t.type === 'op' && t.value === '<-') this.fail('Il manque le nom de la variable avant <-');
      this.fail('Inattendu : ' + describe(t));
    }

    parseDecl() {
      const first = this.peek();
      const names = [];
      for (;;) {
        const t = this.peek();
        if (t.type !== 'id') {
          if (t.type === 'kw') this.fail(describe(t) + ' est un mot réservé, il ne peut pas servir de nom de variable');
          this.fail('Nom de variable attendu, trouvé ' + describe(t));
        }
        this.next();
        names.push({ name: t.text, line: t.line, col: t.col, len: t.len });
        if (this.isOp(',')) { this.next(); continue; }
        break;
      }
      this.expectOp(':', '« : » attendu entre le nom et le type, ex : x : entier');
      const ty = this.peek();
      let type = null;
      if (ty.type === 'kw' && TYPE_NAMES.includes(ty.value)) {
        type = ty.value; this.next();
      } else if (ty.type === 'id' && ty.line === first.line) {
        const h = TYPE_HINTS[norm(ty.text)];
        this.fail('Type inconnu « ' + ty.text + ' »' + (h ? ' — en pseudocode on écrit ' + TYPE_LABEL[h] : '. Types possibles : entier, réel, caractère, booléen, texte'), ty);
      } else {
        this.fail('Type attendu après « : » (entier, réel, caractère, booléen, texte)', ty.line === first.line ? ty : this.prev());
      }
      this.endOfStatement();
      return { kind: 'Decl', names, type, line: first.line };
    }

    parseAssign() {
      const t = this.next();
      this.next(); // <- (ou = signalé)
      if (this.peek().line !== t.line && this.peek().line !== this.prev().line) {
        this.fail('Valeur attendue après <-', this.prev());
      }
      const expr = this.parseExpr();
      this.endOfStatement();
      return { kind: 'Assign', target: { name: t.text, line: t.line, col: t.col, len: t.len }, expr, line: t.line };
    }

    parseRead() {
      const k = this.next();
      const targets = [];
      if (!this.isOp('(')) {
        if (this.peek().type === 'id' && this.peek().line === k.line) {
          this.error('lire s\'écrit avec des parenthèses : lire(' + this.peek().text + ')', k, this.peek().col + this.peek().len - k.col);
          const t = this.next();
          targets.push({ name: t.text, line: t.line, col: t.col, len: t.len });
          this.endOfStatement();
          return { kind: 'Read', targets, line: k.line };
        }
        this.fail('« ( » attendu après lire, ex : lire(x)');
      }
      this.next();
      for (;;) {
        const t = this.peek();
        if (t.type !== 'id') this.fail('lire attend un nom de variable, trouvé ' + describe(t));
        this.next();
        if (!this.isOp(',') && !this.isOp(')')) this.fail('lire attend seulement des noms de variables séparés par des virgules');
        targets.push({ name: t.text, line: t.line, col: t.col, len: t.len });
        if (this.isOp(',')) { this.next(); continue; }
        break;
      }
      this.expectOp(')', 'Parenthèse fermante « ) » manquante');
      this.endOfStatement();
      return { kind: 'Read', targets, line: k.line };
    }

    parseWrite() {
      const k = this.next();
      if (!this.isOp('(')) this.fail('« ( » attendu après écrire, ex : écrire("Bonjour")');
      this.next();
      const args = [];
      this.argDepth++;
      if (!this.isOp(')')) {
        for (;;) {
          args.push(this.parseExpr());
          if (this.isOp(',')) { this.next(); continue; }
          break;
        }
      }
      this.argDepth--;
      this.expectOp(')', 'Parenthèse fermante « ) » manquante (ou virgule manquante entre deux éléments)');
      this.endOfStatement();
      return { kind: 'Write', args, line: k.line };
    }

    parseIf() {
      const k = this.next();
      const node = { kind: 'If', branches: [], elseBody: null, line: k.line };
      let cond = this.parseCond('SI');
      this.expectAlors(k);
      let body = this.parseBlock(false);
      node.branches.push({ cond, body, line: k.line });
      while (this.isKw('sinon')) {
        const s = this.next();
        if (this.isKw('si') && this.peek().line === s.line) {
          const si = this.next();
          cond = this.parseCond('SINON SI');
          this.expectAlors(si);
          body = this.parseBlock(false);
          node.branches.push({ cond, body, line: s.line });
          continue;
        }
        node.elseLine = s.line;
        this.endOfStatement();
        node.elseBody = this.parseBlock(false);
        break;
      }
      if (this.isKw('finsi')) {
        node.endLine = this.next().line;
        this.endOfStatement();
      } else {
        this.error('FINSI manquant pour le SI de la ligne ' + k.line, k);
      }
      return node;
    }

    parseCond(what) {
      if (this.isKw('alors')) this.fail('Condition manquante après ' + what);
      return this.parseExpr();
    }

    expectAlors(k) {
      if (this.isKw('alors')) {
        this.next();
        this.endOfStatement();
      } else {
        this.error('ALORS manquant après la condition du SI (ligne ' + k.line + ')',
          this.peek().line === this.lastLine ? this.peek() : this.prev());
        if (this.peek().line === this.lastLine) this.sync(this.lastLine);
      }
    }

    parseWhile() {
      const k = this.next();
      if (this.isKw('repeter')) this.fail('Condition manquante après TANTQUE');
      const cond = this.parseExpr();
      if (this.isKw('repeter')) {
        this.next();
        this.endOfStatement();
      } else {
        const t = this.peek();
        this.error('REPETER attendu après la condition du TANTQUE' +
          (t.type === 'id' && norm(t.text) === 'faire' ? ' (on écrit REPETER, pas FAIRE)' : ''),
          t.line === this.lastLine ? t : this.prev());
        if (t.line === this.lastLine) this.sync(t.line);
      }
      const body = this.parseBlock(false);
      const node = { kind: 'While', cond, body, line: k.line };
      if (this.isKw('fintantque')) {
        node.endLine = this.next().line;
        this.endOfStatement();
      } else {
        this.error('FINTANTQUE manquant pour le TANTQUE de la ligne ' + k.line, k);
      }
      return node;
    }

    parseRepeat() {
      const k = this.next();
      this.endOfStatement();
      const body = this.parseBlock(true);
      const node = { kind: 'Repeat', body, line: k.line };
      if (this.isKw('tantque')) {
        const tq = this.next();
        node.condLine = tq.line;
        node.cond = this.parseExpr();
        this.endOfStatement();
      } else {
        this.error('« TANTQUE condition » manquant pour fermer le REPETER de la ligne ' + k.line, k);
        node.cond = { kind: 'Bool', value: false, line: k.line, col: 1, len: 1 };
        node.condLine = k.line;
      }
      return node;
    }

    // ---------------- expressions (priorités du cours)

    parseExpr() { return this.parseOr(); }

    bin(op, left, right, tok) {
      return { kind: 'Binary', op, left, right, line: tok.line, col: tok.col, len: tok.len };
    }

    parseOr() {
      let e = this.parseAnd();
      while (this.isKw('ou')) { const t = this.next(); e = this.bin('OU', e, this.parseAnd(), t); }
      return e;
    }
    parseAnd() {
      let e = this.parseEq();
      while (this.isKw('et')) { const t = this.next(); e = this.bin('ET', e, this.parseEq(), t); }
      return e;
    }
    parseEq() {
      let e = this.parseRel();
      while (this.isOp('=') || this.isOp('<>')) { const t = this.next(); e = this.bin(t.value, e, this.parseRel(), t); }
      return e;
    }
    parseRel() {
      let e = this.parseAdd();
      while (this.isOp('<') || this.isOp('>') || this.isOp('<=') || this.isOp('>=')) {
        const t = this.next(); e = this.bin(t.value, e, this.parseAdd(), t);
      }
      if (this.isOp('<-')) {
        this.fail('« <- » ne peut pas apparaître dans une expression. Pour comparer à un nombre négatif, écris un espace : x < -5');
      }
      return e;
    }
    parseAdd() {
      let e = this.parseMul();
      while (this.isOp('+') || this.isOp('-')) { const t = this.next(); e = this.bin(t.value, e, this.parseMul(), t); }
      return e;
    }
    parseMul() {
      let e = this.parseUnary();
      while (this.isOp('*') || this.isOp('/') || this.isKw('div') || this.isKw('mod')) {
        const t = this.next();
        e = this.bin(t.type === 'kw' ? t.value : t.value, e, this.parseUnary(), t);
      }
      return e;
    }
    parseUnary() {
      if (this.isKw('non')) {
        const t = this.next();
        return { kind: 'Unary', op: 'NON', expr: this.parseUnary(), line: t.line, col: t.col, len: t.len };
      }
      if (this.isOp('-') || this.isOp('+')) {
        const t = this.next();
        const e = this.parseUnary();
        if (t.value === '+') return e;
        return { kind: 'Unary', op: '-', expr: e, line: t.line, col: t.col, len: t.len };
      }
      return this.parsePrimary();
    }
    parsePrimary() {
      const t = this.peek();
      if (t.type === 'num') {
        this.next();
        const u = this.peek(), w = this.peek(1);
        if (this.argDepth === 0 && t.isInt && u.type === 'op' && u.value === ',' && u.line === t.line &&
            u.col === t.col + t.len && w.type === 'num' && w.col === u.col + 1 && w.isInt) {
          // 18,5 : erreur, mais on continue comme si c'était 18.5
          this.error('Les nombres décimaux s\'écrivent avec un point : ' + t.text + '.' + w.text + ' (pas ' + t.text + ',' + w.text + ')', t, t.len + 1 + w.len);
          this.next(); this.next();
          return { kind: 'Num', value: Number(t.text + '.' + w.text), isInt: false, line: t.line, col: t.col, len: t.len + 1 + w.len };
        }
        return { kind: 'Num', value: t.value, isInt: t.isInt, line: t.line, col: t.col, len: t.len };
      }
      if (t.type === 'str') { this.next(); return { kind: 'Str', value: t.value, line: t.line, col: t.col, len: t.len }; }
      if (t.type === 'char') { this.next(); return { kind: 'Char', value: t.value, line: t.line, col: t.col, len: t.len }; }
      if (t.type === 'kw' && (t.value === 'vrai' || t.value === 'faux')) {
        this.next();
        return { kind: 'Bool', value: t.value === 'vrai', line: t.line, col: t.col, len: t.len };
      }
      if (t.type === 'op' && t.value === '(') {
        this.next();
        const e = this.parseExpr();
        this.expectOp(')', 'Parenthèse fermante « ) » manquante');
        return e;
      }
      if (t.type === 'id') {
        this.next();
        if (this.isOp('(')) {
          const k = norm(t.text);
          if (!FUNCS[k]) this.fail('« ' + t.text + ' » n\'est pas une fonction connue (fonctions : racine, carré, aléatoire, max, min, puissance, concat, absolu)', t);
          this.next();
          const args = [];
          this.argDepth++;
          if (!this.isOp(')')) {
            for (;;) {
              args.push(this.parseExpr());
              if (this.isOp(',')) { this.next(); continue; }
              break;
            }
          }
          this.argDepth--;
          this.expectOp(')', 'Parenthèse fermante « ) » manquante après les arguments de ' + t.text);
          return { kind: 'Call', name: k, text: t.text, args, line: t.line, col: t.col, len: t.len };
        }
        return { kind: 'Var', name: t.text, line: t.line, col: t.col, len: t.len };
      }
      // erreurs lisibles
      const p = this.prev();
      let msg = 'Valeur ou expression attendue, trouvé ' + describe(t);
      if (p && p.type === 'kw' && p.value === 'non') {
        const pp = this.t[this.p - 2];
        if (pp && pp.type === 'op' && (pp.value === '=' || pp.value === '<>')) {
          this.error('Pour comparer à un texte, mets-le entre guillemets : "' + p.text + '" (NON est un mot-clé)', p);
          return { kind: 'Str', value: p.text, line: p.line, col: p.col, len: p.len, recovered: true };
        }
        msg = 'Il manque une condition après NON';
      } else if (t.type === 'kw' && (t.value === 'alors' || t.value === 'repeter')) {
        msg = 'Condition incomplète avant ' + t.text.toUpperCase();
      }
      this.fail(msg, t);
    }
  }

  // ------------------------------------------------------------------ vérificateur

  function check(prog) {
    const diags = [];
    const vars = new Map();           // nom -> {type, line, used, reads}
    const laterDecls = new Map();     // toutes les déclarations (pour « utilisée avant déclaration »)
    const err = (m, n, len) => diags.push(diag('error', m, n.line, n.col, len || n.len));
    const warn = (m, n, len) => diags.push(diag('warning', m, n.line, n.col, len || n.len));

    (function collect(stmts) {
      for (const s of stmts) {
        if (s.kind === 'Decl') for (const d of s.names) if (!laterDecls.has(d.name)) laterDecls.set(d.name, s.line);
        if (s.kind === 'If') { s.branches.forEach(b => collect(b.body)); if (s.elseBody) collect(s.elseBody); }
        if (s.kind === 'While' || s.kind === 'Repeat') collect(s.body);
      }
    })(prog.body);

    function unknownVar(name, node) {
      const k = norm(name);
      if (FUNCS[k]) return err(FUNCS[k].label + ' est une fonction : il faut des parenthèses, ex : ' + FUNCS[k].label + '(x)', node);
      if (laterDecls.has(name)) return err('« ' + name + ' » est utilisée avant sa déclaration (ligne ' + laterDecls.get(name) + ')', node);
      let hint = '';
      for (const other of vars.keys()) {
        if (norm(other) === k) { hint = ' — tu voulais dire « ' + other + ' » ? (attention aux accents et majuscules)'; break; }
      }
      if (!hint) {
        let best = null, bd = 3;
        for (const other of vars.keys()) {
          const d = levenshtein(norm(other), k);
          if (d < bd && d <= Math.max(1, Math.floor(k.length / 3))) { bd = d; best = other; }
        }
        if (best) hint = ' — tu voulais dire « ' + best + ' » ?';
      }
      err('La variable « ' + name + ' » n\'est pas déclarée' + hint, node);
    }

    // assigned : ensemble des variables certainement initialisées à ce point
    function typeOf(e, assigned) {
      switch (e.kind) {
        case 'Num': return e.isInt ? 'entier' : 'reel';
        case 'Str': return 'texte';
        case 'Char': return 'caractere';
        case 'Bool': return 'booleen';
        case 'Var': {
          const v = vars.get(e.name);
          if (!v) { unknownVar(e.name, e); return 'inconnu'; }
          v.used = true;
          if (assigned && !assigned.has(e.name) && !v.warnedInit) {
            v.warnedInit = true;
            warn('« ' + e.name + ' » risque d\'être utilisée sans avoir reçu de valeur (pas initialisée)', e);
          }
          return v.type;
        }
        case 'Unary': {
          const t = typeOf(e.expr, assigned);
          if (t === 'inconnu') return t;
          if (e.op === 'NON') {
            if (t !== 'booleen') {
              err('NON s\'applique à une condition (booléen), pas à un ' + TYPE_LABEL[t] +
                (e.expr.kind === 'Var' || e.expr.kind === 'Num' ? '. Mets des parenthèses : NON (… = …)' : ''), e);
              return 'inconnu';
            }
            return 'booleen';
          }
          if (!isNumType(t)) { err('Le signe - s\'applique à un nombre, pas à un ' + TYPE_LABEL[t], e); return 'inconnu'; }
          return t;
        }
        case 'Binary': {
          const a = typeOf(e.left, assigned), b = typeOf(e.right, assigned);
          if (a === 'inconnu' || b === 'inconnu') {
            return ['=', '<>', '<', '>', '<=', '>=', 'ET', 'OU'].includes(e.op) ? 'booleen' : 'inconnu';
          }
          const la = TYPE_LABEL[a], lb = TYPE_LABEL[b];
          switch (e.op) {
            case '+': case '-': case '*':
              if (isNumType(a) && isNumType(b)) return a === 'entier' && b === 'entier' ? 'entier' : 'reel';
              if (e.op === '+' && (isTextType(a) || isTextType(b))) {
                err('On ne peut pas additionner du texte avec +. Dans écrire, sépare par des virgules : écrire("…", x). Sinon utilise concat(t1, t2)', e);
              } else {
                err('« ' + e.op + ' » s\'utilise entre deux nombres (ici : ' + la + ' et ' + lb + ')', e);
              }
              return 'inconnu';
            case '/':
              if (isNumType(a) && isNumType(b)) return 'reel';
              err('« / » s\'utilise entre deux nombres (ici : ' + la + ' et ' + lb + ')', e);
              return 'inconnu';
            case 'div': case 'mod':
              if (a === 'entier' && b === 'entier') return 'entier';
              err(e.op + ' s\'utilise entre deux entiers (ici : ' + la + ' et ' + lb + ')', e);
              return 'inconnu';
            case '<': case '>': case '<=': case '>=':
              if ((isNumType(a) && isNumType(b)) || (isTextType(a) && isTextType(b))) return 'booleen';
              err('Comparaison « ' + e.op + ' » impossible entre ' + la + ' et ' + lb, e);
              return 'booleen';
            case '=': case '<>':
              if ((isNumType(a) && isNumType(b)) || (isTextType(a) && isTextType(b)) || (a === 'booleen' && b === 'booleen')) return 'booleen';
              err('Comparaison « ' + e.op + ' » impossible entre ' + la + ' et ' + lb +
                (isTextType(a) && e.right.kind === 'Var' ? ' — pour un texte fixe, mets-le entre guillemets' : ''), e);
              return 'booleen';
            case 'ET': case 'OU':
              if (a !== 'booleen' || b !== 'booleen') {
                err(e.op + ' relie deux conditions (booléens), ici : ' + la + ' et ' + lb +
                  '. Répète la variable : x = 1 ' + e.op + ' x = 2', e);
              }
              return 'booleen';
          }
          return 'inconnu';
        }
        case 'Call': {
          const f = FUNCS[e.name];
          const ts = e.args.map(a => typeOf(a, assigned));
          if (e.args.length !== f.arity) {
            err(f.label + ' attend ' + f.arity + ' argument' + (f.arity > 1 ? 's' : '') + ', pas ' + e.args.length, e);
            return 'inconnu';
          }
          if (ts.includes('inconnu')) return e.name === 'concat' ? 'texte' : 'inconnu';
          const needNum = (i) => {
            if (!isNumType(ts[i])) { err(f.label + ' attend un nombre (argument ' + (i + 1) + ' : ' + TYPE_LABEL[ts[i]] + ')', e.args[i]); return false; }
            return true;
          };
          const needInt = (i) => {
            if (ts[i] !== 'entier') { err(f.label + ' attend un entier (argument ' + (i + 1) + ' : ' + TYPE_LABEL[ts[i]] + ')', e.args[i]); return false; }
            return true;
          };
          switch (e.name) {
            case 'racine': needNum(0); return 'reel';
            case 'carre': case 'absolu': return needNum(0) ? ts[0] : 'inconnu';
            case 'aleatoire': needInt(0); needInt(1); return 'entier';
            case 'max': case 'min':
              if (needNum(0) & needNum(1)) return ts[0] === 'entier' && ts[1] === 'entier' ? 'entier' : 'reel';
              return 'inconnu';
            case 'puissance': needNum(0); needInt(1); return ts[0] === 'entier' ? 'entier' : 'reel';
            case 'concat':
              for (let i = 0; i < 2; i++) if (!isTextType(ts[i])) err('concat attend du texte (argument ' + (i + 1) + ' : ' + TYPE_LABEL[ts[i]] + ')', e.args[i]);
              return 'texte';
          }
        }
      }
      return 'inconnu';
    }

    function checkAssignable(target, tv, te, node) {
      if (tv === 'inconnu' || te === 'inconnu') return;
      const ok =
        tv === te ||
        (tv === 'reel' && te === 'entier') ||
        (tv === 'texte' && te === 'caractere');
      if (ok) return;
      if (tv === 'entier' && te === 'reel') {
        warn('Le résultat est un réel mais « ' + target + ' » est un entier : le programme plantera à l\'exécution. Utilise div pour une division entière', node);
        return;
      }
      err('Types incompatibles : impossible de ranger un ' + TYPE_LABEL[te] + ' dans « ' + target + ' » qui est un ' + TYPE_LABEL[tv] +
        (tv === 'caractere' && te === 'texte' ? ". Un caractère s'écrit entre apostrophes : 'a'" : ''), node);
    }

    function cond(e, assigned, what) {
      const t = typeOf(e, assigned);
      if (t !== 'booleen' && t !== 'inconnu') {
        err('La condition du ' + what + ' doit être vraie ou fausse (booléen), pas un ' + TYPE_LABEL[t], e);
      }
    }

    function block(stmts, assigned) {
      for (const s of stmts) stmt(s, assigned);
    }

    function stmt(s, assigned) {
      switch (s.kind) {
        case 'Decl':
          for (const d of s.names) {
            const k = norm(d.name);
            if (FUNCS[k]) { err('« ' + d.name + ' » est le nom d\'une fonction prédéfinie, choisis un autre nom', d); continue; }
            if (vars.has(d.name)) { err('« ' + d.name + ' » est déjà déclarée (ligne ' + vars.get(d.name).line + ')', d); continue; }
            vars.set(d.name, { type: s.type, line: s.line, node: d, used: false });
          }
          break;
        case 'Assign': {
          const te = typeOf(s.expr, assigned);
          const v = vars.get(s.target.name);
          if (!v) { unknownVar(s.target.name, s.target); break; }
          v.used = true;
          checkAssignable(s.target.name, v.type, te, s.expr.kind === 'Binary' ? s.target : s.expr);
          assigned.add(s.target.name);
          break;
        }
        case 'Read':
          for (const t of s.targets) {
            const v = vars.get(t.name);
            if (!v) { unknownVar(t.name, t); continue; }
            v.used = true;
            assigned.add(t.name);
          }
          break;
        case 'Write':
          for (const a of s.args) typeOf(a, assigned);
          break;
        case 'If': {
          const results = [];
          for (const b of s.branches) {
            cond(b.cond, assigned, 'SI');
            const inner = new Set(assigned);
            block(b.body, inner);
            results.push(inner);
          }
          if (s.elseBody) {
            const inner = new Set(assigned);
            block(s.elseBody, inner);
            results.push(inner);
            for (const name of results[0]) {
              if (results.every(r => r.has(name))) assigned.add(name);
            }
          }
          break;
        }
        case 'While': {
          cond(s.cond, assigned, 'TANTQUE');
          block(s.body, new Set(assigned));
          break;
        }
        case 'Repeat':
          block(s.body, assigned);
          cond(s.cond, assigned, 'REPETER … TANTQUE');
          break;
      }
    }

    block(prog.body, new Set());
    for (const [name, v] of vars) {
      if (!v.used) warn('« ' + name + ' » est déclarée mais jamais utilisée', v.node);
    }
    return diags;
  }

  // ------------------------------------------------------------------ exécution

  class RuntimeError extends Error {
    constructor(message, node) {
      super(message);
      this.line = node ? node.line : 0;
      this.col = node ? node.col : 1;
      this.len = node ? node.len : 1;
    }
  }

  function fmtReal(v) {
    if (!isFinite(v)) return String(v);
    let r = Number(v.toPrecision(12));
    if (Object.is(r, -0)) r = 0;
    if (Number.isInteger(r) && Math.abs(r) < 1e21) return r.toFixed(1);
    return String(r);
  }

  function format(val) {
    if (!val) return '?';
    switch (val.t) {
      case 'entier': return String(val.v);
      case 'reel': return fmtReal(val.v);
      case 'booleen': return val.v ? 'VRAI' : 'FAUX';
      default: return String(val.v);
    }
  }

  function formatLiteral(val) {
    if (!val) return '?';
    if (val.t === 'texte') return '"' + val.v + '"';
    if (val.t === 'caractere') return "'" + val.v + "'";
    return format(val);
  }

  function parseInput(raw, type) {
    const s = raw.trim();
    switch (type) {
      case 'entier':
        if (/^[+-]?\d+$/.test(s)) return { t: 'entier', v: parseInt(s, 10) };
        return { error: '« ' + raw + ' » n\'est pas un entier valide' };
      case 'reel': {
        const s2 = s.replace(',', '.');
        if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s2)) return { t: 'reel', v: parseFloat(s2) };
        return { error: '« ' + raw + ' » n\'est pas un nombre réel valide' };
      }
      case 'booleen': {
        const k = norm(s);
        if (k === 'vrai') return { t: 'booleen', v: true };
        if (k === 'faux') return { t: 'booleen', v: false };
        return { error: 'Tape VRAI ou FAUX' };
      }
      case 'caractere':
        if ([...raw].length === 1) return { t: 'caractere', v: raw };
        return { error: 'Tape exactement un caractère' };
      default:
        return { t: 'texte', v: raw };
    }
  }

  class Machine {
    constructor(prog, io) {
      this.prog = prog;
      this.io = io || {};
      this.mem = new Map();
      this.order = [];
      this.steps = 0;
      this.line = 0;
      this.lastChanged = null;
    }

    snapshot() {
      return this.order.map(name => {
        const c = this.mem.get(name);
        return { name, type: c.type, addr: c.addr, value: c.value, text: c.value ? formatLiteral(c.value) : '?' };
      });
    }

    declare(name, type) {
      if (this.mem.has(name)) return;
      const addr = '0x' + (this.order.length + 1).toString(16).padStart(3, '0');
      this.mem.set(name, { type, value: null, addr });
      this.order.push(name);
    }

    store(name, val, node) {
      const cell = this.mem.get(name);
      if (!cell) throw new RuntimeError('La variable « ' + name + ' » n\'est pas déclarée', node);
      let v = val;
      if (cell.type === 'reel' && val.t === 'entier') v = { t: 'reel', v: val.v };
      else if (cell.type === 'texte' && val.t === 'caractere') v = { t: 'texte', v: val.v };
      else if (cell.type !== val.t) {
        throw new RuntimeError('Impossible de ranger ' + formatLiteral(val) + ' (' + TYPE_LABEL[val.t] + ') dans « ' + name +
          ' » qui est un ' + TYPE_LABEL[cell.type] + (cell.type === 'entier' && val.t === 'reel' ? '. Pour une division entière, utilise div' : ''), node);
      }
      cell.value = v;
      this.lastChanged = name;
      if (this.io.change) this.io.change(name, v, node.line);
    }

    *run() {
      yield* this.block(this.prog.body);
      if (this.prog.endLine) yield { type: 'step', line: this.prog.endLine, end: true };
    }

    *block(stmts) {
      for (const s of stmts) yield* this.stmt(s);
    }

    *step(line) {
      this.steps++;
      this.line = line;
      yield { type: 'step', line };
    }

    *stmt(s) {
      switch (s.kind) {
        case 'Decl':
          yield* this.step(s.line);
          for (const d of s.names) this.declare(d.name, s.type);
          break;
        case 'Assign': {
          yield* this.step(s.line);
          const v = this.eval(s.expr);
          this.store(s.target.name, v, s.target);
          break;
        }
        case 'Read':
          yield* this.step(s.line);
          for (const t of s.targets) {
            const cell = this.mem.get(t.name);
            if (!cell) throw new RuntimeError('La variable « ' + t.name + ' » n\'est pas déclarée', t);
            for (;;) {
              const raw = yield { type: 'read', name: t.name, varType: cell.type, line: s.line };
              const r = parseInput(raw == null ? '' : String(raw), cell.type);
              if (r.error) {
                if (this.io.warn) this.io.warn(r.error + ' — « ' + t.name + ' » est un ' + TYPE_LABEL[cell.type] + ', recommence.');
                continue;
              }
              this.store(t.name, r, t);
              break;
            }
          }
          break;
        case 'Write': {
          yield* this.step(s.line);
          const text = s.args.map(a => format(this.eval(a))).join('');
          if (this.io.write) this.io.write(text + '\n');
          break;
        }
        case 'If': {
          yield* this.step(s.line);
          for (let i = 0; i < s.branches.length; i++) {
            const b = s.branches[i];
            if (i > 0) yield* this.step(b.line);
            if (this.condition(b.cond, 'SI')) {
              yield* this.block(b.body);
              return;
            }
          }
          if (s.elseBody) {
            yield* this.step(s.elseLine);
            yield* this.block(s.elseBody);
          }
          break;
        }
        case 'While':
          for (;;) {
            yield* this.step(s.line);
            if (!this.condition(s.cond, 'TANTQUE')) break;
            yield* this.block(s.body);
          }
          break;
        case 'Repeat':
          for (;;) {
            yield* this.step(s.line);
            yield* this.block(s.body);
            yield* this.step(s.condLine);
            if (!this.condition(s.cond, 'TANTQUE')) break;
          }
          break;
      }
    }

    condition(e, what) {
      const v = this.eval(e);
      if (v.t !== 'booleen') throw new RuntimeError('La condition du ' + what + ' doit être un booléen', e);
      return v.v;
    }

    eval(e) {
      switch (e.kind) {
        case 'Num': return { t: e.isInt ? 'entier' : 'reel', v: e.value };
        case 'Str': return { t: 'texte', v: e.value };
        case 'Char': return { t: 'caractere', v: e.value };
        case 'Bool': return { t: 'booleen', v: e.value };
        case 'Var': {
          const c = this.mem.get(e.name);
          if (!c) throw new RuntimeError('La variable « ' + e.name + ' » n\'est pas déclarée', e);
          if (!c.value) throw new RuntimeError('La variable « ' + e.name + ' » n\'est pas initialisée : elle n\'a encore reçu aucune valeur (lire ou <-)', e);
          return c.value;
        }
        case 'Unary': {
          const v = this.eval(e.expr);
          if (e.op === 'NON') {
            if (v.t !== 'booleen') throw new RuntimeError('NON s\'applique à un booléen', e);
            return { t: 'booleen', v: !v.v };
          }
          if (!isNumType(v.t)) throw new RuntimeError('Le signe - s\'applique à un nombre', e);
          return { t: v.t, v: -v.v };
        }
        case 'Binary': return this.binary(e);
        case 'Call': return this.call(e);
      }
      throw new RuntimeError('Expression inconnue', e);
    }

    binary(e) {
      if (e.op === 'ET' || e.op === 'OU') {
        const a = this.eval(e.left);
        if (a.t !== 'booleen') throw new RuntimeError(e.op + ' relie deux booléens', e);
        if (e.op === 'ET' && !a.v) return { t: 'booleen', v: false };
        if (e.op === 'OU' && a.v) return { t: 'booleen', v: true };
        const b = this.eval(e.right);
        if (b.t !== 'booleen') throw new RuntimeError(e.op + ' relie deux booléens', e);
        return { t: 'booleen', v: b.v };
      }
      const a = this.eval(e.left), b = this.eval(e.right);
      const bothNum = isNumType(a.t) && isNumType(b.t);
      const numType = a.t === 'entier' && b.t === 'entier' ? 'entier' : 'reel';
      const bad = () => new RuntimeError('Opération « ' + e.op + ' » impossible entre ' + TYPE_LABEL[a.t] + ' et ' + TYPE_LABEL[b.t], e);
      switch (e.op) {
        case '+': if (!bothNum) throw bad(); return { t: numType, v: a.v + b.v };
        case '-': if (!bothNum) throw bad(); return { t: numType, v: a.v - b.v };
        case '*': if (!bothNum) throw bad(); return { t: numType, v: a.v * b.v };
        case '/':
          if (!bothNum) throw bad();
          if (b.v === 0) throw new RuntimeError('Division par zéro : le programme plante !', e);
          return { t: 'reel', v: a.v / b.v };
        case 'div': case 'mod':
          if (a.t !== 'entier' || b.t !== 'entier') throw bad();
          if (b.v === 0) throw new RuntimeError((e.op === 'div' ? 'Division' : 'Modulo') + ' par zéro : le programme plante !', e);
          return { t: 'entier', v: e.op === 'div' ? Math.trunc(a.v / b.v) : a.v % b.v };
        case '<': case '>': case '<=': case '>=': case '=': case '<>': {
          const comparable = bothNum || (isTextType(a.t) && isTextType(b.t)) ||
            (a.t === 'booleen' && b.t === 'booleen' && (e.op === '=' || e.op === '<>'));
          if (!comparable) throw bad();
          const x = a.v, y = b.v;
          const r = { '<': x < y, '>': x > y, '<=': x <= y, '>=': x >= y, '=': x === y, '<>': x !== y }[e.op];
          return { t: 'booleen', v: r };
        }
      }
      throw bad();
    }

    call(e) {
      const args = e.args.map(a => this.eval(a));
      const f = FUNCS[e.name];
      if (args.length !== f.arity) throw new RuntimeError(f.label + ' attend ' + f.arity + ' argument(s)', e);
      const num = (i) => { if (!isNumType(args[i].t)) throw new RuntimeError(f.label + ' attend un nombre', e.args[i]); return args[i].v; };
      const int = (i) => { if (args[i].t !== 'entier') throw new RuntimeError(f.label + ' attend un entier', e.args[i]); return args[i].v; };
      switch (e.name) {
        case 'racine': {
          const x = num(0);
          if (x < 0) throw new RuntimeError('racine d\'un nombre négatif (' + format(args[0]) + ') : impossible !', e);
          return { t: 'reel', v: Math.sqrt(x) };
        }
        case 'carre': { const x = num(0); return { t: args[0].t, v: x * x }; }
        case 'absolu': { const x = num(0); return { t: args[0].t, v: Math.abs(x) }; }
        case 'aleatoire': {
          const a = int(0), b = int(1);
          if (a > b) throw new RuntimeError('aléatoire(a, b) : a doit être plus petit ou égal à b', e);
          return { t: 'entier', v: a + Math.floor(Math.random() * (b - a + 1)) };
        }
        case 'max': case 'min': {
          const a = num(0), b = num(1);
          const t = args[0].t === 'entier' && args[1].t === 'entier' ? 'entier' : 'reel';
          return { t, v: e.name === 'max' ? Math.max(a, b) : Math.min(a, b) };
        }
        case 'puissance': {
          const a = num(0), b = int(1);
          if (a === 0 && b < 0) throw new RuntimeError('puissance(0, négatif) : division par zéro !', e);
          const t = args[0].t === 'entier' && b >= 0 ? 'entier' : 'reel';
          return { t, v: Math.pow(a, b) };
        }
        case 'concat': {
          if (!isTextType(args[0].t) || !isTextType(args[1].t)) throw new RuntimeError('concat attend du texte', e);
          return { t: 'texte', v: String(args[0].v) + String(args[1].v) };
        }
      }
      throw new RuntimeError('Fonction inconnue', e);
    }
  }

  // ------------------------------------------------------------------ API

  function analyse(src) {
    const lx = tokenize(src);
    const ps = new Parser(lx.tokens);
    const prog = ps.parseProgram();
    let diags = lx.diags.concat(ps.diags);
    const hasSyntaxError = diags.some(d => d.severity === 'error');
    if (!hasSyntaxError) diags = diags.concat(check(prog));
    diags.sort((a, b) => a.line - b.line || a.col - b.col);
    return { prog, tokens: lx.tokens, diags, ok: !diags.some(d => d.severity === 'error') };
  }

  // Exécution synchrone (tests / ligne de commande)
  function runSync(src, inputs, maxSteps) {
    const a = analyse(src);
    let out = '';
    if (!a.ok) return { ok: false, diags: a.diags, output: out };
    const queue = (inputs || []).slice();
    const m = new Machine(a.prog, { write: s => { out += s; }, warn: s => { out += '[!] ' + s + '\n'; } });
    const g = m.run();
    let res = g.next();
    try {
      while (!res.done) {
        if (m.steps > (maxSteps || 1e6)) return { ok: false, output: out, runtimeError: { message: 'Trop d\'étapes : boucle infinie ?', line: m.line } };
        if (res.value.type === 'read') {
          if (!queue.length) return { ok: false, output: out, runtimeError: { message: 'Plus d\'entrée disponible', line: res.value.line } };
          const v = queue.shift();
          out += String(v) + '\n';
          res = g.next(v);
        } else {
          res = g.next();
        }
      }
    } catch (e) {
      if (e instanceof RuntimeError) return { ok: false, output: out, runtimeError: { message: e.message, line: e.line }, memory: m.snapshot() };
      throw e;
    }
    return { ok: true, output: out, diags: a.diags, memory: m.snapshot() };
  }

  const api = { tokenize, analyse, check, Machine, RuntimeError, runSync, format, formatLiteral, norm, TYPE_LABEL, FUNCS, KEYWORDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Pseudo = api;
})(typeof window !== 'undefined' ? window : globalThis);
