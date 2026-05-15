/**
 * @responsibility PATCH-010 회귀 — Shadow/LIVE 노출 프로파일 SSOT + resolveCandidatePositionFloor + buyListLoop wiring
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  SHADOW_REGIME_EXPOSURE_PROFILE,
  LIVE_REGIME_EXPOSURE_PROFILE,
  isShadowBullExposureFloorEnabled,
  getRegimeExposureProfile,
  resolveCandidatePositionFloor,
  formatShadowBullFloorLog,
  resolveAccountExposureGap,
  resolveMinNotionalShares,
  MIN_CANDIDATE_SHARES,
  MIN_NOTIONAL_PRICE_CEILING_RATIO,
} from './shadowBullExposureProfile.js';
import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');

const ENV_KEY = 'SHADOW_BULL_EXPOSURE_FLOOR_ENABLED';

afterEach(() => {
  delete process.env[ENV_KEY];
});

/** §8 회귀용 ServerShadowTrade fixture (currentEquityExposure.test.ts 정합 패턴). */
const buildTrade = (overrides: Partial<ServerShadowTrade>): ServerShadowTrade => ({
  id: 'test_001',
  stockCode: '005930',
  stockName: 'Test',
  signalTime: '2026-05-02T00:00:00Z',
  signalPrice: 50_000,
  shadowEntryPrice: 50_000,
  quantity: 10,
  originalQuantity: 10,
  stopLoss: 46_000,
  initialStopLoss: 46_000,
  regimeStopLoss: 46_000,
  hardStopLoss: 46_000,
  targetPrice: 60_000,
  status: 'PENDING',
  mode: 'SHADOW',
  entryRegime: 'R3_EARLY',
  profileType: 'B',
  watchlistSource: undefined,
  profitTranches: [],
  trailingHighWaterMark: 50_000,
  trailPct: 0.1,
  trailingEnabled: false,
  ...overrides,
});

describe('PATCH-010 §1 프로파일 SSOT 매트릭스', () => {
  it('SHADOW R5_BULL floor >= 0.02 — spec 필수 (R2 Shadow STANDARD 후보 2% 이상)', () => {
    expect(SHADOW_REGIME_EXPOSURE_PROFILE.R5_BULL.candidateFloorPct).toBeGreaterThanOrEqual(0.02);
  });

  it('SHADOW R6_STRONG_BULL / R4_RECOVERY 도 bull 레짐 floor 보유', () => {
    expect(SHADOW_REGIME_EXPOSURE_PROFILE.R6_STRONG_BULL.candidateFloorPct).toBeGreaterThan(0);
    expect(SHADOW_REGIME_EXPOSURE_PROFILE.R4_RECOVERY.candidateFloorPct).toBeGreaterThan(0);
  });

  it('SHADOW R3_NEUTRAL 이하 — bull 레짐 외 floor 0', () => {
    expect(SHADOW_REGIME_EXPOSURE_PROFILE.R3_NEUTRAL.candidateFloorPct).toBe(0);
    expect(SHADOW_REGIME_EXPOSURE_PROFILE.R2_WEAK.candidateFloorPct).toBe(0);
    expect(SHADOW_REGIME_EXPOSURE_PROFILE.R1_DEFENSIVE.candidateFloorPct).toBe(0);
    expect(SHADOW_REGIME_EXPOSURE_PROFILE.R0_CRISIS.candidateFloorPct).toBe(0);
  });

  it('LIVE 프로파일 — candidateFloorPct 전면 0 (현행 동작 100% 보존)', () => {
    for (const profile of Object.values(LIVE_REGIME_EXPOSURE_PROFILE)) {
      expect(profile.candidateFloorPct).toBe(0);
    }
  });

  it('Object.freeze drift 가드 — 두 프로파일 모두 동결', () => {
    expect(Object.isFrozen(SHADOW_REGIME_EXPOSURE_PROFILE)).toBe(true);
    expect(Object.isFrozen(LIVE_REGIME_EXPOSURE_PROFILE)).toBe(true);
  });

  it('SHADOW accountTargetExposurePct — R2/R3 불싸이클 80~90% 정합 (진단용)', () => {
    expect(SHADOW_REGIME_EXPOSURE_PROFILE.R6_STRONG_BULL.accountTargetExposurePct).toBeGreaterThanOrEqual(0.8);
    expect(SHADOW_REGIME_EXPOSURE_PROFILE.R5_BULL.accountTargetExposurePct).toBeGreaterThanOrEqual(0.8);
    expect(SHADOW_REGIME_EXPOSURE_PROFILE.R4_RECOVERY.accountTargetExposurePct).toBeGreaterThanOrEqual(0.8);
  });
});

describe('PATCH-010 §2 isShadowBullExposureFloorEnabled — ENV 정확 비교 (ADR-0157)', () => {
  it('미설정 → false (default OFF)', () => {
    expect(isShadowBullExposureFloorEnabled()).toBe(false);
  });

  it("'true' → true", () => {
    process.env[ENV_KEY] = 'true';
    expect(isShadowBullExposureFloorEnabled()).toBe(true);
  });

  it("'TRUE' / '1' / 'yes' → false (정확 비교)", () => {
    for (const v of ['TRUE', '1', 'yes', 'True', '']) {
      process.env[ENV_KEY] = v;
      expect(isShadowBullExposureFloorEnabled()).toBe(false);
    }
  });
});

describe('PATCH-010 §3 getRegimeExposureProfile — 내부→exposure 레짐 매핑', () => {
  it('SHADOW R2_BULL → R5_BULL 프로파일', () => {
    expect(getRegimeExposureProfile('SHADOW', 'R2_BULL').regime).toBe('R5_BULL');
  });

  it('SHADOW R1_TURBO → R6_STRONG_BULL / R3_EARLY → R4_RECOVERY', () => {
    expect(getRegimeExposureProfile('SHADOW', 'R1_TURBO').regime).toBe('R6_STRONG_BULL');
    expect(getRegimeExposureProfile('SHADOW', 'R3_EARLY').regime).toBe('R4_RECOVERY');
  });

  it('LIVE R2_BULL → R5_BULL 프로파일 (floor 0)', () => {
    expect(getRegimeExposureProfile('LIVE', 'R2_BULL').candidateFloorPct).toBe(0);
  });
});

describe('PATCH-010 §4 resolveCandidatePositionFloor — 결정 트리', () => {
  it('ENV OFF (default) → applied=false, effectivePositionPct === computedPositionPct (byte-equivalent)', () => {
    const r = resolveCandidatePositionFloor({
      shadowMode: true,
      regime: 'R2_BULL',
      tier: 'STANDARD',
      computedPositionPct: 0.004,
    });
    expect(r.applied).toBe(false);
    expect(r.skipReason).toBe('ENV_DISABLED');
    expect(r.effectivePositionPct).toBe(0.004);
  });

  it('ENV ON + SHADOW + R2_BULL + STANDARD + 0.004 → applied=true, effectivePositionPct = 0.02', () => {
    process.env[ENV_KEY] = 'true';
    const r = resolveCandidatePositionFloor({
      shadowMode: true,
      regime: 'R2_BULL',
      tier: 'STANDARD',
      computedPositionPct: 0.004,
    });
    expect(r.applied).toBe(true);
    expect(r.exposureRegime).toBe('R5_BULL');
    expect(r.floorPct).toBe(0.02);
    expect(r.effectivePositionPct).toBe(0.02);
  });

  it('ENV ON + 휴젤 시나리오 — positionPct 0.004 floor 0.02 → 1억 × 0.02 = 2,000,000원 (1주 과소 매수 차단)', () => {
    process.env[ENV_KEY] = 'true';
    const r = resolveCandidatePositionFloor({
      shadowMode: true,
      regime: 'R2_BULL',
      tier: 'STANDARD',
      computedPositionPct: 0.004,
    });
    // targetBudget = totalAssets × effectivePositionPct (accountKelly 1.0 가정)
    const targetBudget = 100_000_000 * r.effectivePositionPct;
    expect(Math.floor(targetBudget / 284_000)).toBeGreaterThanOrEqual(7); // 1주가 아닌 7주+
  });

  it('ENV ON + positionPct 이미 floor 이상 → applied=false (ALREADY_ABOVE_FLOOR)', () => {
    process.env[ENV_KEY] = 'true';
    const r = resolveCandidatePositionFloor({
      shadowMode: true,
      regime: 'R2_BULL',
      tier: 'STANDARD',
      computedPositionPct: 0.03,
    });
    expect(r.applied).toBe(false);
    expect(r.skipReason).toBe('ALREADY_ABOVE_FLOOR');
    expect(r.effectivePositionPct).toBe(0.03);
  });

  it('ENV ON + SHADOW + R4_NEUTRAL → floor 0 → applied=false (NO_FLOOR)', () => {
    process.env[ENV_KEY] = 'true';
    const r = resolveCandidatePositionFloor({
      shadowMode: true,
      regime: 'R4_NEUTRAL',
      tier: 'STANDARD',
      computedPositionPct: 0.001,
    });
    expect(r.applied).toBe(false);
    expect(r.skipReason).toBe('NO_FLOOR');
    expect(r.effectivePositionPct).toBe(0.001);
  });

  it('ENV ON + LIVE + R2_BULL → LIVE 프로파일 floor 0 → applied=false (LIVE 경로 보존)', () => {
    process.env[ENV_KEY] = 'true';
    const r = resolveCandidatePositionFloor({
      shadowMode: false,
      regime: 'R2_BULL',
      tier: 'STANDARD',
      computedPositionPct: 0.004,
    });
    expect(r.applied).toBe(false);
    expect(r.skipReason).toBe('NO_FLOOR');
    expect(r.effectivePositionPct).toBe(0.004);
  });

  it('ENV ON + PROBING 티어 → applied=false (PROBING_TIER_EXCLUDED — 의도된 소액 탐색 보존)', () => {
    process.env[ENV_KEY] = 'true';
    const r = resolveCandidatePositionFloor({
      shadowMode: true,
      regime: 'R2_BULL',
      tier: 'PROBING',
      computedPositionPct: 0.001,
    });
    expect(r.applied).toBe(false);
    expect(r.skipReason).toBe('PROBING_TIER_EXCLUDED');
    expect(r.effectivePositionPct).toBe(0.001);
  });

  it('ENV ON + CONVICTION 티어 + 낮은 positionPct → floor 적용 (CONVICTION 도 floor 대상)', () => {
    process.env[ENV_KEY] = 'true';
    const r = resolveCandidatePositionFloor({
      shadowMode: true,
      regime: 'R1_TURBO',
      tier: 'CONVICTION',
      computedPositionPct: 0.005,
    });
    expect(r.applied).toBe(true);
    expect(r.exposureRegime).toBe('R6_STRONG_BULL');
    expect(r.effectivePositionPct).toBe(0.025);
  });

  it('ENV ON + NaN positionPct → applied=false (INVALID_POSITION_PCT — 안전 fallback)', () => {
    process.env[ENV_KEY] = 'true';
    const r = resolveCandidatePositionFloor({
      shadowMode: true,
      regime: 'R2_BULL',
      tier: 'STANDARD',
      computedPositionPct: NaN,
    });
    expect(r.applied).toBe(false);
    expect(r.skipReason).toBe('INVALID_POSITION_PCT');
    expect(Number.isNaN(r.effectivePositionPct)).toBe(true);
  });

  it('ENV ON + R3_EARLY → R4_RECOVERY floor 0.015', () => {
    process.env[ENV_KEY] = 'true';
    const r = resolveCandidatePositionFloor({
      shadowMode: true,
      regime: 'R3_EARLY',
      tier: 'STANDARD',
      computedPositionPct: 0.002,
    });
    expect(r.applied).toBe(true);
    expect(r.exposureRegime).toBe('R4_RECOVERY');
    expect(r.effectivePositionPct).toBe(0.015);
  });
});

describe('PATCH-010 §5 buyListLoop wiring 정적 가드', () => {
  const buyListLoopSrc = readFileSync(
    path.join(REPO_ROOT, 'server/trading/signalScanner/perSymbol/buyListLoop.ts'),
    'utf8',
  );

  it('resolveCandidatePositionFloor + formatShadowBullFloorLog import', () => {
    expect(buyListLoopSrc).toMatch(
      /import\s*\{[^}]*resolveCandidatePositionFloor[^}]*\}\s*from\s*'\.\.\/\.\.\/sizing\/shadowBullExposureProfile\.js'/,
    );
    expect(buyListLoopSrc).toMatch(
      /import\s*\{[^}]*formatShadowBullFloorLog[^}]*\}\s*from\s*'\.\.\/\.\.\/sizing\/shadowBullExposureProfile\.js'/,
    );
  });

  it('메인 buyList 경로 — calculateOrderQuantity 가 effectivePositionPct 사용', () => {
    expect(buyListLoopSrc).toContain('resolveCandidatePositionFloor({');
    expect(buyListLoopSrc).toContain('const effectivePositionPct = exposureFloor.effectivePositionPct;');
    expect(buyListLoopSrc).toMatch(/calculateOrderQuantity\(\{[\s\S]*?positionPct:\s*effectivePositionPct/);
  });

  it('진단 로그 — formatShadowBullFloorLog SSOT 헬퍼 사용 (inline 문자열 조립 금지)', () => {
    expect(buyListLoopSrc).toContain('formatShadowBullFloorLog(exposureFloor, {');
    // inline [AutoTrade/ShadowBullFloor] 문자열 조립이 buyListLoop.ts 에 남아있으면 안 된다 (SSOT 위임).
    expect(buyListLoopSrc).not.toContain('`[AutoTrade/ShadowBullFloor]');
  });
});

describe('PATCH-010 §6 formatShadowBullFloorLog — SSOT 로그 포맷터', () => {
  it('pathLabel 미전달 — 메인 buyList 경로 (휴젤 시나리오)', () => {
    process.env[ENV_KEY] = 'true';
    const result = resolveCandidatePositionFloor({
      shadowMode: true,
      regime: 'R2_BULL',
      tier: 'STANDARD',
      computedPositionPct: 0.004,
    });
    const line = formatShadowBullFloorLog(result, {
      stockName: '휴젤',
      stockCode: '145020',
      computedPositionPct: 0.004,
    });
    expect(line).toContain('[AutoTrade/ShadowBullFloor] 휴젤(145020)');
    expect(line).toContain('positionPct 0.40% → 2.00%');
    expect(line).toContain('(floor 2.0%, SHADOW/R5_BULL)');
    expect(line).not.toContain('PRE_BREAKOUT'); // pathLabel 미전달 시 경로 라벨 없음
  });

  it('ENV OFF — byte-equivalent (effectivePositionPct === computedPositionPct)', () => {
    const result = resolveCandidatePositionFloor({
      shadowMode: true,
      regime: 'R2_BULL',
      tier: 'STANDARD',
      computedPositionPct: 0.004,
    });
    const line = formatShadowBullFloorLog(result, {
      stockName: '휴젤',
      stockCode: '145020',
      computedPositionPct: 0.004,
    });
    expect(line).toContain('positionPct 0.40% → 0.40%'); // 미적용 — 원본 보존
  });

  it('pathLabel 전달 — 경로 구분 라벨 포함', () => {
    process.env[ENV_KEY] = 'true';
    const result = resolveCandidatePositionFloor({
      shadowMode: true,
      regime: 'R2_BULL',
      tier: 'STANDARD',
      computedPositionPct: 0.005,
    });
    const follow = formatShadowBullFloorLog(result, {
      stockName: '에코프로',
      stockCode: '086520',
      computedPositionPct: 0.005,
      pathLabel: 'PRE_BREAKOUT_FOLLOWTHROUGH',
    });
    expect(follow).toContain('PRE_BREAKOUT_FOLLOWTHROUGH positionPct');
    const intraday = formatShadowBullFloorLog(result, {
      stockName: '에코프로',
      stockCode: '086520',
      computedPositionPct: 0.005,
      pathLabel: 'INTRADAY',
    });
    expect(intraday).toContain('INTRADAY positionPct');
  });
});

describe('PATCH-010 §7 PRE_BREAKOUT / INTRADAY 경로 wiring 정적 가드', () => {
  const buyListLoopSrc = readFileSync(
    path.join(REPO_ROOT, 'server/trading/signalScanner/perSymbol/buyListLoop.ts'),
    'utf8',
  );
  const intradayLoopSrc = readFileSync(
    path.join(REPO_ROOT, 'server/trading/signalScanner/perSymbol/intradayLoop.ts'),
    'utf8',
  );

  it('PRE_BREAKOUT_FOLLOWTHROUGH 경로 — effPosPctFollow wiring', () => {
    expect(buyListLoopSrc).toContain('const exposureFloorFollow = resolveCandidatePositionFloor({');
    expect(buyListLoopSrc).toContain('const effPosPctFollow = exposureFloorFollow.effectivePositionPct;');
    expect(buyListLoopSrc).toContain("pathLabel: 'PRE_BREAKOUT_FOLLOWTHROUGH',");
    expect(buyListLoopSrc).toMatch(/calculateOrderQuantity\(\{[\s\S]*?positionPct:\s*effPosPctFollow/);
  });

  it('PRE_BREAKOUT 30% 선취매 경로 — effPosPctPb wiring (풀 포지션 floor → 30% 트랜치는 호출자)', () => {
    expect(buyListLoopSrc).toContain('const exposureFloorPb = resolveCandidatePositionFloor({');
    expect(buyListLoopSrc).toContain('const effPosPctPb = exposureFloorPb.effectivePositionPct;');
    expect(buyListLoopSrc).toContain("pathLabel: 'PRE_BREAKOUT_30PCT',");
    expect(buyListLoopSrc).toMatch(/calculateOrderQuantity\(\{[\s\S]*?positionPct:\s*effPosPctPb/);
  });

  it('INTRADAY 경로 — effectivePositionPct wiring + import', () => {
    expect(intradayLoopSrc).toMatch(
      /import\s*\{[^}]*resolveCandidatePositionFloor[^}]*formatShadowBullFloorLog[^}]*\}\s*from\s*'\.\.\/\.\.\/sizing\/shadowBullExposureProfile\.js'/,
    );
    expect(intradayLoopSrc).toContain('const exposureFloorIntraday = resolveCandidatePositionFloor({');
    expect(intradayLoopSrc).toContain('const effectivePositionPct = exposureFloorIntraday.effectivePositionPct;');
    expect(intradayLoopSrc).toContain("pathLabel: 'INTRADAY',");
    expect(intradayLoopSrc).toMatch(/calculateOrderQuantity\(\{[\s\S]*?positionPct:\s*effectivePositionPct/);
  });

  it('3 경로 모두 ctx.shadowMode + STANDARD tier 사용 (PROBING 제외 아님)', () => {
    // FOLLOWTHROUGH / 30% / INTRADAY 모두 tierDecision 부재 → STANDARD 중립 default.
    expect(buyListLoopSrc).toMatch(/exposureFloorFollow[\s\S]*?shadowMode:\s*ctx\.shadowMode[\s\S]*?tier:\s*'STANDARD'/);
    expect(buyListLoopSrc).toMatch(/exposureFloorPb[\s\S]*?shadowMode:\s*ctx\.shadowMode[\s\S]*?tier:\s*'STANDARD'/);
    expect(intradayLoopSrc).toMatch(/exposureFloorIntraday[\s\S]*?shadowMode:\s*ctx\.shadowMode[\s\S]*?tier:\s*'STANDARD'/);
  });

  it('3 경로 모두 applied 시에만 진단 로그 (formatShadowBullFloorLog SSOT)', () => {
    expect(buyListLoopSrc).toMatch(/if\s*\(exposureFloorFollow\.applied\)/);
    expect(buyListLoopSrc).toMatch(/if\s*\(exposureFloorPb\.applied\)/);
    expect(intradayLoopSrc).toMatch(/if\s*\(exposureFloorIntraday\.applied\)/);
    expect(intradayLoopSrc).toContain('formatShadowBullFloorLog(exposureFloorIntraday, {');
  });
});

describe('PATCH-010 §8 resolveAccountExposureGap — 계좌 총 노출 갭 진단 SSOT', () => {
  it('SHADOW R2_BULL — 활성 1종목 500,000 / 계좌 10,000,000 → currentExposurePct 0.05, underExposed=true', () => {
    const r = resolveAccountExposureGap({
      shadowMode: true,
      regime: 'R2_BULL',
      accountTotalEquity: 10_000_000,
      shadows: [buildTrade({ shadowEntryPrice: 50_000, quantity: 10, originalQuantity: 10 })],
    });
    expect(r.mode).toBe('SHADOW');
    expect(r.exposureRegime).toBe('R5_BULL');
    expect(r.targetExposurePct).toBe(0.85);
    expect(r.currentExposureAmount).toBe(500_000);
    expect(r.currentExposurePct).toBeCloseTo(0.05, 6);
    expect(r.targetExposureAmount).toBe(8_500_000);
    expect(r.exposureGapAmount).toBe(8_000_000);
    expect(r.underExposed).toBe(true);
    expect(r.activeTradeCount).toBe(1);
    expect(r.diagnosticOnly).toBe(true);
  });

  it('빈 shadows → currentExposureAmount 0 / underExposed=true', () => {
    const r = resolveAccountExposureGap({
      shadowMode: true,
      regime: 'R2_BULL',
      accountTotalEquity: 10_000_000,
      shadows: [],
    });
    expect(r.currentExposureAmount).toBe(0);
    expect(r.currentExposurePct).toBe(0);
    expect(r.underExposed).toBe(true);
    expect(r.activeTradeCount).toBe(0);
  });

  it('closed trade (HIT_STOP) 는 합산 제외 — computeCurrentEquityExposure 위임', () => {
    const r = resolveAccountExposureGap({
      shadowMode: true,
      regime: 'R2_BULL',
      accountTotalEquity: 10_000_000,
      shadows: [
        buildTrade({ id: 'open', status: 'PENDING', shadowEntryPrice: 50_000, quantity: 10, originalQuantity: 10 }),
        buildTrade({ id: 'closed', status: 'HIT_STOP', shadowEntryPrice: 80_000, quantity: 20, originalQuantity: 20 }),
      ],
    });
    expect(r.currentExposureAmount).toBe(500_000);
    expect(r.activeTradeCount).toBe(1);
  });

  it('accountTotalEquity 0 / 비유한값 → currentExposurePct 0 / underExposed=true 보수적 fallback', () => {
    for (const equity of [0, -1, NaN, Infinity]) {
      const r = resolveAccountExposureGap({
        shadowMode: true,
        regime: 'R2_BULL',
        accountTotalEquity: equity,
        shadows: [buildTrade({})],
      });
      expect(r.currentExposurePct).toBe(0);
      expect(r.targetExposureAmount).toBe(0);
      expect(r.underExposed).toBe(true);
    }
  });

  it('LIVE 모드 → LIVE 프로파일 targetExposurePct 사용 (R5_BULL 0.75)', () => {
    const r = resolveAccountExposureGap({
      shadowMode: false,
      regime: 'R2_BULL',
      accountTotalEquity: 10_000_000,
      shadows: [],
    });
    expect(r.mode).toBe('LIVE');
    expect(r.targetExposurePct).toBe(0.75);
  });

  it('over-exposed — current > target → exposureGapAmount 음수 / underExposed=false', () => {
    const r = resolveAccountExposureGap({
      shadowMode: true,
      regime: 'R2_BULL',
      accountTotalEquity: 1_000_000,
      // 활성 950,000 (95%) > target 85%
      shadows: [buildTrade({ shadowEntryPrice: 95_000, quantity: 10, originalQuantity: 10 })],
    });
    expect(r.currentExposurePct).toBeCloseTo(0.95, 6);
    expect(r.exposureGapAmount).toBeLessThan(0);
    expect(r.underExposed).toBe(false);
  });

  it('currentPriceMap 전달 시 시가 평가 우선', () => {
    const r = resolveAccountExposureGap({
      shadowMode: true,
      regime: 'R2_BULL',
      accountTotalEquity: 10_000_000,
      shadows: [buildTrade({ stockCode: '005930', shadowEntryPrice: 50_000, quantity: 10, originalQuantity: 10 })],
      currentPriceMap: new Map([['005930', 70_000]]),
    });
    expect(r.currentExposureAmount).toBe(700_000); // 시가 70,000 × 10
  });
});

describe('PATCH-010 §9 resolveMinNotionalShares — minNotional 보정 진단 SSOT', () => {
  it('SSOT 상수 — MIN_CANDIDATE_SHARES=1 / MIN_NOTIONAL_PRICE_CEILING_RATIO=0.05', () => {
    expect(MIN_CANDIDATE_SHARES).toBe(1);
    expect(MIN_NOTIONAL_PRICE_CEILING_RATIO).toBe(0.05);
  });

  it('휴젤 시나리오 — price 284,000 budget 200,000 (budget < price) → minNotionalApplied=true, effectiveShares=1', () => {
    const r = resolveMinNotionalShares({
      price: 284_000,
      budgetAmount: 200_000,
      accountTotalEquity: 100_000_000,
    });
    expect(r.rawShares).toBe(0);
    expect(r.minNotionalApplied).toBe(true);
    expect(r.effectiveShares).toBe(1);
    expect(r.skipReason).toBeUndefined();
  });

  it('rawShares >= 1 → ALREADY_ABOVE_MIN (보정 불필요)', () => {
    const r = resolveMinNotionalShares({ price: 284_000, budgetAmount: 600_000 });
    expect(r.rawShares).toBe(2);
    expect(r.minNotionalApplied).toBe(false);
    expect(r.effectiveShares).toBe(2);
    expect(r.skipReason).toBe('ALREADY_ABOVE_MIN');
  });

  it('budget 정확히 price → rawShares 1 → ALREADY_ABOVE_MIN', () => {
    const r = resolveMinNotionalShares({ price: 284_000, budgetAmount: 284_000 });
    expect(r.rawShares).toBe(1);
    expect(r.skipReason).toBe('ALREADY_ABOVE_MIN');
  });

  it('초고가주 — price 6,000,000 > 계좌 100,000,000 × 5% ceiling → PRICE_OVER_CEILING (강제 매수 차단)', () => {
    const r = resolveMinNotionalShares({
      price: 6_000_000,
      budgetAmount: 100_000,
      accountTotalEquity: 100_000_000,
    });
    expect(r.rawShares).toBe(0);
    expect(r.minNotionalApplied).toBe(false);
    expect(r.effectiveShares).toBe(0);
    expect(r.skipReason).toBe('PRICE_OVER_CEILING');
  });

  it('accountTotalEquity 미전달 시 ceiling 검증 생략 → minNotionalApplied=true', () => {
    const r = resolveMinNotionalShares({ price: 284_000, budgetAmount: 200_000 });
    expect(r.minNotionalApplied).toBe(true);
    expect(r.effectiveShares).toBe(1);
  });

  it('price ceiling 경계 — price === 계좌 × 5% → 보정 적용 (초과 아님)', () => {
    const r = resolveMinNotionalShares({
      price: 5_000_000,
      budgetAmount: 100_000,
      accountTotalEquity: 100_000_000,
    });
    expect(r.minNotionalApplied).toBe(true);
    expect(r.effectiveShares).toBe(1);
  });

  it('price/budgetAmount 비유한값 또는 ≤ 0 → INVALID_INPUT', () => {
    for (const bad of [
      { price: 0, budgetAmount: 100_000 },
      { price: -1, budgetAmount: 100_000 },
      { price: NaN, budgetAmount: 100_000 },
      { price: 284_000, budgetAmount: 0 },
      { price: 284_000, budgetAmount: -1 },
      { price: 284_000, budgetAmount: NaN },
    ]) {
      const r = resolveMinNotionalShares(bad);
      expect(r.skipReason).toBe('INVALID_INPUT');
      expect(r.minNotionalApplied).toBe(false);
      expect(r.effectiveShares).toBe(0);
    }
  });
});

describe('PATCH-010 §10 /sizing_debug — index.ts barrel 등록 정적 가드', () => {
  const indexSrc = readFileSync(
    path.join(REPO_ROOT, 'server/telegram/commands/system/index.ts'),
    'utf8',
  );

  it('sizingDebug.cmd.js barrel 등록', () => {
    expect(indexSrc).toContain("import './sizingDebug.cmd.js';");
  });
});
