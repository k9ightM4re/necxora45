import { NEXORA_THEMES, normalizeThemePreference } from './social_utils.js';

export const THEME_STORAGE_KEY = 'nexora_theme';

export const THEME_META = [
  { id: 'dark', label: 'Dark (Graphite)', short: 'Dark', swatch: '#4777DF' },
  { id: 'light', label: 'Light', short: 'Light', swatch: '#3868C8' },
];

export function getStoredTheme() {
  try {
    const direct = localStorage.getItem(THEME_STORAGE_KEY);
    if (direct) return normalizeThemePreference(direct);
    const prefsRaw = localStorage.getItem('nexora_lite_prefs_v2');
    if (prefsRaw) {
      const parsed = JSON.parse(prefsRaw);
      if (parsed?.theme) return normalizeThemePreference(parsed.theme);
    }
  } catch {}
  // Dark is the official Nexora default theme
  return 'dark';
}

function commitThemeDom(normalized) {
  if (typeof document === 'undefined') return;
  const isLight = normalized === 'light';
  document.documentElement.setAttribute('data-theme', normalized);
  document.documentElement.style.colorScheme = isLight ? 'light' : 'dark';

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', isLight ? '#F5F6F8' : '#101318');
  }

  document.body?.classList.toggle('theme-dark', !isLight);
  document.body?.classList.toggle('theme-navy-dark', !isLight);

  document.querySelectorAll('[data-theme-switch]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(!isLight));
    btn.dataset.activeTheme = normalized;
  });

  document.querySelectorAll('[data-theme-choice]').forEach((el) => {
    const match = el.getAttribute('data-theme-choice') === normalized;
    el.setAttribute('aria-checked', String(match));
    el.classList.toggle('is-active', match);
  });

  document.querySelectorAll('[data-theme-select]').forEach((sel) => {
    if (sel instanceof HTMLSelectElement && sel.value !== normalized) {
      sel.value = normalized;
    }
  });

  const activeMeta = THEME_META.find((t) => t.id === normalized) || THEME_META[0];
  document.querySelectorAll('[data-theme-label]').forEach((node) => {
    node.textContent = activeMeta.short;
  });
  document.querySelectorAll('[data-theme-swatch]').forEach((node) => {
    if (node instanceof HTMLElement) {
      node.style.backgroundColor = activeMeta.swatch;
    }
  });
}

export function applyTheme(theme, { animate = false } = {}) {
  const normalized = normalizeThemePreference(theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, normalized);
    const prefsRaw = localStorage.getItem('nexora_lite_prefs_v2');
    if (prefsRaw) {
      const parsed = JSON.parse(prefsRaw);
      parsed.theme = normalized;
      localStorage.setItem('nexora_lite_prefs_v2', JSON.stringify(parsed));
    }
  } catch {}

  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (
    animate &&
    !reduceMotion &&
    typeof document !== 'undefined' &&
    typeof document.startViewTransition === 'function'
  ) {
    document.startViewTransition(() => {
      commitThemeDom(normalized);
    });
  } else {
    commitThemeDom(normalized);
  }

  return normalized;
}

export function cycleNextTheme() {
  const current = getStoredTheme();
  const idx = NEXORA_THEMES.indexOf(current);
  const next = NEXORA_THEMES[(idx + 1) % NEXORA_THEMES.length];
  return applyTheme(next, { animate: true });
}

export function initThemeSync() {
  const current = applyTheme(getStoredTheme(), { animate: false });

  const closeThemeMenus = () => {
    document.querySelectorAll('[data-theme-menu]').forEach((menu) => {
      if (menu instanceof HTMLElement) menu.hidden = true;
    });
    document.querySelectorAll('[data-theme-menu-toggle]').forEach((btn) => {
      btn.setAttribute('aria-expanded', 'false');
    });
  };

  document.querySelectorAll('[data-theme-menu-toggle]').forEach((toggle) => {
    if (toggle.dataset.nxThemeBound) return;
    toggle.dataset.nxThemeBound = '1';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const wrap = toggle.closest('.theme-dropdown');
      const menu = wrap?.querySelector('[data-theme-menu]');
      if (!(menu instanceof HTMLElement)) return;
      const willOpen = menu.hidden;
      closeThemeMenus();
      menu.hidden = !willOpen;
      toggle.setAttribute('aria-expanded', String(willOpen));
    });
  });

  if (typeof document !== 'undefined' && !document.documentElement.dataset.nxThemeMenuDocBound) {
    document.documentElement.dataset.nxThemeMenuDocBound = '1';
    document.addEventListener('click', (e) => {
      if (!(e.target instanceof Element) || !e.target.closest('.theme-dropdown')) {
        closeThemeMenus();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeThemeMenus();
    });
  }

  document.querySelectorAll('[data-theme-switch]').forEach((btn) => {
    if (btn.dataset.nxThemeBound) return;
    btn.dataset.nxThemeBound = '1';
    btn.addEventListener('click', () => {
      cycleNextTheme();
    });
  });

  document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
    if (btn.dataset.nxThemeBound) return;
    btn.dataset.nxThemeBound = '1';
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-theme-choice');
      if (target) applyTheme(target, { animate: true });
      closeThemeMenus();
    });
  });

  document.querySelectorAll('[data-theme-select]').forEach((sel) => {
    if (sel.dataset.nxThemeBound) return;
    sel.dataset.nxThemeBound = '1';
    sel.addEventListener('change', () => {
      applyTheme(sel.value, { animate: true });
    });
  });

  return current;
}
