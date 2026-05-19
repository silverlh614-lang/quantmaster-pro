#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyWarnPriority } from './classifyWarnPriority.ts';

const root = process.cwd();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const scanRoots = ['server', 'src', 'scripts', 'docs', '_workspace', 'ARCHITECTURE.md', 'README.md', '.env.example'];
const textExt = new Set(['.ts', '.tsx', '.js', '.jsx', '.md', '.mdx', '.json']);
const terms = [/console\.warn\s*\(/, /\bWARN\b/, /\bWARNING\b/];

function walk(target, out) {
  const abs = path.resolve(root, target);
  if (!fs.existsSync(abs)) return;
  const stat = fs.statSync(abs);
  if (stat.isFile()) return out.push(abs);
  for (const n of fs.readdirSync(abs)) {
    if (n === 'node_modules' || n === '.git' || n === 'dist') continue;
    walk(path.join(target, n), out);
  }
}

const files = [];
for (const t of scanRoots) walk(t, files);

const hits = [];
for (const file of files) {
  if (!textExt.has(path.extname(file))) continue;
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!terms.some((re) => re.test(line))) return;
    const c = classifyWarnPriority({ filePath: rel, line: i + 1, lineText: line, prevLine: lines[i - 1], nextLine: lines[i + 1] });
    hits.push({ ...c, text: line.trim() });
  });
}

const runtime = hits.filter((h) => h.runtimeCounted);
const p5 = hits.filter((h) => !h.runtimeCounted);
const breakdownKeys = ['DOC_ONLY', 'ADR_ONLY', 'TEST_ONLY', 'TYPE_ONLY', 'ENUM_ONLY', 'EXAMPLE_ONLY', 'WORKSPACE_ONLY', 'FIXTURE_ONLY'];
const p5Breakdown = Object.fromEntries(breakdownKeys.map((k) => [k, p5.filter((h) => h.reason === k).length]));

const suspicious = p5.filter((h) => /(^|\/)(server|src)\//.test(h.path) && /console\.warn\s*\(/.test(h.text));

console.log(`Runtime WARN count: ${runtime.length}`);
console.log(`Excluded P5 count: ${p5.length}`);
console.log('P5 breakdown:');
for (const k of breakdownKeys) console.log(`  - ${k}: ${p5Breakdown[k]}`);
console.log('Remaining direct runtime warns:');
runtime.slice(0, 50).forEach((h) => console.log(`  - ${h.path}:${h.line} ${h.text}`));
console.log('Suspicious P5 candidates:');
(suspicious.length ? suspicious : [{ path: '-', line: 0, text: 'none' }]).forEach((h) => console.log(`  - ${h.path}:${h.line} ${h.text}`));
console.log('Misclassified items:');
console.log('  - none auto-detected');
console.log('Risk:');
console.log('  - Heuristic classification may require manual review near mixed runtime/test helper files.');
console.log('Next action:');
console.log('  - Review suspicious candidates and migrate remaining runtime console.warn to wrappers where applicable.');
