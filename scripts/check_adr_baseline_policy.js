#!/usr/bin/env node
/**
 * @responsibility ADR baseline exception policy guard.
 *
 * Purpose:
 * - Prevent docs/adr/adr-index-baseline.json from becoming a generic CI bypass list.
 * - Enforce explicit metadata for every allowed historical violation.
 * - Fail expired temporary exceptions.
 *
 * This script is governance-only and has no runtime trading side effects.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASELINE_PATH = join(ROOT, 'docs', 'adr', 'adr-index-baseline.json');

const VALID_CLASSIFICATIONS = new Set(['historical', 'temporary']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    return { error: `baseline file missing: ${BASELINE_PATH}` };
  }
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
  } catch (error) {
    return { error: `baseline JSON parse error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isExpired(dateString, now = new Date()) {
  if (!isValidIsoDate(dateString)) return false;
  const expiryEndUtc = new Date(`${dateString}T23:59:59.999Z`).getTime();
  return now.getTime() > expiryEndUtc;
}

function validateEntry(entry, index) {
  const errors = [];
  const prefix = `allowedViolations[${index}]`;

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return [`${prefix}: entry must be an object`];
  }

  if (typeof entry.category !== 'string' || entry.category.trim().length < 3) {
    errors.push(`${prefix}.category is required`);
  }
  if (typeof entry.message !== 'string' || entry.message.trim().length < 12) {
    errors.push(`${prefix}.message is required and must be specific`);
  }
  if (typeof entry.reason !== 'string' || entry.reason.trim().length < 30) {
    errors.push(`${prefix}.reason is required and must explain why this is historical`);
  }
  if (!isValidIsoDate(entry.createdAt)) {
    errors.push(`${prefix}.createdAt must be YYYY-MM-DD`);
  }
  if (typeof entry.owner !== 'string' || entry.owner.trim().length < 2) {
    errors.push(`${prefix}.owner is required`);
  }
  if (!VALID_CLASSIFICATIONS.has(entry.classification)) {
    errors.push(`${prefix}.classification must be historical or temporary`);
  }

  if (entry.classification === 'historical') {
    if (entry.expiresAt !== null) {
      errors.push(`${prefix}.expiresAt must be null for historical exceptions`);
    }
  } else if (entry.classification === 'temporary') {
    if (!isValidIsoDate(entry.expiresAt)) {
      errors.push(`${prefix}.expiresAt must be YYYY-MM-DD for temporary exceptions`);
    } else if (isExpired(entry.expiresAt)) {
      errors.push(`${prefix}.expiresAt has expired (${entry.expiresAt})`);
    }
  }

  return errors;
}

function validateBaseline(baseline) {
  const errors = [];
  if (baseline.error) return [baseline.error];

  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
    return ['baseline root must be an object'];
  }
  if (baseline.version !== 1) {
    errors.push('baseline.version must be 1');
  }
  if (!isValidIsoDate(baseline.createdAt)) {
    errors.push('baseline.createdAt must be YYYY-MM-DD');
  }
  if (typeof baseline.purpose !== 'string' || baseline.purpose.trim().length < 30) {
    errors.push('baseline.purpose is required and must explain governance intent');
  }
  if (!Array.isArray(baseline.allowedViolations)) {
    errors.push('baseline.allowedViolations must be an array');
    return errors;
  }

  const seen = new Set();
  baseline.allowedViolations.forEach((entry, index) => {
    errors.push(...validateEntry(entry, index));
    if (entry && typeof entry === 'object') {
      const key = `${entry.category ?? ''}::${entry.message ?? ''}`;
      if (seen.has(key)) errors.push(`allowedViolations[${index}] duplicates category/message pair`);
      seen.add(key);
    }
  });

  return errors;
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const baseline = readBaseline();
  const errors = validateBaseline(baseline);
  const result = {
    ok: errors.length === 0,
    errors,
    allowedViolationCount: Array.isArray(baseline?.allowedViolations) ? baseline.allowedViolations.length : 0,
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`[ADR Baseline] OK — ${result.allowedViolationCount} explicit exception(s)`);
  } else {
    console.error(`[ADR Baseline] FAIL — ${errors.length} policy violation(s):`);
    for (const error of errors) console.error(`  - ${error}`);
  }

  process.exit(result.ok ? 0 : 1);
}

main();
