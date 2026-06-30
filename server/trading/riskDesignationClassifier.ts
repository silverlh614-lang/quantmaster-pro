// @responsibility ADR-0658/0659 위험·경고 지정 + 펀더멘털 deep-junk floor 진입 제외 순수 분류기 (SSOT, no I/O).

/**
 * riskDesignationClassifier.ts — KIS inquire-price designation → 진입 제외 판정 (ADR-0658)
 * + 펀더멘털 deep-junk floor 진입 제외 판정 (ADR-0659).
 *
 * 운영자(silverlh614) 가 위험·경고 지정 종목(서산 079650 투자경고 -10% stop 사례)을
 * 진입 후보에서 제외할 것을 명시 요청. 본 모듈은 순수(부수효과·네트워크 0)하며
 * NormalizedKisOfficialQuote.designation 만 입력받아 excluded/reason 을 반환한다.
 *
 * ADR-0659(Option B 후속): 형식적 KRX 지정이 없으나 펀더멘털이 깊게 음(-)인 종목
 * (서산 ROE -55% 사례)을 ROE floor(기본 -20%) 기준으로 추가 제외한다. 본 판정 역시
 * 순수하며 reuse-only ROE(Gate2 캐시) 만 입력받는다 — 신규 KIS/DART fetch 0.
 *
 * 결손/미존재 designation·ROE → NOT excluded (graceful; 부재·결손 ≠ 위험, 불변식 #6).
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

// ─── ADR-0659 — 펀더멘털 deep-junk floor 진입 제외 (Option B 후속) ──────────────
// ADR-0658 은 형식적 KRX 지정(투자경고/위험/관리/단기과열) 만 제외한다. 형식적 지정이
// 없으나 펀더멘털이 깊게 음(-)인 종목(서산 079650 ROE -55.6%·적자·shadow -10% 손실)은
// 여전히 통과한다 → 본 분류기가 ROE floor 로 deep-junk 만 보수적으로 추가 제외한다.
//
// 보수성 근거: floor 를 깊게(-20% default) 둬서 (1) 경미·턴어라운드 적자(-5% 등),
// (2) 흑자전환 직전 성장주(pre-profit growth leader)는 살리고 (3) 깊은 적자만 잡는다.
// ROE 결손/NaN → 미제외(graceful; 데이터 결손 ≠ junk, 불변식 #6). 본 모듈은 reuse-only
// ROE 만 받으며 신규 fetch 0 — Gate2 캐시(profitability.roe / metrics.roe)에서 차용한다.
// ADR-0655/0656 Gate2 재무위험 soft 페널티(점수 cap)를 대체하지 않고 보완한다(별도 seam).

export interface FundamentalFloorInput {
  /** Gate2 캐시 ROE(%) — 결손/미가용 가능. null/NaN → 미제외(graceful). */
  roePct?: number | null;
}

/**
 * 펀더멘털 deep-junk floor 판정. roePct 가 present 이고 finite 이며 floorPct 이하이면 제외.
 * 경계: roePct === floorPct → 제외(≤). roePct > floorPct → 미제외.
 * 결손/NaN/±Infinity ROE → { excluded: false } (graceful; 데이터 결손 ≠ junk, 불변식 #6).
 */
export function isFundamentalJunkBelowFloor(
  input: FundamentalFloorInput,
  floorPct: number,
): RiskDesignationDecision {
  const roe = input.roePct;
  if (roe == null || !Number.isFinite(roe)) return { excluded: false };
  if (roe <= floorPct) {
    return {
      excluded: true,
      reason: `FUNDAMENTAL_JUNK_FLOOR:ROE=${round1(roe)}<=${round1(floorPct)}`,
    };
  }
  return { excluded: false };
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}
