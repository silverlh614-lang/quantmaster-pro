// @responsibility staticAssets 서버 모듈
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import express, { type Express, type Request, type Response } from 'express';

export interface StaticAssetsResolution {
  distPath: string;
  hasIndexHtml: boolean;
}

export function resolveStaticAssetsPath(baseDir: string, cwd: string): StaticAssetsResolution {
  const candidates = [
    path.join(baseDir, '..', 'build'),
    path.join(cwd, 'build'),
    path.join(baseDir, '..', 'dist'),
    path.join(cwd, 'dist'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) {
      return {
        distPath: candidate,
        hasIndexHtml: true,
      };
    }
  }

  return {
    distPath: candidates[0],
    hasIndexHtml: false,
  };
}

export async function registerProductionAssets(app: Express, distPath: string): Promise<void> {
  const indexPath = path.join(distPath, 'index.html');
  const [indexHtml, indexStats] = await Promise.all([
    fs.promises.readFile(indexPath, 'utf8'), fs.promises.stat(indexPath),
  ]);
  const etag = `"${createHash('sha1').update(indexHtml).digest('hex')}"`;
  const sendShell = (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-cache, must-revalidate');
    res.set('ETag', etag);
    res.set('Last-Modified', indexStats.mtime.toUTCString());
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    return res.type('html').send(indexHtml);
  };
  // These paths must reach the same revalidating shell before express.static serves index.html.
  app.get(['/', '/index.html'], sendShell);
  app.use(express.static(distPath, { index: false }));
  // A removed deployment chunk is an asset miss, never an HTML navigation.
  app.get('/assets/*', (_req, res) => {
    res.set('Cache-Control', 'no-store').status(404).type('text/plain').send('Asset not found');
  });
  app.get('*', sendShell);
}
