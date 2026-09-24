/* PseudoIDE — interface. Dépend de interpreteur.js (window.Pseudo). */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const norm = Pseudo.norm;
  const INDENT = '    ';

  const store = {
    get(k, d) { try { const v = localStorage.getItem('pseudoide.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('pseudoide.' + k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
  };

  // ================================================================ préférences

  const prefs = Object.assign({ theme: 'dark', fs: 15, speed: '0', wSidebar: 230, wRight: 300, hBottom: 230 }, store.get('prefs', {}));
  const root = document.documentElement;

  function applyPrefs() {
    root.dataset.theme = prefs.theme;
    root.style.setProperty('--fs', prefs.fs + 'px');
    root.style.setProperty('--lh', Math.round(prefs.fs * 1.47) + 'px');
    root.style.setProperty('--w-sidebar', prefs.wSidebar + 'px');
    root.style.setProperty('--w-right', prefs.wRight + 'px');
    root.style.setProperty('--h-bottom', prefs.hBottom + 'px');
    $('#speed').value = prefs.speed;
    measure();
  }
  function savePrefs() { store.set('prefs', prefs); }

  // ================================================================ serveur

  const server = { ok: false, rootName: 'Fichiers' };

  async function api(path, opts) {
    const r = await fetch(path, opts);
    if (!r.ok) {
      let msg = r.statusText;
      try { msg = (await r.json()).erreur || msg; } catch (e) { /* pas de JSON */ }
      throw new Error(msg);
    }
    return r;
  }

  async function detectServer() {
    if (location.protocol === 'file:') return;
    try {
      const info = await (await api('/api/info')).json();
      server.ok = true;
      server.rootName = info.nom;
    } catch (e) { server.ok = false; }
  }

  // ================================================================ documents / onglets

  let docs = [];
  let activeId = null;
  let nextId = 1;

  const TEMPLATE = '/*\nConsigne :\n*/\n\nDEBUT\n    \nFIN\n';
  const WELCOME = [
    '/*',
    'Bienvenue dans PseudoIDE !',
    '  F5  : exécuter          F10 : pas à pas',
    '  Ctrl+S : enregistrer    Ctrl+Maj+F : réindenter',
    '  Clique sur un numéro de ligne pour poser un point d\'arrêt.',
    '*/',
    '',
    'DEBUT',
    '    // données',
    '    taille, masse : réel',
    '    // résultat',
    '    imc : réel',
    '',
    '    écrire("Entrez votre taille en m : ")',
    '    lire(taille)',
    '    écrire("Entrez votre masse en kg : ")',
    '    lire(masse)',
    '',
    '    imc <- masse / (taille * taille)',
    '    écrire("Votre IMC vaut ", imc)',
    '',
    '    SI imc >= 18.5 ET imc <= 25 ALORS',
    '        écrire("Poids idéal")',
    '    SINON',
    '        écrire("Régime à entamer")',
    '    FINSI',
    'FIN',
    ''
  ].join('\n');

  function newDoc(o) {
    const d = Object.assign({
      id: nextId++, name: 'sans_titre.txt', path: null, content: '', saved: null,
      bps: new Set(), diags: [], runtimeDiag: null, scrollTop: 0, scrollLeft: 0, selStart: 0, selEnd: 0
    }, o);
    if (!(d.bps instanceof Set)) d.bps = new Set(d.bps || []);
    docs.push(d);
    return d;
  }
  const active = () => docs.find(d => d.id === activeId);
  const isDirty = (d) => d.saved !== d.content;

  function saveSession() {
    store.set('session', {
      active: activeId,
      docs: docs.map(d => ({ id: d.id, name: d.name, path: d.path, content: d.content, saved: d.saved, bps: [...d.bps] }))
    });
  }
  let sessionTimer = null;
  function saveSessionSoon() { clearTimeout(sessionTimer); sessionTimer = setTimeout(saveSession, 400); }

  function renderTabs() {
    const el = $('#tabs');
    el.innerHTML = '';
    for (const d of docs) {
      const t = document.createElement('div');
      t.className = 'tab' + (d.id === activeId ? ' active' : '') + (isDirty(d) ? ' dirty' : '');
      t.title = d.path ? server.rootName + '/' + d.path : d.name + ' (pas encore enregistré sur le disque)';
      const hasErr = d.diags.some(x => x.severity === 'error') || d.runtimeDiag;
      t.innerHTML = (hasErr ? '<span class="err-dot"></span>' : '') + '<span class="name"></span><span class="x" title="Fermer"><span>×</span></span>';
      t.querySelector('.name').textContent = d.name;
      t.addEventListener('mousedown', (e) => {
        if (e.button === 1) { e.preventDefault(); closeDoc(d); return; }
        if (e.target.closest('.x')) return;
        switchTo(d);
      });
      t.querySelector('.x').addEventListener('click', () => closeDoc(d));
      el.appendChild(t);
    }
    const a = active();
    $('#st-file').textContent = a ? (a.path ? server.rootName + '/' + a.path : a.name) : '';
    document.title = a ? (isDirty(a) ? '● ' : '') + a.name + ' — PseudoIDE' : 'PseudoIDE';
    highlightTreeActive();
  }

  function storeEditorState() {
    const d = active();
    if (!d) return;
    d.scrollTop = ta.scrollTop; d.scrollLeft = ta.scrollLeft;
    d.selStart = ta.selectionStart; d.selEnd = ta.selectionEnd;
  }

  function switchTo(d) {
    if (d.id === activeId) return;
    if (runner.isActive() && runner.doc !== d) runner.stop('Exécution arrêtée (changement d\'onglet).');
    if (runner.doc !== d && runner.machine) { runner.machine = null; runner.trace = []; renderMemory(); renderTrace(); }
    storeEditorState();
    activeId = d.id;
    ta.value = d.content;
    ta.setSelectionRange(d.selStart, d.selEnd);
    renderEditor();
    ta.scrollTop = d.scrollTop; ta.scrollLeft = d.scrollLeft;
    syncScroll();
    renderTabs();
    analyseNow();
    saveSessionSoon();
    ta.focus();
  }

  function closeDoc(d) {
    if (isDirty(d) && !confirm('« ' + d.name + ' » a des modifications non enregistrées. Fermer quand même ?')) return;
    if (runner.doc === d && runner.isActive()) runner.stop();
    const i = docs.indexOf(d);
    docs.splice(i, 1);
    if (!docs.length) newDoc({ name: 'bienvenue.txt', content: WELCOME, saved: WELCOME });
    if (activeId === d.id) {
      activeId = null;
      switchTo(docs[Math.min(i, docs.length - 1)]);
    } else {
      renderTabs();
    }
    saveSessionSoon();
  }

  async function openPath(path) {
    const ex = docs.find(d => d.path === path);
    if (ex) { switchTo(ex); return; }
    try {
      const text = await (await api('/api/fichier?chemin=' + encodeURIComponent(path))).text();
      const d = newDoc({ name: path.split('/').pop(), path, content: text, saved: text });
      switchTo(d);
    } catch (e) {
      alert('Impossible d\'ouvrir ' + path + ' : ' + e.message);
    }
  }

  function openLocalFiles(files) {
    for (const f of files) {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result);
        const d = newDoc({ name: f.name, content: text, saved: server.ok ? null : text });
        switchTo(d);
      };
      reader.readAsText(f, 'utf-8');
    }
  }

  async function saveDoc(d, askPath) {
    d = d || active();
    if (!d) return;
    if (!server.ok) {
      const blob = new Blob([d.content], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = d.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      d.saved = d.content;
      renderTabs(); saveSessionSoon();
      return;
    }
    let path = d.path;
    if (!path || askPath) {
      path = prompt('Enregistrer sous (chemin dans « ' + server.rootName + ' ») :', d.path || d.name);
      if (!path) return;
      path = path.trim().replace(/^\/+/, '');
      if (!/\.[a-z]+$/i.test(path)) path += '.txt';
      if (docs.some(o => o !== d && o.path === path)) { alert('Ce fichier est déjà ouvert dans un autre onglet.'); return; }
    }
    try {
      const r = await (await api('/api/fichier?chemin=' + encodeURIComponent(path), {
        method: 'PUT', headers: { 'X-Pseudo-IDE': '1', 'Content-Type': 'text/plain; charset=utf-8' }, body: d.content
      })).json();
      const isNew = d.path !== r.chemin;
      d.path = r.chemin; d.name = r.chemin.split('/').pop(); d.saved = d.content;
      renderTabs(); saveSessionSoon();
      if (isNew) loadTree();
      consoleSys('✔ Enregistré : ' + server.rootName + '/' + d.path);
    } catch (e) {
      alert('Échec de l\'enregistrement : ' + e.message);
    }
  }

  async function createFile() {
    if (!server.ok) {
      const d = newDoc({ name: 'sans_titre.txt', content: TEMPLATE, saved: null });
      switchTo(d);
      return;
    }
    let path = prompt('Nom du nouveau fichier (tu peux mettre un sous-dossier, ex : labo/ex4.txt) :', 'nouveau.txt');
    if (!path) return;
    path = path.trim().replace(/^\/+/, '');
    if (!/\.[a-z]+$/i.test(path)) path += '.txt';
    try {
      const exists = await fetch('/api/fichier?chemin=' + encodeURIComponent(path));
      if (exists.ok && !confirm('« ' + path + ' » existe déjà. L\'ouvrir ?')) return;
      if (exists.ok) { openPath(path); return; }
    } catch (e) { /* on crée */ }
    const d = newDoc({ name: path.split('/').pop(), path, content: TEMPLATE, saved: null });
    switchTo(d);
    const caret = TEMPLATE.indexOf('DEBUT') + 10;
    ta.setSelectionRange(caret, caret);
    await saveDoc(d);
  }

  // ================================================================ explorateur

  const openDirs = new Set(store.get('openDirs', null) || []);
  let firstTree = store.get('openDirs', null) == null;

  async function loadTree() {
    const el = $('#tree');
    $('#root-name').textContent = server.ok ? server.rootName : 'Fichiers';
    if (!server.ok) {
      el.innerHTML = '<div class="tree-msg">Mode sans serveur : les fichiers sont ouverts depuis le disque et enregistrés par téléchargement.<br><br>' +
        'Pour ouvrir/enregistrer directement tes fichiers, lance :<br><code>~/hers/methode/ide/pseudo-ide</code>' +
        '<br><button id="tree-open">Ouvrir un fichier…</button></div>';
      $('#tree-open').onclick = () => $('#file-input').click();
      return;
    }
    try {
      const tree = await (await api('/api/arbre')).json();
      el.innerHTML = '';
      if (!tree.length) el.innerHTML = '<div class="tree-msg">Aucun fichier .txt ici. Crée-en un avec « ＋ Nouveau ».</div>';
      el.appendChild(renderTree(tree));
      if (firstTree) { firstTree = false; store.set('openDirs', [...openDirs]); }
      highlightTreeActive();
    } catch (e) {
      el.innerHTML = '<div class="tree-msg">Erreur : ' + esc(e.message) + '</div>';
    }
  }

  function renderTree(nodes) {
    const frag = document.createDocumentFragment();
    for (const n of nodes) {
      const item = document.createElement('div');
      item.className = 'tree-item ' + (n.type === 'dossier' ? 'dir' : 'file');
      item.dataset.path = n.chemin;
      if (n.type === 'dossier') {
        if (firstTree) openDirs.add(n.chemin);
        const open = openDirs.has(n.chemin);
        item.innerHTML = '<span class="ic">' + (open ? '▾' : '▸') + '</span><span></span>';
        item.lastChild.textContent = n.nom;
        const kids = document.createElement('div');
        kids.className = 'tree-children' + (open ? '' : ' closed');
        kids.appendChild(renderTree(n.enfants));
        item.onclick = () => {
          const now = kids.classList.toggle('closed');
          item.firstChild.textContent = now ? '▸' : '▾';
          if (now) openDirs.delete(n.chemin); else openDirs.add(n.chemin);
          store.set('openDirs', [...openDirs]);
        };
        frag.appendChild(item);
        frag.appendChild(kids);
      } else {
        item.innerHTML = '<span class="ic">≡</span><span></span>';
        item.lastChild.textContent = n.nom;
        item.onclick = () => openPath(n.chemin);
        frag.appendChild(item);
      }
    }
    return frag;
  }

  function highlightTreeActive() {
    const a = active();
    $$('#tree .tree-item.file').forEach(el => el.classList.toggle('active', !!a && el.dataset.path === a.path));
  }

  // ================================================================ coloration syntaxique

  const K_STRUCT = new Set(['debut', 'fin', 'algorithme', 'si', 'alors', 'sinon', 'finsi', 'tantque', 'repeter', 'fintantque']);
  const K_LOGIC = new Set(['et', 'ou', 'non', 'div', 'mod']);
  const K_IO = new Set(['lire', 'ecrire']);
  const K_TYPE = new Set(['entier', 'reel', 'caractere', 'booleen', 'texte']);
  const K_BOOL = new Set(['vrai', 'faux']);

  function highlight(src) {
    const lines = [[]];
    const push = (text, cls) => {
      const parts = text.split('\n');
      parts.forEach((p, k) => {
        if (k > 0) lines.push([]);
        if (p) lines[lines.length - 1].push({ text: p, cls });
      });
    };
    let i = 0;
    const n = src.length;
    while (i < n) {
      const c = src[i];
      const s = i;
      if (c === '/' && src[i + 1] === '/') {
        while (i < n && src[i] !== '\n') i++;
        push(src.slice(s, i), 't-comment'); continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        const j = src.indexOf('*/', i + 2);
        i = j < 0 ? n : j + 2;
        push(src.slice(s, i), 't-comment'); continue;
      }
      if (c === '"' || c === '“' || c === '«') {
        i++;
        while (i < n && src[i] !== '\n' && !'"”»'.includes(src[i])) i++;
        if (i < n && src[i] !== '\n') i++;
        push(src.slice(s, i), 't-str'); continue;
      }
      if (c === "'" || c === '‘') {
        i++;
        while (i < n && src[i] !== '\n' && src[i] !== "'" && src[i] !== '’') i++;
        if (i < n && src[i] !== '\n') i++;
        push(src.slice(s, i), 't-str'); continue;
      }
      if (/[0-9]/.test(c)) {
        while (i < n && /[0-9.]/.test(src[i])) i++;
        push(src.slice(s, i), 't-num'); continue;
      }
      if (/[\p{L}_]/u.test(c)) {
        while (i < n && /[\p{L}\p{N}_]/u.test(src[i])) i++;
        const w = src.slice(s, i), k = norm(w);
        let cls = 't-id';
        if (K_STRUCT.has(k)) cls = 't-struct';
        else if (K_LOGIC.has(k)) cls = 't-logic';
        else if (K_IO.has(k)) cls = 't-io';
        else if (K_TYPE.has(k)) cls = 't-type';
        else if (K_BOOL.has(k)) cls = 't-bool';
        else if (Pseudo.FUNCS[k] && /^\s*\(/.test(src.slice(i, i + 20))) cls = 't-func';
        push(w, cls); continue;
      }
      if ('<>=+-*/(),:←≤≥≠–—−×÷'.includes(c)) {
        i++;
        if ((c === '<' && '-=>'.includes(src[i])) || (c === '>' && src[i] === '=')) i++;
        push(src.slice(s, i), 't-op'); continue;
      }
      i++;
      push(c, '');
    }
    return lines;
  }

  function renderLine(segs, ranges) {
    if (!ranges.length) {
      return segs.map(s => s.cls ? '<span class="' + s.cls + '">' + esc(s.text) + '</span>' : esc(s.text)).join('');
    }
    let text = segs.map(s => s.text).join('');
    const cls = [];
    for (const s of segs) for (let k = 0; k < s.text.length; k++) cls.push(s.cls);
    // une erreur en fin de ligne (ex : ALORS manquant) se voit sur un espace ajouté
    let need = 0;
    for (const r of ranges) need = Math.max(need, r.start + 1);
    while (text.length < need) { text += ' '; cls.push(''); }
    const sq = new Array(text.length).fill('');
    for (const r of ranges) {
      const end = Math.max(r.end, r.start + 1);
      for (let k = r.start; k < end && k < text.length; k++) {
        if (sq[k] !== 'sq-error') sq[k] = 'sq-' + r.sev;
      }
    }
    let out = '', k = 0;
    while (k < text.length) {
      let j = k;
      while (j < text.length && cls[j] === cls[k] && sq[j] === sq[k]) j++;
      const c = (cls[k] + ' ' + sq[k]).trim();
      const t = esc(text.slice(k, j));
      out += c ? '<span class="' + c + '">' + t + '</span>' : t;
      k = j;
    }
    return out;
  }

  // ================================================================ éditeur

  const ta = $('#src');
  const hl = $('#hl');
  const gutter = $('#gutter');
  let lineEls = [], gutEls = [];
  let charW = 9, lineH = 22, padPx = 10;

  function measure() {
    const probe = document.createElement('div');
    probe.className = 'l';
    probe.style.cssText = 'position:absolute;visibility:hidden;padding:0';
    probe.textContent = 'M'.repeat(100);
    $('.hl-inner').appendChild(probe);
    const r = probe.getBoundingClientRect();
    charW = r.width / 100 || 9;
    lineH = r.height || 22;
    probe.remove();
    padPx = parseFloat(getComputedStyle(ta).paddingTop) || 10;
  }

  function allDiags(d) {
    const list = d.diags.slice();
    if (d.runtimeDiag) list.push(d.runtimeDiag);
    return list;
  }

  function renderEditor() {
    const d = active();
    if (!d) return;
    const lines = highlight(ta.value);
    const nLines = lines.length;
    const byLine = new Map();
    for (const g of allDiags(d)) {
      const ln = Math.min(Math.max(g.line, 1), nLines);
      if (!byLine.has(ln)) byLine.set(ln, []);
      byLine.get(ln).push(g);
    }
    let html = '', gh = '';
    for (let k = 0; k < nLines; k++) {
      const ln = k + 1;
      const ds = byLine.get(ln) || [];
      const ranges = ds.map(g => ({ start: g.line > nLines ? 9999 : g.col - 1, end: g.col - 1 + (g.len || 1), sev: g.severity }));
      const lineText = lines[k].map(s => s.text).join('');
      ranges.forEach(r => { if (r.start > lineText.length) { r.start = lineText.length; r.end = r.start + 1; } });
      const hasErr = ds.some(g => g.severity === 'error');
      const hasWarn = ds.some(g => g.severity === 'warning');
      html += '<div class="l' + (hasErr && ds.includes(d.runtimeDiag) ? ' err' : '') + '">' + (renderLine(lines[k], ranges) || ' ') + '</div>';
      const title = ds.map(g => (g.severity === 'error' ? '✖ ' : '⚠ ') + g.message).join('\n');
      gh += '<div class="gl' + (d.bps.has(ln) ? ' bp-on' : '') + (hasErr ? ' has-err' : hasWarn ? ' has-warn' : '') + '" data-l="' + ln + '"' +
        (title ? ' title="' + esc(title).replace(/"/g, '&quot;') + '"' : '') + '><span class="n">' + ln + '</span><span class="bp"></span></div>';
    }
    hl.innerHTML = html;
    gutter.innerHTML = gh;
    lineEls = hl.children;
    gutEls = gutter.children;
    const digits = String(nLines).length;
    $('.gutter').style.minWidth = (Math.max(2, digits) * charW * 0.9 + 40) + 'px';
    curLine = -1;
    updateCursorLine();
    applyExecLine();
  }

  function syncScroll() {
    hl.style.transform = 'translate(' + (-ta.scrollLeft) + 'px,' + (-ta.scrollTop) + 'px)';
    gutter.style.transform = 'translateY(' + (-ta.scrollTop) + 'px)';
  }

  let curLine = -1;
  function updateCursorLine() {
    const v = ta.value, p = ta.selectionStart;
    const before = v.slice(0, p);
    const ln = before.split('\n').length;
    const col = p - before.lastIndexOf('\n');
    $('#st-pos').textContent = 'Ln ' + ln + ', Col ' + col;
    if (ln === curLine) return;
    if (lineEls[curLine - 1]) lineEls[curLine - 1].classList.remove('cur');
    curLine = ln;
    if (lineEls[ln - 1]) lineEls[ln - 1].classList.add('cur');
  }

  let execLine = 0;
  function setExecLine(ln, reveal) {
    execLine = ln || 0;
    applyExecLine();
    if (reveal && execLine) revealLine(execLine);
  }
  function applyExecLine() {
    for (const el of hl.querySelectorAll('.l.exec')) el.classList.remove('exec');
    for (const el of gutter.querySelectorAll('.gl.exec')) el.classList.remove('exec');
    if (!execLine || runner.doc !== active()) return;
    if (lineEls[execLine - 1]) lineEls[execLine - 1].classList.add('exec');
    if (gutEls[execLine - 1]) gutEls[execLine - 1].classList.add('exec');
  }
  function revealLine(ln) {
    const top = (ln - 1) * lineH;
    const h = ta.clientHeight;
    if (top < ta.scrollTop + lineH || top > ta.scrollTop + h - lineH * 3) {
      ta.scrollTop = Math.max(0, top - h / 3);
      syncScroll();
    }
  }

  function goToLine(ln, col, len) {
    const lines = ta.value.split('\n');
    ln = Math.min(Math.max(1, ln), lines.length);
    let pos = 0;
    for (let k = 0; k < ln - 1; k++) pos += lines[k].length + 1;
    const c = Math.min((col || 1) - 1, lines[ln - 1].length);
    ta.focus();
    ta.setSelectionRange(pos + c, pos + Math.min(c + (len || 0), lines[ln - 1].length));
    revealLine(ln);
    updateCursorLine();
  }

  // --- saisie

  function insertText(text) {
    ta.focus();
    if (!document.execCommand('insertText', false, text)) {
      ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input'));
    }
  }

  function lineBounds(pos) {
    const v = ta.value;
    const s = v.lastIndexOf('\n', pos - 1) + 1;
    let e = v.indexOf('\n', pos);
    if (e < 0) e = v.length;
    return [s, e];
  }

  // Analyse grossière d'une ligne pour l'indentation (sans textes ni commentaires)
  function lineWords(line, st) {
    let s = '', i = 0;
    while (i < line.length) {
      if (st.inBlock) {
        const j = line.indexOf('*/', i);
        if (j < 0) { i = line.length; break; }
        st.inBlock = false; i = j + 2; continue;
      }
      const c = line[i];
      if (c === '/' && line[i + 1] === '/') break;
      if (c === '/' && line[i + 1] === '*') { st.inBlock = true; i += 2; continue; }
      if (c === '"' || c === '“' || c === '«') {
        const m = line.slice(i + 1).search(/["”»]/); i = m < 0 ? line.length : i + m + 2; s += ' _s_ '; continue;
      }
      if (c === "'" || c === '‘') {
        const m = line.slice(i + 1).search(/['’]/); i = m < 0 ? line.length : i + m + 2; s += ' _c_ '; continue;
      }
      s += c; i++;
    }
    const w = norm(s).match(/[\p{L}_][\p{L}\p{N}_]*/gu) || [];
    if (w[0] === 'fin' && w[1] === 'si') w.splice(0, 2, 'finsi');
    else if (w[0] === 'fin' && w[1] === 'tantque') w.splice(0, 2, 'fintantque');
    else if (w[0] === 'fin' && w[1] === 'tant' && w[2] === 'que') w.splice(0, 3, 'fintantque');
    else if (w[0] === 'tant' && w[1] === 'que') w.splice(0, 2, 'tantque');
    return w;
  }

  // Profondeur d'indentation de chaque ligne (null = dans un commentaire /* */, -1 = vide)
  function computeIndents(lines) {
    const stack = [];
    const st = { inBlock: false };
    const res = [];
    const popUntil = (k) => { if (stack.includes(k)) { while (stack.length && stack.pop() !== k) { /* dépile */ } } };
    for (const line of lines) {
      const wasIn = st.inBlock;
      const w = lineWords(line, st);
      if (wasIn) { res.push(null); continue; }
      if (!line.trim()) { res.push(-1); continue; }
      const w0 = w[0] || '', wl = w[w.length - 1] || '';
      const top = stack[stack.length - 1];
      let depth = stack.length;
      if (w0 === 'finsi') { popUntil('si'); depth = stack.length; }
      else if (w0 === 'fintantque') { popUntil('tq'); depth = stack.length; }
      else if (w0 === 'fin') { popUntil('debut'); depth = stack.length; }
      else if (w0 === 'sinon' || w0 === 'alors') { depth = top === 'si' ? stack.length - 1 : stack.length; }
      else if (w0 === 'tantque' && wl !== 'repeter' && top === 'rep') { stack.pop(); depth = stack.length; }
      if (w0 === 'debut') stack.push('debut');
      else if (w0 === 'si') stack.push('si');
      else if (w0 === 'tantque' && wl === 'repeter') stack.push('tq');
      else if (w0 === 'repeter') stack.push('rep');
      res.push(depth);
    }
    return res;
  }

  function formatCode() {
    const lines = ta.value.split('\n');
    const ind = computeIndents(lines);
    const out = lines.map((l, k) => ind[k] === null ? l.replace(/\s+$/, '') : ind[k] < 0 ? '' : INDENT.repeat(ind[k]) + l.trim());
    const text = out.join('\n');
    if (text === ta.value) return;
    const ln = ta.value.slice(0, ta.selectionStart).split('\n').length;
    const st = ta.scrollTop;
    ta.focus();
    ta.setSelectionRange(0, ta.value.length);
    insertText(text);
    goToLine(ln, (out[ln - 1] || '').length + 1);
    ta.scrollTop = st; syncScroll();
  }

  function opensBlock(lineText) {
    const w = lineWords(lineText, { inBlock: false });
    const w0 = w[0], wl = w[w.length - 1];
    return wl === 'alors' || wl === 'repeter' || w0 === 'debut' || (w0 === 'sinon' && w.length === 1);
  }

  function newlineIndent() {
    const s = ta.selectionStart;
    const [ls] = lineBounds(s);
    const before = ta.value.slice(ls, s);
    const indent = before.match(/^[ \t]*/)[0];
    insertText('\n' + indent + (opensBlock(before) ? INDENT : ''));
  }

  function autoDedent() {
    const s = ta.selectionStart;
    if (s !== ta.selectionEnd) return;
    const [ls, le] = lineBounds(s);
    if (s !== le) return;
    const line = ta.value.slice(ls, le);
    const w = norm(line.trim());
    if (!['finsi', 'sinon', 'fintantque', 'fin', 'alors'].includes(w)) return;
    const lines = ta.value.slice(0, le).split('\n');
    const ind = computeIndents(lines);
    const want = ind[ind.length - 1];
    if (want == null || want < 0) return;
    const cur = line.match(/^[ \t]*/)[0];
    const wanted = INDENT.repeat(want);
    if (cur === wanted) return;
    ta.setSelectionRange(ls, ls + cur.length);
    insertText(wanted);
    const p = ls + wanted.length + line.trim().length;
    ta.setSelectionRange(p, p);
  }

  function selectedLineRange() {
    const v = ta.value;
    const s = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    let endPos = ta.selectionEnd;
    if (endPos > ta.selectionStart && v[endPos - 1] === '\n') endPos--;
    let e = v.indexOf('\n', endPos);
    if (e < 0) e = v.length;
    return [s, e];
  }

  function indentLines(out) {
    const [s, e] = selectedLineRange();
    const block = ta.value.slice(s, e);
    const lines = block.split('\n');
    const nl = lines.map(l => out ? l.replace(/^( {1,4}|\t)/, '') : (l.trim() ? INDENT + l : l));
    const text = nl.join('\n');
    if (text === block) return;
    ta.setSelectionRange(s, e);
    insertText(text);
    ta.setSelectionRange(s, s + text.length);
  }

  function toggleComment() {
    const [s, e] = selectedLineRange();
    const lines = ta.value.slice(s, e).split('\n');
    const filled = lines.filter(l => l.trim());
    const allC = filled.length && filled.every(l => /^\s*\/\//.test(l));
    const nl = lines.map(l => {
      if (!l.trim()) return l;
      if (allC) return l.replace(/^(\s*)\/\/ ?/, '$1');
      const m = l.match(/^\s*/)[0];
      return m + '// ' + l.slice(m.length);
    });
    const text = nl.join('\n');
    ta.setSelectionRange(s, e);
    insertText(text);
    ta.setSelectionRange(s, s + text.length);
  }

  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (e.shiftKey) indentLines(true);
      else if (ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n')) indentLines(false);
      else insertText(INDENT);
    } else if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      newlineIndent();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === '/' || e.key === ':')) {
      e.preventDefault();
      toggleComment();
    } else if (e.key === 'Backspace' && ta.selectionStart === ta.selectionEnd) {
      // efface une indentation entière
      const s = ta.selectionStart;
      const [ls] = lineBounds(s);
      const before = ta.value.slice(ls, s);
      if (before.length && /^ +$/.test(before)) {
        e.preventDefault();
        const n = ((before.length - 1) % 4) + 1;
        ta.setSelectionRange(s - n, s);
        insertText('');
      }
    }
  });

  ta.addEventListener('input', (e) => {
    const d = active();
    if (!d) return;
    if (e.inputType === 'insertText' && e.data && /[\p{L}]/u.test(e.data)) {
      autoDedent();
    }
    d.content = ta.value;
    if (d.runtimeDiag) d.runtimeDiag = null;
    if (runner.isActive() && runner.doc === d) runner.stop('Exécution arrêtée : le code a été modifié.');
    renderEditor();
    syncScroll();
    renderTabs();
    scheduleAnalyse();
    saveSessionSoon();
  });
  ta.addEventListener('scroll', syncScroll);
  for (const ev of ['keyup', 'click', 'focus', 'select', 'mouseup']) ta.addEventListener(ev, updateCursorLine);
  document.addEventListener('selectionchange', () => { if (document.activeElement === ta) updateCursorLine(); });

  gutter.addEventListener('click', (e) => {
    const g = e.target.closest('.gl');
    if (!g) return;
    const d = active();
    const ln = +g.dataset.l;
    if (d.bps.has(ln)) d.bps.delete(ln); else d.bps.add(ln);
    g.classList.toggle('bp-on', d.bps.has(ln));
    saveSessionSoon();
  });
  $('.gutter').addEventListener('wheel', (e) => { ta.scrollTop += e.deltaY; e.preventDefault(); }, { passive: false });

  // info-bulle des erreurs
  const tip = $('#tooltip');
  ta.addEventListener('mousemove', (e) => {
    const d = active();
    if (!d) return;
    const r = ta.getBoundingClientRect();
    const x = e.clientX - r.left + ta.scrollLeft - padPx;
    const y = e.clientY - r.top + ta.scrollTop - padPx;
    const ln = Math.floor(y / lineH) + 1;
    const col = Math.floor(x / charW) + 1;
    const lines = ta.value.split('\n').length;
    const hits = allDiags(d).filter(g => Math.min(g.line, lines) === ln && col >= g.col && col < g.col + Math.max(g.len || 1, 1) + 1);
    if (!hits.length) { tip.hidden = true; return; }
    tip.innerHTML = hits.map(g => '<div><span class="' + (g.severity === 'error' ? 'e">Erreur' : 'w">Attention') + '</span> — ' + esc(g.message) + '</div>').join('');
    const er = $('#editor').getBoundingClientRect();
    tip.hidden = false;
    tip.style.left = Math.min(e.clientX - er.left + 12, er.width - tip.offsetWidth - 8) + 'px';
    tip.style.top = (e.clientY - er.top + 18) + 'px';
  });
  ta.addEventListener('mouseleave', () => { tip.hidden = true; });

  // ================================================================ analyse

  let analyseTimer = null;
  function scheduleAnalyse() { clearTimeout(analyseTimer); analyseTimer = setTimeout(analyseNow, 250); }

  function analyseNow() {
    const d = active();
    if (!d) return null;
    const a = Pseudo.analyse(d.content);
    d.diags = a.diags;
    renderEditor();
    renderProblems();
    renderTabs();
    return a;
  }

  function renderProblems() {
    const d = active();
    const list = d ? allDiags(d).sort((a, b) => a.line - b.line) : [];
    const ne = list.filter(g => g.severity === 'error').length;
    const nw = list.length - ne;
    const badge = $('#prob-count');
    badge.textContent = list.length ? String(list.length) : '';
    badge.classList.toggle('warn', !ne && nw > 0);
    $('#st-diag').textContent = ne || nw ? (ne ? '✖ ' + ne + ' erreur' + (ne > 1 ? 's' : '') : '') + (ne && nw ? '  ' : '') + (nw ? '⚠ ' + nw + ' avertissement' + (nw > 1 ? 's' : '') : '') : '✔ Aucun problème';
    const el = $('#problems');
    if (!list.length) { el.innerHTML = '<div class="empty">✔ Aucun problème détecté.</div>'; return; }
    el.innerHTML = '';
    for (const g of list) {
      const row = document.createElement('div');
      row.className = 'prob ' + g.severity;
      row.innerHTML = '<span class="ic">' + (g.severity === 'error' ? '✖' : '⚠') + '</span><span class="loc">Ligne ' + g.line + '</span><span class="msg"></span>';
      row.querySelector('.msg').textContent = g.message;
      row.onclick = () => goToLine(g.line, g.col, g.len);
      el.appendChild(row);
    }
  }

  // ================================================================ console

  const cons = $('#console');
  let outBuf = '';
  function consoleAppend(text, cls) {
    flushOut();
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = text;
    cons.appendChild(span);
    trimConsole();
    cons.scrollTop = cons.scrollHeight;
  }
  function consoleSys(text) { consoleAppend(text + '\n', 'sys'); }
  function flushOut() {
    if (!outBuf) return;
    cons.appendChild(document.createTextNode(outBuf));
    outBuf = '';
    trimConsole();
    cons.scrollTop = cons.scrollHeight;
  }
  function trimConsole() {
    while (cons.childNodes.length > 3000) cons.removeChild(cons.firstChild);
  }

  function showPanel(name) {
    $$('.ptab').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
    $$('#bottom .panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
    if (name === 'trace') renderTrace();
  }
  $$('.ptab').forEach(b => b.addEventListener('click', () => showPanel(b.dataset.panel)));
  $$('.rtab').forEach(b => b.addEventListener('click', () => {
    $$('.rtab').forEach(x => x.classList.toggle('active', x === b));
    $$('.rpanel').forEach(p => p.classList.toggle('active', p.id === 'rpanel-' + b.dataset.panel));
  }));
  $('#btn-clear').onclick = () => { cons.innerHTML = ''; outBuf = ''; };

  // ================================================================ mémoire + traçage

  function renderMemory(flash) {
    const m = runner.machine;
    const tb = $('#memory');
    if (!m) { tb.innerHTML = ''; $('#memory-hint').hidden = false; return; }
    const snap = m.snapshot();
    $('#memory-hint').hidden = snap.length > 0;
    tb.innerHTML = '';
    for (const v of snap) {
      const tr = document.createElement('tr');
      if (flash && runner.changed.has(v.name)) tr.className = 'flash';
      tr.innerHTML = '<td class="addr"></td><td class="name"></td><td class="type"></td><td class="val"></td>';
      tr.children[0].textContent = v.addr;
      tr.children[1].textContent = v.name;
      tr.children[2].textContent = Pseudo.TYPE_LABEL[v.type];
      tr.children[3].textContent = v.text;
      if (!v.value) tr.children[3].classList.add('unset');
      tb.appendChild(tr);
    }
    runner.changed.clear();
  }

  function renderTrace() {
    const el = $('#trace');
    const rows = runner.trace;
    if (!rows.length) { el.innerHTML = '<div class="empty">Le tableau de traçage se remplit à chaque changement de valeur (affectation ou lecture).</div>'; return; }
    const names = runner.machine ? runner.machine.order.slice() : [];
    let h = '<table class="trace"><thead><tr><th>#</th><th>Ligne</th>' + names.map(n => '<th>' + esc(n) + '</th>').join('') + '</tr></thead><tbody>';
    const start = Math.max(0, rows.length - 1500);
    for (let k = start; k < rows.length; k++) {
      const r = rows[k];
      h += '<tr><td class="dim">' + (k + 1) + '</td><td class="dim">' + r.line + '</td>' +
        names.map(n => {
          const v = r.values[n];
          return '<td class="' + (n === r.changed ? 'changed' : v == null ? 'dim' : '') + '">' + esc(v == null ? '?' : v) + '</td>';
        }).join('') + '</tr>';
    }
    el.innerHTML = h + '</tbody></table>';
    const panel = $('#panel-trace');
    panel.scrollTop = panel.scrollHeight;
  }

  // ================================================================ exécution

  const MAX_STEPS = 1000000;

  const runner = {
    state: 'idle', // idle | running | paused | input | done | error
    doc: null, machine: null, gen: null, res: null,
    stepping: false, timer: null, stepBase: 0,
    changed: new Set(), trace: [],

    isActive() { return ['running', 'paused', 'input'].includes(this.state); },

    start(stepMode) {
      const d = active();
      if (!d) return;
      d.runtimeDiag = null;
      const a = analyseNow();
      cons.innerHTML = ''; outBuf = '';
      showPanel('console');
      if (!a.ok) {
        const n = a.diags.filter(g => g.severity === 'error').length;
        consoleAppend('✖ Le programme contient ' + n + ' erreur' + (n > 1 ? 's' : '') + ' : corrige-' + (n > 1 ? 'les' : 'la') + ' avant de l\'exécuter (voir « Problèmes »).\n', 'err');
        const first = a.diags.find(g => g.severity === 'error');
        consoleAppend('   Ligne ' + first.line + ' : ' + first.message + '\n', 'err');
        this.machine = null;
        renderMemory();
        this.setState('idle');
        return;
      }
      this.doc = d;
      this.trace = [];
      this.changed.clear();
      this.machine = new Pseudo.Machine(a.prog, {
        write: (s) => { outBuf += s; if (outBuf.length > 20000) flushOut(); },
        warn: (s) => consoleAppend('⚠ ' + s + '\n', 'warn'),
        change: (name, v, line) => {
          this.changed.add(name);
          if (this.trace.length < 20000) {
            const values = {};
            for (const n of this.machine.order) {
              const c = this.machine.mem.get(n);
              values[n] = c.value ? Pseudo.formatLiteral(c.value) : null;
            }
            this.trace.push({ line, changed: name, values });
          }
        }
      });
      this.gen = this.machine.run();
      this.stepBase = 0;
      this.stepping = !!stepMode;
      consoleSys('▶ Exécution de ' + d.name + (stepMode ? ' (pas à pas)' : ''));
      renderMemory();
      this.setState('running');
      this.advance();
      this.loop();
    },

    advance(val) {
      try {
        this.res = this.gen.next(val);
      } catch (e) {
        if (e instanceof Pseudo.RuntimeError) this.crash(e);
        else { console.error(e); this.crash({ message: 'Erreur interne de l\'IDE : ' + e.message, line: this.machine.line, col: 1, len: 1 }); }
      }
    },

    loop() {
      clearTimeout(this.timer);
      let budget = 4000;
      const delay = +prefs.speed;
      while (this.state === 'running') {
        if (this.res.done) { this.finish(); return; }
        const ev = this.res.value;
        if (ev.type === 'read') {
          this.setState('input');
          setExecLine(ev.line, true);
          flushOut();
          renderMemory(true);
          askInput(ev);
          return;
        }
        if (this.machine.steps - this.stepBase > MAX_STEPS) {
          this.stepBase = this.machine.steps;
          consoleAppend('⚠ Plus d\'un million d\'instructions exécutées… Boucle infinie ? Clique « Continuer » ou « Arrêter ».\n', 'warn');
          this.pauseAt(ev.line);
          return;
        }
        if (this.stepping || (this.doc.bps.has(ev.line) && !ev.end)) {
          this.stepping = false;
          this.pauseAt(ev.line);
          return;
        }
        if (delay > 0) {
          setExecLine(ev.line, true);
          flushOut();
          renderMemory(true);
          this.timer = setTimeout(() => {
            if (this.state !== 'running') return;
            this.advance();
            this.loop();
          }, delay);
          return;
        }
        this.advance();
        if (--budget <= 0) {
          flushOut();
          renderMemory(false);
          this.timer = setTimeout(() => this.loop(), 0);
          return;
        }
      }
    },

    pauseAt(line) {
      this.setState('paused');
      flushOut();
      setExecLine(line, true);
      renderMemory(true);
      if ($('#panel-trace').classList.contains('active')) renderTrace();
    },

    resume() {
      if (this.state !== 'paused') return;
      this.setState('running');
      this.advance();
      this.loop();
    },

    stepOnce() {
      if (this.state === 'paused') {
        this.stepping = true;
        this.setState('running');
        this.advance();
        this.loop();
      } else if (!this.isActive()) {
        this.start(true);
      }
    },

    pause() {
      if (this.state === 'running') this.stepping = true;
    },

    provideInput(text) {
      if (this.state !== 'input') return;
      consoleAppend(text + '\n', 'in');
      this.setState('running');
      this.advance(text);
      this.loop();
    },

    finish() {
      flushOut();
      consoleAppend('■ Fin du programme (' + this.machine.steps + ' instruction' + (this.machine.steps > 1 ? 's' : '') + ' exécutée' + (this.machine.steps > 1 ? 's' : '') + ')\n', 'ok');
      this.setState('done');
      setExecLine(0);
      renderMemory(true);
      if ($('#panel-trace').classList.contains('active')) renderTrace();
    },

    crash(e) {
      flushOut();
      consoleAppend('💥 Le programme a planté à la ligne ' + e.line + ' :\n   ' + e.message + '\n', 'err');
      this.setState('error');
      if (this.doc) {
        this.doc.runtimeDiag = { severity: 'error', message: '[exécution] ' + e.message, line: e.line, col: e.col || 1, len: e.len || 1 };
      }
      setExecLine(0);
      if (this.doc === active()) { renderEditor(); renderProblems(); revealLine(e.line); }
      renderTabs();
      renderMemory(true);
    },

    stop(msg) {
      if (!this.isActive()) return;
      clearTimeout(this.timer);
      flushOut();
      hideInput();
      consoleAppend('■ ' + (msg || 'Exécution arrêtée.') + '\n', 'sys');
      this.setState('idle');
      setExecLine(0);
    },

    setState(s) {
      this.state = s;
      if (s !== 'input') hideInput();
      const run = $('#btn-run'), step = $('#btn-step'), stop = $('#btn-stop');
      const labels = { idle: 'Prêt', running: 'En cours…', paused: 'En pause', input: 'Attend une saisie', done: 'Terminé', error: 'Planté' };
      const st = $('#st-state');
      st.textContent = labels[s];
      st.className = 'state ' + s;
      run.disabled = s === 'input';
      run.innerHTML = s === 'running' ? '❚❚ Pause' : s === 'paused' ? '▶ Continuer' : '▶ Exécuter';
      step.disabled = s === 'running' || s === 'input';
      stop.disabled = !this.isActive();
    }
  };

  function hideInput() { $('#input-row').hidden = true; }
  function askInput(ev) {
    const row = $('#input-row');
    $('#input-label').textContent = 'lire(' + ev.name + ') — ' + Pseudo.TYPE_LABEL[ev.varType] + ' ▸';
    row.hidden = false;
    const inp = $('#input');
    inp.value = '';
    showPanel('console');
    setTimeout(() => inp.focus(), 0);
  }
  $('#input-row').addEventListener('submit', (e) => {
    e.preventDefault();
    runner.provideInput($('#input').value);
  });

  function runOrContinue() {
    if (runner.state === 'running') runner.pause();
    else if (runner.state === 'paused') runner.resume();
    else if (!runner.isActive()) runner.start(false);
  }

  // ================================================================ menu Insérer

  const SNIPPETS = [
    ['Programme', 'DEBUT … FIN', 'DEBUT\n    §\nFIN'],
    ['Déclaration', 'x : entier', '§ : entier'],
    ['Affectation', 'x <- …', '§ <- '],
    ['Lire', 'lire(x)', 'lire(§)'],
    ['Écrire', 'écrire("…")', 'écrire("§")'],
    ['Conditionnelle', 'SI … ALORS … FINSI', 'SI § ALORS\n    \nFINSI'],
    ['Alternative', 'SI … SINON … FINSI', 'SI § ALORS\n    \nSINON\n    \nFINSI'],
    ['Alternatives en chaîne', 'SINON SI', 'SI § ALORS\n    \nSINON SI  ALORS\n    \nSINON\n    \nFINSI'],
    ['Boucle TANTQUE', 'TANTQUE … REPETER', 'TANTQUE § REPETER\n    \nFINTANTQUE'],
    ['Boucle REPETER', 'REPETER … TANTQUE', 'REPETER\n    §\nTANTQUE '],
    ['Commentaire', '/* … */', '/*\n§\n*/']
  ];

  function insertSnippet(tpl) {
    const s = ta.selectionStart;
    const [ls, le] = lineBounds(s);
    const line = ta.value.slice(ls, le);
    const indent = line.match(/^[ \t]*/)[0];
    let prefix = '';
    if (tpl.includes('\n') && line.trim()) {
      ta.setSelectionRange(le, le);
      prefix = '\n' + indent;
    }
    const body = tpl.split('\n').map((l, k) => (k === 0 ? l : indent + l)).join('\n');
    const caret = body.indexOf('§');
    const text = prefix + body.replace('§', '');
    const start = ta.selectionStart;
    insertText(text);
    const p = start + prefix.length + caret;
    ta.setSelectionRange(p, p);
    updateCursorLine();
  }

  function buildInsertMenu() {
    const menu = $('#menu-insert');
    for (const [label, hint, tpl] of SNIPPETS) {
      const b = document.createElement('button');
      b.innerHTML = esc(label) + '<code>' + esc(hint) + '</code>';
      b.onclick = () => { $('.menu').classList.remove('open'); insertSnippet(tpl); };
      menu.appendChild(b);
    }
    $('#btn-insert').onclick = (e) => { e.stopPropagation(); $('.menu').classList.toggle('open'); };
    document.addEventListener('click', () => $('.menu').classList.remove('open'));
  }

  // ================================================================ aide

  function buildHelp() {
    $('#rpanel-help').innerHTML = `
<h3>Programme</h3>
<pre>algorithme MonExemple   // titre (facultatif)
DEBUT
    // instructions
FIN</pre>
<p>Commentaires : <code>// …</code> ou <code>/* … */</code></p>

<h3>Déclarations</h3>
<pre>x : entier
i, j, k : entier
s : texte</pre>
<p>Types : <code>entier</code>, <code>réel</code>, <code>caractère</code>, <code>booléen</code>, <code>texte</code></p>

<h3>Littéraux</h3>
<table>
<tr><td>2</td><td>entier</td></tr>
<tr><td>3.14</td><td>réel (avec un point)</td></tr>
<tr><td>'a'</td><td>caractère (apostrophes)</td></tr>
<tr><td>"Toto"</td><td>texte (guillemets)</td></tr>
<tr><td>VRAI FAUX</td><td>booléen</td></tr>
</table>

<h3>Instructions</h3>
<pre>x <- 2
x <- aléatoire(1, 6)
lire(x)
lire(x, y)
écrire("Hello")
écrire("la somme vaut ", x)</pre>

<h3>Conditionnelle</h3>
<pre>SI i < 0 ALORS
    i <- -i
SINON
    écrire("positif")
FINSI

SI c1 ALORS
    …
SINON SI c2 ALORS
    …
SINON
    …
FINSI</pre>

<h3>Boucles</h3>
<pre>TANTQUE i > 0 REPETER
    i <- i - 1
FINTANTQUE

REPETER
    i <- i - 1
TANTQUE i > 0</pre>

<h3>Opérateurs (par priorité)</h3>
<table>
<tr><td>1</td><td>fonctions</td></tr>
<tr><td>2</td><td>NON, - (unaire)</td></tr>
<tr><td>3</td><td>* / div mod</td></tr>
<tr><td>4</td><td>+ -</td></tr>
<tr><td>5</td><td>&lt;= &gt;= &lt; &gt;</td></tr>
<tr><td>6</td><td>= &lt;&gt;</td></tr>
<tr><td>7</td><td>ET</td></tr>
<tr><td>8</td><td>OU</td></tr>
</table>
<p><code>/</code> donne toujours un réel ; <code>div</code> et <code>mod</code> : division entière et reste (entre entiers).</p>

<h3>Fonctions</h3>
<table>
<tr><td>racine(r)</td><td>√r (r ≥ 0)</td></tr>
<tr><td>carré(r)</td><td>r²</td></tr>
<tr><td>puissance(r, n)</td><td>rⁿ</td></tr>
<tr><td>aléatoire(a, b)</td><td>entier entre a et b inclus</td></tr>
<tr><td>max(a, b)</td><td>le plus grand</td></tr>
<tr><td>min(a, b)</td><td>le plus petit</td></tr>
<tr><td>absolu(r)</td><td>valeur absolue</td></tr>
<tr><td>concat(t1, t2)</td><td>texte t1 suivi de t2</td></tr>
</table>

<h3>Lois de De Morgan</h3>
<pre>NON (C1 ET C2)  ⇔  NON C1 OU NON C2
NON (C1 OU C2)  ⇔  NON C1 ET NON C2</pre>

<h3>Raccourcis</h3>
<table class="keys">
<tr><td>F5</td><td>Exécuter / continuer</td></tr>
<tr><td>F10</td><td>Pas à pas</td></tr>
<tr><td>Maj+F5</td><td>Arrêter</td></tr>
<tr><td>Ctrl+S</td><td>Enregistrer</td></tr>
<tr><td>Ctrl+Maj+S</td><td>Enregistrer sous</td></tr>
<tr><td>Alt+N</td><td>Nouveau fichier</td></tr>
<tr><td>Ctrl+O</td><td>Ouvrir depuis le disque</td></tr>
<tr><td>Ctrl+Maj+F</td><td>Réindenter</td></tr>
<tr><td>Ctrl+/</td><td>Commenter les lignes</td></tr>
<tr><td>Tab / Maj+Tab</td><td>Indenter / désindenter</td></tr>
<tr><td>Ctrl+ + / Ctrl+ -</td><td>Taille du texte</td></tr>
<tr><td>Clic sur n° de ligne</td><td>Point d'arrêt</td></tr>
</table>`;
  }

  // ================================================================ séparateurs

  function initSplitters() {
    for (const sp of $$('.splitter')) {
      sp.addEventListener('mousedown', (e) => {
        e.preventDefault();
        sp.classList.add('drag');
        const kind = sp.dataset.split;
        const main = $('#main').getBoundingClientRect();
        const center = $('#center').getBoundingClientRect();
        const move = (ev) => {
          if (kind === 'sidebar') prefs.wSidebar = Math.max(140, Math.min(500, ev.clientX - main.left));
          if (kind === 'right') prefs.wRight = Math.max(200, Math.min(700, main.right - ev.clientX));
          if (kind === 'bottom') prefs.hBottom = Math.max(80, Math.min(center.height - 120, center.bottom - ev.clientY));
          applyPrefs();
        };
        const up = () => {
          sp.classList.remove('drag');
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          savePrefs();
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      });
    }
  }

  // ================================================================ raccourcis globaux

  window.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'F5' && e.shiftKey) { e.preventDefault(); runner.stop(); return; }
    if (e.key === 'F5') { e.preventDefault(); runOrContinue(); return; }
    if (e.key === 'F10') { e.preventDefault(); if (!$('#btn-step').disabled) runner.stepOnce(); return; }
    if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); saveDoc(null, e.shiftKey); return; }
    if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#file-input').click(); return; }
    if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); createFile(); return; }
    if ((ctrl || e.altKey) && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); formatCode(); return; }
    if (ctrl && (e.key === '+' || e.key === '=')) { e.preventDefault(); prefs.fs = Math.min(28, prefs.fs + 1); applyPrefs(); renderEditor(); savePrefs(); return; }
    if (ctrl && (e.key === '-' || e.key === '_')) { e.preventDefault(); prefs.fs = Math.max(10, prefs.fs - 1); applyPrefs(); renderEditor(); savePrefs(); return; }
  });

  window.addEventListener('beforeunload', (e) => {
    saveSession();
    if (server.ok && docs.some(d => d.path && isDirty(d))) { e.preventDefault(); e.returnValue = ''; }
  });

  // ================================================================ démarrage

  async function init() {
    applyPrefs();
    buildInsertMenu();
    buildHelp();
    initSplitters();

    $('#btn-new').onclick = createFile;
    $('#btn-open').onclick = () => $('#file-input').click();
    $('#file-input').onchange = (e) => { openLocalFiles(e.target.files); e.target.value = ''; };
    $('#btn-save').onclick = () => saveDoc();
    $('#btn-format').onclick = formatCode;
    $('#btn-run').onclick = runOrContinue;
    $('#btn-step').onclick = () => runner.stepOnce();
    $('#btn-stop').onclick = () => runner.stop();
    $('#btn-refresh').onclick = loadTree;
    $('#speed').onchange = (e) => { prefs.speed = e.target.value; savePrefs(); };
    $('#btn-theme').onclick = () => { prefs.theme = prefs.theme === 'dark' ? 'light' : 'dark'; applyPrefs(); savePrefs(); };

    await detectServer();
    $('#btn-open').title = server.ok ? 'Ouvrir un fichier depuis n\'importe où sur le disque (Ctrl+O). Les fichiers du cours sont dans le panneau de gauche.' : 'Ouvrir un fichier (Ctrl+O)';

    const sess = store.get('session', null);
    if (sess && sess.docs && sess.docs.length) {
      for (const sd of sess.docs) newDoc(sd);
      nextId = Math.max(...docs.map(d => d.id)) + 1;
      // recharge depuis le disque les fichiers non modifiés
      if (server.ok) {
        await Promise.all(docs.filter(d => d.path && !isDirty(d)).map(async d => {
          try {
            const t = await (await api('/api/fichier?chemin=' + encodeURIComponent(d.path))).text();
            d.content = t; d.saved = t;
          } catch (e) { d.saved = null; }
        }));
      }
      const target = docs.find(d => d.id === sess.active) || docs[0];
      activeId = null;
      switchTo(target);
    } else {
      switchTo(newDoc({ name: 'bienvenue.txt', content: WELCOME, saved: WELCOME }));
    }
    runner.setState('idle');
    renderTrace();
    loadTree();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); renderEditor(); });
  }

  init();
})();
