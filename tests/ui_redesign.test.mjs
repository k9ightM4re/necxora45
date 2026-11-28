import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NEXORA_THEMES, normalizeThemePreference } from '../js/social_utils.js';

test('Two accessible themes (light Warm Ivory and dark Deep Burgundy) are defined cleanly with View Transitions', () => {
  assert.deepEqual(NEXORA_THEMES, ['dark', 'light']);
  assert.equal(normalizeThemePreference('dark'), 'dark');
  assert.equal(normalizeThemePreference('light'), 'light');
  assert.equal(normalizeThemePreference('navy-dark'), 'dark');
  assert.equal(normalizeThemePreference('midnight-cyan'), 'dark');
  assert.equal(normalizeThemePreference('ember'), 'dark');

  const globalCss = fs.readFileSync(path.resolve(process.cwd(), 'css/global.css'), 'utf8');
  for (const theme of ['dark', 'light']) {
    assert.ok(globalCss.includes(`[data-theme="${theme}"]`), `Missing token block for ${theme}`);
  }
  assert.ok(globalCss.includes('#FFF0DC'), 'Warm Ivory background token #FFF0DC required');
  assert.ok(globalCss.includes('#790B13'), 'Editorial Crimson primary token #790B13 required');
  assert.ok(globalCss.includes('#5C0810'), 'Crimson hover token #5C0810 required');
  assert.ok(globalCss.includes('#2A0A0D'), 'Warm Espresso ink token #2A0A0D required');
  assert.ok(globalCss.includes('#FFF8EE'), 'Elevated Ivory surface token #FFF8EE required');
  assert.ok(globalCss.includes('view-transition'));
});

test('Landing page enforces Warm Editorial hero, Social/Shop/Learn pillars, For schools band, and Playfair Display + DM Sans', () => {
  const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
  const landingCss = fs.readFileSync(path.resolve(process.cwd(), 'css/landing.css'), 'utf8');
  const lower = html.toLowerCase();

  assert.ok(html.includes('Social, Shop, and Learn in one warm space.'), 'Hero must feature official Nexora Warm Editorial headline');
  assert.ok(html.includes('Get the app'), 'Hero must include "Get the app" primary CTA');
  assert.ok(html.includes('nx-device-frame'), 'Hero must include interactive Nexora Workspace device showcase');
  assert.ok(html.includes('For schools') && html.includes('Register your school'), 'Landing page must include For schools band');
  assert.ok(html.includes('partner stores'), 'Landing page must use partner stores terminology');

  // Zero download or installer links/scripts on landing page
  assert.ok(!lower.includes('download'), 'Landing page must not contain download sections or buttons');
  assert.ok(!lower.includes('installer'), 'Landing page must not contain installer links');
  assert.ok(!html.includes('/js/pwa.js'), 'Landing page must not load PWA install prompt script');

  // Official Google Fonts + Warm Editorial CSS tokens
  assert.ok(html.includes('Playfair+Display') && html.includes('DM+Sans'));
  assert.ok(html.includes('Material+Symbols+Outlined'));
  assert.ok(landingCss.includes('#790B13') || landingCss.includes('var(--color-primary'));
});

test('app.html and app.css expose Social Circle, Light/Dark switcher, Feature Discovery, and DM inbox while keeping existing IDs', () => {
  const appHtml = fs.readFileSync(path.resolve(process.cwd(), 'app.html'), 'utf8');
  const appCss = fs.readFileSync(path.resolve(process.cwd(), 'css/app.css'), 'utf8');
  const appJs = fs.readFileSync(path.resolve(process.cwd(), 'js/app.js'), 'utf8');

  assert.ok(appHtml.includes('data-nx-nav="social-circle"'));
  assert.ok(appHtml.includes('data-nx-nav="features"'));
  assert.ok(appHtml.includes('data-nx-nav="marketplace"'));
  assert.ok(appHtml.includes('data-theme-select'));
  assert.ok(appHtml.includes('id="nx-theme-pill"'));
  assert.ok(appHtml.includes('id="leader-alert-modal"'));
  assert.ok(appHtml.includes('id="dm-mobile-back-btn"'));
  assert.ok(appHtml.includes('id="header-peer-avatar"'));

  assert.ok(appCss.includes('.nx-dm-row'));
  assert.ok(appCss.includes('.nx-dm-bubble.is-self'));
  assert.ok(appCss.includes('.nx-dm-bubble.is-peer'));
  assert.ok(appJs.includes('is-dm-msg'));
  assert.ok(appJs.includes('set-dm-tab'));
});
