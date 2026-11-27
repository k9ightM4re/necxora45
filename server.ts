import express from 'express';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { mountNexoraApiRoutes } from './server/api_router.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.use(
    express.json({
      limit: '8mb',
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NEXORA server running on http://0.0.0.0:${PORT} (${isProduction ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start NEXORA server:', err);
  process.exit(1);
});
