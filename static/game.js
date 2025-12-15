// static/game.js — FULL file with theme toggle (light/dark) and Start button removed
(() => {
  // ---------------------------
  // Configuration
  // ---------------------------
  const SOCKET_OPTS = { transports: ['websocket'], reconnectionAttempts: 6, timeout: 3000 };
  const PARTICLE_COUNT = 40;
  const SCORE_POPUP_TIME = 700;
  const MAX_LEADERBOARD = 10;
  const MIN_CELL = 12;
  const MAX_CELL = 28;

  // ---------------------------
  // DOM references & socket
  // ---------------------------
  const socket = (typeof io !== 'undefined') ? io(undefined, SOCKET_OPTS) : null;

  // Canvas & HUD
  const canvas = document.getElementById('gameCanvas');
  const particlesCanvas = document.getElementById('particles');
  const scoreEl = document.getElementById('score');
  const highEl = document.getElementById('highscore');
  const stateEl = document.getElementById('gameState');
  const gridEl = document.getElementById('gridSize');
  const connDot = document.getElementById('connDot');
  const connLabel = document.getElementById('connLabel');

  // Overlays & buttons
  const mainOverlay = document.getElementById('mainOverlay');
  const gameOverOverlay = document.getElementById('gameOverOverlay');
  // start button removed: we will remove it from DOM if present
  const btnStart = document.getElementById('btnStart');
  const btnRestart = document.getElementById('btnRestart'); // important
  const btnMenu = document.getElementById('btnMenu');
  const pauseBtn = document.getElementById('pause');
  const scorePopup = document.getElementById('scorePopup');

  // Arrow controls - canonical IDs expected by layout
  const upBtn = document.getElementById('up');
  const downBtn = document.getElementById('down');
  const leftBtn = document.getElementById('left');
  const rightBtn = document.getElementById('right');

  // Mobile arrow controls (if separate)
  const m_up = document.getElementById('m-up');
  const m_down = document.getElementById('m-down');
  const m_left = document.getElementById('m-left');
  const m_right = document.getElementById('m-right');

  // Leaderboard / theme
  const openLeaderboard = document.getElementById('openLeaderboard');
  const leaderboardModal = document.getElementById('leaderboardModal');
  const leaderboardList = document.getElementById('leaderboardList');
  const lbClose = document.getElementById('lbClose');
  const lbClear = document.getElementById('lbClear');

  // Theme toggle: robust fallback to either id or class
  let themeToggle = document.getElementById('themeToggle');
  if (!themeToggle) themeToggle = document.querySelector('.theme-toggle');

  // ---------------------------
  // State
  // ---------------------------
  let currentState = null;
  let cellSize = 20;
  let sessionHigh = parseInt(localStorage.getItem('snake_high') || '0', 10);
  if (highEl) highEl.textContent = sessionHigh;
  let particleCtx = null;
  let particles = [];
  let particlesW = 0, particlesH = 0;
  let lastSnakeLen = null;

  // local flags
  let savedThisDeath = false;
  let deathShown = false;

  // ---------------------------
  // Small helpers
  // ---------------------------
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function log(...args) { console.debug('[game.js]', ...args); }

  // ---------------------------
  // Audio engine (small)
  // ---------------------------
  const AudioEngine = (() => {
    let ctx = null;
    function ensure() {
      if (!ctx) {
        try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { ctx = null; }
      }
      return ctx;
    }
    function resume() {
      const c = ensure();
      if (c && c.state === 'suspended') return c.resume();
      return Promise.resolve();
    }
    function beep(freq = 440, dur = 0.06, type = 'sine', gain = 0.05) {
      const c = ensure();
      if (!c) return;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.value = gain;
      o.connect(g); g.connect(c.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.stop(c.currentTime + dur + 0.02);
    }
    function eat() { beep(880, 0.06, 'sine', 0.07); beep(660, 0.04, 'sine', 0.04); }
    function gameOver() { beep(160, 0.18, 'sawtooth', 0.12); }
    function click() { beep(1100, 0.04, 'square', 0.04); }
    return { resume, eat, gameOver, click };
  })();

  // ---------------------------
  // Connection UI
  // ---------------------------
  function setConnState(s) {
    if (!connDot || !connLabel) return;
    if (s === 'connected') { connDot.className = 'dot dot-connected'; connLabel.textContent = 'connected'; }
    else if (s === 'connecting') { connDot.className = 'dot dot-connecting'; connLabel.textContent = 'connecting'; }
    else { connDot.className = 'dot dot-disconnected'; connLabel.textContent = 'disconnected'; }
  }

  if (socket) {
    socket.on('connect', () => { setConnState('connected'); AudioEngine.resume().catch(() => {}); log('socket connected', socket.id); });
    socket.on('disconnect', () => { setConnState('disconnected'); });
    socket.on('connect_error', (err) => { setConnState('connecting'); console.warn('connect_error', err); });
  } else {
    console.warn('socket.io client missing — multiplayer/restart features will fail until loaded.');
    setConnState('disconnected');
  }

  // ---------------------------
  // Canvas sizing & responsive layout
  // ---------------------------
  function computeCellSize(gridW, gridH) {
    const pagePadding = 36;
    const rightPanel = window.innerWidth > 920 ? 320 : 0;
    const maxAvailableW = Math.min(window.innerWidth - rightPanel - pagePadding, 920);
    const maxAvailableH = Math.min(window.innerHeight - 240, 720);
    const baseW = Math.floor(maxAvailableW / gridW);
    const baseH = Math.floor(maxAvailableH / gridH);
    const base = Math.max(1, Math.min(baseW, baseH));
    return clamp(base, MIN_CELL, MAX_CELL);
  }

  function resizeToGrid(gridW, gridH) {
    const newCell = computeCellSize(gridW, gridH);
    cellSize = newCell;
    if (canvas) {
      canvas.width = gridW * cellSize;
      canvas.height = gridH * cellSize;
      canvas.style.width = Math.min(canvas.width, window.innerWidth - 80) + 'px';
      canvas.style.height = 'auto';
    }
    if (particlesCanvas) {
      particlesCanvas.width = canvas.width;
      particlesCanvas.height = canvas.height;
      particlesW = particlesCanvas.width;
      particlesH = particlesCanvas.height;
      particleCtx = particlesCanvas.getContext('2d', { alpha: true });
      initParticles();
    }
  }

  // ---------------------------
  // Particle background
  // ---------------------------
  function initParticles() {
    particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * Math.max(300, particlesW),
        y: Math.random() * Math.max(200, particlesH),
        vx: (Math.random() - 0.5) * 0.7,
        vy: (Math.random() - 0.5) * 0.7,
        r: 1 + Math.random() * 3,
        hue: 170 + Math.random() * 120,
        a: 0.06 + Math.random() * 0.12
      });
    }
  }

  function drawParticles() {
    if (!particleCtx) return;
    particleCtx.clearRect(0, 0, particlesW, particlesH);
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < -20) p.x = particlesW + 20;
      if (p.x > particlesW + 20) p.x = -20;
      if (p.y < -20) p.y = particlesH + 20;
      if (p.y > particlesH + 20) p.y = -20;
      const g = particleCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 9);
      g.addColorStop(0, `hsla(${p.hue},90%,60%,${p.a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      particleCtx.fillStyle = g;
      particleCtx.fillRect(p.x - p.r * 9, p.y - p.r * 9, p.r * 18, p.r * 18);
    }
  }

  // ---------------------------
  // Rendering the game canvas
  // ---------------------------
  function render(state) {
    if (!state || !canvas) return;
    currentState = state;

    // ensure correct canvas size for grid
    if (!canvas.width || canvas.width !== state.w * cellSize || canvas.height !== state.h * cellSize) {
      resizeToGrid(state.w, state.h);
    }

    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // background
    ctx.fillStyle = '#020214';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // subtle grid
    ctx.beginPath();
    for (let x = 0; x <= state.w; x++) { ctx.moveTo(x * cellSize + 0.5, 0); ctx.lineTo(x * cellSize + 0.5, canvas.height); }
    for (let y = 0; y <= state.h; y++) { ctx.moveTo(0, y * cellSize + 0.5); ctx.lineTo(canvas.width, y * cellSize + 0.5); }
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1; ctx.stroke();

    // food
    if (state.food) {
      const t = Date.now() / 300;
      const pulse = 0.9 + 0.12 * Math.sin(t);
      const [fx, fy] = state.food;
      const cx = fx * cellSize + cellSize / 2, cy = fy * cellSize + cellSize / 2;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cellSize * 1.8 * pulse);
      grad.addColorStop(0, 'rgba(255,106,106,0.98)');
      grad.addColorStop(0.5, 'rgba(255,106,106,0.22)');
      grad.addColorStop(1, 'rgba(255,106,106,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(fx * cellSize - cellSize, fy * cellSize - cellSize, cellSize * 3, cellSize * 3);
      roundRect(ctx, fx * cellSize + 2, fy * cellSize + 2, cellSize - 4, cellSize - 4, 6);
      ctx.fillStyle = '#ff6b6b';
      ctx.fill();
    }

    // snake
    if (Array.isArray(state.snake)) {
      const snake = state.snake.slice().reverse();
      for (let i = 0; i < snake.length; i++) {
        const [sx, sy] = snake[i];
        const px = sx * cellSize, py = sy * cellSize;
        const size = (i === 0 ? cellSize - 2 : cellSize - 4);
        const r = (i === 0 ? 7 : 5);
        const pct = (snake.length - i) / Math.max(1, snake.length);
        ctx.fillStyle = gradientForPct(pct);
        if (i === 0) {
          ctx.shadowBlur = 16; ctx.shadowColor = '#0284c7';
          roundRect(ctx, px + 1, py + 1, size, size, r); ctx.fill(); ctx.shadowBlur = 0;
        } else {
          roundRect(ctx, px + 2, py + 2, size - 2, size - 2, r - 1); ctx.fill();
        }
      }
    }

    // HUD updates
    if (scoreEl) scoreEl.textContent = state.score ?? '0';
    if (stateEl) stateEl.textContent = state.alive ? 'running' : 'dead';
    if (gridEl) gridEl.textContent = `${state.w} x ${state.h}`;

    if ((state.score ?? 0) > sessionHigh) {
      sessionHigh = state.score;
      localStorage.setItem('snake_high', String(sessionHigh));
      if (highEl) highEl.textContent = sessionHigh;
    }

    // detect eating
    const curLen = Array.isArray(state.snake) ? state.snake.length : 0;
    if (lastSnakeLen != null && curLen > lastSnakeLen) {
      showScorePopup('+1'); AudioEngine.eat();
    }
    lastSnakeLen = curLen;
  }

  function gradientForPct(p) {
    const c1 = [0, 132, 199], c2 = [125, 211, 252];
    const r = Math.round(c1[0] * p + c2[0] * (1 - p));
    const g = Math.round(c1[1] * p + c2[1] * (1 - p));
    const b = Math.round(c1[2] * p + c2[2] * (1 - p));
    return `rgb(${r},${g},${b})`;
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.max(0, r);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  // ---------------------------
  // Score popup
  // ---------------------------
  let scorePopupTimeout = null;
  function showScorePopup(text) {
    if (!scorePopup) return;
    scorePopup.textContent = text;
    scorePopup.classList.add('show');
    if (scorePopupTimeout) clearTimeout(scorePopupTimeout);
    scorePopupTimeout = setTimeout(() => scorePopup.classList.remove('show'), SCORE_POPUP_TIME);
  }

  // ---------------------------
  // Socket `state` listener
  // ---------------------------
  if (socket) {
    socket.on('state', (s) => {
      if (s && s.snake && !Array.isArray(s.snake)) s.snake = Array.from(s.snake);
      if (s && s.food && !Array.isArray(s.food)) s.food = Array.from(s.food);
      render(s);

      // overlays logic
      if (s && s.alive) {
        hideGameOver(); hideMainMenu();
        savedThisDeath = false; deathShown = false;
      } else if (s && !s.alive) {
        if (!deathShown) showGameOver(s.score ?? 0);
      }
    });
  }

  // ---------------------------
  // Input handling (keyboard/on-screen/swipe)
  // ---------------------------
  function sendDir(dx, dy) { if (!socket) return; try { socket.emit('change_direction', { dx, dy }); } catch (e) { console.warn('emit failed', e); } }

  // canonical arrows
  upBtn?.addEventListener('click', () => { AudioEngine.click(); sendDir(0, -1); });
  downBtn?.addEventListener('click', () => { AudioEngine.click(); sendDir(0, 1); });
  leftBtn?.addEventListener('click', () => { AudioEngine.click(); sendDir(-1, 0); });
  rightBtn?.addEventListener('click', () => { AudioEngine.click(); sendDir(1, 0); });

  // mobile arrows
  m_up?.addEventListener('click', () => { AudioEngine.click(); sendDir(0, -1); });
  m_down?.addEventListener('click', () => { AudioEngine.click(); sendDir(0, 1); });
  m_left?.addEventListener('click', () => { AudioEngine.click(); sendDir(-1, 0); });
  m_right?.addEventListener('click', () => { AudioEngine.click(); sendDir(1, 0); });

  // keyboard
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'w', 'W'].includes(e.key)) sendDir(0, -1);
    if (['ArrowDown', 's', 'S'].includes(e.key)) sendDir(0, 1);
    if (['ArrowLeft', 'a', 'A'].includes(e.key)) sendDir(-1, 0);
    if (['ArrowRight', 'd', 'D'].includes(e.key)) sendDir(1, 0);
    if (e.key === ' ' && currentState && !currentState.alive) socket?.emit('restart');
  });

  // swipe support
  let touchStart = null;
  canvas?.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  canvas?.addEventListener('touchend', (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 12) sendDir(1, 0);
      else if (dx < -12) sendDir(-1, 0);
    } else {
      if (dy > 12) sendDir(0, 1);
      else if (dy < -12) sendDir(0, -1);
    }
    touchStart = null;
  }, { passive: true });

  // ---------------------------
  // Overlays: Restart / Pause
  // ---------------------------
  function normalizeControlLabels() {
    if (pauseBtn) { pauseBtn.textContent = 'Pause'; pauseBtn.setAttribute('aria-label', 'Pause game'); pauseBtn.classList.add('control-btn'); }
    if (btnRestart) { btnRestart.textContent = 'Restart'; btnRestart.setAttribute('aria-label', 'Restart game'); btnRestart.classList.add('control-btn'); }
  }
  normalizeControlLabels();

  // remove Start button from DOM if present (user requested)
  if (btnStart && btnStart.parentElement) {
    try {
      btnStart.remove();
      log('Removed Start button from DOM.');
    } catch (e) {
      console.warn('Failed to remove Start button:', e);
    }
  }

  btnRestart?.addEventListener('click', () => { AudioEngine.click(); socket?.emit('restart'); hideGameOver(); });
  btnMenu?.addEventListener('click', () => { AudioEngine.click(); showMainMenu(); hideGameOver(); socket?.emit('restart'); });
  pauseBtn?.addEventListener('click', () => { AudioEngine.click(); showMainMenu(); });

  function showMainMenu() {
    hideLeaderboardModal(); mainOverlay?.classList.remove('hidden');
  }
  function hideMainMenu() { mainOverlay?.classList.add('hidden'); }

  function showGameOver(score) {
    hideLeaderboardModal();
    mainOverlay?.classList.add('hidden');
    const finalScoreEl = document.getElementById('finalScore');
    if (finalScoreEl) finalScoreEl.textContent = score;
    gameOverOverlay?.classList.remove('hidden');
    AudioEngine.gameOver();
    trySaveScoreToLeaderboard(score);
    deathShown = true;
  }
  function hideGameOver() { gameOverOverlay?.classList.add('hidden'); }

  // ---------------------------
  // Leaderboard (localStorage)
  // ---------------------------
  function getLeaderboard() { try { return JSON.parse(localStorage.getItem('snake_lb') || '[]'); } catch (e) { return []; } }
  function saveLeaderboard(arr) { localStorage.setItem('snake_lb', JSON.stringify(arr.slice(0, MAX_LEADERBOARD))); }

  function trySaveScoreToLeaderboard(score) {
    if (typeof score !== 'number' || score <= 0) return;
    if (savedThisDeath) return;
    savedThisDeath = true;
    setTimeout(() => {
      let name = prompt('Enter name for leaderboard (max 12 chars):', 'You') || 'You';
      name = name.slice(0, 12);
      const lb = getLeaderboard();
      lb.push({ name, score, ts: Date.now() });
      lb.sort((a, b) => b.score - a.score);
      saveLeaderboard(lb);
      renderLeaderboard();
    }, 120);
  }

  function renderLeaderboard() {
    const lb = getLeaderboard();
    if (!leaderboardList) return;
    leaderboardList.innerHTML = '';
    if (!lb || lb.length === 0) {
      const li = document.createElement('li'); li.textContent = 'No scores yet — be the first!'; leaderboardList.appendChild(li); return;
    }
    lb.slice(0, MAX_LEADERBOARD).forEach((r, i) => {
      const li = document.createElement('li'); li.textContent = `${i + 1}. ${r.name} — ${r.score}`; leaderboardList.appendChild(li);
    });
  }

  function hideAllOverlays() { mainOverlay?.classList.add('hidden'); gameOverOverlay?.classList.add('hidden'); leaderboardModal?.classList.add('hidden'); }
  function showLeaderboardModal() { hideAllOverlays(); renderLeaderboard(); setTimeout(() => leaderboardModal?.classList.remove('hidden'), 80); }
  function hideLeaderboardModal() { leaderboardModal?.classList.add('hidden'); }

  openLeaderboard?.addEventListener('click', (e) => { e.preventDefault(); AudioEngine.click(); showLeaderboardModal(); });
  lbClose?.addEventListener('click', (e) => { e.preventDefault(); AudioEngine.click(); hideLeaderboardModal(); if (!currentState || !currentState.alive) mainOverlay?.classList.remove('hidden'); });
  lbClear?.addEventListener('click', (e) => { e.preventDefault(); if (confirm('Clear leaderboard?')) { saveLeaderboard([]); renderLeaderboard(); } });

  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { if (leaderboardModal && !leaderboardModal.classList.contains('hidden')) hideLeaderboardModal(); } });

  // ---------------------------
  // Theme toggle (light/dark) — WORKING
  // ---------------------------
  // Behavior: toggles between `theme-light` and `theme-dark` classes on <body>.
  // Persist selection in localStorage as 'snake_theme' with values 'light' or 'dark'.
  function applyThemeFromStorage() {
    const t = localStorage.getItem('snake_theme');
    if (t === 'light') {
      document.body.classList.remove('theme-dark'); document.body.classList.add('theme-light');
    } else if (t === 'dark') {
      document.body.classList.remove('theme-light'); document.body.classList.add('theme-dark');
    } else {
      // default: dark
      document.body.classList.remove('theme-light'); document.body.classList.add('theme-dark');
      localStorage.setItem('snake_theme', 'dark');
    }
  }
  function toggleTheme() {
    AudioEngine.click();
    const current = localStorage.getItem('snake_theme') || 'dark';
    if (current === 'dark') {
      document.body.classList.remove('theme-dark'); document.body.classList.add('theme-light');
      localStorage.setItem('snake_theme', 'light');
    } else {
      document.body.classList.remove('theme-light'); document.body.classList.add('theme-dark');
      localStorage.setItem('snake_theme', 'dark');
    }
  }
  // wire theme toggle click (supports both id and class fallbacks)
  if (themeToggle) {
    themeToggle.addEventListener('click', (e) => { e?.preventDefault(); toggleTheme(); });
  } else {
    // try to find by attribute or a top toolbar button if the expected one is missing
    const fallback = document.querySelector('[data-theme-toggle], .themeToggle, .toggle-theme');
    if (fallback) {
      themeToggle = fallback;
      themeToggle.addEventListener('click', (e) => { e?.preventDefault(); toggleTheme(); });
    } else {
      // no theme control exists in DOM — nothing to wire
      log('Theme toggle control not found in DOM (expected #themeToggle or .theme-toggle).');
    }
  }
  // allow 't' key to toggle theme as convenience
  window.addEventListener('keydown', (e) => { if (e.key === 't' || e.key === 'T') toggleTheme(); });
  // apply saved theme on load
  applyThemeFromStorage();

  // ---------------------------
  // Duplicate arrow removal (permanent) — keep canonical IDs
  // ---------------------------
  function removeDuplicateArrowsPermanently() {
    try {
      const canonicalIds = new Set(['up', 'down', 'left', 'right', 'm-up', 'm-down', 'm-left', 'm-right']);
      const arrows = new Set(['↑', '↓', '←', '→', '⟵', '⟶', '↖', '↗', '↘', '↙', '‹', '›']);
      const candidates = Array.from(document.querySelectorAll('button, a, div, span'))
        .filter(el => {
          if (!el.parentElement) return false;
          if (el.id && canonicalIds.has(el.id)) return false;
          const text = (el.textContent || '').trim();
          if (!text) return false;
          if (text.length <= 3 && [...text].some(ch => arrows.has(ch))) return true;
          if (arrows.has(text[0]) || arrows.has(text[text.length - 1])) return true;
          return false;
        });

      candidates.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 16 || rect.height < 16) return;
        if (el.id && canonicalIds.has(el.id)) return;
        try { el.remove(); log('Removed duplicate arrow element permanently:', el); } catch (e) { console.warn('Failed to remove duplicate arrow', e); }
      });
    } catch (e) {
      console.warn('removeDuplicateArrowsPermanently failed', e);
    }
  }
  setTimeout(removeDuplicateArrowsPermanently, 120);

  // ---------------------------
  // Click ripple effect & focus handling (delegated)
  // ---------------------------
  (function attachRipple() {
    document.addEventListener('pointerdown', function (e) {
      const el = e.target.closest('.btn, .btn-dir, .icon-btn, .control-btn, .icon, .icon-button, .moved-control');
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      const size = Math.max(rect.width, rect.height) * 1.2;
      ripple.style.width = ripple.style.height = size + 'px';
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top - size / 2;
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      ripple.style.position = 'absolute';
      ripple.style.borderRadius = '50%';
      ripple.style.pointerEvents = 'none';
      el.style.position = el.style.position || 'relative';
      el.appendChild(ripple);
      setTimeout(() => ripple.remove(), 700);
    }, { passive: true });

    document.addEventListener('keydown', function (e) { if (e.key === 'Tab' || e.key === 'Shift') document.documentElement.classList.add('user-is-tabbing'); });
    document.addEventListener('pointerdown', function () { document.documentElement.classList.remove('user-is-tabbing'); });
  })();

  // ---------------------------
  // Particle animation loop
  // ---------------------------
  function frame() { drawParticles(); requestAnimationFrame(frame); }
  requestAnimationFrame(frame);

  // ---------------------------
  // Resize handler
  // ---------------------------
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (currentState && currentState.w && currentState.h) {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => resizeToGrid(currentState.w, currentState.h), 140);
    }
  });

  // ---------------------------
  // Initial leaderboard render & safe UI state
  // ---------------------------
  renderLeaderboard();
  mainOverlay?.classList.remove('hidden');
  gameOverOverlay?.classList.add('hidden');
  leaderboardModal?.classList.add('hidden');

  // ---------------------------
  // Helper functions used above
  // ---------------------------
  function renderLeaderboard() {
    const lb = getLeaderboard();
    if (!leaderboardList) return;
    leaderboardList.innerHTML = '';
    if (!lb || lb.length === 0) {
      const li = document.createElement('li'); li.textContent = 'No scores yet — be the first!'; leaderboardList.appendChild(li); return;
    }
    lb.slice(0, MAX_LEADERBOARD).forEach((r, i) => {
      const li = document.createElement('li'); li.textContent = `${i + 1}. ${r.name} — ${r.score}`; leaderboardList.appendChild(li);
    });
  }

  function getLeaderboard() { try { return JSON.parse(localStorage.getItem('snake_lb') || '[]'); } catch (e) { return []; } }

  // End IIFE
})();
