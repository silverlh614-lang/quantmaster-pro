import fs from 'fs';
import path from 'path';

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

  const resolved = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'index.html'))) ?? candidates[0];

  return {
    distPath: resolved,
    hasIndexHtml: fs.existsSync(path.join(resolved, 'index.html')),
  };
}
