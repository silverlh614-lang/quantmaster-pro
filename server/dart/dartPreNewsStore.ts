// @responsibility DART 선행공시 후보 영속화
import fs from 'fs';
import path from 'path';
import { DATA_DIR, ensureDataDir } from '../persistence/paths.js';
import type { DartPreNewsCandidate } from './dartPreNewsTypes.js';

const DART_PRE_NEWS_FILE = path.join(DATA_DIR, 'dart-pre-news-candidates.json');

function loadDartPreNewsCandidates(): DartPreNewsCandidate[] {
  ensureDataDir();
  if (!fs.existsSync(DART_PRE_NEWS_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(DART_PRE_NEWS_FILE, 'utf-8')) as DartPreNewsCandidate[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDartPreNewsCandidates(candidates: DartPreNewsCandidate[]): void {
  ensureDataDir();
  const deduped = dedupeDartPreNewsCandidates(candidates).slice(-500);
  fs.writeFileSync(DART_PRE_NEWS_FILE, JSON.stringify(deduped, null, 2));
}

export function upsertDartPreNewsCandidates(next: DartPreNewsCandidate[]): DartPreNewsCandidate[] {
  const byDisclosureId = new Map<string, DartPreNewsCandidate>();
  for (const candidate of loadDartPreNewsCandidates()) byDisclosureId.set(candidate.disclosureId, candidate);
  for (const candidate of next) byDisclosureId.set(candidate.disclosureId, candidate);
  const saved = Array.from(byDisclosureId.values());
  saveDartPreNewsCandidates(saved);
  return saved;
}

export function dedupeDartPreNewsCandidates(candidates: DartPreNewsCandidate[]): DartPreNewsCandidate[] {
  const byDisclosureId = new Map<string, DartPreNewsCandidate>();
  for (const candidate of candidates) byDisclosureId.set(candidate.disclosureId, candidate);
  return Array.from(byDisclosureId.values());
}
