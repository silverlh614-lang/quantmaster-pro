// @responsibility DART 공시 제목 촉매유형 분류
import type { DartCatalystCategory, DartDisclosureRecord, DartReason } from './dartPreNewsTypes.js';

export interface DartClassificationResult {
  category: DartCatalystCategory;
  disclosureType: string;
  reasons: DartReason[];
  risks: DartReason[];
  marketSignal: boolean;
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((n) => text.includes(n.toLowerCase()));
}

export function classifyDartDisclosure(input: Pick<DartDisclosureRecord, 'disclosureTitle' | 'disclosureType' | 'bodyText'>): DartClassificationResult {
  const text = `${input.disclosureTitle} ${input.disclosureType} ${input.bodyText ?? ''}`.toLowerCase().replace(/\s+/g, ' ');
  const reasons: DartReason[] = [];
  const risks: DartReason[] = [];
  let category: DartCatalystCategory = 'UNKNOWN';

  if (hasAny(text, ['불성실공시', '거래정지', '관리종목'])) {
    category = 'GOVERNANCE_RISK';
    if (text.includes('거래정지')) risks.push('RISK_DART_TRADING_HALT');
    if (text.includes('관리종목')) risks.push('RISK_DART_MANAGED_STOCK');
    if (text.includes('불성실공시')) risks.push('RISK_DART_UNFAITHFUL_DISCLOSURE');
  } else if (hasAny(text, ['해지', '정정']) && hasAny(text, ['공급계약', '판매', '수주', '단일판매'])) {
    category = 'RISK_NEGATIVE';
    risks.push('RISK_DART_CONTRACT_TERMINATION');
  } else if (hasAny(text, ['유상증자', '전환사채', '신주인수권부사채', ' cb', ' bw', '사채권', '신주인수권'])) {
    category = 'DILUTION_RISK';
    if (text.includes('유상증자')) risks.push('RISK_DART_CAPITAL_INCREASE');
    if (hasAny(text, ['전환사채', '신주인수권부사채', ' cb', ' bw', '신주인수권'])) risks.push('RISK_DART_CB_BW_ISSUANCE');
  } else if (hasAny(text, ['최대주주 변경', '최대주주의 변경'])) {
    category = 'GOVERNANCE_RISK';
    risks.push('RISK_DART_GOVERNANCE_CHANGE');
  } else if (hasAny(text, ['최대주주', '임원', '주요주주']) && hasAny(text, ['장내매도', '매도', '처분'])) {
    category = 'OVERHANG_RISK';
    risks.push('RISK_DART_MAJOR_SHAREHOLDER_SELL', 'RISK_DART_OVERHANG');
  } else if (hasAny(text, ['단일판매', '공급계약', '판매ㆍ공급계약', '수주'])) {
    category = 'STRUCTURAL_POSITIVE';
    reasons.push('PASS_DART_LARGE_CONTRACT', 'PASS_DART_STRUCTURAL_CATALYST');
    if (hasAny(text, ['장기', '다년', 'long-term'])) reasons.push('PASS_DART_LONG_TERM_SUPPLY');
  } else if (hasAny(text, ['신규시설투자', '시설투자', '유형자산 취득', '타법인 주식 및 출자증권 취득'])) {
    category = 'STRUCTURAL_POSITIVE';
    reasons.push('PASS_DART_CAPEX_INVESTMENT', 'PASS_DART_STRUCTURAL_CATALYST');
  } else if (hasAny(text, ['자기주식 취득', '자사주 취득'])) {
    category = 'SHORT_TERM_POSITIVE';
    reasons.push('PASS_DART_TREASURY_BUYBACK');
  } else if (hasAny(text, ['특허권 취득', '특허취득'])) {
    category = 'STRUCTURAL_POSITIVE';
    reasons.push('PASS_DART_PATENT_ACQUIRED');
  } else if (hasAny(text, ['기술이전', '라이선스', 'license', 'licence'])) {
    category = 'STRUCTURAL_POSITIVE';
    reasons.push('PASS_DART_TECH_TRANSFER', 'PASS_DART_STRUCTURAL_CATALYST');
  } else if (hasAny(text, ['잠정실적', '영업이익']) && hasAny(text, ['증가', '급증', '흑자전환'])) {
    category = 'CYCLICAL_POSITIVE';
    reasons.push('PASS_DART_EARNINGS_SURPRISE');
  } else if (hasAny(text, ['무상증자'])) {
    category = 'SHORT_TERM_POSITIVE';
    reasons.push('PASS_DART_STRUCTURAL_CATALYST');
  } else if (hasAny(text, ['투자판단 관련 주요경영사항', '주요경영사항'])) {
    category = 'NEUTRAL_INFO';
  }

  return {
    category,
    disclosureType: input.disclosureType || input.disclosureTitle,
    reasons: Array.from(new Set(reasons)),
    risks: Array.from(new Set(risks)),
    marketSignal: category !== 'UNKNOWN' && category !== 'NEUTRAL_INFO',
  };
}
