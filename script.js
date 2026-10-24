(() => {
  'use strict';

  /* =====================================================
     KONFIGURASI
  ===================================================== */
  const SIZE = 8;

  // [warna terang, warna gelap] — harus sama dengan .c0 - .c7 di CSS
  const PALETTE = [
    ['#ff7a8a', '#e0204a'],
    ['#ffb454', '#f07a12'],
    ['#ffe066', '#f2b705'],
    ['#6ee7a0', '#12b76a'],
    ['#5fd8ff', '#0891d1'],
    ['#7aa2ff', '#3b55e6'],
    ['#c084fc', '#8b3dde'],
    ['#ff8ad8', '#e0359e'],
  ];

  const SHAPE_DEFS = [
    { rows: ['#'], weight: 0.6 },
    { rows: ['##'] }, { rows: ['#', '#'] },
    { rows: ['###'] }, { rows: ['#', '#', '#'] },
    { rows: ['####'] }, { rows: ['#', '#', '#', '#'] },
    { rows: ['#####'], weight: 0.6 }, { rows: ['#', '#', '#', '#', '#'], weight: 0.6 },
    { rows: ['##', '##'], weight: 1.3 },
    { rows: ['###', '###', '###'], weight: 0.5 },
    { rows: ['###', '###'] }, { rows: ['##', '##', '##'] },
    // L kecil
    { rows: ['#.', '##'] }, { rows: ['.#', '##'] }, { rows: ['##', '#.'] }, { rows: ['##', '.#'] },
    // L besar
    { rows: ['#..', '#..', '###'], weight: 0.8 }, { rows: ['..#', '..#', '###'], weight: 0.8 },
    { rows: ['###', '#..', '#..'], weight: 0.8 }, { rows: ['###', '..#', '..#'], weight: 0.8 },
    // T
    { rows: ['###', '.#.'] }, { rows: ['.#.', '###'] }, { rows: ['#.', '##', '#.'] }, { rows: ['.#', '##', '.#'] },
    // S / Z
    { rows: ['.##', '##.'] }, { rows: ['##.', '.##'] }, { rows: ['#.', '##', '.#'] }, { rows: ['.#', '##', '#.'] },
    // L panjang
    { rows: ['#.', '#.', '##'] }, { rows: ['.#', '.#', '##'] }, { rows: ['##', '#.', '#.'] }, { rows: ['##', '.#', '.#'] },
    { rows: ['#..', '###'] }, { rows: ['..#', '###'] }, { rows: ['###', '#..'] }, { rows: ['###', '..#'] },
  ];

  const SHAPES = SHAPE_DEFS.map(d => {
    const cells = [];
    d.rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '#') cells.push([r, c]); }));
    return { cells, h: d.rows.length, w: d.rows[0].length, weight: d.weight || 1 };
  });
  const TOTAL_WEIGHT = SHAPES.reduce((s, x) => s + x.weight, 0);

  /* =====================================================
     ELEMEN & STATE
  ===================================================== */
  const $ = s => document.querySelector(s);
  const boardEl = $('#board');
  const wrapEl = $('#boardWrap');
  const trayEl = $('#tray');
  const popupEl = $('#popup');
  const scoreEl = $('#score');
  const bestEl = $('#best');
  const flashEl = $('#flash');
  const overlayEl = $('#overlay');
  const finalScoreEl = $('#finalScore');
  const newBestEl = $('#newBest');
  const soundBtn = $('#soundBtn');

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* abaikan */ } },
  };

  const cellEls = [];
  let grid = new Array(SIZE * SIZE).fill(null);
  let pieces = [null, null, null];
  let score = 0;
  let shown = 0;
  let best = store.get('bb_best', 0);
  let streak = 0;
  let busy = false;
  let over = false;
  let drag = null;
  let trayCell = 20;
  let previewIdx = [];
  let lastKey = null;

  /* =====================================================
     SUARA (WebAudio, tanpa file)
  ===================================================== */
  let actx = null;
  let muted = store.get('bb_muted', false);

  function ensureAudio() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* tidak didukung */ }
    }
    if (actx && actx.state === 'suspended') actx.resume();
  }

  function tone(freq, dur = 0.15, type = 'sine', vol = 0.15, delay = 0) {
    if (muted || !actx) return;
    const t = actx.currentTime + delay;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];
  const sfx = {
    pick() { tone(520, 0.06, 'triangle', 0.08); },
    place() { tone(180, 0.12, 'sine', 0.22); tone(270, 0.08, 'triangle', 0.08, 0.02); },
    invalid() { tone(140, 0.15, 'sawtooth', 0.05); },
    clear(lines, st) {
      const n = Math.min(8, 3 + lines + st);
      for (let i = 0; i < n; i++) tone(SCALE[i % SCALE.length], 0.22, 'triangle', 0.14, i * 0.06);
      tone(120, 0.3, 'sine', 0.22);
    },
    over() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.32, 'sawtooth', 0.07, i * 0.18)); },
  };

  /* =====================================================
     EFEK PARTIKEL (canvas)
  ===================================================== */
  const canvas = $('#fx');
  const ctx = canvas.getContext('2d');
  const parts = [];
  const rings = [];
  let W = 0, H = 0, raf = 0;

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const rand = (a, b) => a + Math.random() * (b - a);

  function burst(x, y, colorIdx, n) {
    const [light, dark] = PALETTE[colorIdx];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(2, 8);
      const r = Math.random();
      parts.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - rand(1, 3),
        g: 0.2,
        life: 1,
        decay: rand(0.014, 0.028),
        size: rand(4, 10),
        rot: rand(0, 6.28),
        vr: rand(-0.3, 0.3),
        color: r < 0.45 ? light : r < 0.75 ? dark : '#ffffff',
        star: Math.random() < 0.35,
      });
    }
    if (parts.length > 800) parts.splice(0, parts.length - 800);
    kick();
  }

  function addRing(x, y, max, color = '#ffffff') {
    rings.push({ x, y, r: 6, max, life: 1, color });
    kick();
  }

  function drawStar(s) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const r = i % 2 ? s * 0.35 : s;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  }

  function loop() {
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = rings.length - 1; i >= 0; i--) {
      const g = rings[i];
      g.r += (g.max - g.r) * 0.12 + 1.5;
      g.life -= 0.035;
      if (g.life <= 0) { rings.splice(i, 1); continue; }
      ctx.globalAlpha = g.life * 0.8;
      ctx.strokeStyle = g.color;
      ctx.lineWidth = 2 + g.life * 8;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.vy += p.g;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life -= p.decay;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      const s = p.size * (0.5 + p.life * 0.5);
      if (p.star) drawStar(s * 1.2);
      else ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (parts.length || rings.length) raf = requestAnimationFrame(loop);
    else { raf = 0; ctx.clearRect(0, 0, W, H); }
  }
  function kick() { if (!raf) raf = requestAnimationFrame(loop); }

  function flash(strength) {
    flashEl.style.setProperty('--o', strength);
    flashEl.classList.remove('on');
    void flashEl.offsetWidth;
    flashEl.classList.add('on');
  }

  function shake(level) {
    boardEl.classList.remove('shake1', 'shake2', 'shake3');
    void boardEl.offsetWidth;
    boardEl.classList.add('shake' + level);
  }

  /* =====================================================
     UKURAN & RENDER
  ===================================================== */
  function metrics() {
    const rect = boardEl.getBoundingClientRect();
    const cs = getComputedStyle(boardEl);
    const pad = parseFloat(cs.paddingLeft) || 0;
    const gap = parseFloat(cs.columnGap) || 0;
    const cell = (boardEl.clientWidth - pad * 2 - gap * (SIZE - 1)) / SIZE;
    return {
      x0: rect.left + boardEl.clientLeft + pad,
      y0: rect.top + boardEl.clientTop + pad,
      cell, gap, step: cell + gap,
    };
  }

  function buildBoard() {
    boardEl.innerHTML = '';
    cellEls.length = 0;
    for (let i = 0; i < SIZE * SIZE; i++) {
      const r = Math.floor(i / SIZE), c = i % SIZE;
      const d = document.createElement('div');
      d.dataset.alt = ((r >> 1) + (c >> 1)) % 2 ? '1' : '';
      boardEl.appendChild(d);
      cellEls.push(d);
      paintCell(i);
    }
  }

  function paintCell(i) {
    const el = cellEls[i];
    const v = grid[i];
    el.className = 'cell' + (el.dataset.alt ? ' alt' : '') + (v !== null ? ` filled c${v}` : '');
  }
  function paintAll() { for (let i = 0; i < grid.length; i++) paintCell(i); }

  function buildPiece(p, cell, gap) {
    const el = document.createElement('div');
    el.className = 'piece';
    el.style.gap = gap + 'px';
    el.style.gridTemplateColumns = `repeat(${p.w}, ${cell}px)`;
    el.style.gridTemplateRows = `repeat(${p.h}, ${cell}px)`;
    p.cells.forEach(([r, c]) => {
      const b = document.createElement('div');
      b.className = 'block c' + p.color;
      b.style.gridRow = r + 1;
      b.style.gridColumn = c + 1;
      el.appendChild(b);
    });
    return el;
  }

  function renderTray(enter = false) {
    const m = metrics();
    const slots = [...trayEl.children];
    slots.forEach((slot, i) => {
      slot.innerHTML = '';
      const p = pieces[i];
      if (!p) return;
      trayCell = Math.floor(Math.min(m.cell * 0.62, (slot.clientWidth - 14) / 5.5));
      const el = buildPiece(p, trayCell, 2);
      if (enter) { el.classList.add('enter'); el.style.animationDelay = i * 90 + 'ms'; }
      slot.appendChild(el);
    });
    updateDisabled();
  }

  function updateDisabled() {
    [...trayEl.children].forEach((slot, i) => {
      const el = slot.firstElementChild;
      if (el) el.classList.toggle('disabled', !!pieces[i] && !fitsAnywhere(pieces[i]));
    });
  }

  /* =====================================================
     LOGIKA GAME
  ===================================================== */
  function canPlace(p, row, col, g = grid) {
    if (row < 0 || col < 0 || row + p.h > SIZE || col + p.w > SIZE) return false;
    for (const [r, c] of p.cells) if (g[(row + r) * SIZE + col + c] !== null) return false;
    return true;
  }

  function fitsAnywhere(p) {
    for (let r = 0; r <= SIZE - p.h; r++)
      for (let c = 0; c <= SIZE - p.w; c++)
        if (canPlace(p, r, c)) return true;
    return false;
  }

  function findFull(g) {
    const rows = [], cols = [], idx = new Set();
    for (let r = 0; r < SIZE; r++) {
      let ok = true;
      for (let c = 0; c < SIZE; c++) if (g[r * SIZE + c] === null) { ok = false; break; }
      if (ok) { rows.push(r); for (let c = 0; c < SIZE; c++) idx.add(r * SIZE + c); }
    }
    for (let c = 0; c < SIZE; c++) {
      let ok = true;
      for (let r = 0; r < SIZE; r++) if (g[r * SIZE + c] === null) { ok = false; break; }
      if (ok) { cols.push(c); for (let r = 0; r < SIZE; r++) idx.add(r * SIZE + c); }
    }
    return { rows, cols, idx };
  }

  function randomPiece() {
    let t = Math.random() * TOTAL_WEIGHT;
    let shape = SHAPES[0];
    for (const s of SHAPES) { t -= s.weight; if (t <= 0) { shape = s; break; } }
    return { cells: shape.cells, w: shape.w, h: shape.h, color: Math.floor(Math.random() * PALETTE.length) };
  }

  function refill() {
    let set;
    for (let a = 0; a < 40; a++) {
      set = [randomPiece(), randomPiece(), randomPiece()];
      if (set.some(fitsAnywhere)) break;
    }
    pieces = set;
    renderTray(true);
  }

  function addScore(n) {
    score += n;
    if (score > best) { best = score; store.set('bb_best', best); bestEl.textContent = best; }
    const from = shown, start = performance.now();
    const dur = Math.min(800, 250 + n * 4);
    (function step(t) {
      const k = Math.min(1, (t - start) / dur);
      shown = Math.round(from + (score - from) * k);
      scoreEl.textContent = shown;
      if (k < 1) requestAnimationFrame(step);
    })(start);
    scoreEl.classList.remove('bump');
    void scoreEl.offsetWidth;
    scoreEl.classList.add('bump');
  }

  function showPopup(text, sub, pts, px, py) {
    popupEl.style.left = px + 'px';
    popupEl.style.top = py + 'px';
    popupEl.innerHTML =
      `<div class="pop"><div class="pop-text">${text}</div>` +
      (sub ? `<div class="pop-sub">${sub}</div>` : '') +
      `<div class="pop-score">+${pts}</div></div>`;
  }

  const PRAISE = ['', 'Bagus!', 'Hebat!', 'Luar Biasa!', 'Spektakuler!'];

  /* ---------- Pasang potongan ---------- */
  function place(idx, row, col) {
    const p = pieces[idx];
    busy = true;
    const m = metrics();

    p.cells.forEach(([r, c]) => {
      const i = (row + r) * SIZE + col + c;
      grid[i] = p.color;
      paintCell(i);
      cellEls[i].classList.add('placed');
      setTimeout(() => cellEls[i].classList.remove('placed'), 280);
    });
    pieces[idx] = null;
    sfx.place();

    let gain = p.cells.length;
    const full = findFull(grid);
    const lines = full.rows.length + full.cols.length;

    // tidak ada baris yang hancur
    if (!lines) {
      streak = 0;
      addScore(gain);
      setTimeout(finishTurn, 120);
      return;
    }

    // ===== ADA BARIS YANG HANCUR =====
    streak++;
    const set = full.idx;
    const cr = row + p.h / 2 - 0.5;
    const cc = col + p.w / 2 - 0.5;

    let maxD = 0;
    set.forEach(i => {
      maxD = Math.max(maxD, Math.hypot(Math.floor(i / SIZE) - cr, (i % SIZE) - cc));
    });

    let sx = 0, sy = 0;
    set.forEach(i => {
      const r = Math.floor(i / SIZE), c = i % SIZE;
      const delay = Math.round(Math.hypot(r - cr, c - cc) * 55);
      const el = cellEls[i];
      el.classList.remove('placed');
      el.style.animationDelay = delay + 'ms';
      el.classList.add('clearing');

      const x = m.x0 + c * m.step + m.cell / 2;
      const y = m.y0 + r * m.step + m.cell / 2;
      sx += x; sy += y;
      const color = grid[i];
      setTimeout(() => burst(x, y, color, 7 + Math.min(streak, 4) * 2), delay + 170);
    });

    // gelombang kejut dari tempat potongan diletakkan
    const rx = m.x0 + (col + p.w / 2) * m.step - m.gap / 2;
    const ry = m.y0 + (row + p.h / 2) * m.step - m.gap / 2;
    addRing(rx, ry, m.step * 5, '#ffffff');
    if (lines >= 2) setTimeout(() => addRing(rx, ry, m.step * 7, PALETTE[p.color][0]), 120);

    // skor
    const perfect = grid.every((v, i) => v === null || set.has(i));
    gain += 5 * lines * (lines + 1) * streak;
    if (perfect) gain += 150;

    sfx.clear(lines, streak);
    shake(lines >= 4 ? 3 : lines >= 2 ? 2 : 1);
    if (lines >= 2 || streak >= 3) flash(Math.min(0.85, 0.3 + lines * 0.12 + streak * 0.05));

    // popup di tengah area yang hancur
    const n = set.size;
    const wr = wrapEl.getBoundingClientRect();
    const px = Math.min(wr.width * 0.78, Math.max(wr.width * 0.22, sx / n - wr.left));
    const py = Math.min(wr.height * 0.8, Math.max(wr.height * 0.2, sy / n - wr.top));
    const label = perfect ? 'SEMPURNA!' : (lines >= 5 ? 'LEGENDARIS!' : PRAISE[lines]);
    const sub = streak >= 2 ? `Kombo x${streak}` : '';

    setTimeout(() => {
      addScore(gain);
      showPopup(label, sub, gain, px, py);
      if (perfect) {
        for (let k = 0; k < 14; k++) {
          setTimeout(() => burst(rand(m.x0, m.x0 + m.step * SIZE), rand(m.y0, m.y0 + m.step * SIZE), Math.floor(rand(0, 8)), 10), k * 60);
        }
        flash(0.9);
      }
    }, 220);

    // hapus data setelah animasi selesai
    setTimeout(() => {
      set.forEach(i => {
        grid[i] = null;
        cellEls[i].style.animationDelay = '';
        paintCell(i);
      });
      finishTurn();
    }, Math.round(maxD * 55) + 540);
  }

  function finishTurn() {
    busy = false;
    if (!pieces.some(Boolean)) refill();
    else renderTray();
    if (!pieces.some(p => p && fitsAnywhere(p))) gameOver();
  }

  function gameOver() {
    over = true;
    busy = true;
    sfx.over();
    cellEls.forEach((el, i) => {
      if (grid[i] !== null) {
        el.style.transitionDelay = (i * 14) + 'ms';
        el.classList.add('dead');
      }
    });
    setTimeout(() => {
      finalScoreEl.textContent = score;
      newBestEl.classList.toggle('hidden', !(score > 0 && score >= best && score > store.get('bb_prevbest', 0)));
      overlayEl.classList.remove('hidden');
      store.set('bb_prevbest', best);
    }, 1100);
  }

  function newGame() {
    grid = new Array(SIZE * SIZE).fill(null);
    cellEls.forEach(el => { el.style.animationDelay = ''; el.style.transitionDelay = ''; });
    paintAll();
    score = 0; shown = 0; streak = 0;
    busy = false; over = false;
    scoreEl.textContent = '0';
    bestEl.textContent = best;
    popupEl.innerHTML = '';
    overlayEl.classList.add('hidden');
    clearPreview();
    refill();
  }

  /* =====================================================
     DRAG & DROP
  ===================================================== */
  function clearPreview() {
    previewIdx.forEach(paintCell);
    previewIdx = [];
    lastKey = null;
  }

  function showPreview(p, row, col) {
    clearPreview();
    lastKey = row + ',' + col;
    if (!canPlace(p, row, col)) return;

    const tmp = grid.slice();
    p.cells.forEach(([r, c]) => {
      const i = (row + r) * SIZE + col + c;
      tmp[i] = p.color;
      cellEls[i].classList.add('preview', 'c' + p.color);
      previewIdx.push(i);
    });
    findFull(tmp).idx.forEach(i => {
      cellEls[i].classList.add('hint');
      if (!previewIdx.includes(i)) previewIdx.push(i);
    });
  }

  function moveDrag(e) {
    const { float, p, m } = drag;
    const w = p.w * m.cell + (p.w - 1) * m.gap;
    const h = p.h * m.cell + (p.h - 1) * m.gap;
    const lift = e.pointerType === 'mouse' ? 0 : h / 2 + 40;
    const left = e.clientX - w / 2;
    const top = e.clientY - h / 2 - lift;
    float.style.left = left + 'px';
    float.style.top = top + 'px';

    const col = Math.round((left - m.x0) / m.step);
    const row = Math.round((top - m.y0) / m.step);
    drag.row = row; drag.col = col;
    drag.valid = canPlace(p, row, col);

    const key = row + ',' + col;
    if (key !== lastKey) showPreview(p, row, col);
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    moveDrag(e);
  }

  function endDrag(e, cancelled = false) {
    if (!drag || e.pointerId !== drag.pid) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);

    const d = drag;
    drag = null;
    clearPreview();

    if (d.valid && !cancelled) {
      d.float.remove();
      place(d.idx, d.row, d.col);
    } else {
      sfx.invalid();
      // animasi kembali ke tray
      const target = d.pieceEl.getBoundingClientRect();
      const f = d.float;
      f.style.animation = 'none';
      f.style.transformOrigin = 'top left';
      f.style.transition = 'left .22s ease, top .22s ease, transform .22s ease';
      requestAnimationFrame(() => {
        f.style.left = target.left + 'px';
        f.style.top = target.top + 'px';
        f.style.transform = `scale(${trayCell / d.m.cell})`;
      });
      setTimeout(() => { f.remove(); d.pieceEl.classList.remove('picked'); }, 240);
    }
  }
  const onUp = e => endDrag(e, false);
  const onCancel = e => endDrag(e, true);

  trayEl.addEventListener('pointerdown', e => {
    if (busy || over || drag) return;
    const slot = e.target.closest('.slot');
    if (!slot) return;
    const idx = +slot.dataset.i;
    const p = pieces[idx];
    const pieceEl = slot.firstElementChild;
    if (!p || !pieceEl) return;

    e.preventDefault();
    ensureAudio();
    sfx.pick();

    const m = metrics();
    const float = buildPiece(p, m.cell, m.gap);
    float.classList.add('floating');
    document.body.appendChild(float);
    pieceEl.classList.add('picked');

    drag = { idx, p, m, float, pieceEl, pid: e.pointerId, row: 0, col: 0, valid: false };
    moveDrag(e);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  });

  /* =====================================================
     TOMBOL & INIT
  ===================================================== */
  function updateSoundBtn() { soundBtn.textContent = muted ? '🔇' : '🔊'; }
  soundBtn.addEventListener('click', () => {
    muted = !muted;
    store.set('bb_muted', muted);
    updateSoundBtn();
    ensureAudio();
    if (!muted) sfx.pick();
  });

  $('#restartBtn').addEventListener('click', () => { ensureAudio(); newGame(); });
  $('#playAgain').addEventListener('click', () => { ensureAudio(); newGame(); });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeCanvas();
      if (!drag) renderTray();
    }, 120);
  });

  resizeCanvas();
  updateSoundBtn();
  bestEl.textContent = best;
  store.set('bb_prevbest', best);
  buildBoard();
  newGame();
})();