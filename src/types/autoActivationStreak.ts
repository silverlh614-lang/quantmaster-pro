// @responsibility ADR-0634 자가 활성 anti-flap streak 영속 저장형 공유 타입 — 서버 repo·cron wiring 단일 소스. 비즈니스 로직 0.
/**
 * autoActivationStreak.ts — ADR-0634 LIVE-safe lever 의 일별 READY 연속일수 영속 저장형.
 *
 * ADR-0633 evaluator 의 `minConsecutiveReadyDays` (anti-flap) 입력을 재배포 후에도
 * 보존하기 위한 lever 별 streak 상태. 단일 소스 — server/persistence/autoActivationStreakRepo
 * 와 server/scheduler cron wiring 양쪽이 본 타입을 import 한다(중복 선언 금지).
 */

/** lever 1건의 streak 상태. */
export interface AutoActivationLeverStreak {
  /** 연속 READY(streak 제외 기준 충족) 일수. not-ready 일에 0 으로 리셋. */
  streak: number;
  /** 마지막으로 기록한 KST 거래일 `YYYY-MM-DD` (멱등 판정 기준). */
  lastDateKey: string;
}

/** leverId → streak 상태. 휘발 시 빈 `{}` self-heal(보수적 리셋). */
export type AutoActivationStreakStore = Record<string, AutoActivationLeverStreak>;
