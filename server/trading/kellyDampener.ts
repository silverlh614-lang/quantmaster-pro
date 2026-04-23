/**
 * kellyDampener.ts — IPS × MAPC 자동 연결 루프
 *
 * @responsibility IPS 변곡 확률에 따라 신규 포지션 Kelly 배율 감쇠치를 유지한다.
 *
 * IPS(Integrated Inflection Point Score)가 임계치를 넘으면 즉시 MAPC 측
 * Kelly Fraction 계산 경로가 읽는 감쇠 배율을 업데이트한다.
 *
 *   IPS ≥ 70 → 0.5× 감쇠 (신규 포지션 크기 반감)
 *   IPS ≥ 80 → 0.3× 감쇠 (기존 CRITICAL 액션과 정합)
 *   IPS ≥ 90 → 0.1× 감쇠 (EXTREME 방어)
 *   IPS < 60 → 1.0× (해제)
 *
 * 페르소나 원칙: "매수보다 리스크 관리와 매도가 더 중요하다" — 변곡 감지 시
 * 인간 판단 이전에 시스템이 먼저 포지션을 축소시킨다.
 *
 * ─── 관련 모듈 (P1-2 구현 완료) ────────────────────────────────────────────
 * 본 dampener (IPS 기반) 는 "위험 신호 시 즉시 사이즈 축소" 만 담당한다.
 * 별도로 다음 두 모듈이 결합되어 다층 사이징을 형성한다:
 *
 *   - `sizingTier.ts`           — 신호 품질 (CONVICTION/STANDARD/PROBING) → Kelly 계수
 *   - `accountRiskBudget.ts`    — 계좌 레벨 일일/동시 R 한도 + Fractional Kelly 캡 강제
 *
 * 결합 흐름 (signalScanner.ts):
 *   positionPct = computeRawPositionPct(gateScore)
 *               × kellyMultiplier(레짐·VIX·FOMC·IPS·exception·accountScale)
 *               × mtasMultiplier × sectionFactor × tierDecision.kellyFactor
 *   →  computeRiskAdjustedSize(...) 가 위 값을 입력으로 받아
 *     "Fractional Kelly cap × confidence × risk-budget cap" 으로 한 번 더 잘라낸다.
 *
 * 운영자는 `/risk` 텔레그램 명령으로 현재 리스크 예산을 즉시 확인 가능.
 * ─────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import { KELLY_DAMPENER_FILE, ensureDataDir } from '../persistence/paths.js';

export interface KellyDampenerState {
  /** 현재 Kelly 배율 (0~1). 신규 포지션 계산 시 곱해서 사용. */
  multiplier: number;
  /** 마지막 IPS 값 */
  ips: number;
  /** 마지막 IPS 단계 */
  level: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'EXTREME';
  /** 감쇠가 활성화된 시각 (ISO) */
  activeSince: string | null;
  /** 마지막 업데이트 시각 (ISO) */
  updatedAt: string;
}

const DEFAULT_STATE: KellyDampenerState = {
  multiplier: 1.0,
  ips: 0,
  level: 'NORMAL',
  activeSince: null,
  updatedAt: new Date(0).toISOString(),
};

/** IPS 임계치 → Kelly 감쇠 배율 테이블 */
export const IPS_KELLY_TABLE: Array<{ threshold: number; multiplier: number; level: KellyDampenerState['level'] }> = [
  { threshold: 90, multiplier: 0.1, level: 'EXTREME' },
  { threshold: 80, multiplier: 0.3, level: 'CRITICAL' },
  { threshold: 70, multiplier: 0.5, level: 'WARNING' },
];

export function loadKellyDampenerState(): KellyDampenerState {
  ensureDataDir();
  if (!fs.existsSync(KELLY_DAMPENER_FILE)) return { ...DEFAULT_STATE };
  try {
    const raw = JSON.parse(fs.readFileSync(KELLY_DAMPENER_FILE, 'utf-8'));
    return { ...DEFAULT_STATE, ...raw };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveKellyDampenerState(state: KellyDampenerState): void {
  ensureDataDir();
  fs.writeFileSync(KELLY_DAMPENER_FILE, JSON.stringify(state, null, 2));
}

/**
 * 현재 적용되어야 할 Kelly 배율을 반환한다.
 * signalScanner.ts 등 포지션 크기 산출 경로에서 읽어 곱한다.
 */
export function getKellyMultiplier(): number {
  return loadKellyDampenerState().multiplier;
}

export function isKellyDampenerActive(): boolean {
  return loadKellyDampenerState().multiplier < 1.0;
}

function lookupMultiplierForIps(ips: number): { multiplier: number; level: KellyDampenerState['level'] } {
  for (const row of IPS_KELLY_TABLE) {
    if (ips >= row.threshold) return { multiplier: row.multiplier, level: row.level };
  }
  return { multiplier: 1.0, level: 'NORMAL' };
}

/**
 * IPS 값을 바탕으로 Kelly 감쇠 상태를 업데이트한다.
 *
 * @returns `{ changed }` — 배율이 바뀌었는지 여부. true이면 호출자가
 *   텔레그램 "변곡 감지 알림"을 송출한다.
 */
export function updateKellyDampenerFromIps(ips: number): {
  changed: boolean;
  prevMultiplier: number;
  multiplier: number;
  level: KellyDampenerState['level'];
  activatedNow: boolean;
} {
  const prev = loadKellyDampenerState();
  const { multiplier, level } = lookupMultiplierForIps(ips);
  const changed = Math.abs(multiplier - prev.multiplier) > 1e-6;
  const activatedNow = prev.multiplier === 1.0 && multiplier < 1.0;

  const next: KellyDampenerState = {
    multiplier,
    ips,
    level,
    activeSince: multiplier < 1.0 ? (prev.activeSince && prev.multiplier < 1.0 ? prev.activeSince : new Date().toISOString()) : null,
    updatedAt: new Date().toISOString(),
  };

  saveKellyDampenerState(next);

  return {
    changed,
    prevMultiplier: prev.multiplier,
    multiplier,
    level,
    activatedNow,
  };
}

/** 수동 해제 — /admin 엔드포인트에서 호출 가능. */
export function clearKellyDampener(): void {
  saveKellyDampenerState({ ...DEFAULT_STATE, updatedAt: new Date().toISOString() });
}
