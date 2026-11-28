import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NEXORA_THEMES, normalizeThemePreference } from '../js/social_utils.js';

test('Two accessible themes (dark Graphite and light Daylight) are defined cleanly with View Transitions', () => {
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
  assert.ok(globalCss.includes('#101318'), 'Dark default background token #101318 required');
  assert.ok(globalCss.includes('#4777DF'), 'Signal Blue token #4777DF required');
  assert.ok(globalCss.includes('#3868CE'), 'Signal Blue AA solid fill #3868CE required');
  assert.ok(globalCss.includes('#C49A52'), 'Soft Amber highlight token #C49A52 required');
  assert.ok(globalCss.includes('view-transition'));
});

test('Landing page enforces zero download/installer UI, human-first hero, and workspace preview', () => {
  const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
  const lower = html.toLowerCase();

  assert.ok(html.includes('Real people.'), 'Hero must include "Real people." headline');
  assert.ok(html.includes('Connected in real time.'), 'Hero must include "Connected in real time." headline');
  assert.ok(html.includes('Explore Messaging'), 'Hero must include "Explore Messaging" primary CTA');
  assert.ok(html.includes('hero-mockup-perspective'), 'Hero must include perspective workspace preview');

  // Zero download or installer links/scripts on landing page
  assert.ok(!lower.includes('download'), 'Landing page must not contain download sections or buttons');
  assert.ok(!lower.includes('installer'), 'Landing page must not contain installer links');
  assert.ok(!html.includes('/js/pwa.js'), 'Landing page must not load PWA install prompt script');

  // Light/Dark switcher + Manrope / JetBrains Mono fonts
  assert.ok(html.includes('data-theme-switch'));
  assert.ok(html.includes('data-theme-choice="dark"'));
  assert.ok(html.includes('data-theme-choice="light"'));
  assert.ok(html.includes('Manrope') && html.includes('JetBrains+Mono'));
  assert.ok(!html.includes('Bricolage+Grotesque'));
  assert.ok(!html.includes('Plus+Jakarta+Sans'));
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
