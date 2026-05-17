import { describe, expect, it } from 'vitest';
import { classifyDartDisclosure } from './dartDisclosureClassifier.js';

const base = { disclosureType: '', bodyText: '' };

describe('classifyDartDisclosure', () => {
  it('대규모 공급계약 제목을 positive catalyst로 분류한다', () => {
    const result = classifyDartDisclosure({ ...base, disclosureTitle: '단일판매ㆍ공급계약 체결' });
    expect(['STRUCTURAL_POSITIVE', 'CYCLICAL_POSITIVE']).toContain(result.category);
    expect(result.reasons).toContain('PASS_DART_LARGE_CONTRACT');
    expect(result.marketSignal).toBe(true);
  });

  it('자기주식 취득을 positive catalyst로 분류한다', () => {
    const result = classifyDartDisclosure({ ...base, disclosureTitle: '자기주식 취득 결정' });
    expect(result.category).toBe('SHORT_TERM_POSITIVE');
    expect(result.reasons).toContain('PASS_DART_TREASURY_BUYBACK');
  });

  it('유상증자와 CB/BW 발행을 DILUTION_RISK로 분류한다', () => {
    expect(classifyDartDisclosure({ ...base, disclosureTitle: '유상증자 결정' }).category).toBe('DILUTION_RISK');
    expect(classifyDartDisclosure({ ...base, disclosureTitle: '전환사채권 발행결정' }).category).toBe('DILUTION_RISK');
    expect(classifyDartDisclosure({ ...base, disclosureTitle: '신주인수권부사채 발행결정' }).category).toBe('DILUTION_RISK');
  });

  it('최대주주 매도는 governance 또는 overhang risk로 분류한다', () => {
    const result = classifyDartDisclosure({ ...base, disclosureTitle: '최대주주 장내매도' });
    expect(['GOVERNANCE_RISK', 'OVERHANG_RISK']).toContain(result.category);
    expect(result.risks).toContain('RISK_DART_MAJOR_SHAREHOLDER_SELL');
  });

  it('공급계약 해지를 RISK_NEGATIVE로 분류한다', () => {
    const result = classifyDartDisclosure({ ...base, disclosureTitle: '단일판매ㆍ공급계약 해지' });
    expect(result.category).toBe('RISK_NEGATIVE');
    expect(result.risks).toContain('RISK_DART_CONTRACT_TERMINATION');
  });
});
