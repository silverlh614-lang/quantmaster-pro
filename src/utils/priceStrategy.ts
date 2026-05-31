// @responsibility 가격 전략(진입/목표/손절) — 주도주 눌림목(20일선) 진입 정본 헬퍼.
/**
 * 주도주(leader)·VCP 시스템의 진입 원칙 = **눌림목(20일선 되돌림) 매수**. 현재가 추격(고점
 * 매수)이 아니라, 가격이 20일선에서 떠 있으면 그 되돌림 지지선을 진입가로 제시한다.
 *
 * - 진입 = 20일선(MA20). `disparity20`(이격도 = 종가/MA20×100)로 MA20/현재가 비율을 역산하고
 *   되돌림 0~15% 로 clamp. 이격 ≤100(20일선 근처/아래)이거나 데이터 없으면 현재가 = 진입.
 * - 목표/손절은 AI 의 비율(target/entry, stop/entry)을 보존해 진입 기준으로 재계산.
 *
 * 저장된 L4 AI 레벨은 가격이 움직이면 stale 해지므로 진입을 항상 현재가 기준 눌림목으로 잡아,
 * 검색 카드·deep-analysis·StockDetailModal 이 동일 값을 보이게 한다. 자동매매(KIS) 무관 — 표시 전용.
 */

export interface EntryStrategy {
  entry: number;
  target: number;
  stop: number;
  /** 'PULLBACK' = 20일선 눌림목(현재가보다 아래) · 'CURRENT' = 현재가(눌림목 구간/데이터 없음). */
  basis: 'PULLBACK' | 'CURRENT';
}

/** 현재가 + 이격도로 눌림목 진입 전략 산출. current≤0 면 원본 AI 레벨 그대로. */
export function computeEntryStrategy(
  current: number,
  aiEntry: number,
  aiTarget: number,
  aiStop: number,
  disparity20?: number,
): EntryStrategy {
  if (!(current > 0)) {
    return { entry: aiEntry, target: aiTarget, stop: aiStop, basis: 'CURRENT' };
  }
  // 눌림목 비율 = MA20/현재가 (이격도 역산). 이격>100(20일선 위) 일 때만 되돌림, 0~15% clamp.
  const pullbackRatio = disparity20 && disparity20 > 100
    ? Math.max(0.85, Math.min(1, 100 / disparity20))
    : 1;
  const entry = Math.round(current * pullbackRatio);
  // AI 의 목표/손절 비율(R:R) 보존 — 진입 기준으로 재계산.
  const targetRatio = aiTarget > 0 && aiEntry > 0 ? aiTarget / aiEntry : 1.20;
  const stopRatio = aiStop > 0 && aiEntry > 0 ? aiStop / aiEntry : 0.93;
  return {
    entry,
    target: Math.round(entry * targetRatio),
    stop: Math.round(entry * stopRatio),
    basis: pullbackRatio < 1 ? 'PULLBACK' : 'CURRENT',
  };
}
