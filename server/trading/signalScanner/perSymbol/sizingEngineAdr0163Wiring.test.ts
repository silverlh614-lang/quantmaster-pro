/**
 * sizingEngineAdr0163Wiring.test.ts
 *
 * ADR-0163 Phase 2-D Extension 정적 가드 — 3 진입 경로 (PRE_BREAKOUT_FOLLOWTHROUGH /
 * PRE_BREAKOUT 30% 선취매 / INTRADAY_STRONG) 모두 본 모듈 wiring 정합성 검증.
 *
 * 경로별 비율 보존 (70% / 30% / 100%) 회귀 차단.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const BUYLIST_SRC = readFileSync(join(process.cwd(), 'server/trading/signalScanner/perSymbol/buyListLoop.ts'), 'utf-8');
const INTRADAY_SRC = readFileSync(join(process.cwd(), 'server/trading/signalScanner/perSymbol/intradayLoop.ts'), 'utf-8');

describe('ADR-0163 Phase 2-D Extension — buyListLoop.ts 2 신규 분기 정적 가드', () => {
  it('applyPositionSizingEngine 호출 = 3건 (메인 + PRE_BREAKOUT_FOLLOWTHROUGH + PRE_BREAKOUT 30%)', () => {
    const calls = BUYLIST_SRC.match(/applyPositionSizingEngine\s*\(/g);
    expect(calls).not.toBeNull();
    expect(calls!.length).toBe(3);
  });

  it('PRE_BREAKOUT_FOLLOWTHROUGH 분기 — STRONG_BUY 매핑 + sizingApplyFollow 변수', () => {
    expect(BUYLIST_SRC).toMatch(/sizingApplyFollow\s*=\s*applyPositionSizingEngine/);
    // STRONG_BUY 매핑 (추세 추격 = 돌파 확정 후)
    const followSection = BUYLIST_SRC.split('sizingApplyFollow')[1];
    expect(followSection).toMatch(/signalGrade:\s*['"]STRONG_BUY['"]/);
  });

  it('PRE_BREAKOUT_FOLLOWTHROUGH — 70% 비율 보존 (legacyFullQty + fullQty + followQtyRaw → followQty exposure cap, ADR-0166)', () => {
    expect(BUYLIST_SRC).toMatch(/const\s*\{\s*quantity:\s*legacyFullQty\s*\}/);
    expect(BUYLIST_SRC).toMatch(/const\s+fullQty\s*=\s*sizingApplyFollow\.applied\s*\?\s*sizingApplyFollow\.quantity\s*:\s*legacyFullQty/);
    // ADR-0166 — followQtyRaw rename + exposure cap 적용 → followQty 최종
    expect(BUYLIST_SRC).toMatch(/const\s+followQtyRaw\s*=\s*Math\.max\(1,\s*Math\.ceil\(fullQty\s*\*\s*0\.7\)\)/);
    expect(BUYLIST_SRC).toMatch(/const\s+followQty\s*=\s*exposureCapFollow\.applied\s*\?\s*exposureCapFollow\.finalQuantity\s*:\s*followQtyRaw/);
  });

  it('PRE_BREAKOUT 30% 선취매 분기 — BUY 매핑 + sizingApplyPb 변수', () => {
    expect(BUYLIST_SRC).toMatch(/sizingApplyPb\s*=\s*applyPositionSizingEngine/);
    // BUY 매핑 (선취매 = 보수적)
    const pbSection = BUYLIST_SRC.split('sizingApplyPb')[1];
    expect(pbSection).toMatch(/signalGrade:\s*['"]BUY['"]/);
  });

  it('PRE_BREAKOUT 30% — 30% 비율 보존 (legacyFullPbQty + fullPbQty + pbQtyRaw → pbQty exposure cap, ADR-0166)', () => {
    expect(BUYLIST_SRC).toMatch(/const\s*\{\s*quantity:\s*legacyFullPbQty\s*\}/);
    expect(BUYLIST_SRC).toMatch(/const\s+fullPbQty\s*=\s*sizingApplyPb\.applied\s*\?\s*sizingApplyPb\.quantity\s*:\s*legacyFullPbQty/);
    // ADR-0166 — pbQtyRaw rename + exposure cap → pbQty 최종
    expect(BUYLIST_SRC).toMatch(/const\s+pbQtyRaw\s*=\s*Math\.max\(1,\s*Math\.floor\(fullPbQty\s*\*\s*0\.3\)\)/);
    expect(BUYLIST_SRC).toMatch(/const\s+pbQty\s*=\s*exposureCapPb\.applied\s*\?\s*exposureCapPb\.finalQuantity\s*:\s*pbQtyRaw/);
  });

  it('PRE_BREAKOUT_FOLLOWTHROUGH buildBuyTrade 호출에 sizingSourceFollow + sizingEngineSnapshotFollow 전달', () => {
    // followTrade 합성 영역에 marker 전달 검증
    const followBuildSection = BUYLIST_SRC.match(/const\s+followTrade\s*=\s*buildBuyTrade\(\{[\s\S]*?\}\);/);
    expect(followBuildSection).not.toBeNull();
    expect(followBuildSection![0]).toMatch(/sizingSource:\s*sizingSourceFollow/);
    expect(followBuildSection![0]).toMatch(/sizingEngineSnapshot:\s*sizingEngineSnapshotFollow/);
  });

  it('PRE_BREAKOUT 30% buildBuyTrade 호출에 sizingSourcePb + sizingEngineSnapshotPb 전달', () => {
    const pbBuildSection = BUYLIST_SRC.match(/const\s+pbTrade\s*=\s*buildBuyTrade\(\{[\s\S]*?\}\);/);
    expect(pbBuildSection).not.toBeNull();
    expect(pbBuildSection![0]).toMatch(/sizingSource:\s*sizingSourcePb/);
    expect(pbBuildSection![0]).toMatch(/sizingEngineSnapshot:\s*sizingEngineSnapshotPb/);
  });

  it('진단 로그 — 3 경로 모두 [Sizing-NewEngine] {경로명} 형식', () => {
    expect(BUYLIST_SRC).toMatch(/\[Sizing-NewEngine\][^`]*PRE_BREAKOUT_FOLLOWTHROUGH/);
    expect(BUYLIST_SRC).toMatch(/\[Sizing-NewEngine\][^`]*PRE_BREAKOUT 30%/);
  });
});

describe('ADR-0163 Phase 2-D Extension — intradayLoop.ts 1 분기 정적 가드', () => {
  it('applyPositionSizingEngine import 정확 1건', () => {
    const matches = INTRADAY_SRC.match(/import\s*\{[^}]*applyPositionSizingEngine[^}]*\}\s*from/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it('applyPositionSizingEngine 호출 정확 1건 (INTRADAY_STRONG)', () => {
    const calls = INTRADAY_SRC.match(/applyPositionSizingEngine\s*\(/g);
    expect(calls).not.toBeNull();
    expect(calls!.length).toBe(1);
  });

  it('INTRADAY_STRONG — BUY 매핑 (장중 강세 보수적)', () => {
    expect(INTRADAY_SRC).toMatch(/sizingApplyIntra\s*=\s*applyPositionSizingEngine/);
    const intraSection = INTRADAY_SRC.split('sizingApplyIntra')[1];
    expect(intraSection).toMatch(/signalGrade:\s*['"]BUY['"]/);
  });

  it('INTRADAY_STRONG — RRR=0 전달 (RRR 평가 부재 — engine 차단으로 legacy fallback)', () => {
    const intraSection = INTRADAY_SRC.split('sizingApplyIntra')[1];
    expect(intraSection).toMatch(/rrr:\s*0/);
  });

  it('INTRADAY_STRONG — 100% 비율 (legacyIntradayQty + baseIntradayQty + quantity exposure cap, ADR-0166)', () => {
    expect(INTRADAY_SRC).toMatch(/const\s*\{\s*quantity:\s*legacyIntradayQty[^}]*\}\s*=\s*calculateOrderQuantity/);
    // ADR-0166 — baseIntradayQty rename + exposure cap → quantity 최종
    expect(INTRADAY_SRC).toMatch(/const\s+baseIntradayQty\s*=\s*sizingApplyIntra\.applied\s*\?\s*sizingApplyIntra\.quantity\s*:\s*legacyIntradayQty/);
    expect(INTRADAY_SRC).toMatch(/const\s+quantity\s*=\s*exposureCapIntra\.applied\s*\?\s*exposureCapIntra\.finalQuantity\s*:\s*baseIntradayQty/);
  });

  it('INTRADAY_STRONG buildBuyTrade — sizingSourceIntra + sizingEngineSnapshotIntra 전달', () => {
    const intraBuildSection = INTRADAY_SRC.match(/const\s+trade\s*=\s*buildBuyTrade\(\{[\s\S]*?\}\);/);
    expect(intraBuildSection).not.toBeNull();
    expect(intraBuildSection![0]).toMatch(/sizingSource:\s*sizingSourceIntra/);
    expect(intraBuildSection![0]).toMatch(/sizingEngineSnapshot:\s*sizingEngineSnapshotIntra/);
  });

  it('진단 로그 — INTRADAY_STRONG 분기', () => {
    expect(INTRADAY_SRC).toMatch(/\[Sizing-NewEngine\][^`]*INTRADAY_STRONG/);
  });
});

describe('ADR-0163 — LIVE 회귀 격리 검증 (3 경로 모두)', () => {
  it('PRE_BREAKOUT_FOLLOWTHROUGH — ctx.shadowMode 첫 인자 전달', () => {
    expect(BUYLIST_SRC).toMatch(/sizingApplyFollow\s*=\s*applyPositionSizingEngine\s*\(\s*ctx\.shadowMode/);
  });

  it('PRE_BREAKOUT 30% — ctx.shadowMode 첫 인자 전달', () => {
    expect(BUYLIST_SRC).toMatch(/sizingApplyPb\s*=\s*applyPositionSizingEngine\s*\(\s*ctx\.shadowMode/);
  });

  it('INTRADAY_STRONG — ctx.shadowMode 첫 인자 전달', () => {
    expect(INTRADAY_SRC).toMatch(/sizingApplyIntra\s*=\s*applyPositionSizingEngine\s*\(\s*ctx\.shadowMode/);
  });
});

describe('ADR-0163 — 4 경로 누적 통합 (메인 + 3 신규)', () => {
  it('buyListLoop 3 호출 + intradayLoop 1 호출 = 총 4 호출', () => {
    const buyCalls = BUYLIST_SRC.match(/applyPositionSizingEngine\s*\(/g)!.length;
    const intraCalls = INTRADAY_SRC.match(/applyPositionSizingEngine\s*\(/g)!.length;
    expect(buyCalls + intraCalls).toBe(4);
  });

  it('모든 진입 경로 buildBuyTrade — sizingSource 인자 전달 (4 호출)', () => {
    // ADR-0162 메인 buyList: shorthand 형식 (`sizingSource,` 단독 라인)
    // ADR-0163 신규 3 분기: 명시 형식 (`sizingSource: sizingSourceFollow,` 등)
    const buyShortHand = (BUYLIST_SRC.match(/^\s*sizingSource,\s*$/gm) || []).length;
    const buyExplicit = (BUYLIST_SRC.match(/sizingSource:\s*sizingSource\w+/g) || []).length;
    const intraExplicit = (INTRADAY_SRC.match(/sizingSource:\s*sizingSource\w+/g) || []).length;
    // 메인 (shorthand) 1 + follow + pb (explicit) 2 + intra (explicit) 1 = 4
    expect(buyShortHand + buyExplicit + intraExplicit).toBe(4);
  });
});
