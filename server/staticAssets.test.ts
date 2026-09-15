import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { registerProductionAssets, resolveStaticAssetsPath } from './staticAssets.js';

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length) {
    const dir = tempRoots.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('production asset responses', () => {
  it('revalidates every shell entry, serves JavaScript, and returns 404 for removed chunks', async () => {
    const root = makeTempProject();
    fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><div id="root"></div>');
    fs.writeFileSync(path.join(root, 'assets/current.js'), 'export default 1;');
    const app = express();
    await registerProductionAssets(app, root);
    const server = await new Promise<Server>(resolve => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      for (const entry of ['/', '/index.html', '/research']) {
        const response = await fetch(base + entry);
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-cache, must-revalidate');
        expect(await response.text()).toContain('<!doctype html>');
        const validated = await fetch(base + entry, { headers: { 'If-None-Match': response.headers.get('etag')! } });
        expect(validated.status).toBe(304);
        expect(validated.headers.get('cache-control')).toBe('no-cache, must-revalidate');
      }
      const current = await fetch(base + '/assets/current.js');
      expect(current.status).toBe(200);
      expect(current.headers.get('content-type')).toContain('javascript');
      const removed = await fetch(base + '/assets/old.js');
      expect(removed.status).toBe(404);
      expect(removed.headers.get('cache-control')).toBe('no-store');
      expect(removed.headers.get('content-type')).not.toContain('html');
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});

function makeTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-static-'));
  tempRoots.push(dir);
  return dir;
}

describe('resolveStaticAssetsPath', () => {
  it('returns build path when index.html exists', () => {
    const projectRoot = makeTempProject();
    const serverDir = path.join(projectRoot, 'server');
    const buildDir = path.join(projectRoot, 'build');
    fs.mkdirSync(serverDir, { recursive: true });
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(path.join(buildDir, 'index.html'), '<html></html>');

    const result = resolveStaticAssetsPath(serverDir, projectRoot);

    expect(result.distPath).toBe(buildDir);
    expect(result.hasIndexHtml).toBe(true);
  });

  it('falls back to candidate path and marks missing index.html', () => {
    const projectRoot = makeTempProject();
    const serverDir = path.join(projectRoot, 'server');
    fs.mkdirSync(serverDir, { recursive: true });

    const result = resolveStaticAssetsPath(serverDir, projectRoot);

    expect(result.distPath).toBe(path.join(projectRoot, 'build'));
    expect(result.hasIndexHtml).toBe(false);
  });
});
