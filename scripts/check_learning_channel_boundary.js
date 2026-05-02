#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const TARGET_DIRS = ['server/learning', 'server/trading'];
const FORBIDDEN = [
  'src/services/quant/evolutionEngine',
  'src/services/quant/aiUniverseService',
  'src/services/quant/macroEngine',
  'src/services/quant/mtfEngine',
  'src/services/quant/percentileClassifier',
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && full.endsWith('.ts')) out.push(full);
  }
  return out;
}

function normalizeSpecifier(specifier, fromFile) {
  if (!specifier.startsWith('.')) return specifier;
  const abs = path.resolve(path.dirname(fromFile), specifier);
  return path.relative(ROOT, abs).replace(/\\/g, '/').replace(/\.(ts|js|tsx|jsx)$/, '');
}

const importRe = /\bimport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)/g;
const violations = [];

for (const targetDir of TARGET_DIRS) {
  for (const file of walk(path.join(ROOT, targetDir))) {
    const source = fs.readFileSync(file, 'utf-8');
    for (const match of source.matchAll(importRe)) {
      const specifier = match[1] ?? match[2];
      const normalized = normalizeSpecifier(specifier, file);
      const forbidden = FORBIDDEN.find((item) => normalized === item || normalized.endsWith(`/${item}`));
      if (forbidden) {
        violations.push({
          file: path.relative(ROOT, file).replace(/\\/g, '/'),
          importText: match[0],
          reason: `server learning/trading must not import client AI recommendation channel (${forbidden})`,
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error('[learning-channel-boundary] forbidden imports found');
  for (const v of violations) {
    console.error(`- ${v.file}: ${v.importText}`);
    console.error(`  reason: ${v.reason}`);
  }
  process.exit(1);
}

console.log('[learning-channel-boundary] ok');
