(() => {
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

  const config = {
    statsEndpoint: window.BLUE_STATS_ENDPOINT || "/api/stats",
    fallbackStatsEndpoint: "data/teststats.json",
    statusEndpoint: window.BLUE_STATUS_ENDPOINT || "/api/status",
    fallbackStatusEndpoint: "data/teststatus.json"
  };

  const fallbackStats = {
    onlineUsers: 1284,
    guilds: 87,
    commandsToday: 19342,
    latency: 42,
    uptime: "99.98%"
  };

  const fallbackStatus = {
    overall: "online",
    title: "Alle Systeme operational",
    message: "Blue ⚡ läuft stabil. Keine aktiven Störungen.",
    components: [
      { name: "Discord Gateway", status: "online" },
      { name: "Slash Commands", status: "online" },
      { name: "Ticket System", status: "online" },
      { name: "Website", status: "online" },
      { name: "Database", status: "online" }
    ],
    incidents: [
      { title: "Keine aktiven Incidents", date: "2026-06-10", text: "Alle Systeme laufen normal." }
    ]
  };

  function formatNumber(value) {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "number") return new Intl.NumberFormat("de-DE").format(value);
    return String(value);
  }

  function formatStat(key, value) {
    if (key === "latency" && typeof value === "number") return `${value}ms`;
    return formatNumber(value);
  }

  async function fetchJSON(primaryUrl, fallbackUrl, fallbackObject) {
    const urls = [primaryUrl, fallbackUrl].filter(Boolean);
    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (response.ok) return await response.json();
      } catch (_) {
        // Static file previews may block fetch. Fallback is used below.
      }
    }
    return fallbackObject;
  }

  function setHeaderState() {
    const header = $("[data-header]");
    if (!header) return;
    header.classList.toggle("scrolled", window.scrollY > 10);
  }

  function setupNavigation() {
    const toggle = $("[data-nav-toggle]");
    const nav = $("[data-nav]");
    if (!toggle || !nav) return;

    toggle.addEventListener("click", () => {
      nav.classList.toggle("open");
    });

    $$("a", nav).forEach((link) => {
      link.addEventListener("click", () => nav.classList.remove("open"));
    });
  }

  function setupRevealAnimations() {
    const elements = $$(".reveal");
    if (!elements.length) return;

    if (!("IntersectionObserver" in window)) {
      elements.forEach((el) => el.classList.add("in-view"));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });

    elements.forEach((el) => observer.observe(el));
  }

  function setupMagneticButtons() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    $$(".magnetic").forEach((button) => {
      button.addEventListener("mousemove", (event) => {
        const rect = button.getBoundingClientRect();
        const x = event.clientX - rect.left - rect.width / 2;
        const y = event.clientY - rect.top - rect.height / 2;
        button.style.transform = `translate(${x * 0.08}px, ${y * 0.12}px)`;
      });
      button.addEventListener("mouseleave", () => {
        button.style.transform = "translate(0, 0)";
      });
    });
  }

  function setStats(stats) {
    $$('[data-stat]').forEach((el) => {
      const key = el.getAttribute('data-stat');
      el.textContent = formatStat(key, stats[key]);
    });
  }

  function statusLabel(status) {
    const labels = {
      online: "Online",
      degraded: "Teilweise gestört",
      offline: "Offline"
    };
    return labels[status] || "Unbekannt";
  }

  function componentLabel(status) {
    const labels = {
      online: "Operational",
      degraded: "Degraded",
      offline: "Offline"
    };
    return labels[status] || "Unknown";
  }

  function applyStatus(status) {
    const state = status.overall || "online";
    const badges = $$('[data-status-badge]');
    badges.forEach((badge) => {
      badge.textContent = statusLabel(state);
      badge.classList.remove("online", "degraded", "offline");
      badge.classList.add(state);
    });

    const label = $('[data-status-label]');
    if (label) label.textContent = status.title || componentLabel(state);

    const title = $('[data-status-title]');
    if (title) title.textContent = status.title || "Status unbekannt";

    const message = $('[data-status-message]');
    if (message) message.textContent = status.message || "Keine Statusmeldung vorhanden.";

    const orb = $('[data-status-orb]');
    if (orb) {
      orb.classList.remove("online", "degraded", "offline");
      orb.classList.add(state);
    }

    const componentRoot = $('[data-components]');
    if (componentRoot && Array.isArray(status.components)) {
      componentRoot.innerHTML = status.components.map((component) => `
        <article class="component-row ${component.status || "online"}">
          <span>${escapeHTML(component.name || "Service")}</span>
          <strong>${componentLabel(component.status || "online")}</strong>
        </article>
      `).join("");
    }

    const incidentRoot = $('[data-incidents]');
    if (incidentRoot && Array.isArray(status.incidents)) {
      incidentRoot.innerHTML = status.incidents.map((incident) => `
        <article class="incident-card">
          <strong>${escapeHTML(incident.title || "Update")}</strong>
          <p>${escapeHTML(incident.date || "")}${incident.date ? " · " : ""}${escapeHTML(incident.text || "")}</p>
        </article>
      `).join("");
    }
  }

  function escapeHTML(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setupCanvasFX() {
    const canvas = $("#fx-canvas");
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = canvas.getContext("2d");
    let width = 0;
    let height = 0;
    let particles = [];
    let pointer = { x: -9999, y: -9999 };

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const amount = Math.min(80, Math.max(36, Math.floor(width / 18)));
      particles = Array.from({ length: amount }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: Math.random() * 1.8 + 0.6
      }));
    }

    function tick() {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "rgba(132, 223, 255, 0.72)";
      ctx.strokeStyle = "rgba(96, 154, 255, 0.16)";
      ctx.lineWidth = 1;

      particles.forEach((p) => {
        const dx = p.x - pointer.x;
        const dy = p.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 140) {
          p.vx += (dx / distance) * 0.02;
          p.vy += (dy / distance) * 0.02;
        }

        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.995;
        p.vy *= 0.995;

        if (p.x < -20) p.x = width + 20;
        if (p.x > width + 20) p.x = -20;
        if (p.y < -20) p.y = height + 20;
        if (p.y > height + 20) p.y = -20;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      });

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (distance < 120) {
            ctx.globalAlpha = 1 - distance / 120;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
      }

      requestAnimationFrame(tick);
    }

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    });
    window.addEventListener("pointerleave", () => {
      pointer.x = -9999;
      pointer.y = -9999;
    });
    resize();
    tick();
  }

  async function initData() {
    const [stats, status] = await Promise.all([
      fetchJSON(config.statsEndpoint, config.fallbackStatsEndpoint, fallbackStats),
      fetchJSON(config.statusEndpoint, config.fallbackStatusEndpoint, fallbackStatus)
    ]);
    setStats({ ...fallbackStats, ...stats });
    applyStatus({ ...fallbackStatus, ...status });
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupNavigation();
    setupRevealAnimations();
    setupMagneticButtons();
    setupCanvasFX();
    initData();
    setHeaderState();
    window.addEventListener("scroll", setHeaderState, { passive: true });
  });
})();
