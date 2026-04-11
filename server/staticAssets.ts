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
