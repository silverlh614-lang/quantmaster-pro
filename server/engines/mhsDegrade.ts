// @responsibility ADR-0583 MHS 소스 저하(degrade) 판정 SSOT — sourcesOk→confidence/degraded 도출 + confluence 가드 flag.
//
// 배경: FRED 미연결(배포지 egress 차단) 등 L2 거시 소스가 죽어도 MHS 는 ECOS+default
// 합산으로 정상처럼(예: 75 GREEN) 표시되던 silent degradation. computeMacroIndex 가
// 이미 반환하는 sourcesOk({ecos, fred})를 단일 규칙으로 confidence 등급화해 영속·노출하고,
// flag ON 시 confluence 의 MHS 낙관 부스트를 억제(비관 페널티는 보존)한다.

type MhsConfidence = 'FULL' | 'PARTIAL' | 'FALLBACK';

export interface MhsSourcesOk {
  ecos: boolean;
  fred: boolean;
}

export interface MhsDegradeInfo {
  sourcesOk: MhsSourcesOk;
  /** FULL=양쪽 정상 / PARTIAL=한쪽 결손 / FALLBACK=전면 결손(MHS 50 폴백). */
  confidence: MhsConfidence;
  /** confidence !== 'FULL' (한쪽이라도 결손). */
  degraded: boolean;
}

/**
 * MHS 소스 저하 판정 SSOT.
 *   - ecos && fred  → FULL   (degraded=false)
 *   - 한쪽만        → PARTIAL (degraded=true)
 *   - 둘 다 false   → FALLBACK(degraded=true, computeMacroIndex 가 MHS 50 으로 폴백한 상태)
 */
export function deriveMhsDegrade(sourcesOk: MhsSourcesOk): MhsDegradeInfo {
  const both = sourcesOk.ecos && sourcesOk.fred;
  const neither = !sourcesOk.ecos && !sourcesOk.fred;
  const confidence: MhsConfidence = both ? 'FULL' : neither ? 'FALLBACK' : 'PARTIAL';
  return { sourcesOk, confidence, degraded: !both };
}

/**
 * ADR-0583 Phase B 가드 flag — default OFF(미설정/'false') = confluence MHS 보정 byte-identical.
 * ON('true') 일 때만, MHS 가 degraded 인 경우 confluence 의 MHS GREEN/중립 낙관 부스트를 억제한다.
 */
export function isMhsDegradeGuardEnabled(): boolean {
  return process.env.MHS_DEGRADE_GUARD_ENABLED === 'true';
}
