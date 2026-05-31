// @responsibility 가격 전략(진입/목표/손절) 현재가 기준 stale 재계산 — 표시 정본 헬퍼.
/**
 * 저장된 L4 AI 가격 레벨은 종목 가격이 움직이면 현재가 기준에서 벗어난다 (진입이 한참
 * 아래/위, 목표가 현재가 바로 위 등 → 혼동). 현재가에 앵커링해 재계산하여 검색 카드와
 * deep-analysis 가 동일한 값을 보이게 한다. 자동매매(KIS) 경로와 무관 — 표시 전용.
 *
 * 재계산 시 AI 의 목표/손절 비율(target/entry, stop/entry)은 보존하고 진입만 현재가로 옮긴다.
 */

export interface RebasedStrategy {
  entry: number;
  target: number;
  stop: number;
  /** true 면 현재가에 앵커링해 재계산됨 (원본 AI 레벨이 stale). */
  rebased: boolean;
}

/** 현재가 기준 가격 전략 정본. current 미확보(≤0) 거나 entry 부재면 원본 그대로 반환. */
export function rebaseStrategyToCurrent(
  current: number,
  entry: number,
  target: number,
  stop: number,
): RebasedStrategy {
  const stale = current > 0 && entry > 0 && (
    (stop > 0 && stop >= current) ||                  // 손절이 현재가 이상 (이미 손절선 아래)
    Math.abs(current - entry) / current > 0.10 ||     // 진입이 현재가에서 ±10% 이상 이탈
    (target > 0 && target / current < 1.05)           // 목표 여력 < 5% (목표가 현재가 바로 위)
  );
  if (!stale) return { entry, target, stop, rebased: false };
  const targetRatio = target > 0 ? target / entry : 1.20;
  const stopRatio = stop > 0 ? stop / entry : 0.93;
  return {
    entry: current,
    target: Math.round(current * targetRatio),
    stop: Math.round(current * stopRatio),
    rebased: true,
  };
}
