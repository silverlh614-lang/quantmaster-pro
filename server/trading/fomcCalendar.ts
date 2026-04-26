// @responsibility fomcCalendar 매매 엔진 모듈
/**
 * fomcCalendar.ts — FOMC 일정 기반 자동 포지션 사이즈 조절기
 *
 * FOMC 근접도 함수로 Kelly 배율을 자동 조절한다.
 *
 * ┌─ 위상별 동작 (정책 v2 — 2026-04-26 사용자 요청 적용) ────────────────────────┐
 * │  PRE_3 (D-3) : 정상 운용 (Kelly ×1.00)                                     │
 * │  PRE_2 (D-2) : 정상 운용 (Kelly ×1.00)                                     │
 * │  PRE_1 (D-1) : 신규 진입 금지 (발표 임박 — 한국 시장 본격 변동성 진입)      │
 * │  DAY   (D+0) : 신규 진입 금지 | 발표 전 전면 관망                          │
 * │  POST_1(D+1) : 방향 확인 후 최대 진입 허용 (Kelly ×1.30)                   │
 * │  POST_2(D+2) : 모멘텀 가속 구간 (Kelly ×1.15)                              │
 * │  NORMAL      : 정상 운용 (Kelly ×1.00)                                     │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * 정책 변경 근거 (사용자 분석):
 *   - 한국 주식 관점에서 미국 FOMC 의 변동성 영향은 발표 직전(D-1) ~ 발표 직후(D+1)
 *     에 집중. D-3, D-2 는 한국 시장에서 사실상 평일 정상 변동성 구간.
 *   - 기존 D-3 ~ D-day 4일 차단은 과도한 보수성으로 진입 기회 손실. D-1 ~ D+0
 *     2일 차단으로 단축해 실질적 회피 + 진입 기회 균형.
 *   - 매도(청산)는 본 게이트와 무관하게 정상 발동 (페르소나 철학 8 — 손절은 운영비).
 *
 * 일정 출처:
 *  2025 — 연준 공식 일정 (확정)
 *  2026 — 연준 공식 일정 (확정, 2025-11 발표)
 */

import { sendTelegramAlert } from '../alerts/telegramClient.js';

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
  noNewEntry:      boolean;        // PRE / DAY 구간
  hedgeSignal:     boolean;        // PRE_3 전용: 50% 헤지 경보 (v2 에선 항상 false)
  description:     string;
  /** v2 우호 환경 완화 적용 여부 (PRE_1/DAY 에서만 의미). true 시 보수적 진입 허용. */
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

// Kelly 배율 테이블 (정책 v2 — 2026-04-26 사용자 요청 적용)
//
// 변경 이력:
//   v1 (2025): PRE_3/PRE_2/PRE_1/DAY 모두 0.0 (4일 차단)
//   v2 (2026-04-26): PRE_3/PRE_2 = 1.0 (정상 운용), PRE_1/DAY 만 0.0 (2일 차단)
//     사유: 한국 주식 관점에서 D-3, D-2 는 사실상 평일 정상 변동성. 미국 FOMC 의
//     실질 영향은 발표 직전(D-1) ~ 발표 직후(D+1) 에 집중. 4일 차단은 과도한 보수성.
const PHASE_KELLY: Record<FomcPhase, number> = {
  PRE_3:  1.0,   // 정상 운용 (D-1 차단으로 단축, v2)
  PRE_2:  1.0,   // 정상 운용 (D-1 차단으로 단축, v2)
  PRE_1:  0.0,   // 신규 진입 금지 (D-1 발표 임박)
  DAY:    0.0,   // 신규 진입 금지 (발표 당일)
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
 * 우호 환경 완화 헬퍼 — PRE_1 / DAY 구간에서 macro 환경이 *우호적* 이면 차단을 풀고
 * 보수적 진입(Kelly ×0.3) 을 허용한다.
 *
 * 우호 환경 조건 (모두 충족):
 *   1. MHS ≥ FOMC_RELAXATION_THRESHOLDS.MHS_MIN  (강한 매크로 강세)
 *   2. regime ∈ FOMC_FAVORABLE_REGIMES          (강세 레짐)
 *   3. VKOSPI ≤ FOMC_RELAXATION_THRESHOLDS.VKOSPI_MAX (변동성 낮음)
 *
 * macro snapshot 부재 또는 일부 필드 누락 시 *보수적으로* 차단 유지.
 *
 * @param phase   현재 FOMC phase
 * @param defaultKelly  현재 phase 의 PHASE_KELLY 값 (PRE_1/DAY 가 아니면 그대로)
 * @param macro   macro snapshot (mhs/regime/vkospi)
 */
export function applyFomcRelaxation(
  phase: FomcPhase,
  defaultKelly: number,
  macro?: FomcRelaxationContext,
): FomcRelaxationResult {
  const isBlockedPhase = phase === 'PRE_1' || phase === 'DAY';

  // PRE_1 / DAY 가 아니면 완화 무관 — 기존 정책 그대로.
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
 * 현재 KST 날짜 기준 FOMC 근접도를 반환한다.
 * signalScanner.ts가 매 tick마다 호출한다.
 *
 * @param macro 옵셔널 — 우호 환경 완화 컨텍스트(MHS/regime/VKOSPI). 전달 시 PRE_1/DAY
 *              구간에서 자동 완화 평가, 미전달 시 기존 차단 정책 유지 (호환성 보장).
 */
export function getFomcProximity(macro?: FomcRelaxationContext): FomcProximity {
  const today = todayKst();

  // 다음 FOMC, 직전 FOMC 탐색
  const sortedDates = [...FOMC_DATES].sort();
  const nextDate    = sortedDates.find(d => d >= today) ?? null;
  const lastDate    = [...sortedDates].reverse().find(d => d < today) ?? null;

  const daysUntil = nextDate ? daysDiff(today, nextDate) : null;
  const daysAfter = lastDate ? daysDiff(lastDate, today) : null;

  let phase: FomcPhase;

  if      (daysUntil === 0)  phase = 'DAY';
  else if (daysUntil === 1)  phase = 'PRE_1';
  else if (daysUntil === 2)  phase = 'PRE_2';
  else if (daysUntil === 3)  phase = 'PRE_3';
  else if (daysAfter === 1)  phase = 'POST_1';
  else if (daysAfter === 2)  phase = 'POST_2';
  else                        phase = 'NORMAL';

  const baseKelly = PHASE_KELLY[phase];
  // hedgeSignal: v2 정책에선 D-3 가 정상 운용으로 격하되어 헤지 신호도 제거.
  // 헤지 검토는 본 게이트가 아닌 R6 비상 청산·trailingStop 등 exitEngine 룰에서 자체 처리.
  const hedgeSignal = false;

  const descMap: Record<FomcPhase, string> = {
    PRE_3:  `FOMC D-3 (${nextDate}) — 정상 운용 (D-1 부터 진입 차단)`,
    PRE_2:  `FOMC D-2 (${nextDate}) — 정상 운용 (내일부터 진입 차단)`,
    PRE_1:  `FOMC D-1 (${nextDate}) — 신규 진입 금지`,
    DAY:    `FOMC 발표일 (${nextDate ?? lastDate}) — 발표 전 전면 관망`,
    POST_1: `FOMC D+1 (${lastDate}) — 방향 확인 후 최대 진입 (Kelly ×1.30)`,
    POST_2: `FOMC D+2 (${lastDate}) — 모멘텀 가속 (Kelly ×1.15)`,
    NORMAL: '정상 운용',
  };

  // v2 우호 환경 완화 — PRE_1 / DAY 에서 macro 가 우호적이면 보수적 진입 허용.
  // macro 미전달 시 applyFomcRelaxation 이 차단 유지 결과 반환 (회귀 안전).
  const relaxation = applyFomcRelaxation(phase, baseKelly, macro);
  const description = relaxation.relaxed
    ? `${descMap[phase]} | ${relaxation.reason}`
    : descMap[phase];

  return {
    phase, daysUntil, daysAfter,
    nextFomcDate:     nextDate,
    lastFomcDate:     lastDate,
    kellyMultiplier:  relaxation.effectiveKelly,
    noNewEntry:       relaxation.noNewEntry,
    hedgeSignal,
    description,
    relaxed:          relaxation.relaxed || undefined,
    relaxationReason: relaxation.relaxed ? relaxation.reason : undefined,
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
      `DESCRIPTION:미 연준 FOMC 금리 결정\\nD-1 부터 신규 진입 자동 차단 (v2 정책)\\nD+1 방향 확인 후 최대 포지션 허용`,
      `UID:${uid}`,
      // D-1 경보 (v2 정책 — D-3 경보 제거, D-1 단일 경보로 단순화)
      'BEGIN:VALARM',
      'TRIGGER:-P1DT0H0M0S',
      'ACTION:DISPLAY',
      'DESCRIPTION:⚠️ FOMC D-1: 신규 진입 자동 차단 — 발표 임박 관망',
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
 * FOMC 근접 시 Telegram 경보 발송.
 * sendWatchlistBriefing() 직후 scheduler.ts에서 호출.
 * 하루 1회만 발송 (서버 메모리 기준).
 */
export async function checkFomcProximityAlert(): Promise<void> {
  const today = todayKst();
  if (_lastAlertedDate === today) return; // 오늘 이미 발송

  const p = getFomcProximity();
  if (p.phase === 'NORMAL') return;

  _lastAlertedDate = today;

  const emojiMap: Record<FomcPhase, string> = {
    PRE_3: '🔴', PRE_2: '🟠', PRE_1: '🟡',
    DAY:   '🔵', POST_1: '📈', POST_2: '📊', NORMAL: '',
  };

  let msg =
    `${emojiMap[p.phase]} <b>[FOMC 캘린더]</b> ${p.description}\n`;

  if (p.hedgeSignal) {
    msg += `\n📌 <b>자동 적용:</b> 신규 진입 차단\n` +
           `💡 <b>권고:</b> 기존 포지션 50% 헤지 검토\n` +
           `📅 다음 FOMC: ${p.nextFomcDate}`;
  } else if (p.noNewEntry) {
    msg += `\n📌 <b>자동 적용:</b> 신규 진입 차단`;
    if (p.nextFomcDate) msg += `\n📅 FOMC 날짜: ${p.nextFomcDate}`;
  } else {
    // POST 구간
    msg += `\n📌 <b>자동 적용:</b> Kelly ×${p.kellyMultiplier.toFixed(2)} (부스트)\n` +
           `💡 방향 확인 후 적극 진입 구간`;
  }

  await sendTelegramAlert(msg).catch(console.error);
}
