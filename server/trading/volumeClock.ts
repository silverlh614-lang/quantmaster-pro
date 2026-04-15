/**
 * volumeClock.ts — Volume Clock (장중 매수 최적 시간대 자동 선택)
 *
 * 한국 주식 시장의 시간대별 특성에 기반하여 발주 실행 가능 여부와
 * 시간대 가중치 보너스를 결정한다.
 *
 * ┌─ 절대 차단 (KST) ──────────────────────────────────────────────────────────┐
 * │  09:00 ~ 09:29  시초가 결정 구간 — 슬리피지 극심                            │
 * │  11:30 ~ 13:00  점심 구간 — 거래량 저조, Scanner SELL_ONLY 연동              │
 * │  14:55 ~ 15:30  마감 동시호가 — 절대 불가                                   │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ 시간대별 점수 조정 ───────────────────────────────────────────────────────┐
 * │  패널티 -2  09:30~09:59  개장 초반 노이즈                                  │
 * │  패널티 -2  14:30~14:54  마감 30분 전 변동성 확대                           │
 * │  패널티 -2  13:01~13:14  점심 직후 회복 초기                                │
 * │  패널티 -1  13:15~13:29  거래 회복 중                                      │
 * │  패널티 -1  11:00~11:29  오전 후반 모멘텀 약화                              │
 * │  보너스  0  13:30~14:29  오후 기관 리밸런싱                                 │
 * │  보너스 +2  10:00~10:59  기관 알고리즘 집중 구간                            │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */

/** 절대 차단 시간대 (KST, 분 단위 HH*60+MM) */
const BLOCKED_WINDOWS: Array<{ start: number; end: number; label: string }> = [
  { start:  9 * 60,      end:  9 * 60 + 29, label: '09:00~09:29 시초가 결정 — 슬리피지 극심' },
  { start: 11 * 60 + 30, end: 13 * 60, label: '11:30~13:00 점심 구간 — 거래량 저조' },
  { start: 14 * 60 + 55, end: 15 * 60 + 30, label: '14:55~15:30 마감 동시호가 — 절대 불가' },
];

/**
 * 시간대별 점수 조정 구간 (KST, 분 단위)
 * 09:30~14:54 전체를 빈틈 없이 커버한다.
 * 배열 순서 = 시간 순서 (검색 시 첫 매칭 반환).
 */
const TIME_ZONES: Array<{ start: number; end: number; bonus: number; label: string }> = [
  { start:  9 * 60 + 30, end:  9 * 60 + 59, bonus: -2, label: '09:30~09:59 개장 초반 노이즈 (-2점)' },
  { start: 10 * 60,      end: 10 * 60 + 59, bonus: +2, label: '10:00~10:59 기관 알고리즘 집중 (+2점)' },
  { start: 11 * 60,      end: 11 * 60 + 29, bonus: -1, label: '11:00~11:29 오전 후반 모멘텀 약화 (-1점)' },
  // 11:30~13:00 → BLOCKED_WINDOWS로 이동 (점심 구간 매수 차단, Scanner SELL_ONLY 연동)
  { start: 13 * 60 + 1,  end: 13 * 60 + 14, bonus: -2, label: '13:01~13:14 점심 직후 회복 초기 (-2점)' },
  { start: 13 * 60 + 15, end: 13 * 60 + 29, bonus: -1, label: '13:15~13:29 거래 회복 중 (-1점)' },
  { start: 13 * 60 + 30, end: 14 * 60 + 29, bonus:  0, label: '13:30~14:29 오후 기관 리밸런싱' },
  { start: 14 * 60 + 30, end: 14 * 60 + 54, bonus: -2, label: '14:30~14:54 마감 30분 전 변동성 확대 (-2점)' },
];

export interface VolumeClockResult {
  /** 발주 허용 여부 */
  allowEntry:   boolean;
  /** 시간대 보너스 점수 (−2, −1, 0, +2) */
  scoreBonus:   number;
  /** 현재 시간대 설명 */
  windowLabel:  string;
  /** 허용·차단 사유 */
  reason:       string;
}

/**
 * 현재 KST 시각의 분(minutes) 값을 반환한다.
 * (UTC + 9시간 오프셋 적용)
 */
function kstMinutesOfDay(now: Date): number {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst   = new Date(kstMs);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

/**
 * 현재 KST 시각을 기준으로 발주 허용 여부와 스코어 보너스를 결정한다.
 *
 * @param now - 현재 시각 (테스트 주입용, 기본값: new Date())
 */
export function checkVolumeClockWindow(now: Date = new Date()): VolumeClockResult {
  const mins = kstMinutesOfDay(now);

  // 1. 절대 차단 구간 (최우선)
  for (const win of BLOCKED_WINDOWS) {
    if (mins >= win.start && mins <= win.end) {
      return {
        allowEntry:  false,
        scoreBonus:  0,
        windowLabel: win.label,
        reason:      `[Volume Clock] 절대 차단 — ${win.label} → 발주 금지`,
      };
    }
  }

  // 2. 시간대별 점수 조정 구간 (09:30~14:54)
  for (const zone of TIME_ZONES) {
    if (mins >= zone.start && mins <= zone.end) {
      const bonusNote = zone.bonus !== 0
        ? ` (${zone.bonus > 0 ? '+' : ''}${zone.bonus}점)`
        : '';
      return {
        allowEntry:  true,
        scoreBonus:  zone.bonus,
        windowLabel: zone.label,
        reason:      `[Volume Clock] 허용 시간대 — ${zone.label}${bonusNote}`,
      };
    }
  }

  // 3. 어느 구간에도 해당하지 않음 → 발주 비허용
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return {
    allowEntry:  false,
    scoreBonus:  0,
    windowLabel: `${hh}:${mm} (비허용 구간)`,
    reason:      `[Volume Clock] 비허용 시간대(${hh}:${mm} KST) — 허용 구간 외`,
  };
}
