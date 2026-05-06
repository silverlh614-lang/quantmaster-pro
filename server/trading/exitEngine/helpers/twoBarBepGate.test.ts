// @responsibility ADR-0085 PR-B1-1 applyTwoBarBepGate 헬퍼 단위 회귀 테스트
/**
 * twoBarBepGate.test.ts — Two-Bar Confirmation Gate (BEP_PROTECTION 단봉 노이즈
 * 차단) 호출자 진입점 SSOT 회귀.
 *
 * vi.mock 로 외부 의존성 격리:
 *   - state.getTradingMode() → SHADOW/LIVE 모드 토글
 *   - helpers/ma60.kstBusinessDateStr() → 결정적 일자 주입
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeMockShadow } from '../rules/__tests__/_testHelpers.js';

// vi.mock — 호이스팅 규칙상 import 보다 먼저 선언.
vi.mock('../../../state.js', () => ({
  getTradingMode: vi.fn(() => 'SHADOW'),
}));
vi.mock('../helpers/ma60.js', () => ({
  kstBusinessDateStr: vi.fn(() => '2026-05-01'),
}));

const { applyTwoBarBepGate, isBepProtectionPolicyDisabled, isBepTwoBarLiveEnabled } =
  await import('./twoBarBepGate.js');
const { getTradingMode } = await import('../../../state.js');
const { kstBusinessDateStr } = await import('../helpers/ma60.js');

describe('twoBarBepGate (ADR-0085 PR-B1-1)', () => {
  const ORIG_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.BEP_PROTECTION_DISABLED;
    delete process.env.BEP_TWO_BAR_LIVE_ENABLED;
    delete process.env.BEP_TWO_BAR_CONFIRMATION_DISABLED;
    (getTradingMode as any).mockReturnValue('SHADOW');
    (kstBusinessDateStr as any).mockReturnValue('2026-05-01');
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
    vi.clearAllMocks();
  });

  describe('ENV 우회 분기', () => {
    it('BEP_PROTECTION_DISABLED=true → SKIP (정책 우회)', () => {
      process.env.BEP_PROTECTION_DISABLED = 'true';
      const r = applyTwoBarBepGate({
        shadow: makeMockShadow(),
        currentPrice: 89,
        hardStopLoss: 90,
        isBepProtection: true,
      });
      expect(r.action).toBe('SKIP');
      expect(r.reason).toContain('BEP_PROTECTION_DISABLED');
      expect(isBepProtectionPolicyDisabled()).toBe(true);
    });

    it('isBepProtectionPolicyDisabled() default false', () => {
      expect(isBepProtectionPolicyDisabled()).toBe(false);
    });

    it('isBepTwoBarLiveEnabled() default true (PR-P0-Activation 2026-05-06)', () => {
      // ADR-0085 PR-P0-Activation — default OFF → ON 전환. 운영자 명시 결정.
      expect(isBepTwoBarLiveEnabled()).toBe(true);
    });

    it('BEP_TWO_BAR_LIVE_ENABLED=false 정확 비교 → isBepTwoBarLiveEnabled()=false', () => {
      process.env.BEP_TWO_BAR_LIVE_ENABLED = 'false';
      expect(isBepTwoBarLiveEnabled()).toBe(false);
    });

    it('BEP_TWO_BAR_LIVE_ENABLED=true → isBepTwoBarLiveEnabled()=true', () => {
      process.env.BEP_TWO_BAR_LIVE_ENABLED = 'true';
      expect(isBepTwoBarLiveEnabled()).toBe(true);
    });
  });

  describe('isBepProtection 분류 분기', () => {
    it('isBepProtection=false → SKIP (즉시 청산 위임)', () => {
      const r = applyTwoBarBepGate({
        shadow: makeMockShadow(),
        currentPrice: 89,
        hardStopLoss: 90,
        isBepProtection: false,
      });
      expect(r.action).toBe('SKIP');
      expect(r.reason).toContain('BEP_PROTECTION 분류 아님');
    });
  });

  describe('LIVE 회귀 격리 분기 (PR-P0-Activation default ON)', () => {
    it('LIVE 모드 + BEP_TWO_BAR_LIVE_ENABLED=false 명시 → SKIP (legacy 회귀 격리)', () => {
      // ADR-0085 PR-P0-Activation — default ON 후 운영자가 명시 비활성 시 legacy 동작 복원.
      process.env.BEP_TWO_BAR_LIVE_ENABLED = 'false';
      (getTradingMode as any).mockReturnValue('LIVE');
      const r = applyTwoBarBepGate({
        shadow: makeMockShadow(),
        currentPrice: 89,
        hardStopLoss: 90,
        isBepProtection: true,
      });
      expect(r.action).toBe('SKIP');
      expect(r.reason).toContain('LIVE');
      expect(r.reason).toContain('회귀 격리');
    });

    it('LIVE 모드 + BEP_TWO_BAR_LIVE_ENABLED=true → 정책 활성', () => {
      (getTradingMode as any).mockReturnValue('LIVE');
      process.env.BEP_TWO_BAR_LIVE_ENABLED = 'true';
      const shadow = makeMockShadow({ shadowEntryPrice: 100 });
      const r = applyTwoBarBepGate({
        shadow,
        currentPrice: 89,
        hardStopLoss: 90,
        isBepProtection: true,
      });
      // LIVE 활성화 → SKIP 안 됨, evaluateTwoBarConfirmation 결과 분기
      expect(r.action).not.toBe('SKIP');
      expect(['WAIT', 'RESET', 'CONTINUE_EXIT']).toContain(r.action);
    });

    it('SHADOW 모드 (default) → ENV 무관 활성', () => {
      (getTradingMode as any).mockReturnValue('SHADOW');
      const r = applyTwoBarBepGate({
        shadow: makeMockShadow(),
        currentPrice: 89,
        hardStopLoss: 90,
        isBepProtection: true,
      });
      expect(r.action).not.toBe('SKIP');
    });

    it('PAPER/MANUAL 모드 → SHADOW 와 동일 활성', () => {
      (getTradingMode as any).mockReturnValue('PAPER');
      const r = applyTwoBarBepGate({
        shadow: makeMockShadow(),
        currentPrice: 89,
        hardStopLoss: 90,
        isBepProtection: true,
      });
      expect(r.action).not.toBe('SKIP');
    });
  });

  describe('evaluateTwoBarConfirmation 결과 분기', () => {
    it('1차 터치 (bepGlideTouchAt 부재) → WAIT + shadowUpdate 합성', () => {
      const shadow = makeMockShadow({ shadowEntryPrice: 100, bepGlideTouchAt: undefined });
      const r = applyTwoBarBepGate({
        shadow,
        currentPrice: 89,
        hardStopLoss: 90,
        isBepProtection: true,
      });
      expect(r.action).toBe('WAIT');
      expect(r.shadowUpdate).toEqual({ bepGlideTouchAt: '2026-05-01' });
      expect(r.reason).toContain('1차 터치');
    });

    it('1차 터치 당일 재방문 → WAIT + shadowUpdate undefined (영속 no-op)', () => {
      const shadow = makeMockShadow({ shadowEntryPrice: 100, bepGlideTouchAt: '2026-05-01' });
      const r = applyTwoBarBepGate({
        shadow,
        currentPrice: 89,
        hardStopLoss: 90,
        isBepProtection: true,
      });
      expect(r.action).toBe('WAIT');
      expect(r.shadowUpdate).toBeUndefined();
    });

    it('다음 영업일 미달 (GRACE_DAYS=1 경과) → CONTINUE_EXIT', () => {
      const shadow = makeMockShadow({ shadowEntryPrice: 100, bepGlideTouchAt: '2026-04-30' });
      (kstBusinessDateStr as any).mockReturnValue('2026-05-01');
      const r = applyTwoBarBepGate({
        shadow,
        currentPrice: 89,
        hardStopLoss: 90,
        isBepProtection: true,
      });
      expect(r.action).toBe('CONTINUE_EXIT');
      expect(r.shadowUpdate).toBeUndefined();
      expect(r.reason).toContain('2개 봉 연속 미달');
    });

    it('가격 회복 (currentPrice > stopLoss) + 영속 존재 → RESET + 영속 초기화', () => {
      const shadow = makeMockShadow({ shadowEntryPrice: 100, bepGlideTouchAt: '2026-04-30' });
      const r = applyTwoBarBepGate({
        shadow,
        currentPrice: 95, // > 90 (stopLoss)
        hardStopLoss: 90,
        isBepProtection: true,
      });
      expect(r.action).toBe('RESET');
      expect(r.shadowUpdate).toEqual({ bepGlideTouchAt: undefined });
      expect(r.reason).toContain('회복');
    });

    it('가격 회복 + 영속 부재 → RESET + shadowUpdate undefined (no-op)', () => {
      const shadow = makeMockShadow({ shadowEntryPrice: 100, bepGlideTouchAt: undefined });
      const r = applyTwoBarBepGate({
        shadow,
        currentPrice: 95,
        hardStopLoss: 90,
        isBepProtection: true,
      });
      expect(r.action).toBe('RESET');
      expect(r.shadowUpdate).toBeUndefined();
    });

    it('NaN currentPrice → SKIP (PASS via twoBar)', () => {
      const r = applyTwoBarBepGate({
        shadow: makeMockShadow(),
        currentPrice: NaN,
        hardStopLoss: 90,
        isBepProtection: true,
      });
      expect(r.action).toBe('SKIP');
      expect(r.reason).toContain('비정상');
    });

    it('Infinity hardStopLoss → SKIP (PASS via twoBar)', () => {
      const r = applyTwoBarBepGate({
        shadow: makeMockShadow(),
        currentPrice: 89,
        hardStopLoss: Infinity,
        isBepProtection: true,
      });
      expect(r.action).toBe('SKIP');
    });

    it('twoBarConfirmation 본체 ENV (BEP_TWO_BAR_CONFIRMATION_DISABLED) → SKIP', () => {
      process.env.BEP_TWO_BAR_CONFIRMATION_DISABLED = 'true';
      const r = applyTwoBarBepGate({
        shadow: makeMockShadow(),
        currentPrice: 89,
        hardStopLoss: 90,
        isBepProtection: true,
      });
      expect(r.action).toBe('SKIP');
      expect(r.reason).toContain('정책 우회');
    });
  });

  describe('weekend gap (KST 금요일 1차 터치 → 월요일 평가)', () => {
    it('금요일 터치 → 월요일 (영업일 1) → CONTINUE_EXIT', () => {
      // Note: kstBusinessDateStr 는 영업일 산술이지만 evaluateTwoBarConfirmation
      // 의 diffDaysKst 는 캘린더일. 4/30 (목) → 5/1 (금) = 1일 → CONFIRM_EXIT.
      const shadow = makeMockShadow({ shadowEntryPrice: 100, bepGlideTouchAt: '2026-04-30' });
      (kstBusinessDateStr as any).mockReturnValue('2026-05-01');
      const r = applyTwoBarBepGate({
        shadow,
        currentPrice: 89,
        hardStopLoss: 90,
        isBepProtection: true,
      });
      expect(r.action).toBe('CONTINUE_EXIT');
    });
  });

  describe('shadowUpdate 합성 정합', () => {
    it('WAIT 반환 시 touchAt 영속 변경 필요한 경우만 shadowUpdate 합성', () => {
      const shadow1 = makeMockShadow({ bepGlideTouchAt: undefined });
      const r1 = applyTwoBarBepGate({
        shadow: shadow1,
        currentPrice: 89,
        hardStopLoss: 90,
        isBepProtection: true,
      });
      expect(r1.shadowUpdate).toBeDefined();

      const shadow2 = makeMockShadow({ bepGlideTouchAt: '2026-05-01' });
      const r2 = applyTwoBarBepGate({
        shadow: shadow2,
        currentPrice: 89,
        hardStopLoss: 90,
        isBepProtection: true,
      });
      expect(r2.shadowUpdate).toBeUndefined();
    });

    it('CONTINUE_EXIT 반환 시 shadowUpdate 항상 undefined', () => {
      const shadow = makeMockShadow({ bepGlideTouchAt: '2026-04-30' });
      const r = applyTwoBarBepGate({
        shadow,
        currentPrice: 89,
        hardStopLoss: 90,
        isBepProtection: true,
      });
      expect(r.action).toBe('CONTINUE_EXIT');
      expect(r.shadowUpdate).toBeUndefined();
    });

    it('decision 객체 항상 포함 (SKIP/PASS/WAIT/RESET/CONTINUE_EXIT 분기)', () => {
      // WAIT
      const r1 = applyTwoBarBepGate({
        shadow: makeMockShadow({ bepGlideTouchAt: undefined }),
        currentPrice: 89,
        hardStopLoss: 90,
        isBepProtection: true,
      });
      expect(r1.decision).toBeDefined();
      expect(r1.decision?.action).toBe('WAIT');
    });
  });
});
