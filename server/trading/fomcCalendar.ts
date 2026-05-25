// @responsibility fomcCalendar 매매 엔진 모듈
/**
 * fomcCalendar.ts — FOMC 일정 기반 자동 포지션 사이즈 조절기
 *
 * FOMC 근접도 함수로 Kelly 배율을 자동 조절한다.
 *
 * ┌─ 위상별 동작 (정책 v4 — 2026-04-26 사용자 운영 결정, D-3~D-1 보수 + DAY 차단) ─┐
 * │  PRE_3 (D-3) : 보수적 진입 (Kelly ×0.75)                                     │
 * │  PRE_2 (D-2) : 보수적 진입 (Kelly ×0.75)                                     │
 * │  PRE_1 (D-1) : 보수적 진입 (Kelly ×0.75)                                     │
 * │  DAY   (D+0) : 신규 진입 금지 | 발표 전 전면 관망                            │
 * │  POST_1(D+1) : 방향 확인 후 최대 진입 허용 (Kelly ×1.30)                     │
 * │  POST_2(D+2) : 모멘텀 가속 구간 (Kelly ×1.15)                                │
 * │  NORMAL      : 정상 운용 (Kelly ×1.00)                                       │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * 정책 변경 이력:
 *   v1 (2025): PRE_3/PRE_2/PRE_1/DAY 모두 차단 (4일)
 *   v2 (2026-04-26 1차): PRE_3/PRE_2 정상, PRE_1/DAY 차단 (2일)
 *   v3 (2026-04-26 2차): PRE_3/PRE_2/PRE_1 정상, DAY 만 차단 (1일)
 *   v3.1 (2026-04-26 3차): PRE_1 = Kelly 0.75 (사이즈 25% 축소), DAY 차단 유지
 *   v4 (2026-04-26 4차): PRE_3/PRE_2/PRE_1 모두 Kelly 0.75 — 4일 보수성 균일 (ADR-0057)
 *     사유: 사용자 운영 결정 — D-3 부터도 발표 영향권 진입으로 간주, 사이즈 보수성을
 *     4일 전체에 균일 적용해 운영 일관성 확보. v3.1 의 PRE_3/PRE_2 = 1.0 (완전 정상)
 *     과 PRE_1 = 0.75 사이의 사이즈 격차가 직관적 부담 — v4 는 4일 균일화로 단순화.
 *
 *   - 매도(청산)는 본 게이트와 무관하게 정상 발동 (페르소나 철학 8 — 손절은 운영비).
 *
 * 우호 환경 완화 (DAY 만 적용):
 *   - 조건: MHS≥60 + 강세 레짐 + VKOSPI≤22 (3조건 모두)
 *   - 효과: DAY 에서도 Kelly ×0.3 보수적 진입 허용
 *   - macro 부재 / 일부 미달 시 안전 차단 유지
 *
 * 일정 출처:
 *  2025 — 연준 공식 일정 (확정)
 *  2026 — 연준 공식 일정 (확정, 2025-11 발표)
 */

// ── FOMC 발표일 (ET 기준 2일차 — 한국 시장 종료일) ────────────────────────────

export const FOMC_DATES: string[] = [
  // 2025 (연준 공식 확정)
  '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18',
  '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10',
  // 2026 (연준 공식 확정)
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17',
  '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
];

// ── 타입 ──────────────────────────────────────────────────────────────────────

export type FomcPhase = 'PRE_3' | 'PRE_2' | 'PRE_1' | 'DAY' | 'POST_1' | 'POST_2' | 'NORMAL';

export interface FomcProximity {
  phase:           FomcPhase;
  daysUntil:       number | null;  // 다음 FOMC까지 남은 일수 (null = 일정 없음)
  daysAfter:       number | null;  // 직전 FOMC 이후 경과 일수
  nextFomcDate:    string | null;
  lastFomcDate:    string | null;
  kellyMultiplier: number;         // 1.0 = 정상, <1 = 축소, >1 = 부스트
  noNewEntry:      boolean;        // DAY 구간만 (v4)
  hedgeSignal:     boolean;        // PRE_3 전용: 50% 헤지 경보 (v2 부터 항상 false)
  description:     string;
  /** 우호 환경 완화 적용 여부 (DAY 에서만 의미, v3+). true 시 보수적 진입 허용. */
  relaxed?:        boolean;
  /** 우호/차단 사유 텍스트 — 운영자 가시성. */
  relaxationReason?: string;
}

/**
 * FOMC 게이트 우호 환경 완화 입력 컨텍스트.
 * macroState/regime/vkospi 등 외부 SSOT 의 snapshot 만 받음 — fomcCalendar 자체는
 * macroStateRepo 를 import 하지 않아 boundary 단순.
 */
export interface FomcRelaxationContext {
  mhs?: number;       // Macro Health Score 0~100
  regime?: string;    // 'BULL_AGGRESSIVE' | 'BULL_NORMAL' | 'NEUTRAL' | ...
  vkospi?: number;    // VKOSPI 변동성 지수
}

export interface FomcRelaxationResult {
  relaxed:         boolean;  // true = 우호 환경, 보수적 진입 허용
  effectiveKelly:  number;   // 0.0 (차단) / 0.3 (보수적) / 1.0 (정상)
  noNewEntry:      boolean;  // 신규 진입 차단 여부 (relaxed 시 false)
  reason:          string;
}

/** v2 우호 환경 완화 임계값 SSOT. ENV 로 운영자 조정 가능. */
export const FOMC_RELAXATION_THRESHOLDS = {
  MHS_MIN:   60,     // Macro Health Score ≥ 60
  VKOSPI_MAX: 22,    // VKOSPI ≤ 22 (변동성 낮음)
  /** 완화 시 적용할 Kelly 배율 (정상 1.0 의 30%). */
  KELLY_RELAXED: 0.3,
} as const;

/** 우호 강세 레짐 — 사용자 분석 13 (regimePlaybook) 의 BULL 분류와 정합. */
const FOMC_FAVORABLE_REGIMES = new Set<string>([
  'BULL_AGGRESSIVE',
  'BULL_NORMAL',
  'R1_BULL_AGGRESSIVE',
  'R2_BULL_NORMAL',
]);

// Kelly 배율 테이블 (정책 v4 — 2026-04-26 사용자 운영 결정, ADR-0057)
//
// 변경 이력:
//   v1 (2025):         PRE_3/PRE_2/PRE_1/DAY 모두 0.0 (4일 차단)
//   v2 (2026-04-26):   PRE_3/PRE_2 = 1.0, PRE_1/DAY = 0.0 (2일 차단)
//   v3 (2026-04-26):   PRE_3/PRE_2/PRE_1 = 1.0, DAY 만 0.0 (1일 차단)
//   v3.1 (2026-04-26): PRE_1 = 0.75 (사이즈 25% 축소), DAY 차단 유지
//   v4 (2026-04-26):   PRE_3/PRE_2/PRE_1 모두 0.75 — 4일 보수성 균일 ← 현재
//     사유: 사용자 운영 결정 — D-3 부터 사이즈 25% 축소 균일 적용, 4일 일관성.
const PHASE_KELLY: Record<FomcPhase, number> = {
  PRE_3:  0.75,  // 보수적 진입 (사이즈 25% 축소, v4) — D-3 부터 발표 영향권
  PRE_2:  0.75,  // 보수적 진입 (사이즈 25% 축소, v4)
  PRE_1:  0.75,  // 보수적 진입 (사이즈 25% 축소, v3.1 부터 유지)
  DAY:    0.0,   // 신규 진입 금지 (발표 당일 — 익일 09:00 시초가 점프 회피)
  POST_1: 1.30,  // FOMC 방향 확인 후 최대 진입
  POST_2: 1.15,
  NORMAL: 1.0,
};

// ── 메인 함수 ─────────────────────────────────────────────────────────────────

/** KST 기준 오늘 날짜 문자열 (YYYY-MM-DD) */
function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 두 날짜 문자열(YYYY-MM-DD) 간 캘린더 일수 차이 (b - a) */
function daysDiff(a: string, b: string): number {
  const msPerDay = 86_400_000;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / msPerDay);
}

/**
 * 우호 환경 완화 헬퍼 — DAY (FOMC 발표 당일) 에서 macro 환경이 *우호적* 이면 차단을
 * 풀고 보수적 진입(Kelly ×0.3) 을 허용한다.
 *
 * v3 (2026-04-26): 차단 phase 가 PRE_1+DAY → DAY 단일로 축소. PRE_1 은 정상 운용
 * 이라 완화 평가 자체가 무의미.
 *
 * 우호 환경 조건 (모두 충족):
 *   1. MHS ≥ FOMC_RELAXATION_THRESHOLDS.MHS_MIN  (강한 매크로 강세)
 *   2. regime ∈ FOMC_FAVORABLE_REGIMES          (강세 레짐)
 *   3. VKOSPI ≤ FOMC_RELAXATION_THRESHOLDS.VKOSPI_MAX (변동성 낮음)
 *
 * macro snapshot 부재 또는 일부 필드 누락 시 *보수적으로* 차단 유지.
 *
 * @param phase   현재 FOMC phase
 * @param defaultKelly  현재 phase 의 PHASE_KELLY 값 (DAY 가 아니면 그대로)
 * @param macro   macro snapshot (mhs/regime/vkospi)
 */
export function applyFomcRelaxation(
  phase: FomcPhase,
  defaultKelly: number,
  macro?: FomcRelaxationContext,
): FomcRelaxationResult {
  const isBlockedPhase = phase === 'DAY';

  // DAY 가 아니면 완화 무관 — 기존 정책 그대로 (PRE_1 도 v3 에선 정상 운용).
  if (!isBlockedPhase) {
    return {
      relaxed: false,
      effectiveKelly: defaultKelly,
      noNewEntry: defaultKelly === 0,
      reason: '게이트 차단 기간 아님',
    };
  }

  // macro 부재 시 보수적 차단 유지 (회귀 안전).
  if (!macro || macro.mhs == null || macro.regime == null) {
    return {
      relaxed: false,
      effectiveKelly: 0,
      noNewEntry: true,
      reason: 'macro snapshot 부재 — 차단 유지',
    };
  }

  const mhs = macro.mhs;
  const regime = macro.regime;
  const vkospi = macro.vkospi;

  const mhsOk    = mhs >= FOMC_RELAXATION_THRESHOLDS.MHS_MIN;
  const regimeOk = FOMC_FAVORABLE_REGIMES.has(regime);
  // VKOSPI 부재 시 보수적으로 false 처리 — 셋 다 통과해야 완화.
  const vkospiOk = vkospi != null && Number.isFinite(vkospi)
    && vkospi <= FOMC_RELAXATION_THRESHOLDS.VKOSPI_MAX;

  if (mhsOk && regimeOk && vkospiOk) {
    return {
      relaxed: true,
      effectiveKelly: FOMC_RELAXATION_THRESHOLDS.KELLY_RELAXED,
      noNewEntry: false,
      reason:
        `우호 환경 (MHS ${mhs.toFixed(0)} ≥ ${FOMC_RELAXATION_THRESHOLDS.MHS_MIN} + ` +
        `${regime} + VKOSPI ${vkospi!.toFixed(1)} ≤ ${FOMC_RELAXATION_THRESHOLDS.VKOSPI_MAX}) — ` +
        `보수적 진입 (Kelly ×${FOMC_RELAXATION_THRESHOLDS.KELLY_RELAXED})`,
    };
  }

  // 어느 하나라도 실패 — 차단 유지.
  const failParts = [
    `MHS ${mhsOk ? '✅' : '❌'} (${mhs.toFixed(0)})`,
    `Regime ${regimeOk ? '✅' : '❌'} (${regime})`,
    `VKOSPI ${vkospiOk ? '✅' : '❌'} (${vkospi != null ? vkospi.toFixed(1) : 'N/A'})`,
  ];
  return {
    relaxed: false,
    effectiveKelly: 0,
    noNewEntry: true,
    reason: `차단 유지 — ${failParts.join(' / ')}`,
  };
}

/**
 * FOMC 게이팅이 제거되었습니다. 항상 NONE phase(no-block, Kelly ×1.0)를 반환합니다.
 */
export function getFomcProximity(_macro?: FomcRelaxationContext): FomcProximity {
  return {
    phase:           'NORMAL',
    daysUntil:       null,
    daysAfter:       null,
    nextFomcDate:    undefined as unknown as null,
    lastFomcDate:    null,
    kellyMultiplier: 1.0,
    noNewEntry:      false,
    hedgeSignal:     false,
    description:     'FOMC_GATING_REMOVED',
    relaxed:         undefined,
    relaxationReason: undefined,
  };
}

// ── ICS 캘린더 생성 ───────────────────────────────────────────────────────────

/** FOMC 일정을 iCalendar(.ics) 형식으로 반환. Google Calendar 임포트용. */
export function generateFomcIcs(): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//QuantMaster Pro//FOMC Calendar 2025-2026//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:FOMC 금리 결정 (QuantMaster)',
    'X-WR-TIMEZONE:Asia/Seoul',
  ];

  for (const d of FOMC_DATES) {
    const dtstart  = d.replace(/-/g, '');  // YYYYMMDD
    // 이벤트 끝은 다음 날 (all-day event)
    const nextDay  = new Date(d);
    nextDay.setDate(nextDay.getDate() + 1);
    const dtend    = nextDay.toISOString().slice(0, 10).replace(/-/g, '');
    const uid      = `fomc-${d}@quantmaster-pro`;

    lines.push(
      'BEGIN:VEVENT',
      `DTSTART;VALUE=DATE:${dtstart}`,
      `DTEND;VALUE=DATE:${dtend}`,
      `SUMMARY:FOMC 금리 결정 🏦`,
      `DESCRIPTION:미 연준 FOMC 금리 결정\\nD-3~D-1 보수적 진입 (Kelly ×0.75, 사이즈 25% 축소, v4)\\nD-day 신규 진입 자동 차단\\nD+1 방향 확인 후 최대 포지션 허용\\n우호 환경 시 D-day 도 보수적 진입 (Kelly ×0.3)`,
      `UID:${uid}`,
      // D-1 경보 (v4 — D-3 부터 보수적 진입, D-day 차단)
      'BEGIN:VALARM',
      'TRIGGER:-P1DT0H0M0S',
      'ACTION:DISPLAY',
      'DESCRIPTION:📅 FOMC D-1: 내일 발표 — D-3 부터 보수적 진입(Kelly ×0.75), D-day 신규 진입 자동 차단',
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// ── 아침 경보 ─────────────────────────────────────────────────────────────────

// 중복 방지: 오늘 이미 발송한 경우 스킵
let _lastAlertedDate = '';

/**
 * FOMC 근접 경보 — 제거됨. no-op stub.
 */
export async function checkFomcProximityAlert(): Promise<void> {
  // FOMC_GATING_REMOVED — no-op
}

// ─── FOMC DAY 보유 포지션 강제 청산 정책 (PR-1, ADR-0061) ─────────────────────
//
// FOMC 발표 당일(D-day, KST) 14:30~15:20 사이에 활성 LIVE/SHADOW 보유 포지션을
// 시장가 전량 청산한다. cron(orchestratorJobs) 가 평일 14:30 KST 진입점을 호출
// 하면 본 SSOT 의 5중 가드(DAY phase / enabled / AUTO_TRADE_ENABLED / emergencyStop
// / 시각 boundary) 를 모두 통과해야 fomcDayLiquidation.liquidateAllForFomc() 가
// 실제 reserveSell 을 호출한다.

/** FOMC DAY 청산 정책 설정 SSOT (env 기반 factory 로 생성). */
export interface FomcDayLiquidationConfig {
  /** false 면 청산 미실행 (env FOMC_DAY_LIQUIDATION_ENABLED='false' 회로). */
  enabled: boolean;
  /** 청산 시작 KST 시각 (HH:MM, 24h). default '14:30' (장마감 60분 전). */
  liquidationStartKstTime: string;
  /** 청산 완료 목표 KST 시각 (HH:MM). default '15:20' (장마감 10분 전). */
  liquidationCompleteKstTime: string;
  /** 사전 경보 KST 시각 배열 (HH:MM). 본 SSOT 는 운영자 가시성 표기용. */
  preAlertKstTimes: string[];
  /** dryRun 모드 — 실제 reserveSell 미호출, 대상만 집계. */
  dryRun: boolean;
}

const DEFAULT_LIQUIDATION_START_KST = '14:30';
const DEFAULT_LIQUIDATION_COMPLETE_KST = '15:20';
const DEFAULT_PRE_ALERT_KST_TIMES = ['09:00', '14:00', '14:30'];

/** env 기반 default config 생성. ADR-0061. */
export function getDefaultFomcDayLiquidationConfig(): FomcDayLiquidationConfig {
  return {
    enabled: process.env.FOMC_DAY_LIQUIDATION_ENABLED !== 'false',
    liquidationStartKstTime: process.env.FOMC_DAY_LIQUIDATION_START_KST || DEFAULT_LIQUIDATION_START_KST,
    liquidationCompleteKstTime: process.env.FOMC_DAY_LIQUIDATION_COMPLETE_KST || DEFAULT_LIQUIDATION_COMPLETE_KST,
    preAlertKstTimes: [...DEFAULT_PRE_ALERT_KST_TIMES],
    dryRun: process.env.FOMC_DAY_LIQUIDATION_DRY_RUN === 'true',
  };
}

export type LiquidationGuardReason =
  | 'OK'
  | 'NOT_DAY_PHASE'
  | 'DISABLED'
  | 'AUTO_TRADE_DISABLED'
  | 'EMERGENCY_STOP'
  | 'BEFORE_START_TIME'
  | 'AFTER_COMPLETE_TIME';

export interface LiquidationGuardResult {
  execute: boolean;
  reason: LiquidationGuardReason;
}

/**
 * 5중 가드 SSOT — 모두 통과하면 { execute: true, reason: 'OK' }, 그 외 즉시 차단.
 *
 * 가드 순서 (실패 시 즉시 return):
 *   1. NOT_DAY_PHASE         — getFomcProximity().phase === 'DAY' 가 아니면 차단 (FOMC 캘린더 SSOT)
 *   2. DISABLED              — config.enabled === false (env 회로)
 *   3. AUTO_TRADE_DISABLED   — process.env.AUTO_TRADE_ENABLED !== 'true' (전역 매매 활성)
 *   4. EMERGENCY_STOP        — getEmergencyStop?.() === true (운영자가 이미 직접 처리 중일 가능성)
 *   5. BEFORE_START_TIME / AFTER_COMPLETE_TIME — KST 시각 boundary
 */
export function shouldExecuteLiquidationAt(
  now: Date = new Date(),
  opts?: {
    config?: FomcDayLiquidationConfig;
    getEmergencyStop?: () => boolean;
  },
): LiquidationGuardResult {
  const config = opts?.config ?? getDefaultFomcDayLiquidationConfig();

  // 가드 1: FOMC DAY phase
  // getFomcProximity 의 macro 인자는 본 가드에선 무관 — phase 만 확인.
  const proximity = getFomcProximity();
  if (proximity.phase !== 'DAY') {
    return { execute: false, reason: 'NOT_DAY_PHASE' };
  }

  // 가드 2: enabled 회로 (env FOMC_DAY_LIQUIDATION_ENABLED='false' 우회)
  if (!config.enabled) {
    return { execute: false, reason: 'DISABLED' };
  }

  // 가드 3: AUTO_TRADE_ENABLED — 청산도 매매의 일부
  if (process.env.AUTO_TRADE_ENABLED !== 'true') {
    return { execute: false, reason: 'AUTO_TRADE_DISABLED' };
  }

  // 가드 4: emergencyStop — 운영자가 이미 직접 처리 중일 가능성
  if (opts?.getEmergencyStop?.() === true) {
    return { execute: false, reason: 'EMERGENCY_STOP' };
  }

  // 가드 5: 시각 boundary (KST)
  const kstMinutes = ((now.getUTCHours() + 9) * 60 + now.getUTCMinutes()) % (24 * 60);
  const startMin = parseHmToMinutes(config.liquidationStartKstTime);
  const completeMin = parseHmToMinutes(config.liquidationCompleteKstTime);
  if (kstMinutes < startMin) {
    return { execute: false, reason: 'BEFORE_START_TIME' };
  }
  if (kstMinutes >= completeMin) {
    return { execute: false, reason: 'AFTER_COMPLETE_TIME' };
  }

  return { execute: true, reason: 'OK' };
}

/** 'HH:MM' → 분 단위 정수 (자정부터). 잘못된 입력은 0 fallback. */
function parseHmToMinutes(hm: string): number {
  const parts = hm.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  const hh = Number.isFinite(h) ? h : 0;
  const mm = Number.isFinite(m) ? m : 0;
  return hh * 60 + mm;
}
