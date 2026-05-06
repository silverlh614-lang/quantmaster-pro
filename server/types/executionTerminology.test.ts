// @responsibility ADR-0394 P1.5 용어 SSOT 회귀 테스트
import { describe, it, expect } from 'vitest';
import {
  TERMINOLOGY_MAP,
  DISPLAY_LABELS,
  SHADOW_LEDGER_ENABLED,
  modernizeTerm,
  getDisplayLabel,
  detectLegacyTerms,
  type LegacyTerm,
  type ModernTerm,
  type DisplayKey,
} from './executionTerminology.js';

describe('TERMINOLOGY_MAP SSOT (ADR-0394)', () => {
  it('6 legacy → modern 매핑 entries', () => {
    expect(Object.keys(TERMINOLOGY_MAP).length).toBe(6);
  });

  it('사용자 명시 매핑 정확 — shadowBuy → shadowDecisionRecorded', () => {
    expect(TERMINOLOGY_MAP.shadowBuy).toBe('shadowDecisionRecorded');
  });

  it('shadowTrade → shadowDecision', () => {
    expect(TERMINOLOGY_MAP.shadowTrade).toBe('shadowDecision');
  });

  it('paperTrade → paperBuyRecorded', () => {
    expect(TERMINOLOGY_MAP.paperTrade).toBe('paperBuyRecorded');
  });

  it('liveTrade → liveOrderSent', () => {
    expect(TERMINOLOGY_MAP.liveTrade).toBe('liveOrderSent');
  });

  it('shadowMode → shadowLedgerEnabled (정책 상수)', () => {
    expect(TERMINOLOGY_MAP.shadowMode).toBe('shadowLedgerEnabled');
  });

  it('simulation → decisionRecord (모호한 용어 제거)', () => {
    expect(TERMINOLOGY_MAP.simulation).toBe('decisionRecord');
  });
});

describe('SHADOW_LEDGER_ENABLED 정책 상수 (ADR-0394)', () => {
  it('always-on 정책 — true 고정', () => {
    expect(SHADOW_LEDGER_ENABLED).toBe(true);
  });

  it('타입 — readonly true literal', () => {
    // TypeScript 타입 검증: const = true 라 SHADOW_LEDGER_ENABLED = false 할당 시 컴파일 에러.
    // 런타임 동작 검증으로 대체.
    expect(typeof SHADOW_LEDGER_ENABLED).toBe('boolean');
  });
});

describe('DISPLAY_LABELS SSOT (ADR-0394)', () => {
  it('5분류 통계 라벨 모두 등재', () => {
    expect(DISPLAY_LABELS.shadowDecisionRecorded).toBeDefined();
    expect(DISPLAY_LABELS.paperBuyRecorded).toBeDefined();
    expect(DISPLAY_LABELS.liveOrderSent).toBeDefined();
    expect(DISPLAY_LABELS.liveBlocked).toBeDefined();
    expect(DISPLAY_LABELS.ghost).toBeDefined();
  });

  it('이모지 마커 포함 — 시각 인식 격상', () => {
    expect(DISPLAY_LABELS.shadowDecisionRecorded).toMatch(/🌑/);
    expect(DISPLAY_LABELS.paperBuyRecorded).toMatch(/🟡/);
    expect(DISPLAY_LABELS.liveOrderSent).toMatch(/🟢/);
    expect(DISPLAY_LABELS.liveBlocked).toMatch(/🔴/);
    expect(DISPLAY_LABELS.ghost).toMatch(/👻/);
  });

  it('정책 상수 라벨 — always-on 명시', () => {
    expect(DISPLAY_LABELS.shadowLedgerEnabled).toMatch(/always-on/);
  });
});

describe('modernizeTerm (ADR-0394)', () => {
  it('legacy 용어 → 신규 용어 변환', () => {
    expect(modernizeTerm('shadowBuy')).toBe<ModernTerm>('shadowDecisionRecorded');
    expect(modernizeTerm('liveTrade')).toBe<ModernTerm>('liveOrderSent');
  });

  it('모든 LegacyTerm 매핑 가능 — type-safe', () => {
    const allLegacy: LegacyTerm[] = ['shadowBuy', 'shadowTrade', 'paperTrade', 'liveTrade', 'shadowMode', 'simulation'];
    for (const legacy of allLegacy) {
      const modern = modernizeTerm(legacy);
      expect(modern).toBeTruthy();
    }
  });
});

describe('getDisplayLabel (ADR-0394)', () => {
  it('표시 라벨 조회 — 텔레그램·UI 메시지 단일 통로', () => {
    const label = getDisplayLabel('shadowDecisionRecorded');
    expect(label).toBeTruthy();
    expect(label).toBe(DISPLAY_LABELS.shadowDecisionRecorded);
  });

  it('모든 DisplayKey 조회 가능 — type-safe', () => {
    const allKeys: DisplayKey[] = [
      'shadowDecisionRecorded',
      'paperBuyRecorded',
      'liveOrderSent',
      'liveBlocked',
      'ghost',
      'shadowLedgerEnabled',
      'decisionRecord',
    ];
    for (const key of allKeys) {
      expect(getDisplayLabel(key)).toBeTruthy();
    }
  });
});

describe('detectLegacyTerms 정책 가드 (ADR-0394)', () => {
  it('빈 텍스트 → 위반 0건', () => {
    expect(detectLegacyTerms('')).toEqual([]);
  });

  it('shadow buy → shadowBuy 위반 검출', () => {
    const violations = detectLegacyTerms('Recorded shadow buy event');
    expect(violations).toContain('shadowBuy');
  });

  it('shadow trade → shadowTrade 위반', () => {
    expect(detectLegacyTerms('shadow trade history')).toContain('shadowTrade');
  });

  it('paper trade → paperTrade 위반', () => {
    expect(detectLegacyTerms('execute paper trade')).toContain('paperTrade');
  });

  it('live trade → liveTrade 위반', () => {
    expect(detectLegacyTerms('live trade success')).toContain('liveTrade');
  });

  it('shadowMode 식별자 → shadowMode 위반 (camelCase 패턴)', () => {
    expect(detectLegacyTerms('const shadowMode = true;')).toContain('shadowMode');
  });

  it('simulation → simulation 위반', () => {
    expect(detectLegacyTerms('Run simulation result')).toContain('simulation');
  });

  it('대소문자 무관 — Shadow Buy / SHADOW BUY', () => {
    expect(detectLegacyTerms('Shadow Buy')).toContain('shadowBuy');
    expect(detectLegacyTerms('SHADOW BUY')).toContain('shadowBuy');
  });

  it('다중 위반 — 모두 검출', () => {
    const violations = detectLegacyTerms('shadow trade and live trade and shadowMode');
    expect(violations).toContain('shadowTrade');
    expect(violations).toContain('liveTrade');
    expect(violations).toContain('shadowMode');
  });

  it('정상 신규 용어 → 위반 0건', () => {
    expect(detectLegacyTerms('shadowDecisionRecorded fired liveOrderSent')).toEqual([]);
  });

  it('모호한 매칭 차단 — "live" 단독 (trade 없으면) → 위반 아님', () => {
    expect(detectLegacyTerms('live mode')).not.toContain('liveTrade');
  });
});
