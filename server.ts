import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { mountNexoraApiRoutes, verifyFirebaseToken } from './server/api_router.ts';
import { attachNexoraWebSocketServer } from './server/realtime_ws.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  // Unified production security headers & WebRTC Permissions-Policy
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(self), microphone=(self), display-capture=(self), geolocation=(self)'
    );
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com https://apis.google.com https://accounts.google.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob: https: http:",
        "media-src 'self' data: blob: https: http:",
        "connect-src 'self' https: wss: ws:",
        "frame-src 'self' https://accounts.google.com https://www.youtube.com https://www.youtube-nocookie.com https://*.firebaseapp.com",
      ].join('; ')
    );
    next();
  });

  app.use(
    express.json({
      limit: '15mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    })
  );
  app.use(express.urlencoded({ extended: false }));

  mountNexoraApiRoutes(app);

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'mpa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir, { extensions: ['html'] }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      const cleanPath = req.path === '/' ? 'index.html' : req.path.replace(/^\/+/, '');
      const candidate = path.join(distDir, cleanPath);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        res.sendFile(candidate);
        return;
      }
      if (fs.existsSync(`${candidate}.html`)) {
        res.sendFile(`${candidate}.html`);
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  attachNexoraWebSocketServer(httpServer, { verifyFirebaseToken });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(
      `NEXORA server running on http://0.0.0.0:${PORT} (${isProduction ? 'production' : 'development'})`
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start NEXORA server:', err);
  process.exit(1);
});
