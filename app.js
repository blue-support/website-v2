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
