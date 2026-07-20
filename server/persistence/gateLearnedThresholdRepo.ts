// @responsibility counterfacture_gate Phase D — operator 승인 학습 임계 영속 store (learning-only, 주문/provider 호출 0).
/**
 * gateLearnedThresholdRepo.ts (counterfacture_gate Phase D)
 *
 * Phase C ROC 권고 중 *operator 가 명시 승인한* 임계만 영속한다. 권고 엔진은 본 store 에
 * 자동 기록하지 않는다 — approveGateLearnedThreshold 는 operator 액션 전용.
 * 적용(gateLearnedThresholdApply)은 flag ON + 승인분 존재 + window-clamp 를 모두 만족할 때만.
 */

import fs from 'fs';
import { GATE_LEARNED_THRESHOLD_FILE, ensureDataDir } from './paths.js';

type GateLearnedThresholdGate = 'GATE1' | 'GATE2' | 'GATE3';

interface GateLearnedThresholdBasis {
  sampleSize: number;
  winSample: number;
  lossSample: number;
  suggestedThreshold: number;
  decision: string;
}

export interface GateLearnedThresholdEntry {
  gate: GateLearnedThresholdGate;
  regime: string;
  /** operator 승인 임계값(스케일은 gate 별 고정 — G1 ×10, G3 ×1). */
  approvedThreshold: number;
  scale: 1 | 10;
  approvedBy: string;
  approvedAtKst: string;
  basis: GateLearnedThresholdBasis;
}

interface GateLearnedThresholdFile {
  version: 1;
  entries: GateLearnedThresholdEntry[];
}

function entryKey(gate: string, regime: string): string {
  return `${gate}:${regime}`;
}

function isFile(value: unknown): value is GateLearnedThresholdFile {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as GateLearnedThresholdFile).entries));
}

function readFile(filePath = GATE_LEARNED_THRESHOLD_FILE): GateLearnedThresholdFile {
  ensureDataDir();
  if (!fs.existsSync(filePath)) return { version: 1, entries: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return isFile(parsed) ? parsed : { version: 1, entries: [] };
  } catch {
    return { version: 1, entries: [] };
  }
}

function writeFile(file: GateLearnedThresholdFile, filePath = GATE_LEARNED_THRESHOLD_FILE): void {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify({ version: 1 as const, entries: file.entries }, null, 2));
}

/** gate×regime 최신 승인분(가장 뒤에 append 된 것)을 반환. 없으면 null. */
export function getGateLearnedThreshold(
  gate: string,
  regime: string,
  filePath = GATE_LEARNED_THRESHOLD_FILE,
): GateLearnedThresholdEntry | null {
  const wanted = entryKey(gate, regime);
  const entries = readFile(filePath).entries;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entryKey(entries[i].gate, entries[i].regime) === wanted) return entries[i];
  }
  return null;
}

/** operator 승인 기록(append). *자동 호출 금지* — operator 명시 액션 전용(Phase L seam). */
export function approveGateLearnedThreshold(
  entry: GateLearnedThresholdEntry,
  filePath = GATE_LEARNED_THRESHOLD_FILE,
): GateLearnedThresholdEntry {
  const file = readFile(filePath);
  file.entries.push(entry);
  writeFile(file, filePath);
  return entry;
}

/** 전체 승인분(append 순) 반환 — status 표시 전용(read-only). */
export function listGateLearnedThresholds(
  filePath = GATE_LEARNED_THRESHOLD_FILE,
): GateLearnedThresholdEntry[] {
  return readFile(filePath).entries;
}
