#!/usr/bin/env node
/**
 * @responsibility Baseline-aware ADR index validator wrapper.
 *
 * Purpose:
 * - Preserve the original strict validator as the full audit source of truth.
 * - Let CI/precommit fail only on new ADR index drift.
 * - Keep known historical deviations explicit in docs/adr/adr-index-baseline.json.
 *
 * This wrapper has no runtime trading imports and no live execution side effects.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIndex, scanAdrFiles, validate } from './check_adr_index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ADR_DIR = join(ROOT, 'docs', 'adr');
const INDEX_PATH = join(ADR_DIR, 'INDEX.md');
const BASELINE_PATH = join(ADR_DIR, 'adr-index-baseline.json');

function readJsonFile(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    return {
      ...fallback,
      baselineReadError: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeViolation(v) {
  return `${v.category}::${String(v.message).replace(/\s+/g, ' ').trim()}`;
}

function loadBaseline() {
  const baseline = readJsonFile(BASELINE_PATH, { version: 1, allowedViolations: [] });
  const allowed = Array.isArray(baseline.allowedViolations) ? baseline.allowedViolations : [];
  return {
    ...baseline,
    allowedViolations: allowed,
    allowedKeys: new Set(allowed.map(normalizeViolation)),
  };
}

function groupByCategory(violations) {
  const out = new Map();
  for (const v of violations) {
    if (!out.has(v.category)) out.set(v.category, []);
    out.get(v.category).push(v.message);
  }
  return out;
}

function printGrouped(prefix, violations) {
  const grouped = groupByCategory(violations);
  for (const [category, messages] of grouped) {
    console.error(`${prefix} [${category}] ${messages.length}건:`);
    for (const message of messages) console.error(`${prefix}   - ${message}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const full = args.includes('--full');
  const audit = args.includes('--audit');

  if (!existsSync(INDEX_PATH)) {
    const payload = {
      summary: { violationCount: 1, newViolationCount: 1, knownViolationCount: 0 },
      newViolations: [{ category: 'INDEX_MISSING', message: `INDEX.md 부재: ${INDEX_PATH}` }],
      knownViolations: [],
    };
    if (json) console.log(JSON.stringify(payload, null, 2));
    else console.error(`[ADR Index] FAIL — INDEX.md 부재: ${INDEX_PATH}`);
    process.exit(1);
  }

  const scan = scanAdrFiles(ADR_DIR);
  const parsed = parseIndex(readFileSync(INDEX_PATH, 'utf-8'));
  const { violations, summary } = validate(scan, parsed);
  const baseline = loadBaseline();

  const knownViolations = [];
  const newViolations = [];
  for (const violation of violations) {
    if (!full && baseline.allowedKeys.has(normalizeViolation(violation))) {
      knownViolations.push(violation);
    } else {
      newViolations.push(violation);
    }
  }

  const result = {
    summary: {
      ...summary,
      knownViolationCount: knownViolations.length,
      newViolationCount: newViolations.length,
      baselineAllowedCount: baseline.allowedViolations.length,
      baselineReadError: baseline.baselineReadError ?? null,
    },
    knownViolations,
    newViolations,
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit((audit || newViolations.length === 0) ? 0 : 1);
  }

  if (baseline.baselineReadError) {
    console.error(`[ADR Index] FAIL — baseline read error: ${baseline.baselineReadError}`);
    process.exit(1);
  }

  if (newViolations.length === 0) {
    const knownText = knownViolations.length > 0 ? ` / known historical ${knownViolations.length}건` : '';
    console.log(
      `[ADR Index] OK — ${summary.totalAdrFiles}개 파일 / ` +
      `${summary.uniqueNumbers}개 unique 번호 / ` +
      `충돌 ${summary.conflictGroups}그룹 / ` +
      `누락 ${summary.gapEntries}건 / ` +
      `다음 발급 ${summary.nextNumber}${knownText}`
    );
    if (knownViolations.length > 0) {
      console.log(`[ADR Index] baseline — ${knownViolations.length}건 historical deviation isolated in docs/adr/adr-index-baseline.json`);
    }
    process.exit(0);
  }

  console.error(`[ADR Index] FAIL — 신규 위반 ${newViolations.length}건 / known ${knownViolations.length}건:`);
  printGrouped(' ', newViolations);
  if (knownViolations.length > 0) {
    console.error('');
    console.error(`[ADR Index] known historical deviations ignored for strict CI: ${knownViolations.length}건`);
  }
  console.error('');
  console.error('해결: 신규 ADR drift를 수정하거나, 역사적 예외라면 docs/adr/adr-index-baseline.json에 명시적 사유와 함께 등재하십시오.');
  process.exit(1);
}

main();
