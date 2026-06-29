// @responsibility ADR-0658 위험·경고 지정 종목 진입 후보 제외 순수 분류기 (SSOT, no I/O).

/**
 * riskDesignationClassifier.ts — KIS inquire-price designation → 진입 제외 판정 (ADR-0658).
 *
 * 운영자(silverlh614) 가 위험·경고 지정 종목(서산 079650 투자경고 -10% stop 사례)을
 * 진입 후보에서 제외할 것을 명시 요청. 본 모듈은 순수(부수효과·네트워크 0)하며
 * NormalizedKisOfficialQuote.designation 만 입력받아 excluded/reason 을 반환한다.
 *
 * 결손/미존재 designation → NOT excluded (graceful; 부재 ≠ 위험, 불변식 #6).
 */

import type { KisOfficialDesignation } from '../clients/kisClient/kisOfficialQuoteMapper.js';

export interface RiskDesignationDecision {
  excluded: boolean;
  reason?: string;
}

/**
 * iscd_stat_cls_code(종목상태구분) 위험 코드셋.
 *
 * KIS inquire-price 명세상 '00'(그외/정상) 은 정상이며, 마진/신용 등 benign 상태는
 * 위험으로 보지 않는다. 보수적으로 아래 코드를 위험으로 매핑한다(주석에 의미 명시):
 *   51 관리종목 / 52 투자위험 / 53 투자경고 / 54 투자주의 / 55 신용가능 (※ benign — 제외)
 *   58 거래정지 / 59 단기과열
 *
 * 단, '55'(신용가능)·'57'(증거금 관련) 등 거래 가능 상태로 알려진 코드는 위험에서 제외한다.
 * 불확실 코드는 over-filter 회피를 위해 위험 집합에서 보수적으로 누락(missing≠risk).
 * 본 집합은 stockScreener.isRiskyKisRow('51','52','53','54','55','56','58') 의 랭킹-row
 * 사전필터와 정합하되, '55'(신용)는 명시적 benign 으로 분리해 detailed-quote 단계에서
 * 과제외를 줄인다. 시장경고(mrkt_warn_cls_code)·거래정지(trht_yn)·관리(mang_issu) 는
 * 별도 필드로 1차 판정되므로 본 코드셋은 보강(redundant-safe)일 뿐 단일 의존 아님.
 */
const RISKY_ISCD_STAT_CODES = new Set<string>([
  '51', // 관리종목
  '52', // 투자위험
  '53', // 투자경고
  '54', // 투자주의
  '56', // 위험예고
  '58', // 거래정지
  '59', // 단기과열
]);

const MARKET_WARN_RISK = new Set<string>([
  '01', // 투자주의
  '02', // 투자경고
  '03', // 투자위험
]);

/**
 * designation 이 ANY 위험 조건에 해당하면 excluded=true + reason 반환.
 * 우선순위: 거래정지 > 정리매매 > 관리종목 > 시장경고 > 단기과열 > 종목상태코드.
 * 결손/미존재 → { excluded: false } (graceful).
 */
export function isRiskDesignatedStock(
  designation: KisOfficialDesignation | null | undefined,
): RiskDesignationDecision {
  if (!designation) return { excluded: false };

  if (designation.tradingHalt) return { excluded: true, reason: 'RISK_DESIGNATED:거래정지' };
  if (designation.liquidation) return { excluded: true, reason: 'RISK_DESIGNATED:정리매매' };
  if (designation.managementIssue) return { excluded: true, reason: 'RISK_DESIGNATED:관리종목' };

  const warn = designation.marketWarnCode;
  if (warn && MARKET_WARN_RISK.has(warn)) {
    const label = warn === '01' ? '투자주의' : warn === '02' ? '투자경고' : '투자위험';
    return { excluded: true, reason: `RISK_DESIGNATED:${label}` };
  }

  if (designation.shortOverheated) return { excluded: true, reason: 'RISK_DESIGNATED:단기과열' };

  const stat = designation.iscdStatCode;
  if (stat && RISKY_ISCD_STAT_CODES.has(stat)) {
    return { excluded: true, reason: `RISK_DESIGNATED:종목상태(${stat})` };
  }

  return { excluded: false };
}
