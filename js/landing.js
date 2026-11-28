import {
  signInWithPopup,
  sendSignInLinkToEmail,
  onAuthStateChanged,
  signOut,
} from 'firebase/auth';
import { auth, googleProvider } from './firebase.js';
import { ensureUserProfile } from './profile.js';
import { redirectIfAuthenticated, verifySessionWithServer, getPostAuthDestination } from './session.js';
import { formatFriendlyError, installGlobalErrorShield, notifyUser } from './notifications.js';
import {
  clearLocalSession,
  getCachedLocalSession,
  loginLocalAccount,
  registerLocalAccount,
  restoreLocalSessionFromServer,
  subscribeLocalAuthChange,
} from './local_session.js';

installGlobalErrorShield();

const FOOTER_INFO = {
  contact: {
    title: 'Contact Nexora',
    body: '<p>Reach the Nexora team for account support, partner store onboarding, or school verification.</p><p>Email: <strong>hello@nexora.network</strong></p>',
  },
  privacy: {
    title: 'Privacy & Messaging Controls',
    body: '<p>Nexora separates incoming message requests from your main inbox and keeps your profile visibility and try-on photos private by default.</p><p>You can toggle Discoverable or Invisible nearby discovery in one tap at any time.</p>',
  },
  terms: {
    title: 'Community Guidelines',
    body: '<p>Nexora is built for authentic people, trusted partner stores, and verified school communities.</p><p>Impersonation, automated spam, and harassment are strictly moderated across all spaces.</p>',
  },
};

const PRICING_DATA = {
  monthly: {
    personal: {
      title: 'Personal',
      price: '$0<span>/month</span>',
      desc: 'Reels, direct messages, nearby discovery, and public Learn study circles.',
      cta: 'Select Personal',
    },
    creator: {
      title: 'Creator Studio',
      price: '$9<span>/mo</span>',
      desc: 'Built for active creators and stylists curating lookbooks and audio rooms.',
      cta: 'Select Creator Studio',
    },
    partner: {
      title: 'Partner Store',
      price: '$24<span>/mo</span>',
      desc: 'Designed for independent clothing brands hosting live catalog try-ons.',
      cta: 'Select Partner Store',
    },
    campus: {
      title: 'Campus & Schools',
      price: 'Custom',
      desc: 'Domain-verified class groups, faculty moderation, and campus spaces.',
      cta: 'Register your school',
    },
  },
  ppv: {
    personal: {
      title: 'Personal',
      price: '$0<span>/visit</span>',
      desc: 'Browse public circles, partner storefronts, and campus updates at zero cost.',
      cta: 'Select Free Browsing',
    },
    creator: {
      title: '25 Try-On Pack',
      price: '$4<span>/pack</span>',
      desc: 'Pay-per-view bundle of 25 virtual studio fitting-room renders with no monthly fee.',
      cta: 'Select 25 Try-On Pack',
    },
    partner: {
      title: '100 Store Pack',
      price: '$12<span>/pack</span>',
      desc: 'Prepaid 100 try-on renders for seasonal drops and independent store campaigns.',
      cta: 'Select 100 Store Pack',
    },
    campus: {
      title: 'Campus Allocation',
      price: 'Custom',
      desc: 'Pooled pay-as-you-go campus credits for design labs and student orgs.',
      cta: 'Register your school',
    },
  },
};

const LANDING_THEME_KEY = 'nexora_landing_theme';
let landingAuthBusy = false;
let currentSignedInUser = null;
let deferredAppPrompt = null;
let appInstalledOnDevice = false;

function getCurrentLandingTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function withThemeQuery(rawHref, theme = getCurrentLandingTheme()) {
  try {
    const url = new URL(rawHref, window.location.origin);
    url.searchParams.set('theme', theme === 'light' ? 'light' : 'dark');
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return rawHref;
  }
}

function syncThemedAuthLinks(theme = getCurrentLandingTheme()) {
  document.querySelectorAll('[data-auth-themed-link]').forEach((anchor) => {
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const baseHref = anchor.dataset.baseHref || anchor.getAttribute('href') || '/login.html';
    if (!anchor.dataset.baseHref) {
      anchor.dataset.baseHref = baseHref;
    }
    anchor.setAttribute('href', withThemeQuery(anchor.dataset.baseHref, theme));
  });
}

function morphButtonState(btn, state, { label, icon, spin = false, restoreAfterMs = 0 } = {}) {
  if (!(btn instanceof HTMLElement)) return;
  if (!btn.dataset.polyDefaultHtml) {
    btn.dataset.polyDefaultHtml = btn.innerHTML;
  }

  if (btn._polyRestoreTimer) {
    clearTimeout(btn._polyRestoreTimer);
    btn._polyRestoreTimer = null;
  }

  if (state === 'idle') {
    btn.removeAttribute('data-btn-state');
    if (btn instanceof HTMLButtonElement) btn.disabled = false;
    btn.innerHTML = btn.dataset.polyDefaultHtml;
    return;
  }

  btn.setAttribute('data-btn-state', state);
  if (btn instanceof HTMLButtonElement) {
    btn.disabled = state === 'loading';
  }

  const parts = [];
  if (icon) {
    const spinCls = spin ? ' nx-btn-spin' : '';
    parts.push(`<span class="material-symbols-outlined${spinCls}" aria-hidden="true">${icon}</span>`);
  }
  if (label) {
    const span = document.createElement('span');
    span.textContent = label;
    parts.push(span.outerHTML);
  }
  if (parts.length) {
    btn.innerHTML = parts.join('');
  }

  if (restoreAfterMs > 0) {
    btn._polyRestoreTimer = window.setTimeout(() => {
      morphButtonState(btn, 'idle');
    }, restoreAfterMs);
  }
}

function detectClientPlatform() {
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

function closeMobileDrawer() {
  const mobileDrawer = document.getElementById('mobile-drawer');
  const mobileBtn = document.getElementById('mobile-menu-toggle');
  if (mobileDrawer && !mobileDrawer.hidden) {
    mobileDrawer.hidden = true;
    mobileBtn?.setAttribute('aria-expanded', 'false');
  }
}

function closeAllModals() {
  document.querySelectorAll('.nx-info-backdrop').forEach((backdrop) => {
    if (backdrop instanceof HTMLElement) {
      backdrop.hidden = true;
    }
  });
}

function initHeroReelLike() {
  const likeBtn = document.getElementById('hero-reel-like');
  if (!likeBtn) return;

  likeBtn.addEventListener('click', () => {
    const liked = likeBtn.getAttribute('aria-pressed') === 'true';
    const next = !liked;
    likeBtn.setAttribute('aria-pressed', String(next));
    likeBtn.classList.toggle('is-liked', next);
    const icon = likeBtn.querySelector('.material-symbols-outlined');
    if (icon) {
      icon.textContent = next ? 'favorite' : 'favorite_border';
    }
  });
}

function initModals() {
  const openModal = (id) => {
    closeMobileDrawer();
    closeAllModals();
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.hidden = false;
    const firstInput = modal.querySelector('input:not([hidden]), button:not([hidden]), a:not([hidden])');
    if (firstInput instanceof HTMLElement) {
      firstInput.focus();
    }
  };

  const closeModal = (modal) => {
    if (!modal) return;
    modal.hidden = true;
  };

  document.querySelectorAll('[data-open-app-modal]').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      openModal('nx-app-modal');
    });
  });

  document.querySelectorAll('[data-open-school-modal]').forEach((trigger) => {
    trigger.addEventListener('click', () => openModal('nx-school-modal'));
  });

  document.querySelectorAll('[data-modal-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-modal-close');
      if (targetId) closeModal(document.getElementById(targetId));
    });
  });

  document.querySelectorAll('.nx-info-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal(backdrop);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.nx-info-backdrop').forEach((backdrop) => {
      if (backdrop instanceof HTMLElement && !backdrop.hidden) closeModal(backdrop);
    });
  });

  return { openModal, closeModal };
}

function initGetAppSystem() {
  const tabs = Array.from(document.querySelectorAll('[data-app-platform]'));
  const titleEl = document.getElementById('nx-app-platform-title');
  const badgeEl = document.getElementById('nx-app-platform-badge');
  const descEl = document.getElementById('nx-app-platform-desc');
  const primaryBtn = document.getElementById('nx-app-platform-primary');
  const copyBtn = document.getElementById('nx-app-copy-link');
  const heroPlatformPill = document.getElementById('nx-hero-platform-pill');
  const form = document.getElementById('nx-app-link-form');
  const input = document.getElementById('app-contact-input');
  const submitBtn = document.getElementById('nx-app-link-submit');
  const feedback = document.getElementById('nx-app-link-feedback');

  let activePlatform = detectClientPlatform();

  const updateHeroPill = () => {
    if (!heroPlatformPill) return;
    const textSpan = heroPlatformPill.querySelector('span:last-child');
    const iconSpan = heroPlatformPill.querySelector('.material-symbols-outlined');
    if (deferredAppPrompt && !appInstalledOnDevice) {
      if (iconSpan) iconSpan.textContent = 'add_to_home_screen';
      if (textSpan) textSpan.textContent = 'Add App to Device';
    } else if (activePlatform === 'ios') {
      if (iconSpan) iconSpan.textContent = 'phone_iphone';
      if (textSpan) textSpan.textContent = 'iPhone & iPad Ready';
    } else if (activePlatform === 'android') {
      if (iconSpan) iconSpan.textContent = 'android';
      if (textSpan) textSpan.textContent = 'Android Web App';
    } else {
      if (iconSpan) iconSpan.textContent = 'devices';
      if (textSpan) textSpan.textContent = 'Web · iOS · Android';
    }
  };

  const renderPlatform = (platform) => {
    activePlatform = platform === 'ios' || platform === 'android' ? platform : 'desktop';
    tabs.forEach((tab) => {
      const match = tab.getAttribute('data-app-platform') === activePlatform;
      tab.classList.toggle('is-active', match);
      tab.setAttribute('aria-selected', String(match));
    });

    if (!titleEl || !badgeEl || !descEl || !(primaryBtn instanceof HTMLElement)) return;

    if (activePlatform === 'ios') {
      titleEl.textContent = 'Nexora for iPhone & iPad';
      badgeEl.textContent = 'Safari Home Screen';
      descEl.textContent =
        'Open Nexora in Safari, tap the Share icon at the bottom bar, and select Add to Home Screen for a full-screen app experience.';
      morphButtonState(primaryBtn, 'idle');
      primaryBtn.innerHTML =
        '<span class="material-symbols-outlined" aria-hidden="true">phone_iphone</span><span>Open iOS Web Sign-In</span>';
    } else if (activePlatform === 'android') {
      titleEl.textContent = 'Nexora for Android';
      badgeEl.textContent = deferredAppPrompt ? 'Ready to add' : 'Chrome App Mode';
      descEl.textContent = deferredAppPrompt
        ? 'Your browser supports instant home-screen app setup. Add Nexora now or launch directly in your browser.'
        : 'Tap Chrome’s top-right menu and select Add to Home Screen, or launch the mobile web workspace right away.';
      morphButtonState(primaryBtn, 'idle');
      primaryBtn.innerHTML = deferredAppPrompt
        ? '<span class="material-symbols-outlined" aria-hidden="true">add_to_home_screen</span><span>Add Nexora to Android</span>'
        : '<span class="material-symbols-outlined" aria-hidden="true">android</span><span>Open Android Sign-In</span>';
    } else {
      titleEl.textContent = currentSignedInUser ? 'Nexora Workspace Ready' : 'Nexora Desktop & Web App';
      badgeEl.textContent = deferredAppPrompt
        ? 'Device prompt ready'
        : appInstalledOnDevice
          ? 'Added to device'
          : 'Instant launch';
      descEl.textContent = deferredAppPrompt
        ? 'Add Nexora as a standalone desktop window with one click, or launch directly inside this browser.'
        : currentSignedInUser
          ? `Signed in as ${currentSignedInUser.displayName || currentSignedInUser.email || 'Member'}. Open your Social, Shop, and Learn workspace.`
          : 'Open the full Nexora workspace immediately or create your account in seconds.';
      morphButtonState(primaryBtn, 'idle');
      primaryBtn.innerHTML = deferredAppPrompt
        ? '<span class="material-symbols-outlined" aria-hidden="true">add_to_home_screen</span><span>Add Nexora App</span>'
        : currentSignedInUser
          ? '<span class="material-symbols-outlined" aria-hidden="true">rocket_launch</span><span>Open Nexora Workspace</span>'
          : '<span class="material-symbols-outlined" aria-hidden="true">rocket_launch</span><span>Open Web App</span>';
    }
    primaryBtn.dataset.polyDefaultHtml = primaryBtn.innerHTML;
  };

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredAppPrompt = event;
    updateHeroPill();
    renderPlatform(activePlatform);
  });

  window.addEventListener('appinstalled', () => {
    deferredAppPrompt = null;
    appInstalledOnDevice = true;
    updateHeroPill();
    renderPlatform(activePlatform);
  });

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      renderPlatform(tab.getAttribute('data-app-platform') || 'desktop');
    });
  });

  if (primaryBtn) {
    primaryBtn.addEventListener('click', async () => {
      if (deferredAppPrompt && (activePlatform === 'desktop' || activePlatform === 'android')) {
        morphButtonState(primaryBtn, 'loading', { label: 'Opening prompt...', icon: 'progress_activity', spin: true });
        try {
          await deferredAppPrompt.prompt();
          const choice = await deferredAppPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
          if (choice?.outcome === 'accepted') {
            deferredAppPrompt = null;
            appInstalledOnDevice = true;
            morphButtonState(primaryBtn, 'success', { label: 'Added to device', icon: 'check_circle', restoreAfterMs: 2200 });
            updateHeroPill();
            return;
          }
        } catch {}
        morphButtonState(primaryBtn, 'idle');
      }

      const theme = getCurrentLandingTheme();
      if (currentSignedInUser) {
        window.location.href = '/app.html';
        return;
      }
      if (activePlatform === 'ios') {
        window.location.href = `/signup.html?platform=ios&theme=${theme}`;
      } else if (activePlatform === 'android') {
        window.location.href = `/signup.html?platform=android&theme=${theme}`;
      } else {
        window.location.href = `/login.html?theme=${theme}`;
      }
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const shareUrl = `${window.location.origin}/login.html?theme=${getCurrentLandingTheme()}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
        morphButtonState(copyBtn, 'success', {
          label: 'Link copied',
          icon: 'check_circle',
          restoreAfterMs: 2200,
        });
      } catch {
        morphButtonState(copyBtn, 'error', {
          label: 'Copy unavailable',
          icon: 'error',
          restoreAfterMs: 2200,
        });
      }
    });
  }

  if (form instanceof HTMLFormElement && input instanceof HTMLInputElement && feedback) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = input.value.trim();
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
      const isPhone = /^\+?[0-9\s().-]{7,18}$/.test(val);

      if (!isEmail && !isPhone) {
        feedback.textContent = 'Please enter a valid email address or mobile phone number.';
        feedback.classList.add('is-error');
        feedback.hidden = false;
        if (submitBtn) {
          morphButtonState(submitBtn, 'error', { label: 'Check details', icon: 'error', restoreAfterMs: 1800 });
        }
        input.focus();
        return;
      }

      feedback.hidden = true;
      feedback.classList.remove('is-error');

      if (isEmail) {
        if (submitBtn) {
          morphButtonState(submitBtn, 'loading', { label: 'Sending launch link...', icon: 'progress_activity', spin: true });
        }
        try {
          await sendSignInLinkToEmail(auth, val, {
            url: `${window.location.origin}/login.html?theme=${getCurrentLandingTheme()}`,
            handleCodeInApp: true,
          });
          window.localStorage.setItem('emailForSignIn', val);
          feedback.textContent = `Direct sign-in link sent to ${val}. Open it from your inbox to launch Nexora.`;
          feedback.hidden = false;
          if (submitBtn) {
            morphButtonState(submitBtn, 'success', { label: 'Launch link sent', icon: 'check_circle', restoreAfterMs: 2600 });
          }
          form.reset();
        } catch (err) {
          const msg = formatFriendlyError(err, 'Could not send sign-in link right now. Please try Google or Sign in.');
          feedback.textContent = msg;
          feedback.classList.add('is-error');
          feedback.hidden = false;
          if (submitBtn) {
            morphButtonState(submitBtn, 'idle');
          }
        }
      } else {
        if (submitBtn) {
          morphButtonState(submitBtn, 'success', { label: 'Opening SMS verification...', icon: 'sms' });
        }
        const theme = getCurrentLandingTheme();
        window.setTimeout(() => {
          window.location.href = `/login.html?method=phone&phone=${encodeURIComponent(val)}&theme=${theme}`;
        }, 420);
      }
    });
  }

  updateHeroPill();
  renderPlatform(activePlatform);

  return {
    refreshForAuth: () => renderPlatform(activePlatform),
  };
}

function initLandingAuth(openModal, closeModal, onAuthUpdated) {
  const authModal = document.getElementById('nx-auth-modal');
  const modalTitle = document.getElementById('nx-auth-modal-title');
  const tabs = Array.from(document.querySelectorAll('[data-landing-auth-tab]'));
  const nameField = document.getElementById('nx-landing-name-field');
  const nameInput = document.getElementById('nx-auth-display');
  const emailInput = document.getElementById('nx-auth-email');
  const passInput = document.getElementById('nx-auth-password');
  const forgotLink = document.getElementById('nx-auth-forgot-link');
  const fullAuthLink = document.getElementById('nx-full-auth-page-link');
  const submitBtn = document.getElementById('nx-landing-auth-submit');
  const googleLabel = document.getElementById('nx-landing-google-label');
  const feedbackEl = document.getElementById('nx-landing-auth-feedback');
  const form = document.getElementById('nx-landing-auth-form');
  const signedInPanel = document.getElementById('nx-auth-signedin-panel');
  const formsPanel = document.getElementById('nx-auth-forms-panel');
  const sessionNameEl = document.getElementById('nx-auth-session-name');
  const sessionEmailEl = document.getElementById('nx-auth-session-email');
  const signOutBtn = document.getElementById('nx-landing-signout-btn');
  const navAuthBtn = document.getElementById('nx-nav-auth-btn');
  const mobileAuthBtn = document.getElementById('nx-mobile-auth-btn');
  const heroWebLaunch = document.getElementById('nx-hero-web-launch');

  let authMode = 'login';

  const setFeedback = (msg, isError = true) => {
    if (!feedbackEl) return;
    const text = String(msg || '').trim();
    if (!text) {
      feedbackEl.hidden = true;
      feedbackEl.textContent = '';
      feedbackEl.classList.remove('is-error');
      return;
    }
    feedbackEl.textContent = text;
    feedbackEl.classList.toggle('is-error', isError);
    feedbackEl.hidden = false;
  };

  const setAuthMode = (mode) => {
    authMode = mode === 'register' ? 'register' : 'login';
    const isReg = authMode === 'register';
    setFeedback('');

    tabs.forEach((tab) => {
      const match = tab.getAttribute('data-landing-auth-tab') === authMode;
      tab.classList.toggle('is-active', match);
      tab.setAttribute('aria-selected', String(match));
    });

    if (modalTitle) modalTitle.textContent = isReg ? 'Create your Nexora account' : 'Sign in to Nexora';
    if (nameField) nameField.hidden = !isReg;
    if (forgotLink) forgotLink.hidden = isReg;
    if (passInput instanceof HTMLInputElement) {
      passInput.setAttribute('autocomplete', isReg ? 'new-password' : 'current-password');
    }
    if (googleLabel) googleLabel.textContent = isReg ? 'Sign up with Google' : 'Continue with Google';
    if (submitBtn) {
      morphButtonState(submitBtn, 'idle');
      submitBtn.textContent = isReg ? 'Create Account' : 'Sign In';
      submitBtn.dataset.polyDefaultHtml = submitBtn.innerHTML;
    }
    if (fullAuthLink instanceof HTMLAnchorElement) {
      fullAuthLink.dataset.baseHref = isReg ? '/signup.html' : '/login.html';
      fullAuthLink.setAttribute('href', withThemeQuery(fullAuthLink.dataset.baseHref));
    }
  };

  document.querySelectorAll('[data-open-auth-modal]').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const targetMode = trigger.getAttribute('data-open-auth-modal') === 'register' ? 'register' : 'login';
      setAuthMode(targetMode);
      openModal('nx-auth-modal');
    });
  });

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      setAuthMode(tab.getAttribute('data-landing-auth-tab') || 'login');
    });
  });

  // Google Sign-In & Registration across Hero, App Modal, Auth Modal, and Plan Drawer
  document.querySelectorAll('[data-google-auth]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      setFeedback('');
      landingAuthBusy = true;
      morphButtonState(btn, 'loading', { label: 'Connecting to Google...', icon: 'progress_activity', spin: true });
      try {
        const cred = await signInWithPopup(auth, googleProvider);
        morphButtonState(btn, 'loading', { label: 'Preparing workspace...', icon: 'progress_activity', spin: true });
        await ensureUserProfile(cred.user).catch(() => null);
        await verifySessionWithServer(cred.user).catch(() => null);
        morphButtonState(btn, 'success', { label: 'Signed in · Opening Nexora', icon: 'check_circle' });
        window.location.replace(getPostAuthDestination('/app.html'));
      } catch (err) {
        landingAuthBusy = false;
        morphButtonState(btn, 'idle');
        const msg = formatFriendlyError(err, 'Google sign-in could not be completed. Please allow popups and retry.');
        if (authModal && !authModal.hidden) {
          setFeedback(msg, true);
        } else {
          notifyUser(msg, 'error');
        }
      }
    });
  });

  if (form instanceof HTMLFormElement) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setFeedback('');
      const displayName = nameInput instanceof HTMLInputElement ? nameInput.value.trim() : '';
      const email = emailInput instanceof HTMLInputElement ? emailInput.value.trim().toLowerCase() : '';
      const password = passInput instanceof HTMLInputElement ? passInput.value : '';

      if (authMode === 'register' && displayName.length < 2) {
        setFeedback('Please enter a display name (at least 2 characters).');
        nameInput?.focus();
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setFeedback('Please enter a valid email address.');
        emailInput?.focus();
        return;
      }
      if (password.length < 6) {
        setFeedback('Password must be at least 6 characters.');
        passInput?.focus();
        return;
      }

      landingAuthBusy = true;
      morphButtonState(submitBtn, 'loading', {
        label: authMode === 'register' ? 'Creating account...' : 'Signing in...',
        icon: 'progress_activity',
        spin: true,
      });

      try {
        if (authMode === 'register') {
          await registerLocalAccount({ displayName, email, password });
          morphButtonState(submitBtn, 'success', { label: 'Account ready!', icon: 'check_circle' });
          window.location.replace(getPostAuthDestination('/app.html'));
        } else {
          await loginLocalAccount({ email, password });
          morphButtonState(submitBtn, 'success', { label: 'Welcome back!', icon: 'check_circle' });
          window.location.replace(getPostAuthDestination('/app.html'));
        }
      } catch (err) {
        landingAuthBusy = false;
        morphButtonState(submitBtn, 'idle');
        setFeedback(err instanceof Error && err.message ? err.message : formatFriendlyError(err, 'Unable to complete sign-in. Please check your details.'));
      }
    });
  }

  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      morphButtonState(signOutBtn, 'loading', { label: 'Signing out...', icon: 'progress_activity', spin: true });
      try {
        clearLocalSession();
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
        await signOut(auth).catch(() => {});
        morphButtonState(signOutBtn, 'idle');
        closeModal(authModal);
      } catch (err) {
        morphButtonState(signOutBtn, 'idle');
        notifyUser(formatFriendlyError(err, 'Could not sign out right now.'), 'error');
      }
    });
  }

  const syncSignedInUi = (user) => {
    currentSignedInUser = user || null;
    const isSignedIn = Boolean(user);

    if (signedInPanel) signedInPanel.hidden = !isSignedIn;
    if (formsPanel) formsPanel.hidden = isSignedIn;
    if (isSignedIn && user) {
      if (sessionNameEl) sessionNameEl.textContent = user.displayName || 'Nexora Member';
      if (sessionEmailEl) sessionEmailEl.textContent = user.email || user.phoneNumber || 'Authenticated session';
    }

    if (navAuthBtn) navAuthBtn.textContent = isSignedIn ? 'Account' : 'Sign in';
    if (mobileAuthBtn) mobileAuthBtn.textContent = isSignedIn ? 'Account' : 'Sign in';

    if (heroWebLaunch instanceof HTMLAnchorElement) {
      const iconEl = heroWebLaunch.querySelector('.material-symbols-outlined');
      const labelEl = heroWebLaunch.querySelector('span:last-child');
      if (isSignedIn) {
        heroWebLaunch.dataset.baseHref = '/app.html';
        heroWebLaunch.setAttribute('href', '/app.html');
        if (iconEl) iconEl.textContent = 'dashboard';
        if (labelEl) labelEl.textContent = 'Open Workspace';
      } else {
        heroWebLaunch.dataset.baseHref = '/login.html';
        heroWebLaunch.setAttribute('href', withThemeQuery('/login.html'));
        if (iconEl) iconEl.textContent = 'open_in_new';
        if (labelEl) labelEl.textContent = 'Launch Web App';
      }
    }

    if (typeof onAuthUpdated === 'function') {
      onAuthUpdated(user);
    }
  };

  onAuthStateChanged(auth, async (fbUser) => {
    if (fbUser) {
      syncSignedInUi(fbUser);
      return;
    }
    const local = getCachedLocalSession() || (await restoreLocalSessionFromServer().catch(() => null));
    syncSignedInUi(local?.user || null);
  });

  subscribeLocalAuthChange((localUser) => {
    if (!auth.currentUser) {
      syncSignedInUi(localUser || null);
    }
  });

  setAuthMode('login');
}

function initSchoolForm() {
  const form = document.getElementById('nx-school-form');
  const feedback = document.getElementById('nx-school-feedback');
  if (!(form instanceof HTMLFormElement) || !feedback) return;
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const schoolInput = document.getElementById('school-name');
    const emailInput = document.getElementById('school-email');
    const sizeSelect = document.getElementById('school-size');
    const schoolName = schoolInput instanceof HTMLInputElement ? schoolInput.value.trim() : '';
    const adminEmail = emailInput instanceof HTMLInputElement ? emailInput.value.trim() : '';
    const studentSize =
      sizeSelect instanceof HTMLSelectElement ? sizeSelect.options[sizeSelect.selectedIndex]?.text || '' : '';

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
    feedback.textContent = `Onboarding confirmed for ${schoolName} (${studentSize}). Verification instructions sent to ${adminEmail}.`;
    feedback.hidden = false;
    if (submitBtn instanceof HTMLElement) {
      morphButtonState(submitBtn, 'success', {
        label: 'Registration confirmed',
        icon: 'check_circle',
        restoreAfterMs: 2600,
      });
    }
    form.reset();
  });
}

function initTryOnSwitcher() {
  const dropzone = document.getElementById('nx-tryon-dropzone');
  const summaryEl = document.getElementById('nx-tryon-summary');
  const countEl = document.getElementById('nx-tryon-count');
  const clearBtn = document.getElementById('nx-tryon-clear');
  const cards = Array.from(document.querySelectorAll('[data-tryon-layer]'));
  if (!dropzone || !summaryEl || !countEl || !cards.length) return;

  const activeLayers = new Set(['camel-trench']);

  const sync = () => {
    const names = [];
    cards.forEach((card) => {
      const id = card.getAttribute('data-tryon-layer') || '';
      const label = card.getAttribute('data-layer-label') || id;
      const isOn = activeLayers.has(id);
      card.classList.toggle('is-active', isOn);
      card.setAttribute('aria-pressed', String(isOn));
      const stateBadge = card.querySelector('.nx-layer-state');
      if (stateBadge) stateBadge.textContent = isOn ? 'Active layer' : 'Add layer';
      if (isOn) names.push(label);
    });

    summaryEl.textContent = names.length ? names.join(' · ') : 'Base lookbook portrait';
    countEl.textContent = `${names.length} of ${cards.length} layers applied`;
    if (clearBtn) clearBtn.hidden = names.length === 0;
  };

  const toggleLayer = (id) => {
    if (!id) return;
    if (activeLayers.has(id)) activeLayers.delete(id);
    else activeLayers.add(id);
    sync();
  };

  cards.forEach((card) => {
    const id = card.getAttribute('data-tryon-layer');
    card.addEventListener('click', () => toggleLayer(id));
    card.addEventListener('dragstart', (e) => {
      if (id && e.dataTransfer) {
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.effectAllowed = 'copy';
      }
    });
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('is-drag-over');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('is-drag-over');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-drag-over');
    const id = e.dataTransfer?.getData('text/plain');
    if (id) {
      activeLayers.add(id);
      sync();
    }
  });

  clearBtn?.addEventListener('click', () => {
    activeLayers.clear();
    sync();
  });

  sync();
}

function initNearbyRadar() {
  const modeBtns = Array.from(document.querySelectorAll('[data-radar-mode]'));
  const card = document.getElementById('nx-radar-card');
  const statusEl = document.getElementById('nx-radar-status-text');
  const detailEl = document.getElementById('nx-radar-member-detail');
  const nodes = Array.from(document.querySelectorAll('.nx-radar-node'));
  if (!modeBtns.length || !card || !statusEl) return;

  const setMode = (mode) => {
    const discoverable = mode === 'discoverable';
    card.classList.toggle('is-discoverable', discoverable);
    card.classList.toggle('is-invisible', !discoverable);
    modeBtns.forEach((btn) => {
      const active = btn.getAttribute('data-radar-mode') === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    if (!discoverable) {
      nodes.forEach((n) => n.classList.remove('is-selected'));
    }
    statusEl.textContent = discoverable ? 'Visible within 100 m' : 'Hidden from nearby discovery';
    if (detailEl) {
      detailEl.textContent = discoverable
        ? '4 circle members nearby — click a node on the radar to preview.'
        : 'Nearby circles paused. Switch back to Discoverable when ready.';
    }
    window.dispatchEvent(new CustomEvent('nexora:radar-mode', { detail: { mode, discoverable } }));
  };

  modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setMode(btn.getAttribute('data-radar-mode') || 'discoverable');
    });
  });

  nodes.forEach((node) => {
    const announce = () => {
      if (card.classList.contains('is-invisible') || !detailEl) return;
      nodes.forEach((n) => n.classList.toggle('is-selected', n === node));
      detailEl.textContent = node.getAttribute('data-member') || '';
    };
    node.addEventListener('click', announce);
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        announce();
      }
    });
  });

  setMode('discoverable');
}

function initOutfitBuilder() {
  const cards = Array.from(document.querySelectorAll('[data-store-id]'));
  const countEl = document.getElementById('nx-outfit-count');
  const totalEl = document.getElementById('nx-outfit-total');
  const toggleLinksBtn = document.getElementById('nx-view-store-links-btn');
  const drawer = document.getElementById('nx-store-links-drawer');
  const linksList = document.getElementById('nx-store-links-list');
  const closeLinksBtn = document.getElementById('nx-close-store-links');
  if (!cards.length || !countEl || !totalEl || !drawer || !linksList) return;

  const selected = new Set(['atelier-rowan']);

  const sync = () => {
    let total = 0;
    const rows = [];
    cards.forEach((card) => {
      const id = card.getAttribute('data-store-id') || '';
      const active = selected.has(id);
      card.classList.toggle('is-selected', active);
      card.setAttribute('aria-pressed', String(active));
      const icon = card.querySelector('.nx-outfit-check');
      if (icon) icon.textContent = active ? 'check_circle' : 'add_circle_outline';
      if (active) {
        total += Number(card.getAttribute('data-store-price') || 0);
        rows.push({
          store: card.getAttribute('data-store-name') || '',
          item: card.getAttribute('data-store-item') || '',
          price: card.getAttribute('data-store-price') || '0',
          url: card.getAttribute('data-store-url') || '/marketplace',
        });
      }
    });

    const count = rows.length;
    countEl.textContent = `${count} ${count === 1 ? 'item' : 'items'} selected`;
    totalEl.textContent = count ? `Total · $${total}` : 'Select a store piece above';

    linksList.innerHTML = count
      ? rows
          .map(
            (row) => `
        <div class="nx-store-link-row">
          <div>
            <strong>${row.store}</strong>
            <span> · ${row.item} ($${row.price})</span>
          </div>
          <a href="${row.url}" class="nx-pillar-link">Visit storefront →</a>
        </div>`
          )
          .join('')
      : '<p class="nx-body-md">Select at least one garment above to view its partner store link.</p>';
  };

  cards.forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-store-id') || '';
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      sync();
    });
  });

  toggleLinksBtn?.addEventListener('click', () => {
    const nextHidden = !drawer.hidden;
    drawer.hidden = nextHidden;
    toggleLinksBtn.setAttribute('aria-expanded', String(!nextHidden));
  });

  closeLinksBtn?.addEventListener('click', () => {
    drawer.hidden = true;
    toggleLinksBtn?.setAttribute('aria-expanded', 'false');
  });

  sync();
}

function initPricingSection(openModal) {
  const modeBtns = Array.from(document.querySelectorAll('[data-billing-mode]'));
  const planCards = Array.from(document.querySelectorAll('[data-plan-card]'));
  const drawer = document.getElementById('nx-plan-drawer');
  const drawerTitle = document.getElementById('nx-plan-drawer-title');
  const drawerDetail = document.getElementById('nx-plan-drawer-detail');
  const closeDrawer = document.getElementById('nx-close-plan-drawer');
  if (!modeBtns.length || !planCards.length) return;

  let currentMode = 'monthly';

  const renderMode = (mode) => {
    currentMode = mode;
    modeBtns.forEach((btn) => {
      const active = btn.getAttribute('data-billing-mode') === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });

    const table = PRICING_DATA[mode] || PRICING_DATA.monthly;
    planCards.forEach((card) => {
      const key = card.getAttribute('data-plan-card') || 'personal';
      const entry = table[key];
      if (!entry) return;
      const titleEl = card.querySelector('[data-plan-title]');
      const priceEl = card.querySelector('[data-plan-price]');
      const descEl = card.querySelector('[data-plan-desc]');
      const ctaBtn = card.querySelector('[data-select-plan]');
      if (titleEl) titleEl.textContent = entry.title;
      if (priceEl) priceEl.innerHTML = entry.price;
      if (descEl) descEl.textContent = entry.desc;
      if (ctaBtn) ctaBtn.textContent = entry.cta;
    });
  };

  modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      renderMode(btn.getAttribute('data-billing-mode') || 'monthly');
    });
  });

  document.querySelectorAll('[data-select-plan]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-select-plan') || 'personal';
      if (key === 'campus') {
        openModal('nx-school-modal');
        return;
      }

      planCards.forEach((card) => {
        card.classList.toggle('is-selected', card.getAttribute('data-plan-card') === key);
      });

      const table = PRICING_DATA[currentMode] || PRICING_DATA.monthly;
      const entry = table[key];
      if (drawer && drawerTitle && drawerDetail && entry) {
        drawerTitle.textContent = `${entry.title} selected`;
        drawerDetail.textContent = `Billing mode: ${currentMode === 'ppv' ? 'Pay-per-view' : 'Monthly subscription'}. Ready to activate in Nexora.`;
        drawer.hidden = false;
      }
    });
  });

  closeDrawer?.addEventListener('click', () => {
    if (drawer) drawer.hidden = true;
  });

  renderMode('monthly');
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

function initFooterInfoModal(openModal) {
  const titleEl = document.getElementById('nx-info-title');
  const bodyEl = document.getElementById('nx-info-body');
  if (!titleEl || !bodyEl) return;

  document.querySelectorAll('[data-footer-info]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-footer-info') || 'privacy';
      const data = FOOTER_INFO[key] || FOOTER_INFO.privacy;
      titleEl.textContent = data.title;
      bodyEl.innerHTML = data.body;
      openModal('nx-info-modal');
    });
  });
}

function initScrollReveals() {
  const targets = Array.from(
    document.querySelectorAll(
      '.nx-pillar-card, .nx-section-head, .nx-split-copy, .nx-split-panel, .nx-tryon-stage-col, .nx-outfit-card, .nx-plan-card, .nx-schools-copy, .nx-schools-diagram-card, .nx-accordion-item'
    )
  );
  if (!targets.length) return;

  targets.forEach((el) => {
    el.classList.add('nx-reveal');
  });

  const staggerGroups = [
    '.nx-pillars-grid .nx-pillar-card',
    '.nx-outfit-grid .nx-outfit-card',
    '.nx-plans-grid-4 .nx-plan-card',
    '.nx-accordion-group .nx-accordion-item',
  ];
  staggerGroups.forEach((selector) => {
    document.querySelectorAll(selector).forEach((item, index) => {
      if (item instanceof HTMLElement) {
        item.style.setProperty('--reveal-delay', `${Math.min(index * 70, 210)}ms`);
      }
    });
  });

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion || typeof IntersectionObserver === 'undefined') {
    targets.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  document.documentElement.classList.add('nx-anim-ready');

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      });
    },
    {
      threshold: 0.12,
      rootMargin: '0px 0px -36px 0px',
    }
  );

  targets.forEach((el) => observer.observe(el));
}

function initSmoothAnchors() {
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const href = anchor.getAttribute('href');
      if (!href || href.length < 2) return;
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function applyLandingTheme(theme, { animate = false } = {}) {
  const normalized = theme === 'light' ? 'light' : 'dark';
  try {
    localStorage.setItem(LANDING_THEME_KEY, normalized);
  } catch {}

  const commit = () => {
    document.documentElement.setAttribute('data-theme', normalized);
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', normalized === 'light' ? '#FFF0DC' : '#09090B');
    }
    const schemeMeta = document.querySelector('meta[name="color-scheme"]');
    if (schemeMeta) {
      schemeMeta.setAttribute('content', normalized);
    }
    document.querySelectorAll('[data-landing-theme]').forEach((btn) => {
      const isMatch = btn.getAttribute('data-landing-theme') === normalized;
      btn.classList.toggle('is-active', isMatch);
      btn.setAttribute('aria-pressed', String(isMatch));
    });
    syncThemedAuthLinks(normalized);
    window.dispatchEvent(new CustomEvent('nexora:theme-change', { detail: { theme: normalized } }));
  };

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (animate && !reduceMotion && typeof document.startViewTransition === 'function') {
    document.startViewTransition(commit);
  } else {
    commit();
  }
}

function initLandingTheme() {
  let saved = 'dark';
  try {
    if (localStorage.getItem(LANDING_THEME_KEY) === 'light') saved = 'light';
  } catch {}
  applyLandingTheme(saved, { animate: false });

  document.querySelectorAll('[data-landing-theme]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-landing-theme');
      if (target) applyLandingTheme(target, { animate: true });
    });
  });
}

function initLandingPage() {
  initLandingTheme();
  redirectIfAuthenticated({
    defaultTarget: '/app.html',
    respectLandingParam: true,
    shouldRedirect: () => !landingAuthBusy,
  });

  const { openModal, closeModal } = initModals();
  const appSystem = initGetAppSystem();
  initLandingAuth(openModal, closeModal, () => {
    appSystem.refreshForAuth();
  });
  initHeroReelLike();
  initSchoolForm();
  initTryOnSwitcher();
  initNearbyRadar();
  initOutfitBuilder();
  initPricingSection(openModal);
  initFaqAccordion();
  initFooterInfoModal(openModal);
  initSmoothAnchors();
  initScrollReveals();

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
