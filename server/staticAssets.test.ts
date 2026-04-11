import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveStaticAssetsPath } from './staticAssets.js';

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length) {
    const dir = tempRoots.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
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
