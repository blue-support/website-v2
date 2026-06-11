const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const statsEndpoint = window.BLUE_STATS_ENDPOINT || '/api/stats';
const statusEndpoint = window.BLUE_STATUS_ENDPOINT || '/api/status';

function formatValue(value, suffix = '') {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return new Intl.NumberFormat('de-DE').format(value) + suffix;
  return String(value);
}

async function fetchJson(url, fallbackUrl) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (!fallbackUrl) throw error;
    const fallback = await fetch(fallbackUrl, { cache: 'no-store' });
    return fallback.json();
  }
}

function setText(selector, value) {
  $$(selector).forEach((node) => {
    node.textContent = value;
  });
}

function setStats(data) {
  const values = {
    onlineUsers: formatValue(data.onlineUsers),
    guilds: formatValue(data.guilds),
    commandsToday: formatValue(data.commandsToday),
    latency: data.latency === null || data.latency === undefined ? '—' : `${data.latency}ms`,
    uptime: formatValue(data.uptime),
  };

  Object.entries(values).forEach(([key, value]) => {
    $$(`[data-stat="${key}"]`).forEach((node) => {
      node.textContent = value;
    });
  });
}

function statusText(status) {
  const map = {
    online: 'Online',
    offline: 'Offline',
    degraded: 'Degraded',
    maintenance: 'Maintenance',
  };
  return map[status] || status || 'Unbekannt';
}

function setStatus(data) {
  const overall = data.overall || 'offline';
  setText('[data-status-title]', data.title || statusText(overall));
  setText('[data-status-message]', data.message || 'Status wird geladen.');
  setText('[data-status-label]', statusText(overall));

  $$('[data-status-badge]').forEach((badge) => {
    badge.classList.remove('online', 'offline', 'degraded', 'maintenance');
    badge.classList.add(overall);
    badge.textContent = statusText(overall);
  });

  $$('[data-status-orb]').forEach((orb) => {
    orb.classList.remove('online', 'offline', 'degraded', 'maintenance');
    orb.classList.add(overall);
  });

  const componentList = $('[data-components]');
  if (componentList && Array.isArray(data.components)) {
    componentList.innerHTML = data.components.map((item) => `
      <div class="component">
        <div><strong>${item.name}</strong><br><small>${item.description || 'Service Status'}</small></div>
        <span class="chip ${item.status}">${statusText(item.status)}</span>
      </div>
    `).join('');
  }

  const incidentList = $('[data-incidents]');
  if (incidentList && Array.isArray(data.incidents)) {
    incidentList.innerHTML = data.incidents.map((item) => `
      <div class="incident">
        <strong>${item.title}</strong>
        <small>${item.date || ''}</small>
        <p>${item.text || ''}</p>
      </div>
    `).join('');
  }
}

async function loadLiveData() {
  try {
    const [stats, status] = await Promise.all([
      fetchJson(statsEndpoint, '/data/stats.json'),
      fetchJson(statusEndpoint, '/data/status.json'),
    ]);
    setStats(stats);
    setStatus(status);
  } catch (error) {
    console.warn('Live-Daten konnten nicht geladen werden:', error);
  }
}

function initNavigation() {
  const toggle = $('[data-nav-toggle]');
  const nav = $('[data-nav]');
  const header = $('[data-header]');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    toggle.classList.toggle('open', isOpen);
    toggle.setAttribute('aria-expanded', String(isOpen));
  });

  nav.addEventListener('click', (event) => {
    if (event.target.tagName === 'A') {
      nav.classList.remove('open');
      toggle.classList.remove('open');
    }
  });

  const onScroll = () => {
    if (!header) return;
    header.classList.toggle('scrolled', window.scrollY > 18);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

function initReveal() {
  const elements = $$('.reveal');
  if (!elements.length || !('IntersectionObserver' in window)) {
    elements.forEach((el) => el.classList.add('visible'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.14 });
  elements.forEach((el) => observer.observe(el));
}

function initTilt() {
  const cards = $$('[data-tilt]');
  cards.forEach((card) => {
    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      card.style.transform = `rotateY(${x * 8}deg) rotateX(${-y * 8}deg)`;
    });
    card.addEventListener('pointerleave', () => {
      card.style.transform = '';
    });
  });
}

function initParticles() {
  const canvas = $('#fx-canvas');
  if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let particles = [];
  const count = Math.min(90, Math.floor(window.innerWidth / 18));

  function resize() {
    width = canvas.width = window.innerWidth * window.devicePixelRatio;
    height = canvas.height = window.innerHeight * window.devicePixelRatio;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.22 * window.devicePixelRatio,
      vy: (Math.random() - 0.5) * 0.22 * window.devicePixelRatio,
      r: (Math.random() * 1.8 + 0.55) * window.devicePixelRatio,
      a: Math.random() * 0.55 + 0.2,
    }));
  }

  function tick() {
    ctx.clearRect(0, 0, width, height);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > width) p.vx *= -1;
      if (p.y < 0 || p.y > height) p.vy *= -1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(125, 211, 252, ${p.a})`;
      ctx.fill();
    }
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const max = 145 * window.devicePixelRatio;
        if (dist < max) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(96, 165, 250, ${0.16 * (1 - dist / max)})`;
          ctx.lineWidth = window.devicePixelRatio;
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(tick);
  }

  resize();
  tick();
  window.addEventListener('resize', resize, { passive: true });
}

function initSupportRedirect() {
  const redirect = $('[data-support-redirect]');
  if (!redirect) return;
  setTimeout(() => {
    window.location.href = 'https://dsc.blue-lol.de';
  }, 900);
}

initNavigation();
initReveal();
initTilt();
initParticles();
initSupportRedirect();
loadLiveData();
setInterval(loadLiveData, 30000);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function formatBanPanel(info) {
  if (!info) return '<strong>Status:</strong> Wird geprüft<br><small>Der Bot aktualisiert diese Daten gleich.</small>';
  const checked = info.checked !== false;
  const banned = Boolean(info.banned);
  const reason = info.reason || (banned ? 'Kein Grund gespeichert.' : 'Kein Ban gefunden.');
  const duration = info.duration || (banned ? 'Unbekannt' : 'Nicht gebannt');
  const until = info.until ? `<br><strong>Bis:</strong> ${escapeHtml(info.until)}` : '';
  return `
    <strong>Status:</strong> ${checked ? (banned ? 'Gebannt' : 'Kein Ban gefunden') : 'Wird geprüft'}<br>
    <strong>Grund:</strong> ${escapeHtml(reason)}<br>
    <strong>Dauer:</strong> ${escapeHtml(duration)}${until}
  `;
}

function statusLabel(value) {
  const labels = { pending: 'Wartet', in_review: 'In Bearbeitung', accepted: 'Angenommen', rejected: 'Abgelehnt', error: 'Fehler' };
  return labels[value] || value || 'Unbekannt';
}

async function initUnbanPage() {
  const authBox = $('[data-unban-auth]');
  const choices = $('[data-unban-choices]');
  const message = $('[data-unban-message]');
  const form = $('[data-unban-form]');
  const historyBox = $('[data-unban-history]');
  const historyList = $('[data-history-list]');
  if (!authBox || !choices || !form) return;

  let selectedType = null;
  let state = null;

  function showMessage(text, type = 'info') {
    if (!message) return;
    message.hidden = false;
    message.className = `notice-card ${type}`;
    message.textContent = text;
  }

  async function refreshData() {
    const response = await fetch('/api/auth/me', { cache: 'no-store' });
    const auth = await response.json();
    if (!auth.loggedIn) {
      authBox.innerHTML = '<h2>Discord Login</h2><p>Du musst dich anmelden, damit dein Antrag eindeutig deiner Discord-ID zugeordnet werden kann.</p><a class="btn primary" href="/auth/discord?return=/unban.html">Mit Discord anmelden</a>';
      choices.hidden = true;
      form.hidden = true;
      return;
    }

    authBox.innerHTML = `
      <h2>Eingeloggt</h2>
      <div class="discord-user-card">
        <span class="user-avatar">${escapeHtml((auth.user.global_name || auth.user.username || 'U').slice(0, 1).toUpperCase())}</span>
        <div><strong>${escapeHtml(auth.user.global_name || auth.user.username)}</strong><small>ID: ${escapeHtml(auth.user.id)}</small></div>
      </div>
      <button class="btn ghost" data-unban-logout>Abmelden</button>
    `;
    $('[data-unban-logout]', authBox)?.addEventListener('click', async () => {
      await fetch('/auth/logout', { method: 'POST' });
      window.location.reload();
    });

    await fetch('/api/unban/request-lookup', { method: 'POST' }).catch(() => null);
    const data = await (await fetch('/api/unban/me', { cache: 'no-store' })).json();
    state = data;
    choices.hidden = false;

    ['discord', 'global'].forEach((type) => {
      const infoBox = $(`[data-ban-info="${type}"]`);
      if (infoBox) infoBox.innerHTML = formatBanPanel(data.banInfo?.[type]);
      const choice = $(`[data-unban-choice="${type}"]`);
      const btn = $(`[data-select-unban="${type}"]`);
      const pending = data.pending?.[type];
      if (choice) choice.classList.toggle('disabled', Boolean(pending));
      if (btn) {
        btn.disabled = Boolean(pending);
        btn.textContent = pending ? 'Bereits in Bearbeitung' : (type === 'discord' ? 'Discord Unban wählen' : 'Global Unban wählen');
      }
    });

    if (historyBox && historyList && Array.isArray(data.history) && data.history.length) {
      historyBox.hidden = false;
      historyList.innerHTML = data.history.map((item) => `
        <div class="history-item">
          <strong>${item.type === 'global' ? 'Blue Security Global Unban' : 'Discord Unban'}</strong>
          <span>${statusLabel(item.status)}</span>
          <small>${escapeHtml(new Date(item.submittedAt).toLocaleString('de-DE'))}</small>
        </div>
      `).join('');
    }
  }

  $$('[data-select-unban]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedType = button.dataset.selectUnban;
      const pending = state?.pending?.[selectedType];
      if (pending) return showMessage('Du hast bereits einen Antrag in Bearbeitung.', 'warn');
      form.hidden = false;
      $('[data-form-type]').textContent = selectedType === 'global' ? 'Blue Security Global Unban' : 'Discord Unban';
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  $('[data-cancel-unban]')?.addEventListener('click', () => {
    form.hidden = true;
    selectedType = null;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedType) return showMessage('Bitte wähle zuerst Discord Unban oder Global Unban.', 'warn');
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.type = selectedType;
    payload.notifyDm = Boolean(form.querySelector('[name="notifyDm"]')?.checked);

    const response = await fetch('/api/unban/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      return showMessage(result.error || 'Antrag konnte nicht gesendet werden.', response.status === 409 ? 'warn' : 'error');
    }
    form.reset();
    form.hidden = true;
    showMessage('Dein Antrag wurde gesendet. Das Team prüft ihn jetzt im Discord-Log.', 'success');
    await refreshData();
  });

  await refreshData();
  setTimeout(refreshData, 8000);
}

initUnbanPage();
