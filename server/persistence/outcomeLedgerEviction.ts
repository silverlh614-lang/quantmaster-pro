// @responsibility outcome ledger 캡 eviction SSOT — 성숙 완료 행 우선 제거로 미성숙(PENDING/PARTIAL) forward 증거의 캡 유실 방지.

/** 성숙 종료 상태 — 라벨 완료/만료/데이터불충분 행은 증거 집계에 이미 기여했으므로 우선 제거 대상. */
const MATURED_STATUSES = new Set(['LABELED', 'EXPIRED', 'DATA_INSUFFICIENT']);

/**
 * 캡 초과분을 ①성숙 종료 행(오래된 순) ②그래도 부족하면 최고령 행 순으로 제거한다.
 * 기존 `slice(-MAX)` 단순 절단은 일일 기록량(~800행) > 캡/성숙기간 조건에서 PENDING 행을
 * D3/D5/D10 성숙 전에 밀어내 forward 증거가 영원히 D1 에 머무는 결함이 있었다 (2026-06-11 진단:
 * d1Updated=4208 vs d3/d5/d10Updated=0 · labeled 4220→4208 감소). 캡 절대 초과는 하지 않는다.
 */
export function evictOutcomeSeedsWithMaturityPriority<T extends { outcomeStatus: string }>(
  seeds: readonly T[],
  max: number,
): T[] {
  if (seeds.length <= max) return [...seeds];
  const overflow = seeds.length - max;
  const dropIndexes = new Set<number>();
  for (let i = 0; i < seeds.length && dropIndexes.size < overflow; i += 1) {
    if (MATURED_STATUSES.has(seeds[i].outcomeStatus)) dropIndexes.add(i);
  }
  for (let i = 0; i < seeds.length && dropIndexes.size < overflow; i += 1) {
    dropIndexes.add(i);
  }
  return seeds.filter((_, index) => !dropIndexes.has(index));
}
