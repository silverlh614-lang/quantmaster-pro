// @responsibility quant contrarianEngine 엔진 모듈
/**
 * contrarianEngine.ts — 역발상 카운터사이클 알고리즘
 *
 * 거시 악재가 오히려 특정 섹터의 매수 신호가 되는 역발상 조건을 판별.
 */

import type { ContrarianSignal, EconomicRegime } from '../../types/quant';
import { VIX } from '../../constants/thresholds';

// ─── 아이디어 11: 역발상 카운터사이클 알고리즘 ──────────────────────────────

/**
 * 거시 악재가 오히려 특정 섹터의 매수 신호가 되는 역발상 조건 3가지를 판별.
 * 순수 계산 함수 — AI 호출 없음.
 */
export function computeContrarianSignals(
  economicRegime: EconomicRegime | undefined,
  fxRegime: 'DOLLAR_STRONG' | 'DOLLAR_WEAK' | 'NEUTRAL',
  vix: number,
  exportGrowth3mAvg: number,
  sectorName: string,
): ContrarianSignal[] {
  const GEO_DEFENSE = ['방산', '방위산업', '항공우주'];
  const HEALTHCARE_DOMESTIC = ['헬스케어', '바이오', '의료기기', '제약'];

  const isDefense = GEO_DEFENSE.some(s => sectorName.includes(s));
  const isHealthcare = HEALTHCARE_DOMESTIC.some(s => sectorName.includes(s));

  // 신호 1: 경기 침체 → 방산 매수 조건 강화 (예산 확대 기대)
  const recessionDefense: ContrarianSignal = {
    id: 'RECESSION_DEFENSE',
    name: '침체기 방산 역발상',
    active: economicRegime === 'RECESSION' && isDefense,
    bonus: 5,
    description: '경기 침체 시 정부 방산 예산 확대 기대 → 방산주 Gate 3 +5pt 역발상 가산',
  };

  // 신호 2: 달러 강세 + 수출 둔화 → 내수 헬스케어 Gate 완화
  const dollarHealthcare: ContrarianSignal = {
    id: 'DOLLAR_STRONG_HEALTHCARE',
    name: '달러강세 헬스케어 역발상',
    active: fxRegime === 'DOLLAR_STRONG' && exportGrowth3mAvg < 0 && isHealthcare,
    bonus: 3,
    description: '달러 강세 + 수출 둔화 → 내수 헬스케어 상대적 수혜 → Gate 3 +3pt',
  };

  // 신호 3: VIX 급등 공포 극점 → Gate 3 역발상 매수 가산점
  const vixFearPeak: ContrarianSignal = {
    id: 'VIX_FEAR_PEAK',
    name: 'VIX 공포 극점 역발상',
    active: vix >= VIX.CONTRARIAN,
    bonus: 3,
    description: `VIX ≥ ${VIX.CONTRARIAN} 공포 극점 → 통계적 과매도 → Gate 3 +3pt 역발상 가산`,
  };

  return [recessionDefense, dollarHealthcare, vixFearPeak];
}
