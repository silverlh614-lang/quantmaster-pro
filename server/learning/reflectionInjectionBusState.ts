// @responsibility ReflectionInjectionBus run-state persistence with pulse archive storage.
import fs from 'fs';
import path from 'path';
import { DATA_DIR, ensureDataDir } from '../persistence/paths.js';

export type ReflectionInjectionBusModule = 'freshnessGuard' | 'safetyGate' | 'shadowLiveDelta';
type ReflectionInjectionBusStatus = 'ACTIVE' | 'INACTIVE' | 'ERROR';

export interface ReflectionInjectionBusModuleState {
  enabled: boolean;
  status: ReflectionInjectionBusStatus;
  lastRunAt?: string;
  sampleSize?: number;
  decayedCount?: number;
  error?: string;
}

export interface ReflectionInjectionBusState {
  freshnessGuard?: ReflectionInjectionBusModuleState;
  safetyGate?: ReflectionInjectionBusModuleState;
  shadowLiveDelta?: ReflectionInjectionBusModuleState;
}

export interface LearningPulseArchiveStatus {
  lastSavedAt?: string;
  todayCount: number;
}

const REFLECTION_INJECTION_BUS_STATE_FILE = path.join(DATA_DIR, 'reflection-injection-bus-state.json');
const LEARNING_PULSE_ARCHIVE_FILE = path.join(DATA_DIR, 'learningPulseArchive.jsonl');

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

export function loadReflectionInjectionBusState(): ReflectionInjectionBusState {
  return readJson<ReflectionInjectionBusState>(REFLECTION_INJECTION_BUS_STATE_FILE, {});
}

export function recordReflectionInjectionBusRun(
  module: ReflectionInjectionBusModule,
  state: ReflectionInjectionBusModuleState,
): ReflectionInjectionBusState {
  const current = loadReflectionInjectionBusState();
  const next = { ...current, [module]: state };
  writeJson(REFLECTION_INJECTION_BUS_STATE_FILE, next);
  return next;
}

export function collectLearningPulseArchiveStatus(now: Date = new Date()): LearningPulseArchiveStatus {
  const today = now.toISOString().slice(0, 10);
  try {
    if (!fs.existsSync(LEARNING_PULSE_ARCHIVE_FILE)) return { todayCount: 0 };
    const lines = fs.readFileSync(LEARNING_PULSE_ARCHIVE_FILE, 'utf-8')
      .split('\n')
      .filter((line) => line.trim().length > 0);
    let lastSavedAt: string | undefined;
    let todayCount = 0;
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as { date?: string; savedAt?: string };
        if (parsed.savedAt) lastSavedAt = parsed.savedAt;
        if (parsed.date === today) todayCount++;
      } catch (e) {
        console.warn('[LearningPulse] archive line ignored (non-fatal):', e);
      }
    }
    return { lastSavedAt, todayCount };
  } catch {
    return { todayCount: 0 };
  }
}

export function appendLearningPulseArchive(
  pulse: unknown,
  now: Date = new Date(),
): LearningPulseArchiveStatus {
  ensureDataDir();
  const entry = {
    date: now.toISOString().slice(0, 10),
    savedAt: now.toISOString(),
    pulse,
  };
  fs.appendFileSync(LEARNING_PULSE_ARCHIVE_FILE, `${JSON.stringify(entry)}\n`);
  return collectLearningPulseArchiveStatus(now);
}
