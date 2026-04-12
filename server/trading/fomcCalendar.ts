/**
 * fomcCalendar.ts — FOMC 일정 기반 자동 포지션 사이즈 조절기
 *
 * FOMC 근접도 함수로 Kelly 배율을 자동 조절한다.
 *
 * ┌─ 위상별 동작 ───────────────────────────────────────────────────────────────┐
 * │  PRE_3 (D-3) : 신규 진입 금지 | 기존 포지션 50% 헤지 경보                  │
 * │  PRE_2 (D-2) : 신규 진입 금지                                              │
 * │  PRE_1 (D-1) : 신규 진입 금지 | 발표 당일 관망 예고                        │
 * │  DAY   (D+0) : 신규 진입 금지 | 발표 전 전면 관망                          │
 * │  POST_1(D+1) : 방향 확인 후 최대 진입 허용 (Kelly ×1.30)                   │
 * │  POST_2(D+2) : 모멘텀 가속 구간 (Kelly ×1.15)                              │
 * │  NORMAL      : 정상 운용 (Kelly ×1.00)                                     │
 * └─────────────────────────────────────────────────────────────────────────────┘
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
  hedgeSignal:     boolean;        // PRE_3 전용: 50% 헤지 경보
  description:     string;
}

// Kelly 배율 테이블
const PHASE_KELLY: Record<FomcPhase, number> = {
  PRE_3:  0.0,   // 신규 진입 금지
  PRE_2:  0.0,
  PRE_1:  0.0,
  DAY:    0.0,
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
 * 현재 KST 날짜 기준 FOMC 근접도를 반환한다.
 * signalScanner.ts가 매 tick마다 호출한다.
 */
export function getFomcProximity(): FomcProximity {
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

  const kellyMultiplier = PHASE_KELLY[phase];
  const noNewEntry      = kellyMultiplier === 0;
  const hedgeSignal     = phase === 'PRE_3';

  const descMap: Record<FomcPhase, string> = {
    PRE_3:  `FOMC D-3 (${nextDate}) — 신규 진입 금지, 50% 헤지 검토`,
    PRE_2:  `FOMC D-2 (${nextDate}) — 신규 진입 금지`,
    PRE_1:  `FOMC D-1 (${nextDate}) — 내일 발표, 관망`,
    DAY:    `FOMC 발표일 (${nextDate ?? lastDate}) — 발표 전 전면 관망`,
    POST_1: `FOMC D+1 (${lastDate}) — 방향 확인 후 최대 진입 (Kelly ×1.30)`,
    POST_2: `FOMC D+2 (${lastDate}) — 모멘텀 가속 (Kelly ×1.15)`,
    NORMAL: '정상 운용',
  };

  return {
    phase, daysUntil, daysAfter,
    nextFomcDate:    nextDate,
    lastFomcDate:    lastDate,
    kellyMultiplier, noNewEntry, hedgeSignal,
    description:     descMap[phase],
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
      `DESCRIPTION:미 연준 FOMC 금리 결정\\nD-3부터 신규 진입 자동 차단\\nD+1 방향 확인 후 최대 포지션 허용`,
      `UID:${uid}`,
      // D-3 경보
      'BEGIN:VALARM',
      'TRIGGER:-P3DT0H0M0S',
      'ACTION:DISPLAY',
      'DESCRIPTION:⚠️ FOMC D-3: 신규 진입 차단 + 50% 헤지 검토',
      'END:VALARM',
      // D-1 경보
      'BEGIN:VALARM',
      'TRIGGER:-P1DT0H0M0S',
      'ACTION:DISPLAY',
      'DESCRIPTION:⚠️ FOMC D-1: 내일 발표 — 관망',
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
