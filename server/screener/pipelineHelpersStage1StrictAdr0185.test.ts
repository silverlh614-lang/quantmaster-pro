/**
 * @responsibility ADR-0185 (PR-B12-B) site 4 — pipelineHelpers.evaluateStage1Filter strict 분기 회귀.
 *
 * ENV `EMERGENCY_STAGE1_STRICT_ENABLED=true` 활성 시 DATA_MISSING_* 5종 분리 검증.
 * default OFF 시 legacy 동작 100% 보존.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIG_STAGE1 = process.env.EMERGENCY_STAGE1_STRICT_ENABLED;

interface QuoteOpts {
  price?: number;
  volume?: number;
  per?: number;
  return20d?: number;
  changePercent?: number;
  avgVolume?: number;
  atr?: number;
  atr20avg?: number;
  ma20?: number;
  return5d?: number;
  isHighRisk?: boolean;
}

function makeQuote(o: QuoteOpts = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    price: o.price ?? 10000,
    volume: o.volume ?? 100_000,
    per: o.per ?? 15,
    return20d: o.return20d ?? 5,
    changePercent: o.changePercent ?? 1,
    avgVolume: o.avgVolume ?? 50_000,
    atr: o.atr ?? 200,
    atr20avg: o.atr20avg ?? 250,
    ma20: o.ma20 ?? 9500,
    return5d: o.return5d ?? 5,
    isHighRisk: o.isHighRisk ?? false,
  } as any;
}

describe('ADR-0185 evaluateStage1Filter strict 분기', () => {
  beforeEach(() => {
    delete process.env.EMERGENCY_STAGE1_STRICT_ENABLED;
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIG_STAGE1 === undefined) delete process.env.EMERGENCY_STAGE1_STRICT_ENABLED;
    else process.env.EMERGENCY_STAGE1_STRICT_ENABLED = ORIG_STAGE1;
  });

  describe('default OFF (legacy 동작 보존)', () => {
    it('정상 quote 통과', async () => {
      const { evaluateStage1Filter } = await import('./pipelineHelpers');
      expect(evaluateStage1Filter(makeQuote())).toEqual({ pass: true });
    });

    it('NaN price 가 legacy 분기에서 *통과* — strict 활성화가 필요한 결함 (default OFF 보존)', async () => {
      const { evaluateStage1Filter } = await import('./pipelineHelpers');
      const result = evaluateStage1Filter(makeQuote({ price: NaN }));
      // legacy: NaN < 3000 → false 비교 (NaN < N 는 항상 false) → 다음 분기 통과
      // 이 결함이 ADR-0185 strict 분기의 핵심 가치 — DATA_MISSING_PRICE 분리
      expect(result.pass).toBe(true);
    });

    it('LOW_VOLUME 보완 신호 없음 분기 보존', async () => {
      const { evaluateStage1Filter } = await import('./pipelineHelpers');
      const result = evaluateStage1Filter(
        makeQuote({
          volume: 1000, avgVolume: 100_000, atr: 250, atr20avg: 200,
          return20d: 0, return5d: 0, ma20: 0, changePercent: 0,
        }),
      );
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('LOW_VOLUME');
    });

    it('HIGH_PER 보완 신호 없음 분기 보존', async () => {
      const { evaluateStage1Filter } = await import('./pipelineHelpers');
      const result = evaluateStage1Filter(makeQuote({
        per: 70,
        return20d: 0,
        return5d: 0,
        ma20: 0,
        changePercent: 0,
        avgVolume: 0,
      }));
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('HIGH_PER');
    });
  });

  describe('ENV EMERGENCY_STAGE1_STRICT_ENABLED=true (strict 분기 활성)', () => {
    beforeEach(() => {
      process.env.EMERGENCY_STAGE1_STRICT_ENABLED = 'true';
      vi.resetModules();
    });

    it('정상 quote 는 strict 통과 + legacy 후속 분기 진입', async () => {
      const { evaluateStage1Filter } = await import('./pipelineHelpers');
      expect(evaluateStage1Filter(makeQuote())).toEqual({ pass: true });
    });

    it('NaN price → DATA_MISSING_PRICE (LOW_VOLUME 으로 오분류 차단)', async () => {
      const { evaluateStage1Filter } = await import('./pipelineHelpers');
      const result = evaluateStage1Filter(makeQuote({ price: NaN }));
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('DATA_MISSING_PRICE');
    });

    it('NaN volume → DATA_MISSING_VOLUME', async () => {
      const { evaluateStage1Filter } = await import('./pipelineHelpers');
      const result = evaluateStage1Filter(makeQuote({ volume: NaN }));
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('DATA_MISSING_VOLUME');
    });

    it('NaN per → DATA_MISSING_PER', async () => {
      const { evaluateStage1Filter } = await import('./pipelineHelpers');
      const result = evaluateStage1Filter(makeQuote({ per: NaN }));
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('DATA_MISSING_PER');
    });

    it('NaN return20d → DATA_MISSING_RETURN', async () => {
      const { evaluateStage1Filter } = await import('./pipelineHelpers');
      const result = evaluateStage1Filter(makeQuote({ return20d: NaN }));
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('DATA_MISSING_RETURN');
    });

    it('Infinity 도 DATA_MISSING_* 분류', async () => {
      const { evaluateStage1Filter } = await import('./pipelineHelpers');
      const result = evaluateStage1Filter(makeQuote({ volume: Infinity }));
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('DATA_MISSING_VOLUME');
    });

    it('정상 데이터 + LOW_VOLUME — strict 통과 후 보완 신호 없음 분기 적용', async () => {
      const { evaluateStage1Filter } = await import('./pipelineHelpers');
      const result = evaluateStage1Filter(
        makeQuote({
          volume: 1000, avgVolume: 100_000, atr: 250, atr20avg: 200,
          return20d: 0, return5d: 0, ma20: 0, changePercent: 0,
        }),
      );
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('LOW_VOLUME');
    });

    it('정상 데이터 + HIGH_PER — strict 통과 후 보완 신호 없음 분기', async () => {
      const { evaluateStage1Filter } = await import('./pipelineHelpers');
      const result = evaluateStage1Filter(makeQuote({
        per: 70,
        return20d: 0,
        return5d: 0,
        ma20: 0,
        changePercent: 0,
        avgVolume: 0,
      }));
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('HIGH_PER');
    });
  });

  describe('Stage1RejectionReason union 확장 정합성', () => {
    it('DATA_MISSING_* 5종 모두 EMPTY_REASON_COUNTS SSOT 등재 (정적 검증)', async () => {
      const fs = await import('fs');
      const src = fs.readFileSync(
        new URL('./pipelineHelpers.ts', import.meta.url),
        'utf-8',
      );
      // EMPTY_REASON_COUNTS 객체 안 5 키 모두 존재 확인
      expect(src).toMatch(/DATA_MISSING_QUOTE:\s*0/);
      expect(src).toMatch(/DATA_MISSING_PRICE:\s*0/);
      expect(src).toMatch(/DATA_MISSING_VOLUME:\s*0/);
      expect(src).toMatch(/DATA_MISSING_PER:\s*0/);
      expect(src).toMatch(/DATA_MISSING_RETURN:\s*0/);
    });
  });
});
