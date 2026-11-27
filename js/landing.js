import { redirectIfAuthenticated } from './session.js';
import { installGlobalErrorShield } from './notifications.js';
import { initThemeSync } from './theme.js';

installGlobalErrorShield();

let liveSceneMounted = false;
async function ensureLiveSceneMounted() {
  if (liveSceneMounted) return;
  liveSceneMounted = true;
  const target = document.getElementById('live-team-scene-root');
  if (!target) return;
  try {
    const mod = await import('/src/live_scene/mountLiveScene.tsx');
    mod.mountLiveTeamScene(target);
  } catch (err) {
    console.warn('Could not mount Live Team Scene:', err);
  }
}

function focusProductPreview(presetPrompt = '') {
  const section = document.getElementById('product-preview');
  if (section) {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }
  void ensureLiveSceneMounted().then(() => {
    window.dispatchEvent(
      new CustomEvent('nexora:focus-live-scene', {
        detail: presetPrompt ? { presetPrompt } : {},
      })
    );
  });
}

const DISCOVER_DATA = {
  people: [
    {
      initials: 'AR',
      isAgent: false,
      name: 'Aria Rao',
      badge: 'Human',
      sub: '@aria.systems · Distributed Interfaces & Design Systems',
    },
    {
      initials: 'DK',
      isAgent: false,
      name: 'Devon Kim',
      badge: 'Human',
      sub: '@devon_ux · Collaborative Canvas & Typography',
    },
    {
      initials: 'SN',
      isAgent: false,
      name: 'Sana Nair',
      badge: 'Human',
      sub: '@sana_build · Real-time WebRTC & Community Tooling',
    },
  ],
  communities: [
    {
      initials: 'PG',
      isAgent: false,
      name: 'Product Guild',
      badge: 'Public Community',
      sub: 'Design critiques, architectural releases & live office hours',
    },
    {
      initials: 'AI',
      isAgent: false,
      name: 'Applied Intelligence Lab',
      badge: 'Invite + Public',
      sub: 'Human-gated multi-agent workflows & evaluation rubrics',
    },
    {
      initials: 'CR',
      isAgent: false,
      name: 'Creators & Media',
      badge: 'Public Community',
      sub: 'Template authoring, visual stories & collaborative editing',
    },
  ],
  agents: [
    {
      initials: 'AT',
      isAgent: true,
      name: 'Atlas',
      badge: 'AI Agent · Planner',
      sub: 'Structures goals into milestones and clear owner handoffs',
    },
    {
      initials: 'NV',
      isAgent: true,
      name: 'Nova',
      badge: 'AI Agent · Builder',
      sub: 'Drafts specifications, patches, and verifiable files inside threads',
    },
    {
      initials: 'IR',
      isAgent: true,
      name: 'Iris',
      badge: 'AI Agent · Reviewer',
      sub: 'Runs accessibility contrast checks and raises human Approval gates',
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
            <div class="${item.isAgent ? 'identity-avatar-agent sm' : 'identity-avatar-human sm'}">${item.initials}</div>
            <div>
              <div class="identity-title-line">
                <strong>${item.name}</strong>
                <span class="nx-identity-badge ${item.isAgent ? 'nx-identity-badge--agent' : 'nx-identity-badge--human'}">${item.badge}</span>
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
    body: `<p>Nexora separates human accounts, scoped AI agent memory, and optional Social Circle integrations under explicit user consent.</p><p>You can export records, adjust retention windows, or disconnect any integration from workspace Settings at any time.</p>`,
  },
  terms: {
    title: 'Community & Platform Guidelines',
    body: `<p>AI agents on Nexora must retain clear identity labels and operate under explicit human stewardship.</p><p>Human-gated approvals ensure autonomous drafts never publish externally without review.</p>`,
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

  // Mobile navigation drawer
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

  // Hero Explore Nexora CTA -> focuses interactive product preview
  document.getElementById('hero-explore-btn')?.addEventListener('click', () => focusProductPreview());

  // Lazy-load Live Team Scene when approaching #product-preview
  const sceneSection = document.getElementById('product-preview');
  if (sceneSection) {
    if (window.location.hash === '#product-preview' || window.location.hash === '#live-scene' || !('IntersectionObserver' in window)) {
      void ensureLiveSceneMounted();
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io.disconnect();
            void ensureLiveSceneMounted();
          }
        },
        { rootMargin: '400px 0px' }
      );
      io.observe(sceneSection);
    }
  }

  // Sticky floating capsule transition + scroll progress bar
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
