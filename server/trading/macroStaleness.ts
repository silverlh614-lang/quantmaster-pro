/**
 * @responsibility macroState 신선도 검증 SSOT — 자동매매 진입 차단 정책 (ADR-0068)
 *
 * macroState 가 N시간 이상 stale 일 때 자동매매 진입을 차단한다. AI hallucinate 차단
 * (ADR-0064) 위에 *시간차원 데이터 노화* 차단을 추가하는 layer.
 *
 * 정책 (사용자 진단 #1+#3):
 *   - age ≤ 8h  → FRESH (정상 진입)
 *   - 8h < age ≤ 24h → STALE_WARN (운영자 알림 1회, 진입 허용)
 *   - age > 24h → STALE_BLOCK (시장 판단 BLOCK + 진입 전면 차단 + CRITICAL 알림)
 *
 * macroStateUpdatedAt 부재/잘못된 ISO → STALE_BLOCK 안전 fallback.
 *
 * 호출자: signalScanner/preflight (스캔 진입 전 게이트), dryRunScanner (진단 트리거).
 *
 * 환경변수 우회:
 *   - MACRO_STALENESS_DISABLED=true → 모든 검사 스킵 (긴급 운영 우회, 권장 안 함)
 *   - MACRO_STALE_WARN_HOURS=N (default 8) → WARN 임계
 *   - MACRO_STALE_BLOCK_HOURS=N (default 24) → BLOCK 임계
 */
import { loadMacroState, type MacroState } from '../persistence/macroStateRepo.js';

export type MacroStalenessTier = 'FRESH' | 'STALE_WARN' | 'STALE_BLOCK' | 'NO_DATA';

export interface MacroStalenessResult {
  tier: MacroStalenessTier;
  ageMs: number | null;       // updatedAt 부재/잘못된 ISO 시 null
  ageHours: number | null;    // ageMs 의 시간 환산 (소수점 1자리)
  updatedAt: string | null;
  warnThresholdHours: number;
  blockThresholdHours: number;
  /** 진입 차단 여부 (STALE_BLOCK + NO_DATA + 환경변수 미우회). */
  shouldBlockEntry: boolean;
  /** 운영자 알림 권장 (STALE_WARN + STALE_BLOCK + NO_DATA). */
  shouldAlertOperator: boolean;
  /** 한국어 사유 메시지 (텔레그램·로그용). */
  reason: string;
}

const DEFAULT_WARN_HOURS = 8;
const DEFAULT_BLOCK_HOURS = 24;

function readEnvNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function isMacroStalenessDisabled(): boolean {
  return process.env.MACRO_STALENESS_DISABLED === 'true';
}

/**
 * macroState 신선도 평가. macro 인자 미전달 시 자동 loadMacroState() 호출.
 *
 * 주의: 본 함수는 부수효과 0 — *분류만* 한다. 차단 결정은 호출자(preflight)가
 * shouldBlockEntry 를 보고 별도 로깅/알림/abort 처리해야 한다.
 */
export function evaluateMacroStaleness(
  macro?: MacroState | null,
  now: Date = new Date(),
): MacroStalenessResult {
  const warnH = readEnvNumber('MACRO_STALE_WARN_HOURS', DEFAULT_WARN_HOURS);
  const blockH = readEnvNumber('MACRO_STALE_BLOCK_HOURS', DEFAULT_BLOCK_HOURS);
  const disabled = isMacroStalenessDisabled();

  const state = macro === undefined ? loadMacroState() : macro;

  // updatedAt 부재 / 잘못된 ISO → NO_DATA
  if (!state || !state.updatedAt) {
    return {
      tier: 'NO_DATA',
      ageMs: null,
      ageHours: null,
      updatedAt: null,
      warnThresholdHours: warnH,
      blockThresholdHours: blockH,
      shouldBlockEntry: !disabled,
      shouldAlertOperator: !disabled,
      reason: 'macroState 미수집 — 거시 데이터 없이 진입 위험',
    };
  }

  const updatedTs = Date.parse(state.updatedAt);
  if (!Number.isFinite(updatedTs)) {
    return {
      tier: 'NO_DATA',
      ageMs: null,
      ageHours: null,
      updatedAt: state.updatedAt,
      warnThresholdHours: warnH,
      blockThresholdHours: blockH,
      shouldBlockEntry: !disabled,
      shouldAlertOperator: !disabled,
      reason: `macroState.updatedAt 형식 오류 (${state.updatedAt})`,
    };
  }

  const ageMs = Math.max(0, now.getTime() - updatedTs);
  const ageHoursRaw = ageMs / 3_600_000;  // 비교용 (정확)
  const ageHours = Math.round(ageHoursRaw * 10) / 10;  // 표시용 (소수점 1자리)

  if (ageHoursRaw <= warnH) {
    return {
      tier: 'FRESH',
      ageMs,
      ageHours,
      updatedAt: state.updatedAt,
      warnThresholdHours: warnH,
      blockThresholdHours: blockH,
      shouldBlockEntry: false,
      shouldAlertOperator: false,
      reason: `정상 (${ageHours}h ≤ ${warnH}h)`,
    };
  }

  if (ageHoursRaw <= blockH) {
    return {
      tier: 'STALE_WARN',
      ageMs,
      ageHours,
      updatedAt: state.updatedAt,
      warnThresholdHours: warnH,
      blockThresholdHours: blockH,
      shouldBlockEntry: false,
      shouldAlertOperator: !disabled,
      reason: `갱신 지연 (${ageHours}h, ${warnH}~${blockH}h 구간) — 진입 허용·경보`,
    };
  }

  // ageHours > blockH
  return {
    tier: 'STALE_BLOCK',
    ageMs,
    ageHours,
    updatedAt: state.updatedAt,
    warnThresholdHours: warnH,
    blockThresholdHours: blockH,
    shouldBlockEntry: !disabled,
    shouldAlertOperator: !disabled,
    reason: `STALE 차단 (${ageHours}h > ${blockH}h) — 거시 데이터 노후로 시장 판단 BLOCK`,
  };
}

/** /health · 텔레그램 메시지용 한국어 라벨. */
export function formatStalenessTier(tier: MacroStalenessTier): string {
  switch (tier) {
    case 'FRESH':       return '✅ 신선';
    case 'STALE_WARN':  return '🟡 갱신 지연';
    case 'STALE_BLOCK': return '❌ STALE 차단';
    case 'NO_DATA':     return '⚠️ 미수집';
  }
}
