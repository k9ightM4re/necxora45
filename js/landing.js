import { redirectIfAuthenticated } from './session.js';
import { installGlobalErrorShield } from './notifications.js';
import { initThemeSync } from './theme.js';

installGlobalErrorShield();

const DISCOVER_DATA = {
  people: [
    {
      initials: 'AR',
      name: 'Aria Rao',
      badge: 'Verified Creator',
      sub: '@aria.systems · Design Systems & Product Architecture',
    },
    {
      initials: 'DK',
      name: 'Devon Kim',
      badge: 'Verified Member',
      sub: '@devon_ux · Visual Storytelling & Typography',
    },
    {
      initials: 'SN',
      name: 'Sana Nair',
      badge: 'Community Host',
      sub: '@sana_build · Real-Time Voice Rooms & Local Meetups',
    },
  ],
  communities: [
    {
      initials: 'PG',
      name: 'Product Guild',
      badge: 'Public Community',
      sub: 'Design critiques, architectural releases & weekly office hours',
    },
    {
      initials: 'LB',
      name: 'Local Builders Circle',
      badge: 'Nearby · 4.2 km',
      sub: 'Regional founder coffee chats, workshops & peer mentorship',
    },
    {
      initials: 'CR',
      name: 'Creators & Media',
      badge: 'Public Community',
      sub: 'Short-form reels, visual stories & collaborative editing',
    },
  ],
  local: [
    {
      initials: 'DC',
      name: 'Design Craft Meetup',
      badge: 'This Friday · 6:30 PM',
      sub: 'Downtown Studio · Open Q&A and portfolio reviews',
    },
    {
      initials: 'AV',
      name: 'Audio & Video Creators Jam',
      badge: 'Saturday · 2:00 PM',
      sub: 'Media Commons · Live reel editing & soundtrack session',
    },
    {
      initials: 'OS',
      name: 'Open Source Hangout',
      badge: 'Weekly · Virtual + Local',
      sub: 'WebRTC & distributed systems engineering circle',
    },
  ],
};

function initDiscoverTabs() {
  const tabs = Array.from(document.querySelectorAll('[data-discover-tab]'));
  const panel = document.getElementById('discover-panel');
  if (!tabs.length || !panel) return;

  const renderCategory = (key) => {
    const items = DISCOVER_DATA[key] || DISCOVER_DATA.people;
    panel.innerHTML = items
      .map(
        (item) => `
        <div class="discover-row">
          <div class="discover-row-main">
            <div class="identity-avatar-human sm">${item.initials}</div>
            <div>
              <div class="identity-title-line">
                <strong>${item.name}</strong>
                <span class="nx-identity-badge nx-identity-badge--human">${item.badge}</span>
              </div>
              <span class="identity-sub">${item.sub}</span>
            </div>
          </div>
          <a href="/signup.html" class="btn btn-outline">Connect in Nexora</a>
        </div>
      `
      )
      .join('');
  };

  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-discover-tab') || 'people';
      tabs.forEach((t) => {
        const active = t === btn;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', String(active));
      });
      renderCategory(target);
    });
  });
}

const FOOTER_INFO = {
  contact: {
    title: 'Contact Nexora',
    body: `<p>Reach the Nexora team or sign in to message community stewards directly inside the workspace.</p><p>Support &amp; community inquiries: <strong>hello@nexora.network</strong></p>`,
  },
  privacy: {
    title: 'Privacy & Data Stewardship',
    body: `<p>Nexora protects user identity, private contact metadata, and optional Social Circle integrations under explicit user consent.</p><p>You can control who can message you, manage Close Friends or blocked accounts, and export or delete your data from Settings at any time.</p>`,
  },
  terms: {
    title: 'Community & Platform Guidelines',
    body: `<p>Nexora is a human-only social network designed for authentic connection, direct messaging, and real-time communities.</p><p>Impersonation, automated spam, and harassment are strictly moderated.</p>`,
  },
};

function initFooterInfoModal() {
  const modal = document.getElementById('nx-info-modal');
  const titleEl = document.getElementById('nx-info-title');
  const bodyEl = document.getElementById('nx-info-body');
  const closeBtn = document.getElementById('nx-info-close');
  if (!modal || !titleEl || !bodyEl) return;

  const close = () => {
    modal.hidden = true;
  };

  document.querySelectorAll('[data-footer-info]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-footer-info') || 'privacy';
      const data = FOOTER_INFO[key] || FOOTER_INFO.privacy;
      titleEl.textContent = data.title;
      bodyEl.innerHTML = data.body;
      modal.hidden = false;
      closeBtn?.focus();
    });
  });

  closeBtn?.addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });
}

function initLandingPage() {
  initThemeSync();
  redirectIfAuthenticated({ defaultTarget: '/app.html', respectLandingParam: true });
  initDiscoverTabs();
  initFooterInfoModal();

  const mobileBtn = document.getElementById('mobile-menu-toggle');
  const mobileClose = document.getElementById('mobile-menu-close');
  const mobileDrawer = document.getElementById('mobile-drawer');
  if (mobileBtn && mobileDrawer) {
    const setDrawer = (open) => {
      mobileDrawer.hidden = !open;
      mobileBtn.setAttribute('aria-expanded', String(open));
    };
    mobileBtn.addEventListener('click', () => {
      setDrawer(mobileDrawer.hidden);
    });
    mobileClose?.addEventListener('click', () => setDrawer(false));
    mobileDrawer.addEventListener('click', (e) => {
      if (e.target instanceof HTMLAnchorElement) {
        setDrawer(false);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !mobileDrawer.hidden) setDrawer(false);
    });
  }

  document.getElementById('hero-explore-btn')?.addEventListener('click', () => {
    const target = document.getElementById('messaging');
    if (target) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
  });

  const bar = document.getElementById('nx-scroll-progress');
  const navWrap = document.getElementById('site-header');
  const onScroll = () => {
    const doc = document.documentElement;
    if (bar) {
      const max = doc.scrollHeight - doc.clientHeight;
      const ratio = max > 0 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 0;
      bar.style.transform = `scaleX(${ratio})`;
    }
    if (navWrap) {
      navWrap.classList.toggle('is-scrolled', doc.scrollTop > 24);
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

document.addEventListener('DOMContentLoaded', initLandingPage);
