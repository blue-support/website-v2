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


function normalizeNavPath(href) {
  try {
    const url = new URL(href, window.location.origin);
    return url.pathname.replace(/\/+$/, '') || '/';
  } catch (error) {
    return String(href || '').replace(/^\.?\//, '/').replace(/\/+$/, '') || '/';
  }
}

function navHasPath(nav, path) {
  const wanted = normalizeNavPath(path);
  return Array.from(nav.querySelectorAll('a[href]')).some((link) => normalizeNavPath(link.getAttribute('href')) === wanted);
}

function ensureUpdatesNavLink() {
  const nav = $('[data-nav]');
  if (!nav || navHasPath(nav, '/updates.html') || navHasPath(nav, '/updates')) return;
  const link = document.createElement('a');
  link.href = '/updates.html';
  link.textContent = 'Updates';
  const dashboard = Array.from(nav.querySelectorAll('a[href]')).find((item) => normalizeNavPath(item.getAttribute('href')) === '/dashboard' || normalizeNavPath(item.getAttribute('href')) === '/dashboard.html');
  if (dashboard && dashboard.nextSibling) nav.insertBefore(link, dashboard.nextSibling);
  else nav.appendChild(link);
}

function ensureTesterNavLink() {
  const nav = $('[data-nav]');
  if (!nav || navHasPath(nav, '/tester.html') || navHasPath(nav, '/tester') || navHasPath(nav, '/tester-dash')) return;
  const link = document.createElement('a');
  link.href = '/tester.html';
  link.textContent = 'Tester Dash';
  if (normalizeNavPath(window.location.pathname) === '/tester.html' || normalizeNavPath(window.location.pathname) === '/tester') {
    link.classList.add('active');
  }
  const dashboard = Array.from(nav.querySelectorAll('a[href]')).find((item) => normalizeNavPath(item.getAttribute('href')) === '/dashboard' || normalizeNavPath(item.getAttribute('href')) === '/dashboard.html');
  if (dashboard && dashboard.nextSibling) nav.insertBefore(link, dashboard.nextSibling);
  else nav.appendChild(link);
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

ensureUpdatesNavLink();
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


async function initGlobalAuth() {
  const authSlots = $$('[data-global-auth]');
  if (!authSlots.length) return;

  let auth = { loggedIn: false, user: null };
  try {
    const response = await fetch('/api/auth/me', { cache: 'no-store' });
    auth = await response.json();
  } catch (error) {
    console.warn('Login-Status konnte nicht geladen werden:', error);
  }

  if (auth.loggedIn && auth.user) {
    try {
      const testerResponse = await fetch('/api/tester/me', { cache: 'no-store' });
      const tester = await testerResponse.json();
      if (tester?.testerAccess?.isTester) ensureTesterNavLink();
    } catch (error) {
      // Tester-Dash bleibt verborgen, wenn der Bot die Rolle noch nicht bestätigt hat.
    }
  }

  authSlots.forEach((slot) => {
    let returnPath = slot.dataset.authReturn || (window.location.pathname || '/index.html');
    if (/^\/dashboard(?:\/|\.)(\d+)/.test(window.location.pathname || '')) {
      returnPath = `${window.location.pathname}${window.location.search || ''}${window.location.hash || ''}`;
    }
    if (!auth.loggedIn || !auth.user) {
      if (slot.dataset.authNoLogin === 'true') {
        slot.innerHTML = '';
        return;
      }
      const loginLabel = auth.hasCachedLogin ? 'Discord Login' : 'Discord Login';
      slot.innerHTML = `<a class="nav-login" data-discord-login-link href="/auth/discord?return=${encodeURIComponent(returnPath)}">${loginLabel}</a>`;
      const loginLink = $('[data-discord-login-link]', slot);
      loginLink?.addEventListener('click', (event) => {
        const now = Date.now();
        const lastClick = Number(sessionStorage.getItem('blue.oauth.lastClick') || 0);
        if (lastClick && now - lastClick < 5000) {
          event.preventDefault();
          return;
        }
        sessionStorage.setItem('blue.oauth.lastClick', String(now));
        loginLink.classList.add('is-loading');
        loginLink.textContent = 'Login startet...';
        loginLink.setAttribute('aria-disabled', 'true');
      });
      return;
    }

    const displayName = auth.user.global_name || auth.user.username || 'Discord User';
    const initial = displayName.slice(0, 1).toUpperCase();
    slot.innerHTML = `
      <div class="nav-user-pill" title="${escapeHtml(displayName)}">
        <span class="nav-user-avatar">${escapeHtml(initial)}</span>
        <span class="nav-user-name">${escapeHtml(displayName)}</span>
        <button class="nav-logout" type="button" data-global-logout>Logout</button>
      </div>
    `;
    $('[data-global-logout]', slot)?.addEventListener('click', async () => {
      await fetch('/auth/logout', { method: 'POST' });
      window.location.reload();
    });
  });
}

async function initUnbanPage() {
  const choices = $('[data-unban-choices]');
  const message = $('[data-unban-message]');
  const form = $('[data-unban-form]');
  const historyBox = $('[data-unban-history]');
  const historyList = $('[data-history-list]');
  if (!choices || !form) return;

  let selectedSystem = null;
  let state = null;
  let systems = [];
  let loggedIn = false;

  const fallbackSystems = [
    { id: 'global', type: 'global', label: 'Blue Security Global Unban', description: 'Für einen Ban aus dem Blue Security Global-Ban-System.', banKey: 'global', always: true },
    { id: 'globalchat', type: 'globalchat', label: 'Globalchat Unban', description: 'Für einen Ban aus dem normalen Blue Globalchat.', banKey: 'globalchat', always: true },
  ];

  function systemKey(system) {
    return system?.id || (system?.type === 'discord' ? `discord:${system.guildId || ''}` : system?.type || 'discord');
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function unbanTypeLabel(type) {
    if (type === 'global') return 'Blue Security Global Unban';
    if (type === 'globalchat') return 'Globalchat Unban';
    return 'Discord Unban';
  }

  function unbanSystemLabel(system) {
    if (!system) return 'Unban Antrag';
    return system.label || (system.type === 'discord' && system.serverName ? `${system.serverName} Unban` : unbanTypeLabel(system.type));
  }

  function historyLabel(item) {
    if (!item) return 'Unban Antrag';
    if (item.type === 'discord' && item.guildName) return `${item.guildName} Unban`;
    return unbanTypeLabel(item.type);
  }

  function unbanIcon(system) {
    if (system.type === 'global') return '🌍';
    if (system.type === 'globalchat') return '💬';
    return '🛡️';
  }

  function showMessage(text, type = 'info') {
    if (!message) return;
    message.hidden = false;
    message.className = `notice-card ${type}`;
    message.textContent = text;
  }

  async function loadSystems() {
    try {
      const response = await fetch('/api/unban/systems', { cache: 'no-store' });
      const data = await response.json();
      systems = Array.isArray(data.systems) && data.systems.length ? data.systems : fallbackSystems;
    } catch {
      systems = fallbackSystems;
    }
    renderChoices();
  }

  function renderChoices() {
    choices.innerHTML = systems.map((system) => `
      <article class="unban-choice" data-unban-choice-key="${escapeHtml(systemKey(system))}">
        <span class="choice-icon">${escapeHtml(unbanIcon(system))}</span>
        <h3>${escapeHtml(unbanSystemLabel(system))}</h3>
        <p>${escapeHtml(system.description || 'Unban-Antrag über Blue stellen.')}</p>
        <div class="ban-info" data-ban-info-key="${escapeHtml(systemKey(system))}">Ban-Status wird geladen...</div>
        <button class="btn ghost" type="button" data-select-unban="${escapeHtml(systemKey(system))}">${escapeHtml(unbanSystemLabel(system))} wählen</button>
      </article>
    `).join('');
  }

  function banInfoForSystem(data, system) {
    if (!data?.banInfo || !system) return null;
    if (system.type === 'discord' && system.guildId) return data.banInfo.discordServers?.[String(system.guildId)] || null;
    return data.banInfo?.[system.type] || null;
  }

  function pendingForSystem(data, system) {
    if (!data?.pending || !system) return null;
    const key = systemKey(system);
    if (data.pending.byKey?.[key]) return data.pending.byKey[key];
    if (system.type === 'discord' && system.guildId) return data.pending.discordServers?.[String(system.guildId)] || null;
    return data.pending?.[system.type] || null;
  }

  function setLoginRequiredState() {
    choices.hidden = false;
    form.hidden = true;
    if (historyBox) historyBox.hidden = true;
    systems.forEach((system) => {
      const key = systemKey(system);
      const infoBox = $(`[data-ban-info-key="${cssEscape(key)}"]`);
      if (infoBox) {
        infoBox.innerHTML = '<strong>Status:</strong> Login erforderlich<br><strong>Hinweis:</strong> Melde dich oben rechts mit Discord an, damit wir deinen Ban-Status prüfen können.';
      }
      const choice = $(`[data-unban-choice-key="${cssEscape(key)}"]`);
      const btn = $(`[data-select-unban="${cssEscape(key)}"]`);
      if (choice) choice.classList.add('disabled');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Erst einloggen';
        btn.setAttribute('aria-disabled', 'true');
      }
    });
    showMessage('Bitte melde dich oben rechts mit Discord an, bevor du einen Unban-Antrag auswählen kannst.', 'warn');
  }

  async function refreshData() {
    await loadSystems();
    const response = await fetch('/api/auth/me', { cache: 'no-store' });
    const auth = await response.json();
    loggedIn = Boolean(auth.loggedIn);

    if (!loggedIn) {
      setLoginRequiredState();
      return;
    }

    await fetch('/api/unban/request-lookup', { method: 'POST' }).catch(() => null);
    const data = await (await fetch('/api/unban/me', { cache: 'no-store' })).json();
    state = data;
    if (Array.isArray(data.systems) && data.systems.length) {
      systems = data.systems;
      renderChoices();
    }
    choices.hidden = false;
    if (message) message.hidden = true;

    systems.forEach((system) => {
      const key = systemKey(system);
      const banInfo = banInfoForSystem(data, system);
      const isChecked = banInfo?.checked === true;
      const isBanned = banInfo?.banned === true;
      const infoBox = $(`[data-ban-info-key="${cssEscape(key)}"]`);
      if (infoBox) infoBox.innerHTML = formatBanPanel(banInfo);
      const choice = $(`[data-unban-choice-key="${cssEscape(key)}"]`);
      const btn = $(`[data-select-unban="${cssEscape(key)}"]`);
      const pending = pendingForSystem(data, system);
      const disabled = Boolean(pending) || !isChecked || !isBanned;
      if (choice) {
        choice.classList.toggle('disabled', disabled);
        choice.classList.toggle('not-banned', isChecked && !isBanned);
      }
      if (btn) {
        btn.disabled = disabled;
        btn.setAttribute('aria-disabled', String(disabled));
        if (pending) btn.textContent = 'Bereits in Bearbeitung';
        else if (!isChecked) btn.textContent = 'Ban-Status wird geprüft';
        else if (!isBanned) btn.textContent = 'Kein Ban gefunden';
        else btn.textContent = `${unbanSystemLabel(system)} wählen`;
      }
    });

    if (historyBox && historyList && Array.isArray(data.history) && data.history.length) {
      historyBox.hidden = false;
      historyList.innerHTML = data.history.map((item) => `
        <div class="history-item">
          <strong>${escapeHtml(historyLabel(item))}</strong>
          <span>${statusLabel(item.status)}</span>
          <small>${escapeHtml(new Date(item.submittedAt).toLocaleString('de-DE'))}</small>
        </div>
      `).join('');
    }
  }

  choices.addEventListener('click', (event) => {
    const button = event.target.closest('[data-select-unban]');
    if (!button || button.disabled || !loggedIn) return;
    const key = String(button.dataset.selectUnban || '');
    selectedSystem = systems.find((system) => systemKey(system) === key) || null;
    if (!selectedSystem) return;
    const pending = pendingForSystem(state, selectedSystem);
    const banInfo = banInfoForSystem(state, selectedSystem);
    if (pending) return showMessage('Du hast bereits einen Antrag in Bearbeitung.', 'warn');
    if (!banInfo?.checked) return showMessage('Dein Ban-Status wird noch geprüft. Bitte warte kurz und lade die Seite neu.', 'warn');
    if (!banInfo?.banned) return showMessage('Für diesen Bereich wurde kein aktiver Ban gefunden. Deshalb kannst du keinen Unban-Antrag senden.', 'warn');
    form.hidden = false;
    $('[data-form-type]').textContent = unbanSystemLabel(selectedSystem);
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  $('[data-cancel-unban]')?.addEventListener('click', () => {
    form.hidden = true;
    selectedSystem = null;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!loggedIn) return showMessage('Bitte melde dich zuerst oben rechts mit Discord an.', 'warn');
    if (!selectedSystem) return showMessage('Bitte wähle zuerst einen Unban-Typ.', 'warn');
    const banInfo = banInfoForSystem(state, selectedSystem);
    if (!banInfo?.checked) return showMessage('Dein Ban-Status wird noch geprüft. Bitte warte kurz und versuche es erneut.', 'warn');
    if (!banInfo?.banned) return showMessage('Für diesen Bereich wurde kein aktiver Ban gefunden. Ein Unban-Antrag ist deshalb nicht möglich.', 'warn');
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.type = selectedSystem.type;
    if (selectedSystem.guildId) payload.guildId = selectedSystem.guildId;
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
    selectedSystem = null;
    showMessage('Dein Antrag wurde gesendet. Das Team prüft ihn jetzt im Discord-Log.', 'success');
    await refreshData();
  });

  await refreshData();
  setTimeout(refreshData, 8000);
  setInterval(refreshData, 30000);
}


async function initTicketPage() {
  const root = $('[data-ticket-page]');
  if (!root) return;

  const messageBox = $('[data-ticket-message]');
  const createForm = $('[data-ticket-create-form]');
  const ticketList = $('[data-ticket-list]');
  const empty = $('[data-ticket-empty]');
  const chat = $('[data-ticket-chat]');
  const chatTitle = $('[data-ticket-chat-title]');
  const chatType = $('[data-ticket-chat-type]');
  const chatStatus = $('[data-ticket-chat-status]');
  const ticketState = $('[data-ticket-state]');
  const messagesBox = $('[data-ticket-messages]');
  const messageForm = $('[data-ticket-message-form]');
  let selectedCategory = null;
  let activeTicketId = null;
  let loggedIn = false;
  let pendingTicketScroll = false;
  let ticketAccess = { ready: false, hasPremium: true };

  function ticketTypeLabel(type) {
    return type === 'head' ? 'Leitung' : 'Allgemeiner Support';
  }

  function ticketStatusLabel(status) {
    const value = String(status || '').toLowerCase();
    if (value === 'pending_channel') return 'Wird erstellt';
    if (value === 'open') return 'Offen';
    if (value === 'closed') return 'Geschlossen';
    return value ? value.replace(/_/g, ' ') : 'Unbekannt';
  }

  function formatTicketDate(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return 'Gerade eben';
    return date.toLocaleString('de-DE');
  }

  function renderTicketAttachment(attachment) {
    const url = attachment?.url || '#';
    const name = attachment?.originalName || attachment?.fileName || 'Datei';
    const mime = String(attachment?.mimeType || '');
    const isImage = mime.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(String(url));
    return `
      <a class="ticket-attachment" href="${escapeHtml(url)}" target="_blank" rel="noopener">
        ${isImage ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy">` : ''}
        <span>📎 ${escapeHtml(name)}</span>
      </a>
    `;
  }

  function ticketStaffRankLabel(rank) {
    const value = String(rank || '').trim().toLowerCase();
    if (value === 'ceo') return 'CEO';
    if (value === 'administrator' || value === 'admin') return 'Administrator';
    if (value === 'moderator' || value === 'mod') return 'Moderator';
    return '';
  }

  function ticketStaffRankClass(rank) {
    return ticketStaffRankLabel(rank).toLowerCase();
  }

  function renderTicketMessage(message) {
    const type = String(message?.authorType || 'system').toLowerCase();
    const author = message?.author || {};
    const authorName = type === 'staff'
      ? (author.name || author.username || 'Blue Team')
      : type === 'user'
        ? (author.global_name || author.username || 'Du')
        : 'Blue System';
    const staffRank = type === 'staff' ? ticketStaffRankLabel(author.rank) : '';
    const staffRankClass = ticketStaffRankClass(author.rank);
    const text = String(message?.text || '').trim();
    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    return `
      <article class="ticket-message ${escapeHtml(type)}">
        <div class="ticket-message-head">
          <strong class="ticket-message-author">${escapeHtml(authorName)}</strong>
          ${staffRank ? `<span class="ticket-rank-badge ${escapeHtml(staffRankClass)}">(${escapeHtml(staffRank)})</span>` : ''}
          <time>${escapeHtml(formatTicketDate(message?.createdAt))}</time>
        </div>
        ${text ? `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>` : ''}
        ${attachments.length ? `<div class="ticket-attachments">${attachments.map(renderTicketAttachment).join('')}</div>` : ''}
      </article>
    `;
  }

  function normalizeTicket(ticket) {
    if (!ticket || typeof ticket !== 'object') return null;
    return {
      id: ticket.id || `local_${Date.now()}`,
      type: ticket.type || 'general',
      status: ticket.status || 'pending_channel',
      channelName: ticket.channelName || ticket.channelId || ticket.id || 'wird-erstellt',
      createdAt: ticket.createdAt || new Date().toISOString(),
      deleteAt: ticket.deleteAt || null,
      messages: Array.isArray(ticket.messages) ? ticket.messages : []
    };
  }

  function showTicketMessage(text, type = 'info', sticky = false) {
    if (!messageBox) return;
    messageBox.hidden = false;
    messageBox.className = `notice-card ${type}`;
    messageBox.textContent = text;
    messageBox.dataset.stickyTicketNotice = sticky ? '1' : '0';
  }

  function clearTicketMessage() {
    if (!messageBox || messageBox.dataset.stickyTicketNotice === '1') return;
    messageBox.hidden = true;
  }

  function clearStickyTicketMessage() {
    if (!messageBox) return;
    messageBox.dataset.stickyTicketNotice = '0';
    messageBox.hidden = true;
  }

  function setTicketButtonState(button, text, disabled) {
    button.disabled = Boolean(disabled);
    button.textContent = text;
    button.setAttribute('aria-disabled', String(Boolean(disabled)));
    button.classList.toggle('disabled', Boolean(disabled));
  }

  function renderPremiumLockBadge(card, text) {
    let badge = card.querySelector('.ticket-premium-lock');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'ticket-premium-lock';
      card.appendChild(badge);
    }
    badge.textContent = text;
  }

  function setLockedState() {
    if (createForm) createForm.hidden = true;
    selectedCategory = null;
    $$('[data-open-ticket-form]').forEach((button) => setTicketButtonState(button, 'Erst einloggen', true));
    $$('.ticket-choice').forEach((card) => {
      card.classList.add('locked', 'premium-required');
      renderPremiumLockBadge(card, 'Discord Login erforderlich');
    });
    if (ticketList) ticketList.innerHTML = '<p class="muted">Bitte oben rechts mit Discord einloggen.</p>';
    showTicketMessage('Bitte melde dich oben rechts mit Discord an, um Tickets zu öffnen oder zu lesen.', 'warn');
  }

  function setUnlockedState() {
    const allowed = Boolean(ticketAccess.ready);
    $$('[data-open-ticket-form]').forEach((button) => {
      const type = button.dataset.openTicketForm;
      if (!ticketAccess.ready) setTicketButtonState(button, 'Wird geladen', true);
      else setTicketButtonState(button, type === 'head' ? 'Leitung kontaktieren' : 'Allgemeinen Support öffnen', false);
    });
    $$('.ticket-choice').forEach((card) => {
      card.classList.toggle('locked', !allowed);
      card.classList.remove('premium-required', 'checking-premium');
      const existing = card.querySelector('.ticket-premium-lock');
      if (!allowed) renderPremiumLockBadge(card, ticketAccess.message || 'Ticket-System wird geladen');
      else if (existing) existing.remove();
    });
    if (createForm && !allowed) {
      createForm.hidden = true;
      selectedCategory = null;
    }
    if (!ticketAccess.ready) showTicketMessage(ticketAccess.message || 'Ticket-System wird geladen. Bitte warte kurz.', 'warn');
    else clearTicketMessage();
  }

  function openTicket(ticket, options = {}) {
    ticket = normalizeTicket(ticket);
    if (!ticket) return;
    activeTicketId = ticket.id;
    root.classList.add('ticket-active');
    $('.ticket-layout')?.classList.add('ticket-active');
    if (empty) empty.hidden = true;
    if (chat) chat.hidden = false;
    if (chatTitle) chatTitle.textContent = `#${ticket.channelName || ticket.id}`;
    if (chatType) chatType.textContent = ticketTypeLabel(ticket.type);
    if (chatStatus) {
      const base = `${ticketStatusLabel(ticket.status)} · erstellt am ${formatTicketDate(ticket.createdAt)}`;
      chatStatus.textContent = ticket.status === 'closed' && ticket.deleteAt
        ? `${base} · wird gelöscht am ${formatTicketDate(ticket.deleteAt)}`
        : base;
    }
    if (ticketState) {
      ticketState.textContent = ticketStatusLabel(ticket.status);
      ticketState.classList.toggle('closed', ticket.status === 'closed');
    }
    if (messageForm) messageForm.hidden = ticket.status === 'closed';
    if (messagesBox) {
      messagesBox.innerHTML = (ticket.messages || []).map(renderTicketMessage).join('') || '<p class="muted">Noch keine Nachrichten.</p>';
      messagesBox.scrollTop = messagesBox.scrollHeight;
    }
    $$('.ticket-list-item').forEach((node) => node.classList.toggle('active', node.dataset.ticketId === ticket.id));

    const shouldScrollToChat = Boolean(options.scroll || pendingTicketScroll);
    pendingTicketScroll = false;
    if (shouldScrollToChat && chat && window.matchMedia('(max-width: 760px)').matches) {
      window.setTimeout(() => {
        chat.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    }
  }

  function renderTicketList(tickets) {
    if (!ticketList) return;
    if (!tickets.length) {
      ticketList.innerHTML = '<p class="muted">Du hast aktuell kein Ticket.</p>';
      root.classList.remove('ticket-active');
      $('.ticket-layout')?.classList.remove('ticket-active');
      return;
    }
    ticketList.innerHTML = tickets.map((ticket) => `<button class="ticket-list-item" type="button" data-ticket-id="${escapeHtml(ticket.id)}"><strong>${escapeHtml(ticketTypeLabel(ticket.type))}</strong><small>${escapeHtml(ticketStatusLabel(ticket.status))} · ${escapeHtml(formatTicketDate(ticket.createdAt))}</small></button>`).join('');
    $$('[data-ticket-id]', ticketList).forEach((button) => {
      button.addEventListener('click', () => {
        const ticket = tickets.find((item) => item.id === button.dataset.ticketId);
        if (ticket) openTicket(ticket, { scroll: true });
      });
    });
  }

  async function loadTickets(keepActive = true) {
    const response = await fetch('/api/auth/me', { cache: 'no-store' });
    const auth = await response.json();
    loggedIn = Boolean(auth.loggedIn);
    if (!loggedIn) {
      setLockedState();
      return;
    }
    const ticketResponse = await fetch('/api/tickets/me', { cache: 'no-store' });
    const data = await ticketResponse.json();
    ticketAccess = data.ticketAccess || { ready: false, hasPremium: false };
    setUnlockedState();
    const tickets = (Array.isArray(data.tickets) ? data.tickets : []).map(normalizeTicket).filter(Boolean);
    renderTicketList(tickets);
    let ticket = keepActive && activeTicketId ? tickets.find((item) => item.id === activeTicketId) : null;
    if (!ticket && tickets.length) ticket = tickets[0];
    if (ticket) openTicket(ticket);
  }

  $$('[data-open-ticket-form]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!loggedIn) return showTicketMessage('Bitte melde dich oben rechts mit Discord an.', 'warn');
      if (!ticketAccess.ready) return showTicketMessage(ticketAccess.message || 'Ticket-System wird geladen. Bitte warte kurz.', 'warn');
      clearStickyTicketMessage();
      selectedCategory = button.dataset.openTicketForm;
      if (createForm) createForm.hidden = false;
      $('[data-ticket-form-type]').textContent = selectedCategory === 'head' ? 'Leitung kontaktieren' : 'Allgemeiner Support';
      $('[data-ticket-reason-label]').childNodes[0].textContent = selectedCategory === 'head' ? 'Warum möchtest du die Leitung kontaktieren?' : 'Warum möchtest du ein Ticket öffnen?';
      createForm?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  $('[data-ticket-form-cancel]')?.addEventListener('click', () => {
    clearStickyTicketMessage();
    if (createForm) createForm.hidden = true;
    selectedCategory = null;
  });

  createForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedCategory) return showTicketMessage('Bitte wähle zuerst eine Kategorie.', 'warn');
    if (!ticketAccess.ready) return showTicketMessage(ticketAccess.message || 'Ticket-System wird geladen. Bitte warte kurz.', 'warn');
    const payload = Object.fromEntries(new FormData(createForm).entries());
    payload.type = selectedCategory;
    const response = await fetch('/api/tickets/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) return showTicketMessage(result.error || 'Ticket konnte nicht erstellt werden.', response.status === 409 ? 'warn' : 'error');
    createForm.reset();
    createForm.hidden = true;
    const createdTicket = normalizeTicket(result.ticket);
    activeTicketId = createdTicket?.id || null;
    pendingTicketScroll = true;
    showTicketMessage('Dein Ticket wurde erstellt. Der Bot legt gerade den Discord-Kanal an.', 'success', true);
    if (createdTicket) {
      renderTicketList([createdTicket]);
      openTicket(createdTicket, { scroll: true });
    }
    await loadTickets(true);
  });

  messageForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeTicketId) return;
    const formData = new FormData(messageForm);
    const response = await fetch(`/api/tickets/${encodeURIComponent(activeTicketId)}/messages`, {
      method: 'POST',
      body: formData
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) return showTicketMessage(result.error || 'Nachricht konnte nicht gesendet werden.', 'error');
    clearStickyTicketMessage();
    messageForm.reset();
    await loadTickets(true);
  });

  await loadTickets(false);
  setInterval(() => loadTickets(true).catch(() => null), 5000);
}


function discordGuildIconUrl(guild) {
  if (!guild) return '';
  if (guild.icon && String(guild.icon).startsWith('http')) return guild.icon;
  if (guild.icon && guild.id) return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=96`;
  return '';
}


async function initTesterPage() {
  const root = $('[data-tester-page]');
  if (!root) return;

  const messageBox = $('[data-tester-message]');
  const locked = $('[data-tester-locked]');
  const shell = $('[data-tester-shell]');
  const form = $('[data-tester-report-form]');
  const history = $('[data-tester-history]');
  const imageInput = $('[data-tester-images]');
  const imageHint = $('[data-tester-image-hint]');

  let loaded = null;
  let selectedTesterImages = [];

  function syncTesterImageInput() {
    if (!imageInput) return;
    try {
      const transfer = new DataTransfer();
      selectedTesterImages.slice(0, 3).forEach((file) => transfer.items.add(file));
      imageInput.files = transfer.files;
    } catch (error) {
      // Manche sehr alten Browser erlauben kein programmgesteuertes Setzen von FileList.
    }
    if (imageHint) {
      const names = selectedTesterImages.map((file) => file.name).join(', ');
      imageHint.textContent = `${selectedTesterImages.length} / 3 Bilder ausgewählt${names ? ` · ${names}` : ''}`;
    }
  }

  function testerImageKey(file) {
    return `${file.name}:${file.size}:${file.lastModified}`;
  }

  function testerNotice(text, type = 'info') {
    if (!messageBox) return;
    messageBox.hidden = false;
    messageBox.className = `notice-card ${type}`;
    messageBox.textContent = text;
  }

  function formatTesterDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return 'Unbekannt';
    return date.toLocaleString('de-DE');
  }

  function testerStatusClass(status) {
    const value = String(status || '').toLowerCase();
    if (value === 'fixed') return 'online';
    if (value === 'rejected') return 'offline';
    if (value === 'in_review') return 'degraded';
    return 'maintenance';
  }

  function testerStatusLabel(report) {
    return report?.statusLabel || ({ pending: 'Offen', in_review: 'In Bearbeitung', fixed: 'Bug wurde gefixt', rejected: 'Bug Report Abgelehnt' }[report?.status] || 'Unbekannt');
  }

  function renderTesterHistory(reports) {
    if (!history) return;
    if (!Array.isArray(reports) || !reports.length) {
      history.innerHTML = '<p class="muted">Noch keine Bug-Reports gemeldet.</p>';
      return;
    }
    history.innerHTML = reports.map((report) => `
      <article class="tester-history-item">
        <div class="tester-history-head">
          <div>
            <strong>${escapeHtml(report.title || 'Ohne Titel')}</strong>
            <small>${escapeHtml(report.category || 'Kategorie')} · ${escapeHtml(report.page || 'Seite')} · ${escapeHtml(formatTesterDate(report.createdAt))}</small>
          </div>
          <span class="chip ${escapeHtml(testerStatusClass(report.status))}">${escapeHtml(testerStatusLabel(report))}</span>
        </div>
        <p>${escapeHtml(report.description || '').replace(/\n/g, '<br>')}</p>
        ${report.decisionReason ? `<div class="tester-decision"><strong>Grund:</strong> ${escapeHtml(report.decisionReason).replace(/\n/g, '<br>')}</div>` : ''}
        ${Array.isArray(report.images) && report.images.length ? `<div class="tester-report-images">${report.images.map((image) => `<a href="${escapeHtml(image.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.originalName || 'Bug Bild')}" loading="lazy"></a>`).join('')}</div>` : ''}
      </article>
    `).join('');
  }

  async function loadTesterDash() {
    const authResponse = await fetch('/api/auth/me', { cache: 'no-store' });
    const auth = await authResponse.json().catch(() => ({}));
    if (!auth.loggedIn) {
      if (locked) locked.hidden = false;
      if (shell) shell.hidden = true;
      testerNotice('Tester-Zugriff konnte nicht bestätigt werden. Öffne den Tester Dash über die Website-Navigation, nachdem deine Rolle erkannt wurde.', 'warn');
      return;
    }

    const response = await fetch('/api/tester/me', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    loaded = data;
    const access = data.testerAccess || {};

    if (!access.isTester) {
      if (locked) locked.hidden = false;
      if (shell) shell.hidden = true;
      testerNotice(access.message || 'Du hast aktuell keinen Tester-Zugriff.', access.checking ? 'warn' : 'error');
      return;
    }

    ensureTesterNavLink();
    if (locked) locked.hidden = true;
    if (shell) shell.hidden = false;
    if (messageBox) messageBox.hidden = true;
    renderTesterHistory(data.reports || []);
  }

  imageInput?.addEventListener('change', () => {
    const incoming = Array.from(imageInput.files || []).filter((file) => String(file.type || '').startsWith('image/'));
    const known = new Set(selectedTesterImages.map(testerImageKey));
    for (const file of incoming) {
      if (selectedTesterImages.length >= 3) break;
      const key = testerImageKey(file);
      if (!known.has(key)) {
        selectedTesterImages.push(file);
        known.add(key);
      }
    }
    if (incoming.length && selectedTesterImages.length >= 3 && incoming.length + known.size > 3) {
      testerNotice('Du kannst maximal 3 Bilder anhängen. Weitere Bilder wurden nicht übernommen.', 'warn');
    }
    syncTesterImageInput();
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Report wird gesendet...';
    }
    try {
      const formData = new FormData(form);
      const response = await fetch('/api/tester/reports', { method: 'POST', body: formData });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        testerNotice(result.error || 'Bug-Report konnte nicht gesendet werden.', 'error');
        return;
      }
      testerNotice('✅ Bug-Report wurde an den Bot gesendet. Der Bot speichert ihn auf dem Bot-Hosting und erstellt gleich den privaten Bug-Kanal.', 'success');
      form.reset();
      selectedTesterImages = [];
      syncTesterImageInput();
      await loadTesterDash();
    } catch (error) {
      testerNotice('Bug-Report konnte nicht gesendet werden. Bitte versuche es erneut.', 'error');
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = 'Bug-Report senden';
      }
    }
  });

  await loadTesterDash();
}

function dashboardSelectOptions(items, selected = []) {
  const selectedSet = new Set((selected || []).map(String));
  return (items || []).map((item) => `<option value="${escapeHtml(item.id)}" ${selectedSet.has(String(item.id)) ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
}

async function initDashboardPage() {
  const root = $('[data-dashboard-page]');
  if (!root) return;
  const messageBox = $('[data-dashboard-message]');
  const serverList = $('[data-dashboard-server-list]');
  const empty = $('[data-dashboard-empty]');
  const workspace = $('[data-dashboard-workspace]');
  const dashboardMain = $('.dashboard-main', root);
  const dashboardSidebar = $('.dashboard-sidebar', root);
  const form = $('[data-dashboard-verify-form]');
  const globalchatForm = $('[data-dashboard-globalchat-form]');
  const messagesForm = $('[data-dashboard-messages-form]');
  const ticketForm = $('[data-dashboard-ticket-form]');
  const moderationForm = $('[data-dashboard-moderation-form]');
  const securityForm = $('[data-dashboard-security-form]');
  const funForm = $('[data-dashboard-fun-form]');
  const communityForm = $('[data-dashboard-community-form]');
  const soon = $('[data-dashboard-soon]');
  let selectedGuildId = null;
  let selectedGuildData = null;
  let access = null;
  let dashboardRoles = [];
  let selectedAddRoleIds = new Set();
  let selectedRemoveRoleIds = new Set();
  let selectedReviewRoleIds = new Set();
  let dashboardDirty = false;
  let dashboardChannels = [];
  let dashboardCategoryChannels = [];
  let dashboardServerAutoRefreshes = 0;
  let dashboardServerAutoRefreshTimer = null;
  let globalchatDirty = false;
  let ticketDirty = false;
  let moderationDirty = false;
  let securityDirty = false;
  let securityIgnoredRoleIds = new Set();
  let securityIgnoredChannelIds = new Set();
  let securityLanguageIgnoredRoleIds = new Set();
  let securityLanguageIgnoredChannelIds = new Set();
  let securityUnbanRoleIds = new Set();
  const dashboardSecurityLanguageLabels = { de: 'Deutsch', en: 'Englisch', tr: 'Türkisch', pl: 'Polnisch', fr: 'Französisch', es: 'Spanisch', it: 'Italienisch', nl: 'Niederländisch' };
  let funDirty = false;
  let communityDirty = false;
  let communityRoleIds = new Set();
  let moderationRolePermissions = [];
  const moderationCommands = [
    { id: 'ban', label: 'Ban' },
    { id: 'unban', label: 'Unban' },
    { id: 'kick', label: 'Kick' },
    { id: 'mute', label: 'Mute' },
    { id: 'unmute', label: 'Unmute' },
    { id: 'warn', label: 'Warn' },
    { id: 'unwarn', label: 'Unwarn' },
    { id: 'warnings', label: 'Warnings' },
  ];
  let ticketCategories = [];
  let ticketPanels = [];
  let selectedTicketPanelId = null;
  let ticketPanelEmbedIsDefault = true;
  let dashboardMessages = [];
  let selectedDashboardMessageId = null;
  let messagesDirty = false;

  const moduleFeedbackTimers = new Map();

  function dashboardNoticeIcon(type = 'info') {
    if (type === 'success') return '✅';
    if (type === 'error') return '❌';
    if (type === 'warn') return '⚠️';
    return 'ℹ️';
  }

  function dashboardNoticeSubtext(type = 'info') {
    if (type === 'success') return 'Erledigt · Änderung wurde gespeichert oder an Blue übergeben.';
    if (type === 'error') return 'Fehler · Bitte prüfe die Eingaben oder versuche es erneut.';
    if (type === 'warn') return 'Hinweis · Es fehlt noch etwas.';
    return 'Info · Dashboard wurde aktualisiert.';
  }

  function ensureDashboardToastStack() {
    let stack = document.querySelector('[data-dashboard-toast-stack]');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'dashboard-toast-stack';
      stack.setAttribute('data-dashboard-toast-stack', '');
      stack.setAttribute('aria-live', 'polite');
      stack.setAttribute('aria-atomic', 'false');
      document.body.appendChild(stack);
    }
    return stack;
  }

  function showDashboardToast(text, type = 'info') {
    const stack = ensureDashboardToastStack();
    const toast = document.createElement('div');
    toast.className = `dashboard-toast ${type}`;
    toast.innerHTML = `
      <span class="dashboard-toast-icon">${dashboardNoticeIcon(type)}</span>
      <div class="dashboard-toast-copy">
        <strong>${escapeHtml(text)}</strong>
        <small>${escapeHtml(dashboardNoticeSubtext(type))}</small>
      </div>
      <button class="dashboard-toast-close" type="button" aria-label="Meldung schließen">×</button>
      <span class="dashboard-toast-progress" aria-hidden="true"></span>
    `;

    const close = () => {
      toast.classList.add('is-leaving');
      window.setTimeout(() => toast.remove(), 220);
    };

    toast.querySelector('.dashboard-toast-close')?.addEventListener('click', close);
    stack.appendChild(toast);
    window.requestAnimationFrame(() => toast.classList.add('is-visible'));
    window.setTimeout(close, 5000);
  }

  function showDashboardMessage(text, type = 'info') {
    if (!messageBox) return;
    messageBox.hidden = false;
    messageBox.className = `notice-card ${type}`;
    messageBox.textContent = text;
  }

  function clearDashboardMessage() {
    if (messageBox) messageBox.hidden = true;
  }

  function showModuleFeedback(section, text, type = 'success') {
    const box = $(`[data-module-feedback="${section}"]`);
    if (!box) return;
    box.hidden = false;
    box.className = `module-feedback ${type}`;
    box.innerHTML = `<span class="module-feedback-icon">${dashboardNoticeIcon(type)}</span><div><strong>${escapeHtml(text)}</strong><small>${escapeHtml(dashboardNoticeSubtext(type))}</small></div>`;

    const oldTimer = moduleFeedbackTimers.get(section);
    if (oldTimer) window.clearTimeout(oldTimer);
    moduleFeedbackTimers.set(section, window.setTimeout(() => {
      box.hidden = true;
      moduleFeedbackTimers.delete(section);
    }, 5000));
  }

  function dashboardNotify(section, text, type = 'success') {
    showDashboardToast(text, type);
    showDashboardMessage(text, type);
    if (section) showModuleFeedback(section, text, type);
  }

  function dashboardTrySendCooldown(key, section) {
    const cooldownSeconds = 10;
    const now = Date.now();
    const last = Number(dashboardTrySendCooldown.map?.get(key) || 0);
    const remaining = Math.ceil(((last + cooldownSeconds * 1000) - now) / 1000);
    if (remaining > 0) {
      dashboardNotify(section, `Spamschutz: Du kannst in ${remaining} Sekunden wieder senden.`, 'warn');
      return false;
    }
    if (!dashboardTrySendCooldown.map) dashboardTrySendCooldown.map = new Map();
    dashboardTrySendCooldown.map.set(key, now);
    return true;
  }

  function setWorkspaceVisible(visible) {
    if (empty) empty.hidden = visible;
    if (workspace) workspace.hidden = !visible;
    if (!visible) clearDashboardModuleSelection();
  }

  function setDashboardRouteMode(requestedGuildId = getDashboardPathGuildId()) {
    const isServerPage = Boolean(requestedGuildId);
    root.classList.toggle('dashboard-picker-mode', !isServerPage);
    root.classList.toggle('dashboard-server-mode', isServerPage);

    // /dashboard zeigt nur die Serverauswahl.
    // /dashboard/<serverid> zeigt direkt die Module des Servers ohne erneute Serverauswahl.
    if (dashboardSidebar) dashboardSidebar.hidden = isServerPage;
    if (dashboardMain) dashboardMain.hidden = !isServerPage;

    if (!isServerPage) {
      selectedGuildId = null;
      selectedGuildData = null;
      setWorkspaceVisible(false);
    } else {
      setWorkspaceVisible(true);
    }
    return isServerPage;
  }

  function getDashboardPathGuildId() {
    const path = window.location.pathname || '';
    const slashMatch = path.match(/^\/dashboard\/(\d+)\/?$/);
    if (slashMatch) return slashMatch[1];
    const dotMatch = path.match(/^\/dashboard\.(\d+)$/);
    if (dotMatch) return dotMatch[1];
    const queryId = new URLSearchParams(window.location.search || '').get('server');
    return /^\d+$/.test(queryId || '') ? queryId : null;
  }

  function dashboardGuildUrl(guildId) {
    return `/dashboard/${encodeURIComponent(guildId)}#dashboard-app`;
  }

  function scrollDashboardAppIntoView() {
    const target = document.getElementById('dashboard-app') || root;
    window.setTimeout(() => target?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  function clearDashboardModuleSelection() {
    $$('[data-dashboard-section]').forEach((node) => node.classList.remove('active'));
    [form, globalchatForm, ticketForm, moderationForm, securityForm, funForm, communityForm, messagesForm].forEach((node) => {
      if (node) node.hidden = true;
    });
    if (soon) soon.hidden = true;
  }

  function renderServers(guilds) {
    if (!serverList) return;
    if (!guilds.length) {
      serverList.innerHTML = '<p class="muted">Keine gemeinsamen Server gefunden. Prüfe, ob du mit Discord eingeloggt bist und Blue auf dem Server ist. Falls der Server neu ist, warte kurz, bis der Bot ihn bestätigt.</p>';
      return;
    }
    serverList.innerHTML = guilds.map((guild) => {
      const icon = discordGuildIconUrl(guild);
      const initial = (guild.name || '?').slice(0, 1).toUpperCase();
      const available = guild.available !== false;
      const reason = guild.unavailableReason || 'Nicht verfügbar - Administrator benötigt';
      return `<button class="dashboard-server-card ${available ? '' : 'disabled'}" type="button" data-dashboard-guild="${escapeHtml(guild.id)}" ${available ? `data-dashboard-guild-url="${escapeHtml(dashboardGuildUrl(guild.id))}"` : 'disabled aria-disabled="true"'}><span class="server-icon">${icon ? `<img src="${escapeHtml(icon)}" alt="">` : escapeHtml(initial)}</span><span class="server-card-copy"><strong>${escapeHtml(guild.name)}</strong><small>${available ? `${formatValue(guild.memberCount)} Mitglieder · Module öffnen` : escapeHtml(reason)}</small></span><span class="server-card-badge ${available ? 'ok' : 'locked'}">${available ? 'Öffnen' : 'Locked'}</span></button>`;
    }).join('');
  }

  function roleColorStyle(role) {
    const color = String(role?.color || '').trim();
    if (!color || color === '#000000' || color === '0' || color.toLowerCase() === 'default') return '';
    return ` style="--role-color:${escapeHtml(color)}"`;
  }


  function dashboardIsTextChannel(channel) {
    const type = String(channel?.type || '').toLowerCase();
    return ['text', 'news', 'announcement', 'guild_text', 'guild_news', '0', '5'].includes(type);
  }

  function dashboardTextChannelsFromGuild(guild = selectedGuildData) {
    return ((guild && Array.isArray(guild.channels)) ? guild.channels : [])
      .filter(dashboardIsTextChannel)
      .sort((a, b) => (a.position || 0) - (b.position || 0));
  }

  function dashboardChannelName(channelId, fallback = 'Nicht eingerichtet') {
    const id = String(channelId || '');
    if (!id) return fallback;
    const found = dashboardChannels.find((channel) => String(channel.id) === id)
      || dashboardTextChannelsFromGuild().find((channel) => String(channel.id) === id);
    return found ? `#${found.name}` : `#${id}`;
  }

  function setDashboardSelectOptions(selector, channels, selected, placeholder = 'Kanal auswählen') {
    const select = typeof selector === 'string' ? $(selector) : selector;
    if (!select) return;
    const usableChannels = (channels && channels.length ? channels : dashboardTextChannelsFromGuild());
    const selectedValues = [selected].flat().filter(Boolean).map(String);
    select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + dashboardSelectOptions(usableChannels, selectedValues);
    if (selectedValues.length) select.value = selectedValues[0];
  }

  function renderSelectedRoleTags(target, selectedSet) {
    const container = $(target);
    if (!container) return;
    const selectedRoles = dashboardRoles.filter((role) => selectedSet.has(String(role.id)));
    if (!selectedRoles.length) {
      container.innerHTML = '<span class="muted">Keine Rolle gewählt</span>';
      return;
    }
    container.innerHTML = selectedRoles.map((role) => (
      `<button class="selected-role-tag" type="button" data-remove-role="${escapeHtml(role.id)}"${roleColorStyle(role)}><span>@${escapeHtml(role.name)}</span><b aria-hidden="true">×</b></button>`
    )).join('');
    $$('[data-remove-role]', container).forEach((button) => {
      button.addEventListener('click', () => {
        selectedSet.delete(String(button.dataset.removeRole));
        dashboardDirty = true;
        renderRolePickers();
      });
    });
  }

  function renderRolePicker(target, selectedSet, oppositeSet, mode) {
    const container = $(target);
    if (!container) return;
    if (!dashboardRoles.length) {
      container.innerHTML = '<p class="muted">Keine Rollen gefunden. Prüfe die Bot-Berechtigungen.</p>';
      return;
    }
    container.innerHTML = dashboardRoles.map((role) => {
      const id = String(role.id);
      const active = selectedSet.has(id);
      return `<button class="role-chip ${active ? 'active' : ''}" type="button" data-role-chip="${escapeHtml(id)}" data-role-mode="${escapeHtml(mode)}"${roleColorStyle(role)}><span class="role-dot"></span>@${escapeHtml(role.name)}</button>`;
    }).join('');
    $$('[data-role-chip]', container).forEach((button) => {
      button.addEventListener('click', () => {
        const id = String(button.dataset.roleChip || '');
        if (!id) return;
        if (selectedSet.has(id)) {
          selectedSet.delete(id);
        } else {
          selectedSet.add(id);
          if (oppositeSet) oppositeSet.delete(id);
        }
        dashboardDirty = true;
        renderRolePickers();
      });
    });
  }

  function renderRolePickers() {
    renderRolePicker('[data-dashboard-add-role-picker]', selectedAddRoleIds, selectedRemoveRoleIds, 'add');
    renderRolePicker('[data-dashboard-remove-role-picker]', selectedRemoveRoleIds, selectedAddRoleIds, 'remove');
    renderRolePicker('[data-dashboard-review-role-picker]', selectedReviewRoleIds, null, 'review');
    renderSelectedRoleTags('[data-dashboard-add-selected]', selectedAddRoleIds);
    renderSelectedRoleTags('[data-dashboard-remove-selected]', selectedRemoveRoleIds);
    renderSelectedRoleTags('[data-dashboard-review-selected]', selectedReviewRoleIds);
  }

  function updateGlobalchatPreview() {
    if (!globalchatForm) return;
    const select = $('[data-dashboard-globalchat-channel-select]');
    const selected = dashboardChannels.find((channel) => String(channel.id) === String(select?.value || ''));
    const preview = $('[data-dashboard-globalchat-preview]');
    if (preview) preview.textContent = selected ? `#${selected.name}` : 'Kanal auswählen';
  }

  function renderGlobalchatConfig(data, channels) {
    if (!globalchatForm) return;
    const config = data.globalchat || {};
    const channelSelect = $('[data-dashboard-globalchat-channel-select]');
    if (channelSelect) channelSelect.innerHTML = '<option value="">Kanal auswählen</option>' + dashboardSelectOptions(channels, [config.channelId || config.channel_id].filter(Boolean));
    const enabledInput = globalchatForm.querySelector('[name="globalchatEnabled"]');
    if (enabledInput) enabledInput.checked = config.enabled !== false && Boolean(config.channelId || config.channel_id);
    const status = $('[data-dashboard-globalchat-status]');
    if (status) {
      const active = Boolean(config.enabled !== false && (config.channelId || config.channel_id));
      status.textContent = active ? 'Eingerichtet' : 'Nicht eingerichtet';
      status.className = `chip ${active ? 'online' : ''}`;
    }
    globalchatDirty = false;
    updateGlobalchatPreview();
  }

  function ticketPanelDefaultEmbed() {
    const guildName = selectedGuildData?.name || 'deinem Server';
    return {
      author: '',
      authorImage: '',
      title: '🎫 Blue Support Center',
      description: `Willkommen im offiziellen Support-Bereich von **${guildName}**.\n\nWähle unten eine passende Kategorie aus und beschreibe dein Anliegen im Formular möglichst genau. Unser Team wird dein Ticket anschließend schnellstmöglich bearbeiten.`,
      footer: 'Powered by Blue ⚡'
    };
  }

  function getTicketPanelEmbedFromForm(forPreview = false) {
    const defaults = ticketPanelDefaultEmbed();
    if (!ticketForm) return defaults;
    const value = (name) => ticketForm.querySelector(`[name="${name}"]`)?.value || '';
    if (ticketPanelEmbedIsDefault && !forPreview) return null;
    return {
      author: value('ticketPanelAuthor').trim(),
      authorImage: value('ticketPanelAuthorImage').trim(),
      title: value('ticketPanelTitle').trim() || defaults.title,
      description: value('ticketPanelDescription').trim() || defaults.description,
      footer: value('ticketPanelFooter').trim() || 'Powered by Blue ⚡',
    };
  }

  function setTicketPanelEmbedForm(panelEmbed = null, forceDefault = false) {
    if (!ticketForm) return;
    const defaults = ticketPanelDefaultEmbed();
    const isDefault = forceDefault || !panelEmbed || panelEmbed.default === true;
    ticketPanelEmbedIsDefault = isDefault;
    const embed = isDefault ? defaults : { ...defaults, ...(panelEmbed || {}) };
    const set = (name, value) => {
      const input = ticketForm.querySelector(`[name="${name}"]`);
      if (input) input.value = value || '';
    };
    set('ticketPanelAuthor', embed.author || '');
    set('ticketPanelAuthorImage', embed.authorImage || embed.author_image || '');
    set('ticketPanelTitle', embed.title || defaults.title);
    set('ticketPanelDescription', embed.description || defaults.description);
    set('ticketPanelFooter', embed.footer || 'Powered by Blue ⚡');
    const footerInput = $('[data-dashboard-ticket-footer-input]');
    const footerNote = $('[data-dashboard-ticket-footer-note]');
    if (footerInput) {
      footerInput.disabled = !(access && access.hasPremiumFooter);
      if (!(access && access.hasPremiumFooter)) footerInput.value = 'Powered by Blue ⚡';
    }
    if (footerNote) footerNote.textContent = access && access.hasPremiumFooter ? 'Blue Premium erkannt: Du darfst den Ticket-Panel-Footer bearbeiten.' : 'Ohne Blue Premium auf dem Mainserver bleibt der Footer fest auf Powered by Blue ⚡.';
  }

  function emptyTicketCategory(index = 0) {
    return { id: `cat_${index + 1}`, name: '', description: '', roleIds: [] };
  }

  function normalizeTicketCategories(categories) {
    const list = Array.isArray(categories) ? categories : [];
    const cleaned = list.slice(0, 5).map((category, index) => ({
      id: category.id || `cat_${index + 1}`,
      name: category.name || '',
      description: category.description || '',
      roleIds: Array.isArray(category.roleIds || category.role_ids) ? (category.roleIds || category.role_ids).map(String) : [],
    }));
    return cleaned.length ? cleaned : [emptyTicketCategory(0)];
  }

  function createTicketPanelId() {
    return `panel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeTicketPanels(config = {}) {
    const raw = Array.isArray(config.panels) ? config.panels : [];
    const panels = raw.map((panel, index) => {
      const embed = panel.panelEmbed || panel.panel_embed || null;
      const title = String(embed?.title || '').trim();
      return {
        id: String(panel.id || `panel_${index + 1}`),
        name: String(panel.name || title || `Ticket Support ${index + 1}`).slice(0, 80),
        panelChannelId: String(panel.panelChannelId || panel.panel_channel_id || ''),
        panelMessageId: panel.panelMessageId || panel.panel_message_id || null,
        panelEmbed: embed,
        createdAt: panel.createdAt || panel.created_at || null,
        updatedAt: panel.updatedAt || panel.updated_at || null,
      };
    });
    if (!panels.length && (config.panelChannelId || config.panel_channel_id || config.panelEmbed || config.panel_embed)) {
      const embed = config.panelEmbed || config.panel_embed || null;
      panels.push({
        id: 'panel_1',
        name: String(embed?.title || 'Ticket Support').slice(0, 80),
        panelChannelId: String(config.panelChannelId || config.panel_channel_id || ''),
        panelMessageId: config.panelMessageId || config.panel_message_id || null,
        panelEmbed: embed,
        createdAt: config.createdAt || null,
        updatedAt: config.updatedAt || config.updated_at || null,
      });
    }
    return panels;
  }

  function currentTicketPanelName(panelEmbed = getTicketPanelEmbedFromForm(true)) {
    return String(panelEmbed?.title || '').trim().slice(0, 80) || 'Ticket Support';
  }

  function applyTicketPanelToForm(panel) {
    if (!ticketForm || !panel) return;
    selectedTicketPanelId = String(panel.id || createTicketPanelId());
    const panelSelect = $('[data-dashboard-ticket-panel-channel]');
    if (panelSelect && panel.panelChannelId) panelSelect.value = String(panel.panelChannelId);
    setTicketPanelEmbedForm(panel.panelEmbed || null, !panel.panelEmbed);
    renderTicketPanelHistory();
    updateTicketPreview();
  }

  function renderTicketPanelHistory() {
    const list = $('[data-dashboard-ticket-panel-history]');
    if (!list) return;
    if (!ticketPanels.length) {
      list.innerHTML = '<p class="muted compact">Noch kein Panel gespeichert. Beim Speichern wird ein neues Panel angelegt.</p>';
      return;
    }
    list.innerHTML = ticketPanels.map((panel) => `
      <button class="ticket-panel-history-item ${String(panel.id) === String(selectedTicketPanelId) ? 'active' : ''}" type="button" data-ticket-panel-id="${escapeHtml(panel.id)}">
        <strong>${escapeHtml(panel.name || 'Ticket Support')}</strong>
        <small>${panel.panelMessageId ? 'Gesendet' : 'Wartet auf Bot'}${panel.updatedAt ? ` · ${escapeHtml(formatTicketDate(panel.updatedAt))}` : ''}</small>
      </button>
    `).join('');
    $$('[data-ticket-panel-id]', list).forEach((button) => {
      button.addEventListener('click', () => {
        const panel = ticketPanels.find((item) => String(item.id) === String(button.dataset.ticketPanelId));
        if (panel) applyTicketPanelToForm(panel);
      });
    });
  }

  function updateTicketPreview() {
    if (!ticketForm) return;
    const panelSelect = $('[data-dashboard-ticket-panel-channel]');
    const categorySelect = $('[data-dashboard-ticket-category-select]');
    const logSelect = $('[data-dashboard-ticket-log-channel]');
    const channelName = (select, fallback) => {
      const selected = [...(select?.options || [])].find((option) => option.value === select?.value);
      return selected && selected.value ? `#${selected.textContent}` : fallback;
    };
    const panelPreview = $('[data-dashboard-ticket-panel-preview]');
    const categoryPreview = $('[data-dashboard-ticket-category-preview]');
    const logPreview = $('[data-dashboard-ticket-log-preview]');
    if (panelPreview) panelPreview.textContent = channelName(panelSelect, 'Kanal auswählen');
    if (categoryPreview) categoryPreview.textContent = channelName(categorySelect, 'Kategorie auswählen');
    if (logPreview) logPreview.textContent = channelName(logSelect, 'Kanal auswählen');

    const panelEmbed = getTicketPanelEmbedFromForm(true);
    const author = $('[data-ticket-panel-preview-author]');
    const title = $('[data-ticket-panel-preview-title]');
    const description = $('[data-ticket-panel-preview-description]');
    const footer = $('[data-ticket-panel-preview-footer]');
    const previewCard = $('[data-ticket-panel-preview-card]');
    if (previewCard) previewCard.style.borderLeftColor = '#5865f2';
    if (author) {
      const authorText = String(panelEmbed.author || '').trim();
      const authorImage = String(panelEmbed.authorImage || panelEmbed.author_image || '').trim();
      author.hidden = !authorText;
      author.innerHTML = authorText ? `${authorImage ? `<img src="${escapeHtml(authorImage)}" alt="">` : ''}<span>${escapeHtml(authorText)}</span>` : '';
    }
    if (title) title.textContent = panelEmbed.title || '🎫 Blue Support Center';
    if (description) description.textContent = panelEmbed.description || ticketPanelDefaultEmbed().description;
    if (footer) footer.textContent = panelEmbed.footer || 'Powered by Blue ⚡';

    const categoriesPreview = $('[data-dashboard-ticket-preview-categories]');
    if (categoriesPreview) {
      const rows = ticketCategories.filter((category) => category.name.trim()).map((category, index) => {
        const roleNames = dashboardRoles.filter((role) => (category.roleIds || []).map(String).includes(String(role.id))).map((role) => `@${role.name}`);
        const desc = String(category.description || '').trim();
        return `<div><strong>${String(index + 1).padStart(2, '0')} · ${escapeHtml(category.name)}</strong>${desc ? `<p>${escapeHtml(desc)}</p>` : ''}<small>${roleNames.length ? escapeHtml(roleNames.join(', ')) : 'Keine Team-Rolle gewählt'}</small></div>`;
      });
      categoriesPreview.innerHTML = rows.length ? rows.join('') : '<p class="muted compact">Noch keine Kategorie eingerichtet.</p>';
    }
  }


  function renderTicketSelectedTags(container, categoryIndex) {
    const category = ticketCategories[categoryIndex];
    const selectedSet = new Set((category?.roleIds || []).map(String));
    const selectedRoles = dashboardRoles.filter((role) => selectedSet.has(String(role.id)));
    if (!selectedRoles.length) {
      container.innerHTML = '<span class="muted">Keine Team-Rolle gewählt</span>';
      return;
    }
    container.innerHTML = selectedRoles.map((role) => `<button class="selected-role-tag" type="button" data-ticket-role-remove="${escapeHtml(role.id)}"${roleColorStyle(role)}><span>@${escapeHtml(role.name)}</span><b aria-hidden="true">×</b></button>`).join('');
    $$('[data-ticket-role-remove]', container).forEach((button) => {
      button.addEventListener('click', () => {
        ticketCategories[categoryIndex].roleIds = (ticketCategories[categoryIndex].roleIds || []).filter((id) => String(id) !== String(button.dataset.ticketRoleRemove));
        ticketDirty = true;
        renderTicketCategoryRows();
      });
    });
  }

  function renderTicketRolePicker(container, categoryIndex) {
    const selectedSet = new Set((ticketCategories[categoryIndex]?.roleIds || []).map(String));
    if (!dashboardRoles.length) {
      container.innerHTML = '<p class="muted">Keine Rollen gefunden.</p>';
      return;
    }
    container.innerHTML = dashboardRoles.map((role) => {
      const active = selectedSet.has(String(role.id));
      return `<button class="role-chip ${active ? 'active' : ''}" type="button" data-ticket-role-chip="${escapeHtml(role.id)}"${roleColorStyle(role)}><span class="role-dot"></span>@${escapeHtml(role.name)}</button>`;
    }).join('');
    $$('[data-ticket-role-chip]', container).forEach((button) => {
      button.addEventListener('click', () => {
        const id = String(button.dataset.ticketRoleChip || '');
        const roles = new Set((ticketCategories[categoryIndex].roleIds || []).map(String));
        if (roles.has(id)) roles.delete(id);
        else roles.add(id);
        ticketCategories[categoryIndex].roleIds = Array.from(roles);
        ticketDirty = true;
        renderTicketCategoryRows();
      });
    });
  }

  function renderTicketCategoryRows() {
    const list = $('[data-dashboard-ticket-category-list]');
    if (!list) return;
    ticketCategories = ticketCategories.slice(0, 5);
    list.innerHTML = ticketCategories.map((category, index) => `
      <div class="ticket-category-builder" data-ticket-category-index="${index}">
        <div class="ticket-category-head">
          <label>Kategorie Name<input data-ticket-category-name="${index}" maxlength="50" value="${escapeHtml(category.name || '')}" placeholder="z. B. Allgemeiner Support"></label>
          <button class="btn ghost danger-lite" type="button" data-ticket-category-remove="${index}" ${ticketCategories.length <= 1 ? 'disabled' : ''}>Entfernen</button>
        </div>
        <label class="ticket-category-description-label">Kategorie Beschreibung<textarea data-ticket-category-description="${index}" maxlength="100" rows="2" placeholder="Kurze Beschreibung, z. B. Fragen, Hilfe und allgemeine Anliegen.">${escapeHtml(category.description || '')}</textarea><small>Wird im Ticket-Menü und im Panel angezeigt.</small></label>
        <div class="role-picker-title"><strong>Team-Rollen</strong><small>Diese Rollen sehen und bearbeiten Tickets dieser Kategorie.</small></div>
        <div class="dashboard-role-picker" data-ticket-role-picker="${index}"></div>
        <div class="selected-role-tags" data-ticket-role-selected="${index}"></div>
      </div>
    `).join('');
    $$('[data-ticket-category-name]', list).forEach((input) => {
      input.addEventListener('input', () => {
        const index = Number.parseInt(input.dataset.ticketCategoryName, 10);
        if (ticketCategories[index]) ticketCategories[index].name = input.value;
        ticketDirty = true;
        updateTicketPreview();
      });
    });
    $$('[data-ticket-category-description]', list).forEach((input) => {
      input.addEventListener('input', () => {
        const index = Number.parseInt(input.dataset.ticketCategoryDescription, 10);
        if (ticketCategories[index]) ticketCategories[index].description = input.value;
        ticketDirty = true;
        updateTicketPreview();
      });
    });
    $$('[data-ticket-category-remove]', list).forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number.parseInt(button.dataset.ticketCategoryRemove, 10);
        ticketCategories.splice(index, 1);
        if (!ticketCategories.length) ticketCategories.push(emptyTicketCategory(0));
        ticketCategories = ticketCategories.map((category, idx) => ({ ...category, id: `cat_${idx + 1}` }));
        ticketDirty = true;
        renderTicketCategoryRows();
      });
    });
    $$('[data-ticket-role-picker]', list).forEach((container) => renderTicketRolePicker(container, Number.parseInt(container.dataset.ticketRolePicker, 10)));
    $$('[data-ticket-role-selected]', list).forEach((container) => renderTicketSelectedTags(container, Number.parseInt(container.dataset.ticketRoleSelected, 10)));
    updateTicketPreview();
  }

  function renderTicketConfig(data, textChannels, categoryChannels) {
    if (!ticketForm) return;
    const config = data.ticket || {};
    const panelSelect = $('[data-dashboard-ticket-panel-channel]');
    const ticketCategorySelect = $('[data-dashboard-ticket-category-select]');
    const logSelect = $('[data-dashboard-ticket-log-channel]');
    if (panelSelect) panelSelect.innerHTML = '<option value="">Panel-Kanal auswählen</option>' + dashboardSelectOptions(textChannels, [config.panelChannelId || config.panel_channel_id].filter(Boolean));
    if (ticketCategorySelect) ticketCategorySelect.innerHTML = '<option value="">Discord-Kategorie auswählen</option>' + dashboardSelectOptions(categoryChannels, [config.ticketCategoryId || config.ticket_category_id].filter(Boolean));
    if (logSelect) logSelect.innerHTML = '<option value="">Log-Kanal auswählen</option>' + dashboardSelectOptions(textChannels, [config.logChannelId || config.log_channel_id].filter(Boolean));
    ticketCategories = normalizeTicketCategories(config.categories || []);
    ticketPanels = normalizeTicketPanels(config);
    selectedTicketPanelId = config.panelId || config.panel_id || (ticketPanels[0]?.id || createTicketPanelId());
    const selectedPanel = ticketPanels.find((panel) => String(panel.id) === String(selectedTicketPanelId)) || ticketPanels[0] || null;
    if (selectedPanel) applyTicketPanelToForm(selectedPanel);
    else setTicketPanelEmbedForm(config.panelEmbed || config.panel_embed || null);
    renderTicketPanelHistory();
    const status = $('[data-dashboard-ticket-status]');
    if (status) {
      const active = Boolean(config.panelChannelId || config.panel_channel_id || ticketPanels.length);
      status.textContent = active ? `${ticketPanels.length || 1} Panel` : 'Nicht eingerichtet';
      status.className = `chip ${active ? 'online' : ''}`;
    }
    renderTicketCategoryRows();
    ticketDirty = false;
  }



  function emptyModerationRole(index = 0) {
    return { id: `mod_${index + 1}`, roleId: '', commands: [] };
  }

  function normalizeModerationPermissions(entries) {
    const allowed = new Set(moderationCommands.map((command) => command.id));
    const cleaned = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      const roleId = String(entry.roleId || entry.role_id || '').replace(/\D/g, '');
      if (!roleId || cleaned.some((item) => item.roleId === roleId)) continue;
      const commands = Array.from(new Set((entry.commands || []).map(String).filter((cmd) => allowed.has(cmd))));
      if (!commands.length) continue;
      cleaned.push({ id: `mod_${cleaned.length + 1}`, roleId, commands });
      if (cleaned.length >= 5) break;
    }
    return cleaned.length ? cleaned : [emptyModerationRole(0)];
  }

  function commandLabel(commandId) {
    return moderationCommands.find((command) => command.id === commandId)?.label || commandId;
  }

  function updateModerationPreview() {
    if (!moderationForm) return;
    const logSelect = $('[data-dashboard-moderation-log-channel]');
    const logPreview = $('[data-dashboard-moderation-log-preview]');
    const logOption = [...(logSelect?.options || [])].find((option) => option.value === logSelect?.value);
    if (logPreview) logPreview.textContent = logOption && logOption.value ? `#${logOption.textContent}` : 'Kein Log-Kanal';
    const preview = $('[data-dashboard-moderation-preview]');
    if (preview) {
      const rows = moderationRolePermissions
        .filter((entry) => entry.roleId && (entry.commands || []).length)
        .map((entry) => {
          const role = dashboardRoles.find((item) => String(item.id) === String(entry.roleId));
          const commands = (entry.commands || []).map(commandLabel).join(', ');
          return `<div><strong>${role ? `@${escapeHtml(role.name)}` : `Rolle ${escapeHtml(entry.roleId)}`}</strong><small>${escapeHtml(commands || 'Keine Commands')}</small></div>`;
        });
      preview.innerHTML = rows.length ? rows.join('') : '<p class="muted compact">Noch keine Mod-Rollen eingerichtet.</p>';
    }
  }

  function renderModerationRows() {
    const list = $('[data-dashboard-moderation-role-list]');
    if (!list) return;
    moderationRolePermissions = moderationRolePermissions.slice(0, 5);
    if (!moderationRolePermissions.length) moderationRolePermissions = [emptyModerationRole(0)];
    const roleOptions = '<option value="">Rolle wählen</option>' + dashboardSelectOptions(dashboardRoles, []);
    list.innerHTML = moderationRolePermissions.map((entry, index) => {
      const commandChips = moderationCommands.map((command) => {
        const active = (entry.commands || []).includes(command.id);
        return `<button class="command-chip ${active ? 'active' : ''}" type="button" data-moderation-command="${escapeHtml(command.id)}" data-moderation-command-index="${index}">${escapeHtml(command.label)}</button>`;
      }).join('');
      return `
        <article class="moderation-role-row">
          <div class="moderation-role-top">
            <label>Mod-Rolle ${index + 1}<select data-moderation-role-select="${index}">${roleOptions}</select></label>
            <button class="icon-button danger" type="button" data-moderation-role-remove="${index}" aria-label="Mod-Rolle entfernen">×</button>
          </div>
          <div class="command-chip-grid">${commandChips}</div>
        </article>
      `;
    }).join('');
    $$('[data-moderation-role-select]', list).forEach((select) => {
      const index = Number.parseInt(select.dataset.moderationRoleSelect, 10);
      select.value = moderationRolePermissions[index]?.roleId || '';
      select.addEventListener('change', () => {
        const value = String(select.value || '');
        const duplicate = value && moderationRolePermissions.some((entry, idx) => idx !== index && String(entry.roleId) === value);
        if (duplicate) {
          select.value = moderationRolePermissions[index]?.roleId || '';
          return dashboardNotify('moderation', 'Diese Rolle wurde bereits hinzugefügt.', 'warn');
        }
        moderationRolePermissions[index].roleId = value;
        moderationDirty = true;
        updateModerationPreview();
      });
    });
    $$('[data-moderation-command]', list).forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number.parseInt(button.dataset.moderationCommandIndex, 10);
        const command = String(button.dataset.moderationCommand || '');
        const entry = moderationRolePermissions[index];
        if (!entry) return;
        entry.commands ||= [];
        if (entry.commands.includes(command)) entry.commands = entry.commands.filter((item) => item !== command);
        else entry.commands.push(command);
        moderationDirty = true;
        renderModerationRows();
      });
    });
    $$('[data-moderation-role-remove]', list).forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number.parseInt(button.dataset.moderationRoleRemove, 10);
        moderationRolePermissions.splice(index, 1);
        if (!moderationRolePermissions.length) moderationRolePermissions.push(emptyModerationRole(0));
        moderationDirty = true;
        renderModerationRows();
      });
    });
    updateModerationPreview();
  }

  function renderModerationConfig(data, channels) {
    if (!moderationForm) return;
    const config = data.moderation || {};
    const logSelect = $('[data-dashboard-moderation-log-channel]');
    if (logSelect) logSelect.innerHTML = '<option value="">Kein Log-Kanal</option>' + dashboardSelectOptions(channels, [config.logChannelId || config.log_channel_id].filter(Boolean));
    moderationRolePermissions = normalizeModerationPermissions(config.rolePermissions || config.role_permissions || []);
    const status = $('[data-dashboard-moderation-status]');
    if (status) {
      const active = moderationRolePermissions.some((entry) => entry.roleId && (entry.commands || []).length);
      status.textContent = active ? 'Eingerichtet' : 'Nicht eingerichtet';
      status.className = `chip ${active ? 'online' : ''}`;
    }
    renderModerationRows();
    moderationDirty = false;
  }

  function emptyMessagePayload() {
    return {
      id: '',
      name: '',
      channelId: '',
      embed: {
        author: '',
        authorImage: '',
        title: '',
        titleUrl: '',
        description: '',
        image: '',
        thumbnail: '',
        color: '#38bdf8',
        footer: 'Powered by Blue ⚡'
      }
    };
  }

  function currentMessageFromForm() {
    if (!messagesForm) return emptyMessagePayload();
    const fd = new FormData(messagesForm);
    return {
      id: fd.get('messageId') || selectedDashboardMessageId || '',
      name: fd.get('messageName') || '',
      channelId: fd.get('messageChannelId') || '',
      embed: {
        author: fd.get('messageAuthor') || '',
        authorImage: fd.get('messageAuthorImage') || '',
        title: fd.get('messageTitle') || '',
        titleUrl: fd.get('messageTitleUrl') || '',
        description: fd.get('messageDescription') || '',
        image: fd.get('messageImage') || '',
        thumbnail: fd.get('messageThumbnail') || '',
        color: fd.get('messageColor') || '#38bdf8',
        footer: fd.get('messageFooter') || 'Powered by Blue ⚡'
      }
    };
  }

  function setMessageForm(message = null) {
    if (!messagesForm) return;
    const data = message || emptyMessagePayload();
    selectedDashboardMessageId = data.id || null;
    const embed = data.embed || {};
    const set = (name, value) => {
      const input = messagesForm.querySelector(`[name="${name}"]`);
      if (input) input.value = value || '';
    };
    set('messageId', data.id || '');
    set('messageName', data.name || '');
    set('messageChannelId', data.channelId || '');
    set('messageAuthor', embed.author || '');
    set('messageAuthorImage', embed.authorImage || '');
    set('messageTitle', embed.title || '');
    set('messageTitleUrl', embed.titleUrl || '');
    set('messageDescription', embed.description || '');
    set('messageImage', embed.image || '');
    set('messageThumbnail', embed.thumbnail || '');
    set('messageColor', embed.color || '#38bdf8');
    set('messageFooter', embed.footer || 'Powered by Blue ⚡');
    const footerInput = $('[data-dashboard-message-footer-input]');
    const footerNote = $('[data-dashboard-message-footer-note]');
    if (footerInput) {
      footerInput.disabled = !(access && access.hasPremiumFooter);
      if (!(access && access.hasPremiumFooter)) footerInput.value = 'Powered by Blue ⚡';
    }
    if (footerNote) footerNote.textContent = access && access.hasPremiumFooter ? 'Blue Premium erkannt: Du darfst den Footer bearbeiten.' : 'Ohne Blue Premium auf dem Mainserver bleibt der Footer fest auf Powered by Blue ⚡.';
    updateMessagePreview();
  }

  function renderDashboardMessagesList() {
    const list = $('[data-dashboard-message-list]');
    if (!list) return;
    if (!dashboardMessages.length) {
      list.innerHTML = '<p class="muted">Noch keine Message gespeichert.</p>';
      return;
    }
    list.innerHTML = dashboardMessages.map((message) => {
      const active = String(message.id) === String(selectedDashboardMessageId);
      const channel = dashboardChannels.find((item) => String(item.id) === String(message.channelId));
      return `<div class="dashboard-message-item ${active ? 'active' : ''}" data-message-item="${escapeHtml(message.id)}"><button type="button" class="message-item-main"><strong>${escapeHtml(message.name || 'Message')}</strong><small>${channel ? `#${escapeHtml(channel.name)}` : 'Kanal nicht gefunden'} · ${escapeHtml(message.status || 'saved')}</small></button><button type="button" class="message-item-delete" data-message-delete="${escapeHtml(message.id)}" aria-label="Message löschen">×</button></div>`;
    }).join('');
    $$('[data-message-item]', list).forEach((item) => {
      item.querySelector('.message-item-main')?.addEventListener('click', () => {
        const message = dashboardMessages.find((entry) => String(entry.id) === String(item.dataset.messageItem));
        if (message) {
          setMessageForm(message);
          renderDashboardMessagesList();
        }
      });
    });
    $$('[data-message-delete]', list).forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (!selectedGuildId) return;
        const id = String(button.dataset.messageDelete || '');
        if (!id) return;
        if (!confirm('Diese gespeicherte Message wirklich löschen?')) return;
        const response = await fetch(`/api/dashboard/guild/${encodeURIComponent(selectedGuildId)}/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) return dashboardNotify('messages', result.error || 'Message konnte nicht gelöscht werden.', 'error');
        dashboardMessages = dashboardMessages.filter((message) => String(message.id) !== id);
        if (String(selectedDashboardMessageId) === id) setMessageForm(null);
        renderDashboardMessagesList();
        dashboardNotify('messages', 'Message wurde gelöscht und bleibt entfernt.', 'success');
      });
    });
  }

  function renderMessagesConfig(data, channels) {
    if (!messagesForm) return;
    dashboardMessages = (data.messages?.messages || data.messages || []).filter(Boolean);
    const channelSelect = $('[data-dashboard-message-channel-select]');
    if (channelSelect) channelSelect.innerHTML = '<option value="">Kanal auswählen</option>' + dashboardSelectOptions(channels, [dashboardMessages[0]?.channelId].filter(Boolean));
    renderDashboardMessagesList();
    const current = selectedDashboardMessageId ? dashboardMessages.find((message) => String(message.id) === String(selectedDashboardMessageId)) : null;
    setMessageForm(current || dashboardMessages[0] || null);
    messagesDirty = false;
  }

  function updateMessagePreview() {
    if (!messagesForm) return;
    const data = currentMessageFromForm();
    const embed = data.embed || {};
    const card = $('[data-message-preview-card]');
    const author = $('[data-message-preview-author]');
    const title = $('[data-message-preview-title]');
    const description = $('[data-message-preview-description]');
    const thumbnail = $('[data-message-preview-thumbnail]');
    const image = $('[data-message-preview-image]');
    const footer = $('[data-message-preview-footer]');
    const color = embed.color || '#38bdf8';
    if (card) {
      card.style.borderLeftColor = color;
      card.classList.toggle('has-thumbnail', Boolean(embed.thumbnail));
    }
    if (author) {
      const authorImage = embed.authorImage ? `<img src="${escapeHtml(embed.authorImage)}" alt="">` : '';
      author.innerHTML = embed.author ? `${authorImage}<span>${escapeHtml(embed.author)}</span>` : '';
      author.hidden = !embed.author;
    }
    if (title) {
      title.textContent = embed.title || 'Embed Titel';
      title.href = embed.titleUrl || '#';
      title.classList.toggle('muted-link', !embed.title);
    }
    if (description) description.textContent = embed.description || 'Embed Beschreibung';
    if (thumbnail) {
      thumbnail.hidden = !embed.thumbnail;
      if (embed.thumbnail) thumbnail.src = embed.thumbnail;
    }
    if (image) {
      image.hidden = !embed.image;
      if (embed.image) image.src = embed.image;
    }
    if (footer) footer.textContent = embed.footer || 'Powered by Blue ⚡';
  }


  function updateFunPreview() {
    if (!funForm) return;
    const formData = new FormData(funForm);
    const countingEnabled = formData.get('countingEnabled') === 'on';
    const errateEnabled = formData.get('errateEnabled') === 'on';
    const anonymEnabled = formData.get('anonymEnabled') === 'on';
    const countingText = countingEnabled ? dashboardChannelName(formData.get('countingChannelId'), 'Kanal auswählen') : 'Deaktiviert';
    const errateText = errateEnabled ? dashboardChannelName(formData.get('errateChannelId'), 'Kanal auswählen') : 'Deaktiviert';
    const anonymText = anonymEnabled ? dashboardChannelName(formData.get('anonymChannelId'), 'Kanal auswählen') : 'Deaktiviert';
    const countingPreview = $('[data-dashboard-fun-counting-preview]');
    const erratePreview = $('[data-dashboard-fun-errate-preview]');
    const anonymPreview = $('[data-dashboard-fun-anonym-preview]');
    if (countingPreview) countingPreview.textContent = countingText;
    if (erratePreview) erratePreview.textContent = errateText;
    if (anonymPreview) anonymPreview.textContent = anonymText;
    const status = $('[data-dashboard-fun-status]');
    if (status) {
      const activeCount = [countingEnabled, errateEnabled, anonymEnabled].filter(Boolean).length;
      status.textContent = activeCount ? `${activeCount} aktiv` : 'Nicht eingerichtet';
      status.className = `chip ${activeCount ? 'ok' : ''}`;
    }
  }


  function selectedRoleTagHtml(role, attrName) {
    return `<button class="selected-role-tag" type="button" ${attrName}="${escapeHtml(role.id)}"${roleColorStyle(role)}><span>@${escapeHtml(role.name)}</span><b aria-hidden="true">×</b></button>`;
  }

  function selectedChannelTagHtml(channel, attrName) {
    return `<button class="selected-role-tag channel-chip" type="button" ${attrName}="${escapeHtml(channel.id)}"><span>#${escapeHtml(channel.name)}</span><b aria-hidden="true">×</b></button>`;
  }

  function renderSecuritySelectedRoles() {
    const container = $('[data-dashboard-security-selected-roles]');
    const count = $('[data-dashboard-security-role-count]');
    if (count) count.textContent = String(securityIgnoredRoleIds.size);
    if (!container) return;
    const selected = dashboardRoles.filter((role) => securityIgnoredRoleIds.has(String(role.id)));
    if (!selected.length) {
      container.innerHTML = '<span class="muted">Keine Rolle ignoriert</span>';
      return;
    }
    container.innerHTML = selected.map((role) => selectedRoleTagHtml(role, 'data-security-role-remove')).join('');
    $$('[data-security-role-remove]', container).forEach((button) => {
      button.addEventListener('click', () => {
        securityIgnoredRoleIds.delete(String(button.dataset.securityRoleRemove || ''));
        securityDirty = true;
        renderSecurityPickers();
      });
    });
  }

  function renderSecurityRolePicker() {
    const container = $('[data-dashboard-security-role-picker]');
    if (!container) return;
    if (!dashboardRoles.length) {
      container.innerHTML = '<p class="muted">Keine Rollen gefunden.</p>';
      return;
    }
    container.innerHTML = dashboardRoles.map((role) => {
      const active = securityIgnoredRoleIds.has(String(role.id));
      return `<button class="role-chip ${active ? 'active' : ''}" type="button" data-security-role-chip="${escapeHtml(role.id)}"${roleColorStyle(role)}><span class="role-dot"></span>@${escapeHtml(role.name)}</button>`;
    }).join('');
    $$('[data-security-role-chip]', container).forEach((button) => {
      button.addEventListener('click', () => {
        const id = String(button.dataset.securityRoleChip || '');
        if (!id) return;
        if (securityIgnoredRoleIds.has(id)) securityIgnoredRoleIds.delete(id);
        else securityIgnoredRoleIds.add(id);
        securityDirty = true;
        renderSecurityPickers();
      });
    });
  }

  function renderSecuritySelectedChannels() {
    const container = $('[data-dashboard-security-selected-channels]');
    const count = $('[data-dashboard-security-channel-count]');
    if (count) count.textContent = String(securityIgnoredChannelIds.size);
    if (!container) return;
    const selected = dashboardChannels.filter((channel) => securityIgnoredChannelIds.has(String(channel.id)));
    if (!selected.length) {
      container.innerHTML = '<span class="muted">Kein Kanal ignoriert</span>';
      return;
    }
    container.innerHTML = selected.map((channel) => selectedChannelTagHtml(channel, 'data-security-channel-remove')).join('');
    $$('[data-security-channel-remove]', container).forEach((button) => {
      button.addEventListener('click', () => {
        securityIgnoredChannelIds.delete(String(button.dataset.securityChannelRemove || ''));
        securityDirty = true;
        renderSecurityPickers();
      });
    });
  }

  function renderSecurityChannelPicker() {
    const container = $('[data-dashboard-security-channel-picker]');
    if (!container) return;
    if (!dashboardChannels.length) {
      container.innerHTML = '<p class="muted">Keine Textkanäle gefunden.</p>';
      return;
    }
    container.innerHTML = dashboardChannels.map((channel) => {
      const active = securityIgnoredChannelIds.has(String(channel.id));
      return `<button class="role-chip channel-chip ${active ? 'active' : ''}" type="button" data-security-channel-chip="${escapeHtml(channel.id)}"><span class="role-dot"></span>#${escapeHtml(channel.name)}</button>`;
    }).join('');
    $$('[data-security-channel-chip]', container).forEach((button) => {
      button.addEventListener('click', () => {
        const id = String(button.dataset.securityChannelChip || '');
        if (!id) return;
        if (securityIgnoredChannelIds.has(id)) securityIgnoredChannelIds.delete(id);
        else securityIgnoredChannelIds.add(id);
        securityDirty = true;
        renderSecurityPickers();
      });
    });
  }

  function renderSecurityLanguageSelectedRoles() {
    const container = $('[data-dashboard-security-language-selected-roles]');
    const count = $('[data-dashboard-security-language-role-count]');
    if (count) count.textContent = String(securityLanguageIgnoredRoleIds.size);
    if (!container) return;
    const selected = dashboardRoles.filter((role) => securityLanguageIgnoredRoleIds.has(String(role.id)));
    if (!selected.length) {
      container.innerHTML = '<span class="muted">Keine Rolle ignoriert</span>';
      return;
    }
    container.innerHTML = selected.map((role) => selectedRoleTagHtml(role, 'data-security-language-role-remove')).join('');
    $$('[data-security-language-role-remove]', container).forEach((button) => {
      button.addEventListener('click', () => {
        securityLanguageIgnoredRoleIds.delete(String(button.dataset.securityLanguageRoleRemove || ''));
        securityDirty = true;
        renderSecurityPickers();
      });
    });
  }

  function renderSecurityLanguageRolePicker() {
    const container = $('[data-dashboard-security-language-role-picker]');
    if (!container) return;
    if (!dashboardRoles.length) {
      container.innerHTML = '<p class="muted">Keine Rollen gefunden.</p>';
      return;
    }
    container.innerHTML = dashboardRoles.map((role) => {
      const active = securityLanguageIgnoredRoleIds.has(String(role.id));
      return `<button class="role-chip ${active ? 'active' : ''}" type="button" data-security-language-role-chip="${escapeHtml(role.id)}"${roleColorStyle(role)}><span class="role-dot"></span>@${escapeHtml(role.name)}</button>`;
    }).join('');
    $$('[data-security-language-role-chip]', container).forEach((button) => {
      button.addEventListener('click', () => {
        const id = String(button.dataset.securityLanguageRoleChip || '');
        if (!id) return;
        if (securityLanguageIgnoredRoleIds.has(id)) securityLanguageIgnoredRoleIds.delete(id);
        else securityLanguageIgnoredRoleIds.add(id);
        securityDirty = true;
        renderSecurityPickers();
      });
    });
  }

  function renderSecurityLanguageSelectedChannels() {
    const container = $('[data-dashboard-security-language-selected-channels]');
    const count = $('[data-dashboard-security-language-channel-count]');
    if (count) count.textContent = String(securityLanguageIgnoredChannelIds.size);
    if (!container) return;
    const selected = dashboardChannels.filter((channel) => securityLanguageIgnoredChannelIds.has(String(channel.id)));
    if (!selected.length) {
      container.innerHTML = '<span class="muted">Kein Kanal ignoriert</span>';
      return;
    }
    container.innerHTML = selected.map((channel) => selectedChannelTagHtml(channel, 'data-security-language-channel-remove')).join('');
    $$('[data-security-language-channel-remove]', container).forEach((button) => {
      button.addEventListener('click', () => {
        securityLanguageIgnoredChannelIds.delete(String(button.dataset.securityLanguageChannelRemove || ''));
        securityDirty = true;
        renderSecurityPickers();
      });
    });
  }

  function renderSecurityLanguageChannelPicker() {
    const container = $('[data-dashboard-security-language-channel-picker]');
    if (!container) return;
    if (!dashboardChannels.length) {
      container.innerHTML = '<p class="muted">Keine Textkanäle gefunden.</p>';
      return;
    }
    container.innerHTML = dashboardChannels.map((channel) => {
      const active = securityLanguageIgnoredChannelIds.has(String(channel.id));
      return `<button class="role-chip channel-chip ${active ? 'active' : ''}" type="button" data-security-language-channel-chip="${escapeHtml(channel.id)}"><span class="role-dot"></span>#${escapeHtml(channel.name)}</button>`;
    }).join('');
    $$('[data-security-language-channel-chip]', container).forEach((button) => {
      button.addEventListener('click', () => {
        const id = String(button.dataset.securityLanguageChannelChip || '');
        if (!id) return;
        if (securityLanguageIgnoredChannelIds.has(id)) securityLanguageIgnoredChannelIds.delete(id);
        else securityLanguageIgnoredChannelIds.add(id);
        securityDirty = true;
        renderSecurityPickers();
      });
    });
  }


  function renderSecurityUnbanSelectedRoles() {
    const container = $('[data-dashboard-security-unban-selected-roles]');
    const count = $('[data-dashboard-security-unban-role-count]');
    if (count) count.textContent = `${securityUnbanRoleIds.size}/5`;
    if (!container) return;
    const selected = dashboardRoles.filter((role) => securityUnbanRoleIds.has(String(role.id)));
    if (!selected.length) {
      container.innerHTML = '<span class="muted">Keine Team-Rolle ausgewählt</span>';
      return;
    }
    container.innerHTML = selected.map((role) => selectedRoleTagHtml(role, 'data-security-unban-role-remove')).join('');
    $$('[data-security-unban-role-remove]', container).forEach((button) => {
      button.addEventListener('click', () => {
        securityUnbanRoleIds.delete(String(button.dataset.securityUnbanRoleRemove || ''));
        securityDirty = true;
        renderSecurityPickers();
      });
    });
  }

  function renderSecurityUnbanRolePicker() {
    const container = $('[data-dashboard-security-unban-role-picker]');
    if (!container) return;
    if (!dashboardRoles.length) {
      container.innerHTML = '<p class="muted">Keine Rollen gefunden.</p>';
      return;
    }
    container.innerHTML = dashboardRoles.map((role) => {
      const active = securityUnbanRoleIds.has(String(role.id));
      return `<button class="role-chip ${active ? 'active' : ''}" type="button" data-security-unban-role-chip="${escapeHtml(role.id)}"${roleColorStyle(role)}><span class="role-dot"></span>@${escapeHtml(role.name)}</button>`;
    }).join('');
    $$('[data-security-unban-role-chip]', container).forEach((button) => {
      button.addEventListener('click', () => {
        const id = String(button.dataset.securityUnbanRoleChip || '');
        if (!id) return;
        if (securityUnbanRoleIds.has(id)) securityUnbanRoleIds.delete(id);
        else {
          if (securityUnbanRoleIds.size >= 5) return dashboardNotify('security', 'Du kannst maximal 5 Unban-Teamrollen auswählen.', 'warn');
          securityUnbanRoleIds.add(id);
        }
        securityDirty = true;
        renderSecurityPickers();
      });
    });
  }

  function updateSecurityPreview() {
    if (!securityForm) return;
    const linksEnabled = securityForm.querySelector('[name="securityLinksEnabled"]')?.checked;
    const languageEnabled = securityForm.querySelector('[name="securityLanguageEnabled"]')?.checked;
    const lang = securityForm.querySelector('[name="securityPreferredLanguage"]')?.value || 'de';
    const enabledPreview = $('[data-dashboard-security-enabled-preview]');
    if (enabledPreview) enabledPreview.textContent = linksEnabled ? 'Aktiv · HTTPS & Discord-Invites werden gelöscht' : 'Nicht aktiv';
    const rolesPreview = $('[data-dashboard-security-roles-preview]');
    const channelsPreview = $('[data-dashboard-security-channels-preview]');
    if (rolesPreview) {
      const names = dashboardRoles.filter((role) => securityIgnoredRoleIds.has(String(role.id))).map((role) => `@${role.name}`);
      rolesPreview.textContent = names.length ? names.join(', ') : 'Keine';
    }
    if (channelsPreview) {
      const names = dashboardChannels.filter((channel) => securityIgnoredChannelIds.has(String(channel.id))).map((channel) => `#${channel.name}`);
      channelsPreview.textContent = names.length ? names.join(', ') : 'Keine';
    }
    const languageEnabledPreview = $('[data-dashboard-security-language-enabled-preview]');
    if (languageEnabledPreview) languageEnabledPreview.textContent = languageEnabled ? 'Aktiv · andere Sprachen werden direkt blockiert' : 'Nicht aktiv';
    const languagePreview = $('[data-dashboard-security-language-preview]');
    if (languagePreview) languagePreview.textContent = dashboardSecurityLanguageLabels[lang] || lang.toUpperCase();
    const languageRolesPreview = $('[data-dashboard-security-language-roles-preview]');
    if (languageRolesPreview) {
      const names = dashboardRoles.filter((role) => securityLanguageIgnoredRoleIds.has(String(role.id))).map((role) => `@${role.name}`);
      languageRolesPreview.textContent = names.length ? names.join(', ') : 'Keine';
    }
    const languageChannelsPreview = $('[data-dashboard-security-language-channels-preview]');
    if (languageChannelsPreview) {
      const names = dashboardChannels.filter((channel) => securityLanguageIgnoredChannelIds.has(String(channel.id))).map((channel) => `#${channel.name}`);
      languageChannelsPreview.textContent = names.length ? names.join(', ') : 'Keine';
    }
    const unbanEnabled = securityForm.querySelector('[name="securityUnbanEnabled"]')?.checked;
    const unbanEnabledPreview = $('[data-dashboard-security-unban-enabled-preview]');
    if (unbanEnabledPreview) unbanEnabledPreview.textContent = unbanEnabled ? 'Aktiv · Website-Anträge gehen in den Log-Kanal' : 'Nicht aktiv';
    const unbanLogPreview = $('[data-dashboard-security-unban-log-preview]');
    if (unbanLogPreview) {
      const selectedLog = String(securityForm.querySelector('[name="securityUnbanLogChannelId"]')?.value || '');
      const channel = dashboardChannels.find((item) => String(item.id) === selectedLog);
      unbanLogPreview.textContent = channel ? `#${channel.name}` : 'Kein Log-Kanal';
    }
    const unbanRolesPreview = $('[data-dashboard-security-unban-roles-preview]');
    if (unbanRolesPreview) {
      const names = dashboardRoles.filter((role) => securityUnbanRoleIds.has(String(role.id))).map((role) => `@${role.name}`);
      unbanRolesPreview.textContent = names.length ? names.join(', ') : 'Admins/Owner';
    }
  }

  function renderSecurityPickers() {
    renderSecurityRolePicker();
    renderSecuritySelectedRoles();
    renderSecurityChannelPicker();
    renderSecuritySelectedChannels();
    renderSecurityLanguageRolePicker();
    renderSecurityLanguageSelectedRoles();
    renderSecurityLanguageChannelPicker();
    renderSecurityLanguageSelectedChannels();
    renderSecurityUnbanRolePicker();
    renderSecurityUnbanSelectedRoles();
    updateSecurityPreview();
  }

  function renderSecurityConfig(data, channels) {
    if (!securityForm) return;
    const config = data.security || {};
    const links = config.links || {};
    const language = config.language || {};
    const unban = config.unban || {};
    const enabledInput = securityForm.querySelector('[name="securityLinksEnabled"]');
    if (enabledInput) enabledInput.checked = Boolean(links.enabled);
    const languageEnabledInput = securityForm.querySelector('[name="securityLanguageEnabled"]');
    if (languageEnabledInput) languageEnabledInput.checked = Boolean(language.enabled);
    const languageSelect = securityForm.querySelector('[name="securityPreferredLanguage"]');
    if (languageSelect) languageSelect.value = language.preferred || language.language || 'de';
    const unbanEnabledInput = securityForm.querySelector('[name="securityUnbanEnabled"]');
    if (unbanEnabledInput) unbanEnabledInput.checked = Boolean(unban.enabled);
    setDashboardSelectOptions('[data-dashboard-security-unban-log-channel]', channels || dashboardChannels, unban.logChannelId || unban.log_channel_id || '', 'Log-Kanal auswählen');
    securityIgnoredRoleIds = new Set((links.ignoredRoleIds || links.ignored_role_ids || []).map(String));
    securityIgnoredChannelIds = new Set((links.ignoredChannelIds || links.ignored_channel_ids || []).map(String));
    securityLanguageIgnoredRoleIds = new Set((language.ignoredRoleIds || language.ignored_role_ids || []).map(String));
    securityLanguageIgnoredChannelIds = new Set((language.ignoredChannelIds || language.ignored_channel_ids || []).map(String));
    securityUnbanRoleIds = new Set((unban.teamRoleIds || unban.team_role_ids || []).map(String));
    const status = $('[data-dashboard-security-status]');
    if (status) {
      const activeCount = [Boolean(links.enabled), Boolean(language.enabled), Boolean(unban.enabled)].filter(Boolean).length;
      status.textContent = activeCount ? `${activeCount} aktiv` : 'Nicht aktiv';
      status.className = `chip ${activeCount ? 'online' : ''}`;
    }
    securityDirty = false;
    renderSecurityPickers();
  }

  function renderFunConfig(data, channels = dashboardChannels) {
    if (!funForm) return;
    const usableChannels = (channels && channels.length ? channels : dashboardTextChannelsFromGuild());
    const config = data.fun || {};
    const counting = config.counting || {};
    const errate = config.errate || {};
    const anonym = config.anonym || {};
    setDashboardSelectOptions('[data-dashboard-fun-counting-channel]', usableChannels, counting.channelId || counting.channel_id, 'Kanal auswählen');
    setDashboardSelectOptions('[data-dashboard-fun-errate-channel]', usableChannels, errate.channelId || errate.channel_id, 'Kanal auswählen');
    setDashboardSelectOptions('[data-dashboard-fun-anonym-channel]', usableChannels, anonym.channelId || anonym.channel_id, 'Kanal auswählen');
    setDashboardSelectOptions('[data-dashboard-fun-anonym-log-channel]', usableChannels, anonym.logChannelId || anonym.log_channel_id, 'Kein Log-Kanal');
    const countingEnabled = funForm.querySelector('[name="countingEnabled"]');
    const errateEnabled = funForm.querySelector('[name="errateEnabled"]');
    const anonymEnabled = funForm.querySelector('[name="anonymEnabled"]');
    if (countingEnabled) countingEnabled.checked = Boolean(counting.enabled);
    if (errateEnabled) errateEnabled.checked = Boolean(errate.enabled);
    if (anonymEnabled) anonymEnabled.checked = Boolean(anonym.enabled);
    if (!usableChannels.length) {
      dashboardNotify('fun', 'Keine Textkanäle gefunden. Prüfe, ob der Bot auf dem Server Kanäle sehen darf.', 'warn');
    }
    funDirty = false;
    updateFunPreview();
  }



  function updateCommunityPreview() {
    if (!communityForm) return;
    const formData = new FormData(communityForm);
    const channelPreview = $('[data-dashboard-community-channel-preview]');
    const rolePreview = $('[data-dashboard-community-preview-roles]');
    const status = $('[data-dashboard-community-status]');
    if (channelPreview) channelPreview.textContent = dashboardChannelName(formData.get('communityTeamlistChannelId'), 'Kanal auswählen');
    const selectedRoles = dashboardRoles.filter((role) => communityRoleIds.has(String(role.id)));
    if (rolePreview) {
      rolePreview.innerHTML = selectedRoles.length
        ? selectedRoles.map((role, index) => `<div class="feature-preview-line"><strong>${index + 1}.</strong> <span>@${escapeHtml(role.name)}</span></div>`).join('')
        : '<p class="muted compact">Noch keine Rollen gewählt.</p>';
    }
    if (status) {
      status.textContent = selectedRoles.length ? `${selectedRoles.length} Rolle(n)` : 'Nicht eingerichtet';
      status.classList.toggle('online', selectedRoles.length > 0);
    }
    const count = $('[data-dashboard-community-role-count]');
    if (count) count.textContent = `${selectedRoles.length}/10`;
  }

  function renderCommunitySelectedRoles() {
    const container = $('[data-dashboard-community-selected]');
    if (!container) return;
    const selectedRoles = dashboardRoles.filter((role) => communityRoleIds.has(String(role.id)));
    if (!selectedRoles.length) {
      container.innerHTML = '<span class="muted">Keine Rolle gewählt</span>';
      return;
    }
    container.innerHTML = selectedRoles.map((role) => `<button class="selected-role-tag" type="button" data-community-remove-role="${escapeHtml(role.id)}"${roleColorStyle(role)}><span>@${escapeHtml(role.name)}</span><b aria-hidden="true">×</b></button>`).join('');
    $$('[data-community-remove-role]', container).forEach((button) => {
      button.addEventListener('click', () => {
        communityRoleIds.delete(String(button.dataset.communityRemoveRole));
        communityDirty = true;
        renderCommunityRolePicker();
      });
    });
  }

  function renderCommunityRolePicker() {
    const container = $('[data-dashboard-community-role-picker]');
    if (!container) return;
    if (!dashboardRoles.length) {
      container.innerHTML = '<p class="muted">Keine Rollen gefunden. Prüfe die Bot-Berechtigungen.</p>';
      renderCommunitySelectedRoles();
      updateCommunityPreview();
      return;
    }
    container.innerHTML = dashboardRoles.map((role) => {
      const id = String(role.id);
      const active = communityRoleIds.has(id);
      return `<button class="role-chip ${active ? 'active' : ''}" type="button" data-community-role-chip="${escapeHtml(id)}"${roleColorStyle(role)}><span class="role-dot"></span>@${escapeHtml(role.name)}</button>`;
    }).join('');
    $$('[data-community-role-chip]', container).forEach((button) => {
      button.addEventListener('click', () => {
        const id = String(button.dataset.communityRoleChip || '');
        if (!id) return;
        if (communityRoleIds.has(id)) {
          communityRoleIds.delete(id);
        } else {
          if (communityRoleIds.size >= 10) return dashboardNotify('community', 'Maximal 10 Rollen sind möglich.', 'warn');
          communityRoleIds.add(id);
        }
        communityDirty = true;
        renderCommunityRolePicker();
      });
    });
    renderCommunitySelectedRoles();
    updateCommunityPreview();
  }

  function renderCommunityConfig(data, channels = dashboardChannels) {
    if (!communityForm) return;
    const config = data.community || {};
    const teamlist = config.teamlist || config || {};
    setDashboardSelectOptions('[data-dashboard-community-channel]', channels, teamlist.channelId || config.channelId || '', 'Kanal auswählen');
    communityRoleIds = new Set((teamlist.roleIds || config.roleIds || config.roles || []).map(String).filter(Boolean).slice(0, 10));
    communityDirty = false;
    renderCommunityRolePicker();
  }

  function renderGuildConfig(data) {
    selectedGuildData = data.guild;
    access = data.access || { checked: false, hasPremiumFooter: false };
    $('[data-dashboard-server-name]').textContent = selectedGuildData.name || 'Server';
    $('[data-dashboard-server-meta]').textContent = `${formatValue(selectedGuildData.memberCount)} Mitglieder · ${access.checked ? (access.canManage ? 'Administrator bestätigt' : 'Administrator benötigt') : 'Administrator wird geprüft'}`;
    const roles = (selectedGuildData.roles || []).filter((role) => !role.managed && !role.default).sort((a, b) => (b.position || 0) - (a.position || 0));
    const allGuildChannels = Array.isArray(selectedGuildData.channels) ? selectedGuildData.channels : [];
    const channels = allGuildChannels.filter((channel) => dashboardIsTextChannel(channel) || String(channel.type).toLowerCase() === 'forum');
    const globalchatChannels = allGuildChannels.filter(dashboardIsTextChannel);
    const categoryChannels = allGuildChannels.filter((channel) => String(channel.type).toLowerCase() === 'category');
    dashboardChannels = globalchatChannels;
    dashboardCategoryChannels = categoryChannels;
    dashboardRoles = roles;
    selectedAddRoleIds = new Set((data.verification?.addRoleIds || data.verification?.role_ids || []).map(String));
    selectedRemoveRoleIds = new Set((data.verification?.removeRoleIds || data.verification?.remove_role_ids || []).map(String));
    selectedReviewRoleIds = new Set((data.verification?.reviewRoleIds || data.verification?.review_role_ids || data.verification?.teamRoleIds || data.verification?.team_role_ids || []).map(String));
    selectedAddRoleIds.forEach((id) => selectedRemoveRoleIds.delete(id));
    renderRolePickers();
    $('[data-dashboard-channel-select]').innerHTML = dashboardSelectOptions(channels, [data.verification?.channelId || data.verification?.channel_id].filter(Boolean));
    const logChannelSelect = $('[data-dashboard-log-channel-select]');
    if (logChannelSelect) {
      logChannelSelect.innerHTML = '<option value="">Kein Log-Kanal</option>' + dashboardSelectOptions(channels, [data.verification?.logChannelId || data.verification?.log_channel_id].filter(Boolean));
    }
    renderGlobalchatConfig(data, globalchatChannels);
    renderTicketConfig(data, globalchatChannels, categoryChannels);
    renderModerationConfig(data, globalchatChannels);
    renderSecurityConfig(data, globalchatChannels);
    renderFunConfig(data, globalchatChannels);
    renderCommunityConfig(data, globalchatChannels);
    renderMessagesConfig(data, globalchatChannels);
    if (data.verification?.mode) {
      const modeInput = form.querySelector(`[name="mode"][value="${data.verification.mode}"]`);
      if (modeInput) modeInput.checked = true;
    }
    const ageEnabled = form.querySelector('[name="minAccountAgeEnabled"]');
    const ageDays = form.querySelector('[name="minAccountAgeDays"]');
    if (ageEnabled) ageEnabled.checked = Boolean(data.verification?.minAccountAgeEnabled);
    if (ageDays) ageDays.value = Number.isFinite(Number(data.verification?.minAccountAgeDays)) ? Number(data.verification.minAccountAgeDays) : 30;
    if (data.verification?.embed) {
      for (const [key, value] of Object.entries(data.verification.embed)) {
        const input = form.querySelector(`[name="${key}"]`);
        if (input && value !== null && value !== undefined) input.value = value;
      }
    }
    const footerInput = $('[data-dashboard-footer-input]');
    const footerNote = $('[data-dashboard-footer-note]');
    if (footerInput) {
      footerInput.disabled = !access.hasPremiumFooter;
      if (!access.hasPremiumFooter) footerInput.value = 'Powered by Blue ⚡';
    }
    if (footerNote) footerNote.textContent = access.hasPremiumFooter ? 'Blue Premium erkannt: Du darfst den Footer bearbeiten.' : 'Ohne Blue Premium auf dem Mainserver bleibt der Footer fest auf Powered by Blue ⚡.';
    updateVerifyPreview();
  }

  async function loadDashboard() {
    const requestedGuildId = getDashboardPathGuildId();
    setDashboardRouteMode(requestedGuildId);
    const authResponse = await fetch('/api/auth/me', { cache: 'no-store' });
    const auth = await authResponse.json();
    if (!auth.loggedIn) {
      setWorkspaceVisible(false);
      if (dashboardSidebar) dashboardSidebar.hidden = false;
      if (dashboardMain) dashboardMain.hidden = true;
      if (serverList) serverList.innerHTML = '<p class="muted">Bitte oben rechts mit Discord einloggen.</p>';
      showDashboardMessage('Discord Login erforderlich, um dein Dashboard zu öffnen.', 'warn');
      return;
    }
    const response = await fetch('/api/dashboard/me', { cache: 'no-store' });
    const data = await response.json();
    renderServers(data.guilds || []);
    if (data.checkingServers && dashboardServerAutoRefreshes < 4) {
      showDashboardMessage('Neue Server werden vom Bot geprüft. Die Liste aktualisiert sich gleich automatisch...', 'info');
      clearTimeout(dashboardServerAutoRefreshTimer);
      dashboardServerAutoRefreshes += 1;
      dashboardServerAutoRefreshTimer = setTimeout(() => loadDashboard(), 4500);
    } else {
      clearDashboardMessage();
    }
    $$('[data-dashboard-guild]', serverList).forEach((button) => {
      button.addEventListener('click', () => {
        const targetUrl = button.dataset.dashboardGuildUrl || dashboardGuildUrl(button.dataset.dashboardGuild);
        window.location.href = targetUrl;
      });
    });

    if (!requestedGuildId) {
      setDashboardRouteMode(null);
      return;
    }

    if (requestedGuildId) {
      const requestedButton = $(`[data-dashboard-guild="${CSS.escape(requestedGuildId)}"]`, serverList);
      if (!requestedButton) {
        if (dashboardSidebar) dashboardSidebar.hidden = false;
        setWorkspaceVisible(false);
        showDashboardMessage('Dieser Server wurde nicht gefunden oder Blue ist dort noch nicht bestätigt.', 'warn');
        return;
      }
      if (requestedButton.disabled) {
        if (dashboardSidebar) dashboardSidebar.hidden = false;
        setWorkspaceVisible(false);
        showDashboardMessage('Dieser Server ist sichtbar, aber gesperrt. Du brauchst Administratorrechte, um Module zu öffnen.', 'warn');
        return;
      }
      selectedGuildId = requestedGuildId;
      if (dashboardMain) dashboardMain.hidden = false;
      $$('.dashboard-server-card', serverList).forEach((node) => node.classList.toggle('active', node === requestedButton));
      setWorkspaceVisible(true);
      await loadGuild(selectedGuildId, true);
    }
  }

  async function loadGuild(guildId, focusModules = false) {
    showDashboardMessage('Serverdaten werden geladen...', 'info');
    const response = await fetch(`/api/dashboard/guild/${encodeURIComponent(guildId)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      showDashboardMessage(data.error || 'Server konnte nicht geladen werden.', 'error');
      return;
    }
    clearDashboardMessage();
    renderGuildConfig(data);
    clearDashboardModuleSelection();
    if (focusModules || window.location.hash === '#dashboard-app') scrollDashboardAppIntoView();
  }

  function updateVerifyPreview() {
    if (!form) return;
    const titleValue = form.querySelector('[name="title"]')?.value || '✅ Verifizierung erforderlich';
    const descriptionValue = form.querySelector('[name="description"]')?.value || 'Um Zugriff auf alle Kanäle zu erhalten, musst du dich zuerst verifizieren.';
    const color = form.querySelector('[name="color"]')?.value || '#22c55e';
    const thumbnailValue = form.querySelector('[name="thumbnail"]')?.value || '';
    const imageValue = form.querySelector('[name="image"]')?.value || '';
    const footerValue = form.querySelector('[name="footer"]')?.value || 'Powered by Blue ⚡';
    const card = $('[data-verify-preview-card]');
    const title = $('[data-verify-preview-title]');
    const description = $('[data-verify-preview-description]');
    const thumbnail = $('[data-verify-preview-thumbnail]');
    const image = $('[data-verify-preview-image]');
    const footer = $('[data-verify-preview-footer]');
    if (card) {
      card.style.borderLeftColor = color;
      card.classList.toggle('has-thumbnail', Boolean(thumbnailValue));
    }
    if (title) {
      title.textContent = titleValue;
      title.href = '#';
      title.classList.remove('muted-link');
    }
    if (description) description.textContent = descriptionValue;
    if (thumbnail) {
      thumbnail.hidden = !thumbnailValue;
      if (thumbnailValue) thumbnail.src = thumbnailValue;
    }
    if (image) {
      image.hidden = !imageValue;
      if (imageValue) image.src = imageValue;
    }
    if (footer) footer.textContent = footerValue;
  }

  form?.addEventListener('input', () => { dashboardDirty = true; updateVerifyPreview(); });
  form?.addEventListener('change', () => { dashboardDirty = true; updateVerifyPreview(); });
  globalchatForm?.addEventListener('input', () => { globalchatDirty = true; updateGlobalchatPreview(); });
  globalchatForm?.addEventListener('change', () => { globalchatDirty = true; updateGlobalchatPreview(); });
  ticketForm?.addEventListener('input', (event) => {
    if (event.target?.matches?.('[name^="ticketPanel"]')) ticketPanelEmbedIsDefault = false;
    ticketDirty = true;
    updateTicketPreview();
  });
  ticketForm?.addEventListener('change', (event) => {
    if (event.target?.matches?.('[name^="ticketPanel"]')) ticketPanelEmbedIsDefault = false;
    ticketDirty = true;
    updateTicketPreview();
  });
  moderationForm?.addEventListener('input', () => { moderationDirty = true; updateModerationPreview(); });
  moderationForm?.addEventListener('change', () => { moderationDirty = true; updateModerationPreview(); });
  securityForm?.addEventListener('input', () => { securityDirty = true; updateSecurityPreview(); });
  securityForm?.addEventListener('change', () => { securityDirty = true; updateSecurityPreview(); });
  funForm?.addEventListener('input', () => { funDirty = true; updateFunPreview(); });
  funForm?.addEventListener('change', () => { funDirty = true; updateFunPreview(); });
  communityForm?.addEventListener('input', () => { communityDirty = true; updateCommunityPreview(); });
  communityForm?.addEventListener('change', () => { communityDirty = true; updateCommunityPreview(); });
  messagesForm?.addEventListener('input', () => { messagesDirty = true; updateMessagePreview(); });
  messagesForm?.addEventListener('change', () => { messagesDirty = true; updateMessagePreview(); });
  $('[data-dashboard-refresh]')?.addEventListener('click', async () => {
    if (selectedGuildId) await loadGuild(selectedGuildId);
  });

  $$('[data-dashboard-section]').forEach((button) => {
    button.addEventListener('click', () => {
      const section = button.dataset.dashboardSection;
      $$('[data-dashboard-section]').forEach((node) => node.classList.toggle('active', node === button));
      if (form) form.hidden = section !== 'verification';
      if (globalchatForm) globalchatForm.hidden = section !== 'globalchat';
      if (ticketForm) ticketForm.hidden = section !== 'ticket';
      if (moderationForm) moderationForm.hidden = section !== 'moderation';
      if (securityForm) securityForm.hidden = section !== 'security';
      if (funForm) funForm.hidden = section !== 'fun';
      if (communityForm) communityForm.hidden = section !== 'community';
      if (messagesForm) messagesForm.hidden = section !== 'messages';
      if (section === 'verification' || section === 'globalchat' || section === 'messages' || section === 'ticket' || section === 'moderation' || section === 'security' || section === 'fun' || section === 'community') {
        if (soon) soon.hidden = true;
      } else if (soon) {
        soon.hidden = false;
        soon.querySelector('h3').textContent = `${button.querySelector('strong')?.textContent || 'Dieses System'} · Bald...`;
      }
    });
  });





  communityForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedGuildId) return dashboardNotify(null, 'Bitte wähle zuerst einen Server.', 'warn');
    const formData = new FormData(communityForm);
    const payload = {
      enabled: true,
      channelId: formData.get('communityTeamlistChannelId') || '',
      roleIds: Array.from(communityRoleIds),
    };
    if (!payload.channelId) return dashboardNotify('community', 'Bitte wähle einen Teamlist-Kanal.', 'warn');
    if (!payload.roleIds.length) return dashboardNotify('community', 'Bitte wähle mindestens eine Rolle für die Teamliste.', 'warn');
    if (!dashboardTrySendCooldown(`community:${selectedGuildId}`, 'community')) return;
    const response = await fetch(`/api/dashboard/guild/${encodeURIComponent(selectedGuildId)}/community`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) return dashboardNotify('community', result.error || 'Community konnte nicht gespeichert werden.', 'error');
    communityDirty = false;
    if (result.config) renderCommunityConfig({ community: result.config }, dashboardChannels);
    dashboardNotify('community', 'Community gespeichert. Blue sendet/aktualisiert jetzt die Teamliste.', 'success');
  });


  securityForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedGuildId) return dashboardNotify(null, 'Bitte wähle zuerst einen Server.', 'warn');
    const formData = new FormData(securityForm);
    const payload = {
      links: {
        enabled: formData.get('securityLinksEnabled') === 'on',
        ignoredRoleIds: Array.from(securityIgnoredRoleIds),
        ignoredChannelIds: Array.from(securityIgnoredChannelIds),
      },
      language: {
        enabled: formData.get('securityLanguageEnabled') === 'on',
        preferred: String(formData.get('securityPreferredLanguage') || 'de'),
        ignoredRoleIds: Array.from(securityLanguageIgnoredRoleIds),
        ignoredChannelIds: Array.from(securityLanguageIgnoredChannelIds),
      },
      unban: {
        enabled: formData.get('securityUnbanEnabled') === 'on',
        logChannelId: String(formData.get('securityUnbanLogChannelId') || ''),
        teamRoleIds: Array.from(securityUnbanRoleIds).slice(0, 5),
      }
    };
    const response = await fetch(`/api/dashboard/guild/${encodeURIComponent(selectedGuildId)}/security`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) return dashboardNotify('security', result.error || 'Security konnte nicht gespeichert werden.', 'error');
    securityDirty = false;
    if (result.config) renderSecurityConfig({ security: result.config }, dashboardChannels);
    const activeParts = [];
    if (payload.links.enabled) activeParts.push('Link-Schutz');
    if (payload.language.enabled) activeParts.push('Sprachschutz');
    if (payload.unban.enabled) activeParts.push('Unban-System');
    dashboardNotify('security', activeParts.length ? `${activeParts.join(' & ')} gespeichert.` : 'Security gespeichert. Alle Schutzsysteme sind deaktiviert.', 'success');
  });

  funForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedGuildId) return dashboardNotify(null, 'Bitte wähle zuerst einen Server.', 'warn');
    const formData = new FormData(funForm);
    const payload = {
      counting: {
        enabled: formData.get('countingEnabled') === 'on',
        channelId: formData.get('countingChannelId') || '',
      },
      errate: {
        enabled: formData.get('errateEnabled') === 'on',
        channelId: formData.get('errateChannelId') || '',
      },
      anonym: {
        enabled: formData.get('anonymEnabled') === 'on',
        channelId: formData.get('anonymChannelId') || '',
        logChannelId: formData.get('anonymLogChannelId') || '',
      }
    };
    if (payload.counting.enabled && !payload.counting.channelId) return dashboardNotify('fun', 'Bitte wähle einen Counting-Kanal oder deaktiviere Counting.', 'warn');
    if (payload.errate.enabled && !payload.errate.channelId) return dashboardNotify('fun', 'Bitte wähle einen Errate-Zahl-Kanal oder deaktiviere Errate-Zahl.', 'warn');
    if (payload.anonym.enabled && !payload.anonym.channelId) return dashboardNotify('fun', 'Bitte wähle einen Anonym-Chat-Kanal oder deaktiviere Anonym-Chat.', 'warn');
    const response = await fetch(`/api/dashboard/guild/${encodeURIComponent(selectedGuildId)}/fun`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) return dashboardNotify('fun', result.error || 'Fun Systeme konnten nicht gespeichert werden.', 'error');
    funDirty = false;
    if (result.config) renderFunConfig({ fun: result.config }, dashboardChannels);
    dashboardNotify('fun', 'Fun Systeme gespeichert. Blue übernimmt jetzt Counting, Errate-Zahl und Anonym-Chat.', 'success');
  });

  $('[data-dashboard-moderation-add-role]')?.addEventListener('click', () => {
    if (moderationRolePermissions.length >= 5) return dashboardNotify('moderation', 'Maximal 5 Mod-Rollen sind möglich.', 'warn');
    moderationRolePermissions.push(emptyModerationRole(moderationRolePermissions.length));
    moderationDirty = true;
    renderModerationRows();
  });

  moderationForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedGuildId) return dashboardNotify(null, 'Bitte wähle zuerst einen Server.', 'warn');
    const formData = new FormData(moderationForm);
    const rolePermissions = moderationRolePermissions
      .map((entry) => ({
        roleId: String(entry.roleId || '').replace(/\D/g, ''),
        commands: Array.from(new Set((entry.commands || []).map(String)))
      }))
      .filter((entry) => entry.roleId && entry.commands.length)
      .slice(0, 5);
    if (!rolePermissions.length) return dashboardNotify('moderation', 'Bitte wähle mindestens eine Mod-Rolle und mindestens einen Command.', 'warn');
    const payload = {
      logChannelId: formData.get('moderationLogChannelId') || '',
      rolePermissions
    };
    const response = await fetch(`/api/dashboard/guild/${encodeURIComponent(selectedGuildId)}/moderation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) return dashboardNotify('moderation', result.error || 'Moderation konnte nicht gespeichert werden.', 'error');
    moderationDirty = false;
    if (result.config) renderModerationConfig({ moderation: result.config }, dashboardChannels);
    dashboardNotify('moderation', 'Moderation gespeichert. Blue übernimmt jetzt Rollen, Commands und Log-Kanal.', 'success');
  });


  $('[data-dashboard-ticket-panel-reset]')?.addEventListener('click', () => {
    setTicketPanelEmbedForm(null, true);
    ticketDirty = true;
    updateTicketPreview();
    dashboardNotify('ticket', 'Ticket-Panel wurde auf Standard zurückgesetzt. Speichern nicht vergessen.', 'info');
  });

  $('[data-dashboard-ticket-new-panel]')?.addEventListener('click', () => {
    selectedTicketPanelId = createTicketPanelId();
    setTicketPanelEmbedForm(null, true);
    const panelSelect = $('[data-dashboard-ticket-panel-channel]');
    if (panelSelect) panelSelect.value = '';
    renderTicketPanelHistory();
    updateTicketPreview();
    dashboardNotify('ticket', 'Neues Ticket-Panel vorbereitet. Gib Titel/Kanal ein und speichere.', 'info');
  });

  $('[data-dashboard-ticket-add-category]')?.addEventListener('click', () => {
    if (ticketCategories.length >= 5) return dashboardNotify('ticket', 'Maximal 5 Ticket-Kategorien sind möglich.', 'warn');
    ticketCategories.push(emptyTicketCategory(ticketCategories.length));
    ticketDirty = true;
    renderTicketCategoryRows();
  });

  ticketForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedGuildId) return dashboardNotify(null, 'Bitte wähle zuerst einen Server.', 'warn');
    const formData = new FormData(ticketForm);
    const categories = ticketCategories.map((category, index) => ({
      id: `cat_${index + 1}`,
      name: (category.name || '').trim(),
      description: (category.description || '').trim(),
      roleIds: Array.from(new Set((category.roleIds || []).map(String)))
    })).filter((category) => category.name);
    if (!categories.length) return dashboardNotify('ticket', 'Bitte erstelle mindestens eine Ticket-Kategorie.', 'warn');
    if (categories.some((category) => !category.roleIds.length)) return dashboardNotify('ticket', 'Jede Ticket-Kategorie braucht mindestens eine Team-Rolle.', 'warn');
    const panelEmbed = getTicketPanelEmbedFromForm(false);
    const previewEmbed = getTicketPanelEmbedFromForm(true);
    const payload = {
      panelId: selectedTicketPanelId || createTicketPanelId(),
      panelName: currentTicketPanelName(previewEmbed),
      panelChannelId: formData.get('ticketPanelChannelId'),
      ticketCategoryId: formData.get('ticketCategoryId'),
      logChannelId: formData.get('ticketLogChannelId'),
      categories,
      panelEmbed
    };
    if (!payload.panelChannelId || !payload.ticketCategoryId || !payload.logChannelId) return dashboardNotify('ticket', 'Bitte wähle Panel-Kanal, Ticket-Kategorie und Log-Kanal aus.', 'warn');
    if (!dashboardTrySendCooldown(`ticket:${selectedGuildId}`, 'ticket')) return;
    const response = await fetch(`/api/dashboard/guild/${encodeURIComponent(selectedGuildId)}/ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) return dashboardNotify('ticket', result.error || 'Ticket-System konnte nicht gespeichert werden.', 'error');
    ticketDirty = false;
    if (result.config) renderTicketConfig({ ticket: result.config }, dashboardChannels, dashboardCategoryChannels);
    dashboardNotify('ticket', 'Ticket-System gespeichert. Blue sendet/aktualisiert jetzt das Panel.', 'success');
  });

  function resetMessageBuilder() {
    selectedDashboardMessageId = null;
    setMessageForm(null);
    renderDashboardMessagesList();
  }

  $('[data-dashboard-message-new]')?.addEventListener('click', resetMessageBuilder);
  $('[data-dashboard-message-reset]')?.addEventListener('click', resetMessageBuilder);

  messagesForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedGuildId) return dashboardNotify(null, 'Bitte wähle zuerst einen Server.', 'warn');
    const payload = currentMessageFromForm();
    if (!payload.name.trim()) return dashboardNotify('messages', 'Bitte gib der Message einen Namen.', 'warn');
    if (!payload.channelId) return dashboardNotify('messages', 'Bitte wähle einen Kanal aus.', 'warn');
    if (!dashboardTrySendCooldown(`messages:${selectedGuildId}`, 'messages')) return;
    const response = await fetch(`/api/dashboard/guild/${encodeURIComponent(selectedGuildId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) return dashboardNotify('messages', result.error || 'Message konnte nicht gesendet werden.', 'error');
    const saved = result.message;
    const index = dashboardMessages.findIndex((message) => String(message.id) === String(saved.id));
    if (index >= 0) dashboardMessages[index] = saved;
    else dashboardMessages.unshift(saved);
    selectedDashboardMessageId = saved.id;
    setMessageForm(saved);
    renderDashboardMessagesList();
    messagesDirty = false;
    dashboardNotify('messages', 'Message gespeichert und an den Bot zum Senden übergeben.', 'success');
  });

  async function submitGlobalchatConfig(enabledOverride = null) {
    if (!selectedGuildId) return dashboardNotify(null, 'Bitte wähle zuerst einen Server.', 'warn');
    if (!globalchatForm) return;
    const formData = new FormData(globalchatForm);
    const enabled = enabledOverride === null ? formData.get('globalchatEnabled') === 'on' : Boolean(enabledOverride);
    const payload = {
      enabled,
      channelId: enabled ? formData.get('globalchatChannelId') : null
    };
    if (enabled && !payload.channelId) return dashboardNotify('globalchat', 'Bitte wähle einen Globalchat-Kanal aus.', 'warn');
    const response = await fetch(`/api/dashboard/guild/${encodeURIComponent(selectedGuildId)}/globalchat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) return dashboardNotify('globalchat', result.error || 'Globalchat konnte nicht gespeichert werden.', 'error');
    globalchatDirty = false;
    dashboardNotify('globalchat', enabled ? 'Globalchat gespeichert. Blue richtet den Kanal jetzt ein.' : 'Globalchat-Deaktivierung gespeichert. Blue entfernt die Verbindung jetzt.', 'success');
  }

  globalchatForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await submitGlobalchatConfig(null);
  });

  $('[data-dashboard-globalchat-disable]')?.addEventListener('click', async () => {
    if (globalchatForm) {
      const enabledInput = globalchatForm.querySelector('[name="globalchatEnabled"]');
      if (enabledInput) enabledInput.checked = false;
    }
    await submitGlobalchatConfig(false);
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedGuildId) return dashboardNotify(null, 'Bitte wähle zuerst einen Server.', 'warn');
    const formData = new FormData(form);
    const addRoleIds = Array.from(selectedAddRoleIds);
    const removeRoleIds = Array.from(selectedRemoveRoleIds);
    const reviewRoleIds = Array.from(selectedReviewRoleIds);
    if (!addRoleIds.length) return dashboardNotify('verification', 'Bitte wähle mindestens eine Rolle zum Hinzufügen aus.', 'warn');
    const payload = {
      mode: formData.get('mode'),
      addRoleIds,
      removeRoleIds,
      reviewRoleIds,
      channelId: formData.get('channelId'),
      logChannelId: formData.get('logChannelId') || null,
      minAccountAgeEnabled: formData.get('minAccountAgeEnabled') === 'on',
      minAccountAgeDays: Number.parseInt(formData.get('minAccountAgeDays'), 10) || 0,
      embed: {
        title: formData.get('title'),
        description: formData.get('description'),
        thumbnail: formData.get('thumbnail'),
        image: formData.get('image'),
        color: formData.get('color'),
        footer: formData.get('footer')
      }
    };
    if (!dashboardTrySendCooldown(`verification:${selectedGuildId}`, 'verification')) return;
    const response = await fetch(`/api/dashboard/guild/${encodeURIComponent(selectedGuildId)}/verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) return dashboardNotify('verification', result.error || 'Verify Panel konnte nicht gespeichert werden.', 'error');
    dashboardDirty = false;
    dashboardNotify('verification', 'Verification gespeichert. Blue sendet/aktualisiert jetzt das Panel.', 'success');
  });

  await loadDashboard();
  // Kein automatisches Neuladen im Dashboard: sonst werden gerade bearbeitete Einstellungen zurückgesetzt.
}

initGlobalAuth();
initUnbanPage();
initTicketPage();
initTesterPage();
initDashboardPage();
