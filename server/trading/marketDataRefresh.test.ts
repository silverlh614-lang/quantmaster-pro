import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { computeVkospiDayChangeFromBars } from './marketDataRefresh.js';

describe('computeVkospiDayChangeFromBars', () => {
  it('bars 2개 이상이면 당일 변화율 계산', () => {
    const out = computeVkospiDayChangeFromBars([
      { ts: 1_769_904_000, close: 70 },
      { ts: 1_769_990_400, close: 18 },
    ]);
    expect(out).not.toBeNull();
    expect(out?.prevClose).toBe(70);
    expect(out?.current).toBe(18);
    expect(out?.dayChangePct).toBeCloseTo(-74.2857, 3);
  });

  it('bars 1개 이하면 null', () => {
    expect(computeVkospiDayChangeFromBars([{ ts: 1_769_990_400, close: 18 }])).toBeNull();
    expect(computeVkospiDayChangeFromBars(null)).toBeNull();
  });
});

describe('VKOSPI KRX wiring', () => {
  it('uses KRX derivatives index daily as primary source', () => {
    // ADR-0595 분해: VKOSPI 섹션은 marketDataRefresh/indexMacroSections.ts 로 이동 —
    // 본문 + 서브모듈을 함께 grep (ADR-0444 static-grep-guard 패턴).
    const src = fs.readFileSync(path.join(process.cwd(), 'server/trading/marketDataRefresh.ts'), 'utf8')
      + fs.readFileSync(path.join(process.cwd(), 'server/trading/marketDataRefresh/indexMacroSections.ts'), 'utf8');
    expect(src).toContain('fetchDerivativesIndexDaily()');
    // ADR-0586: bare includes('VKOSPI') → 정밀 이름 매칭 SSOT(isVkospiIndexName)로 좁힘
    expect(src).toContain('isVkospiIndexName(r.indexName)');
    expect(src).toContain("computed.vkospiDayChangeSource = 'KRX_DERIV_INDEX_DAILY'");
  });
});
