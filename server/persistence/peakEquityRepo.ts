/**
 * @responsibility ADR-0164 peakEquity 영속 SSOT — drawdown 자동 차단 입력 + 자동 갱신 정책 진입점
 *
 * `server/trading/sizing/positionSizingEngine` 의 `drawdownAdapter.getDrawdownMultiplier(peakEquity, currentEquity)`
 * 입력으로 사용. 현재 자본 (totalAssets) 이 영속 peak 보다 크면 자동 갱신.
 *
 * SHADOW / LIVE 분리 — SHADOW 는 startingCapital 기반 가상 자본, LIVE 는 KIS 실잔고.
 * 두 모드의 peak 영속은 *분리* (SHADOW peak 가 LIVE 결정에 영향 안 함).
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { PEAK_EQUITY_FILE } from './paths.js';

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface PeakEquitySnapshot {
  /** SHADOW 모드 peak (가상 자본 기반) */
  shadowPeakEquity: number;
  /** SHADOW 모드 peak 도달 시각 (ISO) */
  shadowPeakAt: string | null;
  /** LIVE 모드 peak (KIS 실잔고 기반) */
  livePeakEquity: number;
  /** LIVE 모드 peak 도달 시각 (ISO) */
  livePeakAt: string | null;
  /** schema 버전 — 후방호환 */
  schemaVersion: number;
}

export const PEAK_EQUITY_SCHEMA_VERSION = 1;

const EMPTY_SNAPSHOT: PeakEquitySnapshot = {
  shadowPeakEquity: 0,
  shadowPeakAt: null,
  livePeakEquity: 0,
  livePeakAt: null,
  schemaVersion: PEAK_EQUITY_SCHEMA_VERSION,
};

export type PeakEquityMode = 'SHADOW' | 'LIVE';

// ─── 영속 read/write ────────────────────────────────────────────────────────

/**
 * 영속 SSOT 로드. 부재 / 손상 JSON / null / 잘못된 schema 모두 빈 snapshot fallback.
 */
export function loadPeakEquitySnapshot(): PeakEquitySnapshot {
  if (!existsSync(PEAK_EQUITY_FILE)) return { ...EMPTY_SNAPSHOT };
  try {
    const raw = readFileSync(PEAK_EQUITY_FILE, 'utf-8');
    if (!raw.trim()) return { ...EMPTY_SNAPSHOT };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...EMPTY_SNAPSHOT };
    }
    return {
      shadowPeakEquity: Number.isFinite(parsed.shadowPeakEquity) && parsed.shadowPeakEquity > 0
        ? parsed.shadowPeakEquity : 0,
      shadowPeakAt: typeof parsed.shadowPeakAt === 'string' ? parsed.shadowPeakAt : null,
      livePeakEquity: Number.isFinite(parsed.livePeakEquity) && parsed.livePeakEquity > 0
        ? parsed.livePeakEquity : 0,
      livePeakAt: typeof parsed.livePeakAt === 'string' ? parsed.livePeakAt : null,
      schemaVersion: PEAK_EQUITY_SCHEMA_VERSION,
    };
  } catch {
    return { ...EMPTY_SNAPSHOT };
  }
}

/**
 * Atomic write (tmp → rename) — race condition 시 이전 정상 본 보존.
 */
export function savePeakEquitySnapshot(snapshot: PeakEquitySnapshot): void {
  const normalized: PeakEquitySnapshot = {
    shadowPeakEquity: Number.isFinite(snapshot.shadowPeakEquity) && snapshot.shadowPeakEquity > 0
      ? snapshot.shadowPeakEquity : 0,
    shadowPeakAt: snapshot.shadowPeakAt,
    livePeakEquity: Number.isFinite(snapshot.livePeakEquity) && snapshot.livePeakEquity > 0
      ? snapshot.livePeakEquity : 0,
    livePeakAt: snapshot.livePeakAt,
    schemaVersion: PEAK_EQUITY_SCHEMA_VERSION,
  };
  const tmpPath = `${PEAK_EQUITY_FILE}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(normalized, null, 2), 'utf-8');
  renameSync(tmpPath, PEAK_EQUITY_FILE);
}

// ─── 진입점 ──────────────────────────────────────────────────────────────────

/**
 * 모드별 peak equity 조회.
 * @returns 영속값 (없거나 0 이면 0 반환 — 호출자 안전 fallback 의무)
 */
export function getPeakEquity(mode: PeakEquityMode): number {
  const snapshot = loadPeakEquitySnapshot();
  return mode === 'SHADOW' ? snapshot.shadowPeakEquity : snapshot.livePeakEquity;
}

/**
 * 모드별 peak equity 조회 + 메타데이터.
 */
export function getPeakEquityWithMeta(mode: PeakEquityMode): { peakEquity: number; peakAt: string | null } {
  const snapshot = loadPeakEquitySnapshot();
  return mode === 'SHADOW'
    ? { peakEquity: snapshot.shadowPeakEquity, peakAt: snapshot.shadowPeakAt }
    : { peakEquity: snapshot.livePeakEquity, peakAt: snapshot.livePeakAt };
}

/**
 * 현재 자본이 영속 peak 보다 크면 자동 갱신. 그 외 no-op.
 *
 * @returns 갱신 발생 여부 (true=갱신, false=no-op)
 */
export function updatePeakEquityIfHigher(mode: PeakEquityMode, currentEquity: number, now: Date = new Date()): boolean {
  if (!Number.isFinite(currentEquity) || currentEquity <= 0) return false;

  const snapshot = loadPeakEquitySnapshot();
  const currentPeak = mode === 'SHADOW' ? snapshot.shadowPeakEquity : snapshot.livePeakEquity;

  if (currentEquity <= currentPeak) return false;

  const updated: PeakEquitySnapshot = {
    ...snapshot,
    ...(mode === 'SHADOW'
      ? { shadowPeakEquity: currentEquity, shadowPeakAt: now.toISOString() }
      : { livePeakEquity: currentEquity, livePeakAt: now.toISOString() }),
  };
  savePeakEquitySnapshot(updated);
  return true;
}

/**
 * peakEquity 안전 fallback — 영속값 0 (부재) 시 currentEquity 사용 (drawdown 0).
 * `mapToPositionSizingInput` 의 단일 호출자.
 */
export function getEffectivePeakEquity(mode: PeakEquityMode, currentEquity: number): number {
  const peak = getPeakEquity(mode);
  return peak > 0 ? peak : currentEquity;
}

/**
 * 테스트 전용 — 영속 상태 초기화.
 * (production 코드에서 호출 금지)
 */
export function __resetPeakEquityForTests(): void {
  if (existsSync(PEAK_EQUITY_FILE)) {
    try {
      writeFileSync(PEAK_EQUITY_FILE, JSON.stringify(EMPTY_SNAPSHOT, null, 2), 'utf-8');
    } catch {
      // ignore
    }
  }
}
