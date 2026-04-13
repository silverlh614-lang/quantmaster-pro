/**
 * volumeClock.ts — Volume Clock (장중 매수 최적 시간대 자동 선택)
 *
 * 한국 주식 시장의 시간대별 특성에 기반하여 발주 실행 가능 여부와
 * 시간대 가중치 보너스를 결정한다.
 *
 * ┌─ 허용 발주 시간대 (KST) ────────────────────────────────────────────────────┐
 * │  10:00 ~ 11:30  기관 알고리즘 매수 집중 구간 (핵심 발주 시간)               │
 * │  14:00 ~ 14:50  기관 윈도우 드레싱 구간                                     │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ 차단 시간대 (KST) ─────────────────────────────────────────────────────────┐
 * │  09:00 ~ 09:59  패닉 매도·추격 매수 혼조 구간 (노이즈 극심)                 │
 * │  14:55 ~ 15:30  마감 변동성 구간                                             │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ 시간대 가중치 보너스 ──────────────────────────────────────────────────────┐
 * │  10:00 ~ 11:00  발주 시 +2점 보너스 (기관 알고리즘 집중 진입 구간)          │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */

/** 발주 허용 시간대 정의 (KST, 분 단위 HH*60+MM) */
const ALLOWED_WINDOWS: Array<{ start: number; end: number; label: string }> = [
  { start: 10 * 60,       end: 11 * 60 + 30, label: '10:00~11:30 기관 알고리즘 집중 구간' },
  { start: 14 * 60,       end: 14 * 60 + 50, label: '14:00~14:50 기관 윈도우 드레싱 구간' },
];

/** 차단 시간대 정의 (KST, 분 단위) */
const BLOCKED_WINDOWS: Array<{ start: number; end: number; label: string }> = [
  { start:  9 * 60,       end:  9 * 60 + 59, label: '09:00~09:59 개장 노이즈 구간' },
  { start: 14 * 60 + 55, end: 15 * 60 + 30,  label: '14:55~15:30 마감 변동성 구간' },
];

/** +2점 보너스 구간 (KST, 분 단위) */
const BONUS_WINDOW = { start: 10 * 60, end: 11 * 60, bonus: 2, label: '10:00~11:00 기관 알고리즘 집중 (+2점)' };

export interface VolumeClockResult {
  /** 발주 허용 여부 */
  allowEntry:   boolean;
  /** 시간대 보너스 점수 (0 또는 +2) */
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

  // 차단 구간 먼저 확인 (우선순위 높음)
  for (const win of BLOCKED_WINDOWS) {
    if (mins >= win.start && mins <= win.end) {
      return {
        allowEntry:  false,
        scoreBonus:  0,
        windowLabel: win.label,
        reason:      `[Volume Clock] 차단 시간대 — ${win.label} → 발주 금지`,
      };
    }
  }

  // 허용 구간 확인
  for (const win of ALLOWED_WINDOWS) {
    if (mins >= win.start && mins <= win.end) {
      const bonus = (mins >= BONUS_WINDOW.start && mins < BONUS_WINDOW.end) ? BONUS_WINDOW.bonus : 0;
      const bonusNote = bonus > 0 ? ` (+${bonus}점 보너스 — ${BONUS_WINDOW.label})` : '';
      return {
        allowEntry:  true,
        scoreBonus:  bonus,
        windowLabel: win.label,
        reason:      `[Volume Clock] 허용 시간대 — ${win.label}${bonusNote}`,
      };
    }
  }

  // 어느 구간에도 해당하지 않음 → 발주 비허용
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return {
    allowEntry:  false,
    scoreBonus:  0,
    windowLabel: `${hh}:${mm} (비허용 구간)`,
    reason:      `[Volume Clock] 비허용 시간대(${hh}:${mm} KST) — 허용 구간 외`,
  };
}
