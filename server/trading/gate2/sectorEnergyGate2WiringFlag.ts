// @responsibility SECTOR_ENERGY_GATE2_WIRING_ENABLED 플래그 SSOT — macroState.sectorEnergyResult를 Gate2 confluence SECTOR_LEADERSHIP 축으로 배선할지 단일 통로.
/**
 * sectorEnergyGate2WiringFlag.ts (ADR-0568)
 *
 * 배경(2026-06-04 섹터원인조사): macroState.sectorEnergyResult 는 score boost·포지션 상한·표시용
 * sectorLeadershipScore 엔 이미 쓰이지만, Gate2 confluence external coverage 입력
 * (gate2ExternalCoverageInput.sectorEnergyResult) 으로만 미배선이었다. 그 결과
 * buildSectorAxis(gate2ConfluenceScore.ts)가 sectorCycle/leaderCycle 을 빈 값으로 받아
 * 전 종목 SECTOR_LEADERSHIP MISSING → scan_blockers "Sector 0/25".
 *
 * 이 플래그는 그 배선의 *소비 지점*(externalCoverage.ts: normalizeSectorThemeCycleForGate2 호출)을
 * gate 한다. caller(stockScreener/universeScanner)는 sectorEnergyResult 를 무조건 thread 하지만,
 * OFF 면 소비 지점에서 undefined 로 무시 → sectorCycle 빌드가 현행과 byte-identical.
 *
 * - default OFF: 명시적 opt-in('true') 일 때만 활성. executionImpact ≠ NONE — ON 시
 *   SECTOR_LEADERSHIP 축이 채워져 coverageAdjustedScore 가 이동하고 일부 gate2Status(특히
 *   GATE2_PASS_STRONG 의 bullishAxisCount>=3 조건)가 바뀔 수 있다.
 * - 활성화: ENV `SECTOR_ENERGY_GATE2_WIRING_ENABLED=true`.
 * - 주의: 섹터 데이터가 VERIFIED/PARTIAL 일 때만 축이 채워진다(off-hours/sector-index-master
 *   결손 시 ON 이어도 MISSING — 정상 동작).
 */
export function isSectorEnergyGate2WiringEnabled(): boolean {
  // default OFF — 명시적으로 'true' 일 때만 활성(ADR-0157 정확 비교).
  return process.env.SECTOR_ENERGY_GATE2_WIRING_ENABLED === 'true';
}
