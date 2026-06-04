// @responsibility KIS_FINANCE_PRIMARY_ENABLED 플래그 SSOT — KIS L1 재무(ROE/OPM/부채/EPS/YoY/PER) 1차 소스 활성 여부 단일 통로.
/**
 * kisFinancePrimaryFlag.ts (ADR-0532 Phase 4 — default 승격)
 *
 * KIS finance(L1, financial-ratio/income-statement/stability-ratio)를 Gate2 재무 1차 소스로 쓸지 결정한다.
 * - default ON: KIS L1 재무 1차(ROE/OPM/부채비율/유동비율/EPS/YoY/marginAcceleration) + PER(KIS inquire-price),
 *   OCF/이자보상(현금흐름표 항목)만 DART 잔존에서 머지(mergeKisPrimaryWithDartResidual). KIS=L1 > DART=L2 신뢰등급 상향.
 * - 롤백: ENV `KIS_FINANCE_PRIMARY_ENABLED=false` 1줄 → DART 1차(ADR-0532 이전 동작)로 즉시 복귀.
 *
 * 주의: byte-equivalent 아님 — KIS 재무값이 DART 와 달라 Gate2 FUNDAMENTAL_QUALITY 점수가 이동할 수 있다.
 *       KIS quota 종목당 ~3콜(캐시 + 서킷브레이커로 관리). default 승격 직후 cache self-heal 재산출 wave 발생.
 */
export function isKisFinancePrimaryEnabled(): boolean {
  // default ON — 명시적으로 'false' 일 때만 비활성(ADR-0157 정확 비교).
  return process.env.KIS_FINANCE_PRIMARY_ENABLED !== 'false';
}
