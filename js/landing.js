import { redirectIfAuthenticated } from './session.js';
import { installGlobalErrorShield } from './notifications.js';
import { initThemeSync } from './theme.js';

installGlobalErrorShield();

const DEVICE_PREVIEW_DATA = {
  social: `
    <article class="nx-preview-card">
      <div class="nx-preview-head">
        <div class="nx-avatar-circle" aria-hidden="true">ML</div>
        <div>
          <strong class="nx-preview-author">Maya Lin</strong>
          <span class="nx-preview-meta">Design Studio Circle · 12m ago</span>
        </div>
      </div>
      <p class="nx-preview-text">
        Shared our autumn print typography guide in the studio thread and opened peer notes for tonight’s review session.
      </p>
      <div class="nx-preview-footer">
        <span>24 likes</span>
        <span aria-hidden="true">·</span>
        <span>6 replies</span>
        <span aria-hidden="true">·</span>
        <span>Saved to bookmarks</span>
      </div>
    </article>
    <div class="nx-preview-split">
      <div class="nx-preview-mini">
        <span class="material-symbols-outlined nx-mini-icon" aria-hidden="true">chat_bubble_outline</span>
        <div>
          <strong>Direct messages</strong>
          <span>Liam Patel: Audio huddle starts in 5 minutes.</span>
        </div>
      </div>
      <div class="nx-preview-mini">
        <span class="material-symbols-outlined nx-mini-icon" aria-hidden="true">storefront</span>
        <div>
          <strong>Partner store drop</strong>
          <span>Linen Sketchbook Folio · Studio Press</span>
        </div>
      </div>
    </div>
  `,
  shop: `
    <article class="nx-preview-card">
      <div class="nx-preview-head">
        <div class="nx-avatar-circle" aria-hidden="true">SP</div>
        <div>
          <strong class="nx-preview-author">Studio Press Bookstore</strong>
          <span class="nx-preview-meta">Verified partner store · Stationery &amp; Print</span>
        </div>
      </div>
      <p class="nx-preview-text">
        Linen Hardcover Sketchbook &amp; Brass Pen Set — curated for architecture and design studio students with campus pickup.
      </p>
      <div class="nx-preview-footer">
        <span>$34.00</span>
        <span aria-hidden="true">·</span>
        <span>In stock</span>
        <span aria-hidden="true">·</span>
        <span>Direct store chat</span>
      </div>
    </article>
    <div class="nx-preview-split">
      <div class="nx-preview-mini">
        <span class="material-symbols-outlined nx-mini-icon" aria-hidden="true">bookmark_border</span>
        <div>
          <strong>Saved lookbook</strong>
          <span>3 items saved from partner stores</span>
        </div>
      </div>
      <div class="nx-preview-mini">
        <span class="material-symbols-outlined nx-mini-icon" aria-hidden="true">image_search</span>
        <div>
          <strong>Visual search</strong>
          <span>Match styles directly from any photo</span>
        </div>
      </div>
    </div>
  `,
  learn: `
    <article class="nx-preview-card">
      <div class="nx-preview-head">
        <div class="nx-avatar-circle" aria-hidden="true">OA</div>
        <div>
          <strong class="nx-preview-author">Oakridge Humanities Seminar</strong>
          <span class="nx-preview-meta">Verified school space · 28 students</span>
        </div>
      </div>
      <p class="nx-preview-text">
        Week 6 reading packet and peer discussion questions are pinned. Evening voice study room opens at 7:00 PM.
      </p>
      <div class="nx-preview-footer">
        <span>14 members online</span>
        <span aria-hidden="true">·</span>
        <span>Notes shared</span>
        <span aria-hidden="true">·</span>
        <span>Study room</span>
      </div>
    </article>
    <div class="nx-preview-split">
      <div class="nx-preview-mini">
        <span class="material-symbols-outlined nx-mini-icon" aria-hidden="true">event</span>
        <div>
          <strong>Campus meetup</strong>
          <span>Library Courtyard · Friday 4:30 PM</span>
        </div>
      </div>
      <div class="nx-preview-mini">
        <span class="material-symbols-outlined nx-mini-icon" aria-hidden="true">verified_user</span>
        <div>
          <strong>School verified</strong>
          <span>Domain-gated faculty &amp; student space</span>
        </div>
      </div>
    </div>
  `,
};

const FLOW_STEPS = [
  {
    label: 'Social · Direct Thread',
    meta: 'Today · 4:15 PM',
    title: 'Architecture reading group',
    body: '“Uploaded the annotated chapter PDF and pinned the discussion prompts for Thursday’s studio critique.”',
    row1Left: '14 classmates active',
    row1Right: 'Study room open',
    row2Left: 'Message requests',
    row2Right: 'Filtered to contacts',
  },
  {
    label: 'Shop · Partner Store',
    meta: 'Curated drop',
    title: 'Studio Press & Co.',
    body: '“Drafting pencils, archival sketchbooks, and campus apparel ships same-day from our verified partner store.”',
    row1Left: 'Partner merchant',
    row1Right: 'Verified storefront',
    row2Left: 'Order questions',
    row2Right: 'Direct seller thread',
  },
  {
    label: 'Learn · Campus Space',
    meta: 'Verified school',
    title: 'Autumn Term Study Circles',
    body: '“Every course channel connects class announcements, peer notes, and quiet evening study rooms.”',
    row1Left: 'Access control',
    row1Right: 'School email verified',
    row2Left: 'Moderation',
    row2Right: 'Faculty & lead tools',
  },
];

const FOOTER_INFO = {
  contact: {
    title: 'Contact Nexora',
    body: '<p>Reach the Nexora team for account support, partner store onboarding, or school verification.</p><p>Email: <strong>hello@nexora.network</strong></p>',
  },
  privacy: {
    title: 'Privacy & Messaging Controls',
    body: '<p>Nexora separates incoming message requests from your main inbox and keeps your profile visibility under your control.</p><p>You can manage Close Friends, mute threads, block accounts, or export your data from Settings at any time.</p>',
  },
  terms: {
    title: 'Community Guidelines',
    body: '<p>Nexora is built for authentic people, trusted partner stores, and verified school communities.</p><p>Impersonation, automated spam, and harassment are strictly moderated across all spaces.</p>',
  },
};

function initPreviewTabs() {
  const tabs = Array.from(document.querySelectorAll('[data-preview-tab]'));
  const body = document.getElementById('nx-device-preview');
  if (!tabs.length || !body) return;

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const key = tab.getAttribute('data-preview-tab') || 'social';
      tabs.forEach((btn) => {
        const active = btn === tab;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-selected', String(active));
      });
      body.innerHTML = DEVICE_PREVIEW_DATA[key] || DEVICE_PREVIEW_DATA.social;
    });
  });
}

function initFlowSteps() {
  const stepBtns = Array.from(document.querySelectorAll('[data-flow-step]'));
  const display = document.getElementById('nx-flow-display');
  if (!stepBtns.length || !display) return;

  stepBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-flow-step') || 0);
      const data = FLOW_STEPS[idx] || FLOW_STEPS[0];
      stepBtns.forEach((b) => {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', String(active));
      });
      display.innerHTML = `
        <div class="nx-flow-head">
          <span class="nx-flow-label">${data.label}</span>
          <span class="nx-flow-meta tabular">${data.meta}</span>
        </div>
        <h3 class="nx-headline-md">${data.title}</h3>
        <p class="nx-body-md">${data.body}</p>
        <div class="nx-flow-items">
          <div class="nx-flow-row">
            <span>${data.row1Left}</span>
            <span>${data.row1Right}</span>
          </div>
          <div class="nx-flow-row">
            <span>${data.row2Left}</span>
            <span>${data.row2Right}</span>
          </div>
        </div>
      `;
    });
  });
}

function initFaqAccordion() {
  const triggers = Array.from(document.querySelectorAll('.nx-accordion-trigger'));
  triggers.forEach((btn) => {
    btn.addEventListener('click', () => {
      const panelId = btn.getAttribute('aria-controls');
      const panel = panelId ? document.getElementById(panelId) : null;
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      if (panel) panel.hidden = expanded;
    });
  });
}

function initSchoolForm() {
  const form = document.getElementById('nx-school-form');
  const feedback = document.getElementById('nx-school-feedback');
  if (!(form instanceof HTMLFormElement) || !feedback) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const schoolInput = document.getElementById('school-name');
    const emailInput = document.getElementById('school-email');
    const schoolName = schoolInput instanceof HTMLInputElement ? schoolInput.value.trim() : '';
    const adminEmail = emailInput instanceof HTMLInputElement ? emailInput.value.trim() : '';

    if (!schoolName) {
      feedback.textContent = 'Please enter your school or university name.';
      feedback.classList.add('is-error');
      feedback.hidden = false;
      schoolInput?.focus();
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      feedback.textContent = 'Please enter a valid school administrator email address.';
      feedback.classList.add('is-error');
      feedback.hidden = false;
      emailInput?.focus();
      return;
    }

    feedback.classList.remove('is-error');
    feedback.textContent = `Request received for ${schoolName}. We will contact ${adminEmail} with campus verification steps.`;
    feedback.hidden = false;
    form.reset();
  });
}

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
  initPreviewTabs();
  initFlowSteps();
  initFaqAccordion();
  initSchoolForm();
  initFooterInfoModal();

  const mobileBtn = document.getElementById('mobile-menu-toggle');
  const mobileDrawer = document.getElementById('mobile-drawer');
  if (mobileBtn && mobileDrawer) {
    const setDrawer = (open) => {
      mobileDrawer.hidden = !open;
      mobileBtn.setAttribute('aria-expanded', String(open));
    };
    mobileBtn.addEventListener('click', () => {
      setDrawer(mobileDrawer.hidden);
    });
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
    const target = document.getElementById('pillars');
    if (target) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
  });

  const navWrap = document.getElementById('site-header');
  const onScroll = () => {
    if (navWrap) {
      navWrap.classList.toggle('is-scrolled', document.documentElement.scrollTop > 16);
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

document.addEventListener('DOMContentLoaded', initLandingPage);
