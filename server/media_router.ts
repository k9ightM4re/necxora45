import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { nexoraStore, UPLOADS_DIR } from './nexora_store.ts';

const MAX_MEDIA_BYTES = 10 * 1024 * 1024; // 10 MB

const UploadSchema = z.object({
  name: z.string().min(1).max(120).optional().default('upload'),
  mimeType: z.string().min(3).max(80).optional().default('application/octet-stream'),
  kind: z.enum(['avatar', 'cover', 'post', 'story', 'reel', 'dm', 'general']).optional().default('general'),
  dataUrl: z.string().min(16).max(14_500_000),
});

export interface MagicDetectResult {
  valid: boolean;
  mimeType: string;
  ext: string;
}

export function inspectMediaMagicBytes(buf: Buffer, declaredMime = ''): MagicDetectResult {
  if (!Buffer.isBuffer(buf) || buf.length < 4) {
    return { valid: false, mimeType: '', ext: '' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { valid: true, mimeType: 'image/png', ext: 'png' };
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { valid: true, mimeType: 'image/jpeg', ext: 'jpg' };
  }
  // GIF: GIF87a / GIF89a
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return { valid: true, mimeType: 'image/gif', ext: 'gif' };
  }
  // WEBP: RIFF....WEBP
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { valid: true, mimeType: 'image/webp', ext: 'webp' };
  }
  // MP4 / M4A / QuickTime: ftyp at offset 4
  if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    const isAudio = declaredMime.toLowerCase().startsWith('audio/');
    return {
      valid: true,
      mimeType: isAudio ? 'audio/mp4' : 'video/mp4',
      ext: isAudio ? 'm4a' : 'mp4',
    };
  }
  // WEBM / Matroska: 1A 45 DF A3
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    const isAudio = declaredMime.toLowerCase().startsWith('audio/');
    return {
      valid: true,
      mimeType: isAudio ? 'audio/webm' : 'video/webm',
      ext: 'webm',
    };
  }
  // OGG: OggS
  if (buf.subarray(0, 4).toString('ascii') === 'OggS') {
    return { valid: true, mimeType: 'audio/ogg', ext: 'ogg' };
  }
  // MP3: ID3 or frame sync
  if (
    buf.subarray(0, 3).toString('ascii') === 'ID3' ||
    (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
  ) {
    return { valid: true, mimeType: 'audio/mpeg', ext: 'mp3' };
  }
  // WAV: RIFF....WAVE
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    return { valid: true, mimeType: 'audio/wav', ext: 'wav' };
  }

  return { valid: false, mimeType: '', ext: '' };
}

export interface MediaRouterDeps {
  requireVerifiedBearer: (req: Request, res: Response) => Promise<any | null>;
  checkRateLimit: (key: string, maxRequests: number, windowMs: number) => { allowed: boolean; retryAfterSec: number };
  isAdminUserServer: (user: any) => boolean;
}

const UUID_MEDIA_RE = /^[a-f0-9-]{20,64}$/;

export function mountMediaRoutes(app: Express, deps: MediaRouterDeps): void {
  app.post('/api/media/upload', async (req: Request, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;

    const rate = deps.checkRateLimit(`media-up:${user.uid}`, 25, 60 * 1000);
    if (!rate.allowed) {
      res.status(429).json({ error: `Upload limit reached. Retry in ${rate.retryAfterSec}s.` });
      return;
    }

    const parsed = UploadSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid upload payload.' });
      return;
    }

    const { dataUrl, kind, mimeType, name } = parsed.data;
    const match = /^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
    if (!match) {
      res.status(400).json({ error: 'Upload must be a valid base64 data payload.' });
      return;
    }

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0 || buffer.length > MAX_MEDIA_BYTES) {
      res.status(413).json({ error: 'File must be non-empty and under 10 MB.' });
      return;
    }

    const inspected = inspectMediaMagicBytes(buffer, match[1] || mimeType);
    if (!inspected.valid) {
      res.status(415).json({ error: 'Unsupported or unverified media file format.' });
      return;
    }

    const mediaId = crypto.randomUUID();
    const diskName = `${mediaId}.${inspected.ext}`;
    const targetPath = path.resolve(UPLOADS_DIR, diskName);
    if (!targetPath.startsWith(UPLOADS_DIR + path.sep)) {
      res.status(400).json({ error: 'Invalid target path.' });
      return;
    }

    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(targetPath, buffer, { mode: 0o600 });

    const safeName = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || diskName;
    const record = nexoraStore.saveMedia({
      id: mediaId,
      ownerUid: user.uid,
      kind,
      mimeType: inspected.mimeType,
      ext: inspected.ext,
      size: buffer.length,
      fileName: safeName,
      createdAtMs: Date.now(),
    });

    res.status(201).json({
      ok: true,
      id: record.id,
      url: `/api/media/${record.id}`,
      mimeType: record.mimeType,
      size: record.size,
      fileName: record.fileName,
    });
  });

  app.get('/api/media/:mediaId', (req: Request, res: Response) => {
    const mediaId = String(req.params.mediaId || '').trim();
    if (!UUID_MEDIA_RE.test(mediaId)) {
      res.status(400).json({ error: 'Invalid media identifier.' });
      return;
    }

    const record = nexoraStore.getMedia(mediaId);
    if (!record) {
      res.status(404).json({ error: 'Media not found.' });
      return;
    }

    const filePath = path.resolve(UPLOADS_DIR, `${record.id}.${record.ext}`);
    if (!filePath.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Media binary missing.' });
      return;
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', record.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('Content-Disposition', `inline; filename="${record.fileName}"`);

    const stat = fs.statSync(filePath);
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = Math.max(0, Number.parseInt(parts[0], 10) || 0);
      const end = Math.min(stat.size - 1, parts[1] ? Number.parseInt(parts[1], 10) : stat.size - 1);
      if (start <= end && start < stat.size) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', String(end - start + 1));
        fs.createReadStream(filePath, { start, end }).pipe(res);
        return;
      }
    }

    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Accept-Ranges', 'bytes');
    fs.createReadStream(filePath).pipe(res);
  });

  app.delete('/api/media/:mediaId', async (req: Request, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;

    const mediaId = String(req.params.mediaId || '').trim();
    if (!UUID_MEDIA_RE.test(mediaId)) {
      res.status(400).json({ error: 'Invalid media identifier.' });
      return;
    }

    const record = nexoraStore.getMedia(mediaId);
    if (!record) {
      res.status(404).json({ error: 'Media not found.' });
      return;
    }
    if (record.ownerUid !== user.uid && !deps.isAdminUserServer(user)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const filePath = path.resolve(UPLOADS_DIR, `${record.id}.${record.ext}`);
    if (filePath.startsWith(UPLOADS_DIR + path.sep) && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {}
    }
    nexoraStore.deleteMedia(mediaId);
    res.json({ ok: true });
  });
}
