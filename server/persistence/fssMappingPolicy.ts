// @responsibility fssMappingPolicy SSOT — KRX 11분류 → Passive/Active/Foreign 매핑 (ADR-0142)
//
// 사용자 명시 *통념 추정 위험* 차단:
//   - 매핑 helper 만 도입, ENV gate default OFF
//   - FSS_MAPPING_ENABLED=true 명시 활성화 시에만 작동
//   - 활성화 결정은 *운영자가 데이터 1~2주 검증 후 명시*
//
// 매핑 후보 (검증 대기):
//   - Passive = 투신 + 연기금 등 + 보험 (장기 자산운용)
//   - Active  = 금융투자 + 사모 + 은행 + 기타금융 (단기 알파)
//   - Foreign = 외국인 + 기타외국인
//   - 매핑 미적용 (제외): 개인, 기타법인 (passiveActiveBoth 평가에서 제외)

import type { KrxInvestorDetailRow } from '../clients/krxClient.js';

/** Passive proxy 카테고리 — 장기 자산운용. 검증 대기. */
export const FSS_PASSIVE_CATEGORIES = ['투신', '연기금 등', '보험'] as const;

/** Active proxy 카테고리 — 단기 알파 추구. 검증 대기. */
export const FSS_ACTIVE_CATEGORIES = ['금융투자', '사모', '은행', '기타금융'] as const;

/** Foreign 카테고리 — 외국인 + 기타외국인 합. */
export const FSS_FOREIGN_CATEGORIES = ['외국인', '기타외국인'] as const;

export interface FssMappingResult {
  date: string;
  passiveNetBuy: number;     // 합산 (억원)
  activeNetBuy: number;      // 합산 (억원)
  foreignNetBuy: number;     // 합산 (억원)
  unmatched: string[];       // 매핑 미적용 카테고리 (로깅용)
}

/**
 * KRX 11분류 raw → Passive/Active/Foreign 합산 매핑.
 *
 * - 카테고리 누락 시 0 합산 (안전 fallback)
 * - unmatched 분류 — 매핑 외 카테고리 (개인 / 기타법인 / 잘못된 카테고리)
 * - 거래대금 (원) → 억원 환산 (다른 macroState 자금 흐름 단위 정합)
 * - 빈 입력 시 모두 0 + unmatched 빈 배열
 *
 * @param rows KRX 11분류 raw 배열
 * @param date YYYY-MM-DD (호출자 책임 — 형식 검증 안 함)
 */
export function mapPassiveActive(
  rows: KrxInvestorDetailRow[],
  date: string,
): FssMappingResult {
  let passiveSum = 0;
  let activeSum = 0;
  let foreignSum = 0;
  const unmatched: string[] = [];

  for (const row of rows) {
    const category = row.category;
    const eokwon = (Number.isFinite(row.netBuyKrw) ? row.netBuyKrw : 0) / 100_000_000;

    if ((FSS_PASSIVE_CATEGORIES as readonly string[]).includes(category)) {
      passiveSum += eokwon;
    } else if ((FSS_ACTIVE_CATEGORIES as readonly string[]).includes(category)) {
      activeSum += eokwon;
    } else if ((FSS_FOREIGN_CATEGORIES as readonly string[]).includes(category)) {
      foreignSum += eokwon;
    } else {
      unmatched.push(category);
    }
  }

  return {
    date,
    passiveNetBuy: parseFloat(passiveSum.toFixed(2)),
    activeNetBuy: parseFloat(activeSum.toFixed(2)),
    foreignNetBuy: parseFloat(foreignSum.toFixed(2)),
    unmatched,
  };
}

/**
 * ENV gate — default OFF.
 * 운영자 명시 활성화 (`FSS_MAPPING_ENABLED=true`) 시에만 자동 매핑 작동.
 */
export function isFssMappingEnabled(): boolean {
  return process.env.FSS_MAPPING_ENABLED === 'true';
}
