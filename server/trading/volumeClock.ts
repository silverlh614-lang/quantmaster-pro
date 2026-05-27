// @responsibility volumeClock 매매 엔진 모듈
/**
 * volumeClock.ts — Volume Clock (장중 매수 시간대 가/감점)
 *
 * ALWAYS-ON 정책 (사용자 5/27): 볼륨클록은 *매매를 차단하지 않는다*. 장중 전 시간 매수 허용이며,
 * 시간대 특성은 평가 점수의 가/감점(scoreBonus)으로만 반영한다.
 * 유일한 예외는 마감 동시호가(15:21~15:30) — 단일가 세션은 시장 메커니즘상 일반 발주가 불가하므로
 * 하드 차단을 유지한다. 그 외(09:00~15:20)는 시초가/점심 포함 전부 allowEntry=true(감점만 부여).
 *
 * 롤백: ENV `VOLUME_CLOCK_LEGACY_HARD_BLOCK=true` → 구(ADR-0192) 하드 차단 동작 복원
 *   (09:00~09:29 / 12:00~12:59 / 15:21~15:30 차단). 기본값은 always-on(감점 전용).
 *
 * ┌─ 시간대별 점수 가/감점 (KST, allowEntry=true) ─────────────────────────────┐
 * │  -3  09:00~09:29  시초가 결정 — 슬리피지 극심 (차단 아님, 강한 감점)        │
 * │  -2  09:30~09:59  개장 초반 노이즈                                         │
 * │  +2  10:00~10:59  기관 알고리즘 집중                                       │
 * │  -1  11:00~11:59  오전 후반 모멘텀 약화                                    │
 * │  -2  12:00~12:59  점심 — 거래량 저조 (차단 아님, 감점)                     │
 * │  -2  13:00~13:14  점심 직후 회복 초기                                      │
 * │  -1  13:15~13:29  거래 회복 중                                             │
 * │   0  13:30~14:29  오후 기관 리밸런싱                                       │
 * │  -2  14:30~15:20  마감 50분 전 변동성 확대                                 │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * 하드 차단(유일): 15:21~15:30 마감 동시호가(단일가).
 */

interface BlockedWindow { start: number; end: number; label: string; }
interface TimeZone { start: number; end: number; bonus: number; label: string; }

/** 마감 동시호가 — 시장 메커니즘상 유일하게 유지되는 하드 차단 (KST, 분 단위 HH*60+MM). */
const CLOSING_AUCTION_WINDOW: BlockedWindow = {
  start: 15 * 60 + 21, end: 15 * 60 + 30, label: '15:21~15:30 마감 동시호가(단일가) — 일반 발주 불가',
};

/** ALWAYS-ON 시간대별 가/감점 (KST). 09:00~15:20 전부 allowEntry=true — 차단 없음. */
const TIME_ZONES: ReadonlyArray<TimeZone> = [
  { start:  9 * 60,      end:  9 * 60 + 29, bonus: -3, label: '09:00~09:29 시초가 결정 — 슬리피지 극심 (-3점)' },
  { start:  9 * 60 + 30, end:  9 * 60 + 59, bonus: -2, label: '09:30~09:59 개장 초반 노이즈 (-2점)' },
  { start: 10 * 60,      end: 10 * 60 + 59, bonus: +2, label: '10:00~10:59 기관 알고리즘 집중 (+2점)' },
  { start: 11 * 60,      end: 11 * 60 + 59, bonus: -1, label: '11:00~11:59 오전 후반 모멘텀 약화 (-1점)' },
  { start: 12 * 60,      end: 12 * 60 + 59, bonus: -2, label: '12:00~12:59 점심 거래량 저조 (-2점)' },
  { start: 13 * 60,      end: 13 * 60 + 14, bonus: -2, label: '13:00~13:14 점심 직후 회복 초기 (-2점)' },
  { start: 13 * 60 + 15, end: 13 * 60 + 29, bonus: -1, label: '13:15~13:29 거래 회복 중 (-1점)' },
  { start: 13 * 60 + 30, end: 14 * 60 + 29, bonus:  0, label: '13:30~14:29 오후 기관 리밸런싱' },
  { start: 14 * 60 + 30, end: 15 * 60 + 20, bonus: -2, label: '14:30~15:20 마감 50분 전 변동성 확대 (-2점)' },
];

/** 구 하드 차단 (ENV VOLUME_CLOCK_LEGACY_HARD_BLOCK=true 시) — ADR-0192. */
const BLOCKED_WINDOWS_LEGACY: ReadonlyArray<BlockedWindow> = [
  { start:  9 * 60,      end:  9 * 60 + 29, label: '09:00~09:29 시초가 결정 — 슬리피지 극심' },
  { start: 12 * 60,      end: 12 * 60 + 59, label: '12:00~12:59 점심 구간 — 거래량 저조 (ADR-0192)' },
  { start: 15 * 60 + 21, end: 15 * 60 + 30, label: '15:21~15:30 마감 동시호가 — 절대 불가' },
];

export interface VolumeClockResult {
  /** 발주 허용 여부 — always-on 에서는 마감 동시호가(15:21~15:30) 외 항상 true. */
  allowEntry:   boolean;
  /** 시간대 보너스 점수 (−3, −2, −1, 0, +2) */
  scoreBonus:   number;
  /** 현재 시간대 설명 */
  windowLabel:  string;
  /** 허용·차단 사유 */
  reason:       string;
}

/** ENV: 구 하드 차단 동작 복원 (롤백 단일 통로). */
function isVolumeClockLegacyHardBlock(): boolean {
  return process.env.VOLUME_CLOCK_LEGACY_HARD_BLOCK === 'true';
}

/**
 * 현재 KST 시각의 분(minutes) 값을 반환한다. (UTC + 9시간 오프셋 적용)
 */
function kstMinutesOfDay(now: Date): number {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst   = new Date(kstMs);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

/**
 * 현재 KST 시각을 기준으로 발주 허용 여부와 스코어 보너스를 결정한다.
 * ALWAYS-ON: 마감 동시호가(15:21~15:30) 외 09:00~15:20 전부 allowEntry=true (감점만).
 *
 * @param now - 현재 시각 (테스트 주입용, 기본값: new Date())
 */
export function checkVolumeClockWindow(now: Date = new Date()): VolumeClockResult {
  const mins = kstMinutesOfDay(now);

  // 롤백 경로: 구 하드 차단 동작.
  if (isVolumeClockLegacyHardBlock()) {
    for (const win of BLOCKED_WINDOWS_LEGACY) {
      if (mins >= win.start && mins <= win.end) {
        return { allowEntry: false, scoreBonus: 0, windowLabel: win.label, reason: `[Volume Clock] (legacy) 절대 차단 — ${win.label}` };
      }
    }
  } else if (mins >= CLOSING_AUCTION_WINDOW.start && mins <= CLOSING_AUCTION_WINDOW.end) {
    // ALWAYS-ON 유일 하드 차단: 마감 동시호가(단일가).
    return {
      allowEntry: false,
      scoreBonus: 0,
      windowLabel: CLOSING_AUCTION_WINDOW.label,
      reason: `[Volume Clock] 마감 동시호가 — ${CLOSING_AUCTION_WINDOW.label} → 일반 발주 불가`,
    };
  }

  // 장중 가/감점 구간 (09:00~15:20) — 전부 매수 허용.
  for (const zone of TIME_ZONES) {
    if (mins >= zone.start && mins <= zone.end) {
      const bonusNote = zone.bonus !== 0 ? ` (${zone.bonus > 0 ? '+' : ''}${zone.bonus}점)` : '';
      return {
        allowEntry:  true,
        scoreBonus:  zone.bonus,
        windowLabel: zone.label,
        reason:      `[Volume Clock] 매수 허용 — ${zone.label}${bonusNote}`,
      };
    }
  }

  // 장외 시간 (09:00 이전 / 15:30 이후) — 연속매매 세션 부재 (차단이 아니라 시장 미개장).
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return {
    allowEntry:  false,
    scoreBonus:  0,
    windowLabel: `${hh}:${mm} (장외)`,
    reason:      `[Volume Clock] 장외 시간(${hh}:${mm} KST) — 연속매매 세션 외`,
  };
}
