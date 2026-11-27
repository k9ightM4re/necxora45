import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHOTO_TEMPLATES,
  REEL_FILTERS,
  REEL_VIDEO_TEMPLATES,
  SNAP_LENS_STICKERS,
  buildCommunityInviteMessage,
  extractCommunityInviteCodeFromText,
  getPhotoTemplateMeta,
  getReelFilterCss,
  getReelTemplateMeta,
  getYouTubeEmbedUrl,
  getYouTubeThumbUrl,
  parseYouTubeVideoId,
  sanitizeReelTextOverlays,
} from '../js/reel_studio.js';

test('parseYouTubeVideoId extracts canonical IDs across YouTube URL formats', () => {
  assert.equal(parseYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=12'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeVideoId('https://youtube.com/shorts/abc123XYZ_9?feature=share'), 'abc123XYZ_9');
  assert.equal(parseYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeVideoId('https://example.com/video.mp4'), '');
  assert.equal(getYouTubeEmbedUrl('dQw4w9WgXcQ', { autoplay: true, mute: true }).includes('/embed/dQw4w9WgXcQ'), true);
  assert.equal(getYouTubeThumbUrl('dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
});

test('sanitizeReelTextOverlays clamps bounds, strips blanks, and caps length', () => {
  const cleaned = sanitizeReelTextOverlays([
    { id: 't1', text: '  NEXORA Live!  ', x: 120, y: -10, fontSize: 99, style: 'neon', bgMode: 'dark', color: '#701CFF' },
    { id: 't2', text: '   ', x: 50, y: 50 },
    { id: 't3', text: 'Valid Text', x: 45, y: 60, fontSize: 22, style: 'invalid-style', color: 'bad' },
  ]);
  assert.equal(cleaned.length, 2);
  assert.deepEqual(cleaned[0], {
    id: 't1',
    text: 'NEXORA Live!',
    x: 92,
    y: 10,
    fontSize: 48,
    style: 'neon',
    bgMode: 'dark',
    color: '#701CFF',
  });
  assert.equal(cleaned[1].style, 'modern');
  assert.equal(cleaned[1].color, '#FFFFFF');
});

test('buildCommunityInviteMessage and extractCommunityInviteCodeFromText round-trip cleanly', () => {
  const msg = buildCommunityInviteMessage({ id: 'srv-1', name: 'Design Hub', inviteCode: 'design-9a2f' }, 'https://myzora.netlify.app');
  assert.equal(msg.includes('https://myzora.netlify.app/welcome.html?invite=design-9a2f'), true);
  assert.equal(extractCommunityInviteCodeFromText(msg), 'design-9a2f');
  assert.equal(extractCommunityInviteCodeFromText('Join via nexora://invite/tech-4411'), 'tech-4411');
  assert.equal(extractCommunityInviteCodeFromText('Regular chat message hello world'), '');
});

test('getReelFilterCss supports Instagram & Snapchat filters and adheres to Firestore 32-char ID bound', () => {
  assert.equal(getReelFilterCss('none'), 'none');
  assert.equal(getReelFilterCss('noir').includes('grayscale(1)'), true);
  assert.equal(getReelFilterCss('snap-tokyo').includes('hue-rotate'), true);
  assert.equal(getReelFilterCss('unknown-filter'), 'none');
  assert.ok(REEL_FILTERS.length >= 12);
  const seenIds = new Set();
  for (const f of REEL_FILTERS) {
    assert.ok(f.id && f.id.length <= 32, `Filter id "${f.id}" exceeds Firestore rule max length 32`);
    assert.equal(seenIds.has(f.id), false);
    seenIds.add(f.id);
  }
});

test('REEL_VIDEO_TEMPLATES, SNAP_LENS_STICKERS, and PHOTO_TEMPLATES have valid rule-safe presets', () => {
  assert.ok(REEL_VIDEO_TEMPLATES.length >= 5);
  for (const tpl of REEL_VIDEO_TEMPLATES) {
    assert.notEqual(getReelFilterCss(tpl.filterName), 'none', `Template ${tpl.id} should reference a valid filter`);
    assert.ok(tpl.playbackSpeed >= 0.25 && tpl.playbackSpeed <= 4);
    assert.ok(tpl.musicVolume >= 0 && tpl.musicVolume <= 1);
    assert.ok(Array.isArray(tpl.overlays) && tpl.overlays.length >= 1);
    const cleaned = sanitizeReelTextOverlays(tpl.overlays);
    assert.equal(cleaned.length, tpl.overlays.length);
    assert.ok(getReelTemplateMeta(tpl.id));
  }

  assert.ok(SNAP_LENS_STICKERS.length >= 5);
  for (const lens of SNAP_LENS_STICKERS) {
    const cleaned = sanitizeReelTextOverlays([lens]);
    assert.equal(cleaned.length, 1);
  }

  assert.ok(PHOTO_TEMPLATES.length >= 5);
  assert.equal(getPhotoTemplateMeta('polaroid-frame').id, 'polaroid-frame');
  assert.equal(getPhotoTemplateMeta('missing-id').id, 'clean-filter');
});

