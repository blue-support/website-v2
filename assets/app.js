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

  authSlots.forEach((slot) => {
    const returnPath = slot.dataset.authReturn || (window.location.pathname || '/index.html');
    if (!auth.loggedIn || !auth.user) {
      slot.innerHTML = `<a class="nav-login" href="/auth/discord?return=${encodeURIComponent(returnPath)}">Discord Login</a>`;
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

  let selectedType = null;
  let state = null;
  let loggedIn = false;
  let ticketAccess = { ready: false, hasPremium: false };

  function showMessage(text, type = 'info') {
    if (!message) return;
    message.hidden = false;
    message.className = `notice-card ${type}`;
    message.textContent = text;
  }

  function setLoginRequiredState() {
    choices.hidden = false;
    form.hidden = true;
    if (historyBox) historyBox.hidden = true;
    ['discord', 'global'].forEach((type) => {
      const infoBox = $(`[data-ban-info="${type}"]`);
      if (infoBox) {
        infoBox.innerHTML = '<strong>Status:</strong> Login erforderlich<br><strong>Hinweis:</strong> Melde dich oben rechts mit Discord an, damit wir deinen Ban-Status prüfen können.';
      }
      const choice = $(`[data-unban-choice="${type}"]`);
      const btn = $(`[data-select-unban="${type}"]`);
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
    choices.hidden = false;
    if (message) message.hidden = true;

    ['discord', 'global'].forEach((type) => {
      const banInfo = data.banInfo?.[type];
      const isChecked = banInfo?.checked === true;
      const isBanned = banInfo?.banned === true;
      const infoBox = $(`[data-ban-info="${type}"]`);
      if (infoBox) infoBox.innerHTML = formatBanPanel(banInfo);
      const choice = $(`[data-unban-choice="${type}"]`);
      const btn = $(`[data-select-unban="${type}"]`);
      const pending = data.pending?.[type];
      const disabled = Boolean(pending) || !isChecked || !isBanned;
      if (choice) {
        choice.classList.toggle('disabled', disabled);
        choice.classList.toggle('not-banned', isChecked && !isBanned);
      }
      if (btn) {
        btn.disabled = disabled;
        btn.setAttribute('aria-disabled', String(disabled));
        if (pending) {
          btn.textContent = 'Bereits in Bearbeitung';
        } else if (!isChecked) {
          btn.textContent = 'Ban-Status wird geprüft';
        } else if (!isBanned) {
          btn.textContent = 'Kein Ban gefunden';
        } else {
          btn.textContent = type === 'discord' ? 'Discord Unban wählen' : 'Global Unban wählen';
        }
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
      if (!loggedIn) return;
      selectedType = button.dataset.selectUnban;
      const pending = state?.pending?.[selectedType];
      const banInfo = state?.banInfo?.[selectedType];
      if (pending) return showMessage('Du hast bereits einen Antrag in Bearbeitung.', 'warn');
      if (!banInfo?.checked) return showMessage('Dein Ban-Status wird noch geprüft. Bitte warte kurz und lade die Seite neu.', 'warn');
      if (!banInfo?.banned) return showMessage('Für diesen Bereich wurde kein aktiver Ban gefunden. Deshalb kannst du keinen Unban-Antrag senden.', 'warn');
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
    if (!loggedIn) return showMessage('Bitte melde dich zuerst oben rechts mit Discord an.', 'warn');
    if (!selectedType) return showMessage('Bitte wähle zuerst Discord Unban oder Global Unban.', 'warn');
    const banInfo = state?.banInfo?.[selectedType];
    if (!banInfo?.checked) return showMessage('Dein Ban-Status wird noch geprüft. Bitte warte kurz und versuche es erneut.', 'warn');
    if (!banInfo?.banned) return showMessage('Für diesen Bereich wurde kein aktiver Ban gefunden. Ein Unban-Antrag ist deshalb nicht möglich.', 'warn');
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
  setInterval(refreshData, 30000);
}



function discordAvatarUrl(user) {
  if (!user) return '';
  if (user.avatar && String(user.avatar).startsWith('http')) return user.avatar;
  if (user.avatar && user.id) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=96`;
  return '';
}

function ticketTypeLabel(type) {
  return type === 'head' ? 'Leitung' : 'Allgemeiner Support';
}

function ticketStatusLabel(status) {
  const labels = { pending_channel: 'Kanal wird erstellt', open: 'Offen', closed: 'Geschlossen' };
  return labels[status] || status || 'Unbekannt';
}

function ticketRankClass(rank) {
  const normalized = String(rank || '').trim().toLowerCase();
  if (normalized === 'ceo') return 'ceo';
  if (normalized === 'administrator') return 'administrator';
  if (normalized === 'moderator') return 'moderator';
  return 'default';
}

function renderTicketMessage(message) {
  const type = message.authorType || 'system';
  const author = message.author || {};
  const name = type === 'system' ? 'Blue System' : (author.global_name || author.name || author.username || 'Unbekannt');
  const avatar = discordAvatarUrl(author);
  const initial = name.slice(0, 1).toUpperCase() || '⚡';
  const attachments = Array.isArray(message.attachments) && message.attachments.length
    ? `<div class="ticket-attachments">${message.attachments.map((file) => `<a class="ticket-attachment" href="${escapeHtml(file.url)}" target="_blank" rel="noopener">📎 ${escapeHtml(file.originalName || file.filename || 'Datei')}</a>`).join('')}</div>`
    : '';
  if (type === 'system') {
    return `<div class="ticket-message system"><p>${escapeHtml(message.text || '')}</p><small>${escapeHtml(new Date(message.createdAt).toLocaleString('de-DE'))}</small>${attachments}</div>`;
  }
  const rank = type === 'staff' && author.rank
    ? `<span class="ticket-rank-badge ${ticketRankClass(author.rank)}">${escapeHtml(author.rank)}</span>`
    : '';
  return `<div class="ticket-message ${type === 'user' ? 'user' : 'staff'}"><div class="ticket-message-head"><span class="ticket-message-avatar">${avatar ? `<img src="${escapeHtml(avatar)}" alt="">` : escapeHtml(initial)}</span><div><div class="ticket-message-author">${escapeHtml(name)}${rank}</div><div class="ticket-message-time">${escapeHtml(new Date(message.createdAt).toLocaleString('de-DE'))}</div></div></div>${message.text ? `<p>${escapeHtml(message.text)}</p>` : ''}${attachments}</div>`;
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
  let ticketAccess = { ready: false, hasPremium: false };

  function showTicketMessage(text, type = 'info') {
    if (!messageBox) return;
    messageBox.hidden = false;
    messageBox.className = `notice-card ${type}`;
    messageBox.textContent = text;
  }

  function clearTicketMessage() {
    if (messageBox) messageBox.hidden = true;
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
    const allowed = Boolean(ticketAccess.ready && ticketAccess.hasPremium);
    $$('[data-open-ticket-form]').forEach((button) => {
      const type = button.dataset.openTicketForm;
      if (!ticketAccess.ready) setTicketButtonState(button, 'Premium wird geprüft', true);
      else if (!ticketAccess.hasPremium) setTicketButtonState(button, 'Blue Premium benötigt', true);
      else setTicketButtonState(button, type === 'head' ? 'Leitung kontaktieren' : 'Allgemeinen Support öffnen', false);
    });
    $$('.ticket-choice').forEach((card) => {
      card.classList.toggle('locked', !allowed);
      card.classList.toggle('premium-required', ticketAccess.ready && !ticketAccess.hasPremium);
      card.classList.toggle('checking-premium', !ticketAccess.ready);
      const existing = card.querySelector('.ticket-premium-lock');
      if (!allowed) renderPremiumLockBadge(card, ticketAccess.ready ? 'Blue Premium benötigt' : 'Premium wird geprüft');
      else if (existing) existing.remove();
    });
    if (createForm && !allowed) {
      createForm.hidden = true;
      selectedCategory = null;
    }
    if (!ticketAccess.ready) showTicketMessage(ticketAccess.message || 'Premium-Rolle wird geprüft. Bitte warte kurz.', 'warn');
    else if (!ticketAccess.hasPremium) showTicketMessage(ticketAccess.message || 'Blue Premium benötigt: Du brauchst die Premium-Rolle auf dem Server, um Tickets zu öffnen.', 'error');
    else clearTicketMessage();
  }

  function openTicket(ticket) {
    activeTicketId = ticket.id;
    if (empty) empty.hidden = true;
    if (chat) chat.hidden = false;
    if (chatTitle) chatTitle.textContent = `#${ticket.channelName || ticket.id}`;
    if (chatType) chatType.textContent = ticketTypeLabel(ticket.type);
    if (chatStatus) {
      const base = `${ticketStatusLabel(ticket.status)} · erstellt am ${new Date(ticket.createdAt).toLocaleString('de-DE')}`;
      chatStatus.textContent = ticket.status === 'closed' && ticket.deleteAt
        ? `${base} · wird gelöscht am ${new Date(ticket.deleteAt).toLocaleString('de-DE')}`
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
  }

  function renderTicketList(tickets) {
    if (!ticketList) return;
    if (!tickets.length) {
      ticketList.innerHTML = '<p class="muted">Du hast aktuell kein Ticket.</p>';
      return;
    }
    ticketList.innerHTML = tickets.map((ticket) => `<button class="ticket-list-item" type="button" data-ticket-id="${escapeHtml(ticket.id)}"><strong>${escapeHtml(ticketTypeLabel(ticket.type))}</strong><small>${escapeHtml(ticketStatusLabel(ticket.status))} · ${escapeHtml(new Date(ticket.createdAt).toLocaleString('de-DE'))}</small></button>`).join('');
    $$('[data-ticket-id]', ticketList).forEach((button) => {
      button.addEventListener('click', () => {
        const ticket = tickets.find((item) => item.id === button.dataset.ticketId);
        if (ticket) openTicket(ticket);
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
    const tickets = Array.isArray(data.tickets) ? data.tickets : [];
    renderTicketList(tickets);
    let ticket = keepActive && activeTicketId ? tickets.find((item) => item.id === activeTicketId) : null;
    if (!ticket && tickets.length) ticket = tickets[0];
    if (ticket) openTicket(ticket);
  }

  $$('[data-open-ticket-form]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!loggedIn) return showTicketMessage('Bitte melde dich oben rechts mit Discord an.', 'warn');
      if (!ticketAccess.ready) return showTicketMessage(ticketAccess.message || 'Premium-Rolle wird noch geprüft.', 'warn');
      if (!ticketAccess.hasPremium) return showTicketMessage(ticketAccess.message || 'Blue Premium benötigt: Blue Premium benötigt: Blue Premium benötigt: Du brauchst die Premium-Rolle, um Tickets zu öffnen.', 'error');
      selectedCategory = button.dataset.openTicketForm;
      if (createForm) createForm.hidden = false;
      $('[data-ticket-form-type]').textContent = selectedCategory === 'head' ? 'Leitung kontaktieren' : 'Allgemeiner Support';
      $('[data-ticket-reason-label]').childNodes[0].textContent = selectedCategory === 'head' ? 'Warum möchtest du die Leitung kontaktieren?' : 'Warum möchtest du ein Ticket öffnen?';
      createForm?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  $('[data-ticket-form-cancel]')?.addEventListener('click', () => {
    if (createForm) createForm.hidden = true;
    selectedCategory = null;
  });

  createForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedCategory) return showTicketMessage('Bitte wähle zuerst eine Kategorie.', 'warn');
    if (!ticketAccess.ready || !ticketAccess.hasPremium) return showTicketMessage(ticketAccess.message || 'Blue Premium benötigt: Blue Premium benötigt: Blue Premium benötigt: Du brauchst die Premium-Rolle, um Tickets zu öffnen.', 'error');
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
    activeTicketId = result.ticket?.id || null;
    showTicketMessage('Dein Ticket wurde erstellt. Der Bot legt gerade den Discord-Kanal an.', 'success');
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
  const form = $('[data-dashboard-verify-form]');
  const soon = $('[data-dashboard-soon]');
  let selectedGuildId = null;
  let selectedGuildData = null;
  let access = null;

  function showDashboardMessage(text, type = 'info') {
    if (!messageBox) return;
    messageBox.hidden = false;
    messageBox.className = `notice-card ${type}`;
    messageBox.textContent = text;
  }

  function clearDashboardMessage() {
    if (messageBox) messageBox.hidden = true;
  }

  function setWorkspaceVisible(visible) {
    if (empty) empty.hidden = visible;
    if (workspace) workspace.hidden = !visible;
  }

  function renderServers(guilds) {
    if (!serverList) return;
    if (!guilds.length) {
      serverList.innerHTML = '<p class="muted">Keine gemeinsamen verwaltbaren Server gefunden. Prüfe, ob du mit Discord eingeloggt bist, Blue auf dem Server ist und du Server verwalten darfst.</p>';
      return;
    }
    serverList.innerHTML = guilds.map((guild) => {
      const icon = discordGuildIconUrl(guild);
      const initial = (guild.name || '?').slice(0, 1).toUpperCase();
      return `<button class="dashboard-server-card" type="button" data-dashboard-guild="${escapeHtml(guild.id)}"><span class="server-icon">${icon ? `<img src="${escapeHtml(icon)}" alt="">` : escapeHtml(initial)}</span><span><strong>${escapeHtml(guild.name)}</strong><small>${formatValue(guild.memberCount)} Mitglieder</small></span></button>`;
    }).join('');
  }

  function renderGuildConfig(data) {
    selectedGuildData = data.guild;
    access = data.access || { checked: false, hasPremiumFooter: false };
    $('[data-dashboard-server-name]').textContent = selectedGuildData.name || 'Server';
    $('[data-dashboard-server-meta]').textContent = `${formatValue(selectedGuildData.memberCount)} Mitglieder · ${access.checked ? (access.canManage ? 'Zugriff bestätigt' : 'Zugriff wird geprüft') : 'Zugriff wird geprüft'}`;
    const roles = (selectedGuildData.roles || []).filter((role) => !role.managed && !role.default).sort((a, b) => (b.position || 0) - (a.position || 0));
    const channels = (selectedGuildData.channels || []).filter((channel) => ['text', 'news', 'forum'].includes(channel.type));
    $('[data-dashboard-add-roles]').innerHTML = dashboardSelectOptions(roles, data.verification?.addRoleIds || data.verification?.role_ids || []);
    $('[data-dashboard-remove-roles]').innerHTML = dashboardSelectOptions(roles, data.verification?.removeRoleIds || data.verification?.remove_role_ids || []);
    $('[data-dashboard-channel-select]').innerHTML = dashboardSelectOptions(channels, [data.verification?.channelId || data.verification?.channel_id].filter(Boolean));
    if (data.verification?.mode) {
      const modeInput = form.querySelector(`[name="mode"][value="${data.verification.mode}"]`);
      if (modeInput) modeInput.checked = true;
    }
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
    const authResponse = await fetch('/api/auth/me', { cache: 'no-store' });
    const auth = await authResponse.json();
    if (!auth.loggedIn) {
      setWorkspaceVisible(false);
      if (serverList) serverList.innerHTML = '<p class="muted">Bitte oben rechts mit Discord einloggen.</p>';
      showDashboardMessage('Discord Login erforderlich, um dein Dashboard zu öffnen.', 'warn');
      return;
    }
    const response = await fetch('/api/dashboard/me', { cache: 'no-store' });
    const data = await response.json();
    renderServers(data.guilds || []);
    clearDashboardMessage();
    $$('[data-dashboard-guild]', serverList).forEach((button) => {
      button.addEventListener('click', async () => {
        selectedGuildId = button.dataset.dashboardGuild;
        $$('.dashboard-server-card', serverList).forEach((node) => node.classList.toggle('active', node === button));
        setWorkspaceVisible(true);
        await loadGuild(selectedGuildId);
      });
    });
  }

  async function loadGuild(guildId) {
    showDashboardMessage('Serverdaten werden geladen...', 'info');
    const response = await fetch(`/api/dashboard/guild/${encodeURIComponent(guildId)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      showDashboardMessage(data.error || 'Server konnte nicht geladen werden.', 'error');
      return;
    }
    clearDashboardMessage();
    renderGuildConfig(data);
  }

  function updateVerifyPreview() {
    if (!form) return;
    const title = form.querySelector('[name="title"]')?.value || '✅ Verifizierung erforderlich';
    const description = form.querySelector('[name="description"]')?.value || '';
    const color = form.querySelector('[name="color"]')?.value || '#22c55e';
    const image = form.querySelector('[name="image"]')?.value || form.querySelector('[name="thumbnail"]')?.value || '';
    const footer = form.querySelector('[name="footer"]')?.value || 'Powered by Blue ⚡';
    $('[data-verify-preview-title]').textContent = title;
    $('[data-verify-preview-description]').textContent = description;
    $('[data-verify-preview-footer]').textContent = footer;
    const media = $('[data-verify-preview-media]');
    if (media) {
      media.style.borderColor = color;
      media.innerHTML = image ? `<img src="${escapeHtml(image)}" alt="Embed Vorschau">` : 'Embed Image / Thumbnail';
    }
  }

  form?.addEventListener('input', updateVerifyPreview);
  $('[data-dashboard-refresh]')?.addEventListener('click', async () => {
    if (selectedGuildId) await loadGuild(selectedGuildId);
  });

  $$('[data-dashboard-section]').forEach((button) => {
    button.addEventListener('click', () => {
      const section = button.dataset.dashboardSection;
      $$('[data-dashboard-section]').forEach((node) => node.classList.toggle('active', node === button));
      if (section === 'verification') {
        if (form) form.hidden = false;
        if (soon) soon.hidden = true;
      } else {
        if (form) form.hidden = true;
        if (soon) {
          soon.hidden = false;
          soon.querySelector('h3').textContent = `${button.querySelector('strong')?.textContent || 'Dieses System'} · Bald...`;
        }
      }
    });
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedGuildId) return showDashboardMessage('Bitte wähle zuerst einen Server.', 'warn');
    const formData = new FormData(form);
    const addRoleIds = Array.from(form.querySelector('[name="addRoleIds"]').selectedOptions).map((option) => option.value);
    const removeRoleIds = Array.from(form.querySelector('[name="removeRoleIds"]').selectedOptions).map((option) => option.value);
    const payload = {
      mode: formData.get('mode'),
      addRoleIds,
      removeRoleIds,
      channelId: formData.get('channelId'),
      embed: {
        title: formData.get('title'),
        description: formData.get('description'),
        thumbnail: formData.get('thumbnail'),
        image: formData.get('image'),
        color: formData.get('color'),
        footer: formData.get('footer')
      }
    };
    const response = await fetch(`/api/dashboard/guild/${encodeURIComponent(selectedGuildId)}/verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) return showDashboardMessage(result.error || 'Verify Panel konnte nicht gespeichert werden.', 'error');
    showDashboardMessage('Verify Panel wird vom Bot gesendet. Das kann ein paar Sekunden dauern.', 'success');
    setTimeout(() => selectedGuildId && loadGuild(selectedGuildId).catch(() => null), 2500);
  });

  await loadDashboard();
  setInterval(() => {
    if (selectedGuildId) loadGuild(selectedGuildId).catch(() => null);
  }, 30000);
}

initGlobalAuth();
initUnbanPage();
initTicketPage();
initDashboardPage();
