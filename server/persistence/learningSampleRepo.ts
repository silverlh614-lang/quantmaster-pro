// @responsibility supply_health LearningSample JSON persistence
import fs from 'fs';
import path from 'path';
import { DATA_DIR, ensureDataDir } from './paths.js';
import type { LearningSample } from '../learning/supplyHealthLearning.js';

const LEARNING_SAMPLES_FILE = path.join(DATA_DIR, 'learning-samples.json');
const LEARNING_SAMPLES_TRIM_LIMIT = 20_000;

function isLearningSample(value: unknown): value is LearningSample {
  if (!value || typeof value !== 'object') return false;
  const sample = value as Partial<LearningSample>;
  return (
    typeof sample.id === 'string' &&
    typeof sample.symbol === 'string' &&
    typeof sample.date === 'string' &&
    typeof sample.rawSignal === 'string' &&
    typeof sample.finalSignal === 'string' &&
    typeof sample.dataConfidence === 'number' &&
    !!sample.supplyHealthSnapshot
  );
}

export function loadLearningSamples(): LearningSample[] {
  ensureDataDir();
  if (!fs.existsSync(LEARNING_SAMPLES_FILE)) return [];
  try {
    const raw = fs.readFileSync(LEARNING_SAMPLES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLearningSample);
  } catch {
    return [];
  }
}

function saveLearningSamples(samples: LearningSample[]): void {
  ensureDataDir();
  const toSave = samples.length > LEARNING_SAMPLES_TRIM_LIMIT
    ? samples.slice(samples.length - LEARNING_SAMPLES_TRIM_LIMIT)
    : samples;
  const tmp = `${LEARNING_SAMPLES_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(toSave, null, 2), 'utf-8');
  fs.renameSync(tmp, LEARNING_SAMPLES_FILE);
}

export function appendLearningSample(sample: LearningSample): void {
  const samples = loadLearningSamples();
  samples.push(sample);
  saveLearningSamples(samples);
}

export function __resetLearningSamplesForTests(): void {
  try {
    if (fs.existsSync(LEARNING_SAMPLES_FILE)) fs.unlinkSync(LEARNING_SAMPLES_FILE);
    const tmp = `${LEARNING_SAMPLES_FILE}.tmp`;
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  } catch {
    // test cleanup only
  }
}
