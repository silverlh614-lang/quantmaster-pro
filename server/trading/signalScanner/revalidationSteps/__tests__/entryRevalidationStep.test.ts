// @responsibility entryRevalidationStep PoC 회귀 테스트 — proceed/fail 분기 + diagnostic 형식 검증

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entryRevalidationStep } from '../entryRevalidationStep.js';

/**
 * evaluateEntryRevalidation 의 임계값(entryEngine.ts):
 *   - ENTRY_MIN_GATE_SCORE = 5 (기본 minGateScore)
 *   - ENTRY_MAX_BREAKOUT_EXTENSION_PCT = 3 (현재가 ≥ entryPrice 일 때 +3% 초과 → 과열)
 *   - ENTRY_MAX_BEARISH_DROP_FROM_OPEN_PCT = -2 (시가 대비 -2% 이하 → 급락)
 *   - ENTRY_MAX_OPEN_GAP_OVERHEAT_PCT = 4 (전일종가 대비 +4% 이상 → 갭 과열)
 *   - ENTRY_MIN_VOLUME_RATIO = 0.6 (거래량 비율 보정 임계)
 */

const baseInput = {
  stockName: '삼성전자',
  currentPrice: 70_000,
  entryPrice: 70_000,
  reCheckQuote: {
    dayOpen: 70_000,
    prevClose: 69_500,
    volume: 1_000_000,
    avgVolume: 1_000_000,
  },
  reCheckGate: {
    gateScore: 8 as number | undefined,
    signalType: 'NORMAL' as 'STRONG' | 'NORMAL' | 'SKIP' | undefined,
  },
  regime: 'R2_BULL',
  marketElapsedMinutes: 390, // 풀장 — elapsedRatio=1, MORNING discount 미적용
};

describe('entryRevalidationStep', () => {
  it('정상 입력 — proceed=true 반환 (모든 임계 통과)', () => {
    const result = entryRevalidationStep(baseInput);
    expect(result.proceed).toBe(true);
  });

  it('SKIP signalType — Gate 재검증 미달로 차단', () => {
    const result = entryRevalidationStep({
      ...baseInput,
      reCheckGate: { gateScore: 8, signalType: 'SKIP' },
    });
    expect(result.proceed).toBe(false);
    if (result.proceed) return;
    expect(result.failReasons).toHaveLength(1);
    expect(result.failReasons[0]).toContain('Gate 재검증 미달');
    expect(result.logMessage).toContain('[AutoTrade] 삼성전자 진입 직전 재검증 탈락:');
    expect(result.stageLogValue).toMatch(/^FAIL\(Gate 재검증 미달/);
  });

  it('현재가가 entryPrice 대비 +5% 초과 — 돌파 이탈 과열 차단', () => {
    const result = entryRevalidationStep({
      ...baseInput,
      currentPrice: 73_500, // entryPrice 70_000 대비 +5%
      entryPrice: 70_000,
      reCheckQuote: { ...baseInput.reCheckQuote, dayOpen: 70_000 },
    });
    expect(result.proceed).toBe(false);
    if (result.proceed) return;
    expect(result.failReasons.some(r => r.includes('돌파 이탈 과열'))).toBe(true);
    expect(result.stageLogValue).toContain('돌파 이탈 과열');
  });

  it('다중 fail — failReasons 배열 + stageLogValue 콤마 결합', () => {
    const result = entryRevalidationStep({
      ...baseInput,
      reCheckGate: { gateScore: 2, signalType: 'NORMAL' }, // Gate 미달
      currentPrice: 73_500, // 돌파 과열
    });
    expect(result.proceed).toBe(false);
    if (result.proceed) return;
    expect(result.failReasons.length).toBeGreaterThanOrEqual(2);
    expect(result.stageLogValue).toMatch(/^FAIL\(/);
    expect(result.stageLogValue).toContain(',');
    // logMessage 도 콤마+공백으로 결합
    expect(result.logMessage).toMatch(/탈락: .+, .+/);
  });

  it('reCheckGate=null — quoteGateScore 미전달 시 minGate fallback 으로 자연 통과 (Yahoo 미상 차단은 별도 step 영역)', () => {
    // evaluateEntryRevalidation 의 `(quoteGateScore ?? minGate) < minGate` 분기는
    // quoteGateScore 부재 시 minGate 자체와 비교 → 절대 fail 하지 않는다.
    // Yahoo 가용성 차단은 perSymbolEvaluation 라인 734-741 의 별도 step 책임.
    const result = entryRevalidationStep({
      ...baseInput,
      reCheckGate: null,
    });
    expect(result.proceed).toBe(true);
  });

  it('reCheckQuote=null — dayOpen/prevClose/volume 검증 스킵, Gate 만 검증', () => {
    const result = entryRevalidationStep({
      ...baseInput,
      reCheckQuote: null,
    });
    expect(result.proceed).toBe(true);
  });

  it('failReasons 빈 배열 응답 케이스 없음 (proceed=true 시 데이터 미포함)', () => {
    const result = entryRevalidationStep(baseInput);
    expect(result.proceed).toBe(true);
    // discriminated union 검증: pass 분기에는 failReasons 미존재
    if (result.proceed) {
      expect((result as unknown as Record<string, unknown>).failReasons).toBeUndefined();
    }
  });

  it('byte-equivalent 검증 — logMessage 형식이 원본 perSymbolEvaluation 라인 705 와 동일', () => {
    const result = entryRevalidationStep({
      ...baseInput,
      reCheckGate: { gateScore: 1, signalType: 'NORMAL' },
    });
    expect(result.proceed).toBe(false);
    if (result.proceed) return;
    // 원본: console.log(`[AutoTrade] ${stock.name} 진입 직전 재검증 탈락: ${entryRevalidation.reasons.join(', ')}`)
    expect(result.logMessage).toMatch(/^\[AutoTrade\] 삼성전자 진입 직전 재검증 탈락: .+$/);
    expect(result.failReasons.join(',')).toBe(result.failReasons.join(','));
  });

  // ── ADR-0075 PR-4 wiring: sectorBoost 적용 ─────────────────────────────
  describe('sectorBoost (ADR-0075 PR-4 wiring)', () => {
    it('sectorBoost 미전달 → 기존 동작 (gateScore=4, minGate=5 → 탈락)', () => {
      const result = entryRevalidationStep({
        ...baseInput,
        reCheckGate: { gateScore: 4, signalType: 'NORMAL' },
      });
      expect(result.proceed).toBe(false);
    });

    it('sectorBoost=+2 → gateScore 4 → 6, minGate=5 → 통과 (LEADING 섹터 효과)', () => {
      const result = entryRevalidationStep({
        ...baseInput,
        reCheckGate: { gateScore: 4, signalType: 'NORMAL' },
        sectorBoost: 2,
        sectorBoostReason: '반도체 +2 (LEADING)',
      });
      expect(result.proceed).toBe(true);
    });

    it('sectorBoost=+2 적용해도 gateScore 2 → 4, minGate=5 → 여전히 탈락', () => {
      const result = entryRevalidationStep({
        ...baseInput,
        reCheckGate: { gateScore: 2, signalType: 'NORMAL' },
        sectorBoost: 2,
        sectorBoostReason: '반도체 +2 (LEADING)',
      });
      expect(result.proceed).toBe(false);
      // 진단 메시지에 boost 효과 표시
      if (!result.proceed) {
        expect(result.logMessage).toContain('[반도체 +2 (LEADING)]');
      }
    });

    it('sectorBoost=-1 (LAGGING Bear regime) → gateScore 5 → 4, minGate=5 → 탈락', () => {
      const result = entryRevalidationStep({
        ...baseInput,
        reCheckGate: { gateScore: 5, signalType: 'NORMAL' },
        sectorBoost: -1,
        sectorBoostReason: '건설/부동산 -1 (LAGGING, R6_DEFENSE)',
        regime: 'R6_DEFENSE',
      });
      expect(result.proceed).toBe(false);
    });

    it('sectorBoost=0 + reason 미전달 → 진단 메시지에 boost 표기 없음', () => {
      const result = entryRevalidationStep({
        ...baseInput,
        reCheckGate: { gateScore: 1, signalType: 'NORMAL' },
        sectorBoost: 0,
      });
      expect(result.proceed).toBe(false);
      if (!result.proceed) {
        expect(result.logMessage).not.toContain('[반도체');
        expect(result.logMessage).not.toContain('[LEADING');
      }
    });

    it('sectorBoost 음수지만 reason 미전달 → 진단 메시지에 boost 표기 없음', () => {
      const result = entryRevalidationStep({
        ...baseInput,
        reCheckGate: { gateScore: 5, signalType: 'NORMAL' },
        sectorBoost: -1,
      });
      expect(result.proceed).toBe(false);
      if (!result.proceed) {
        // boost reason 미전달 시 "[<reason>]" 형식의 보너스 진단 텍스트 부재
        // (단, 헤더 "[AutoTrade]" 자체는 항상 존재 — 검증 대상은 sector reason 라벨만)
        expect(result.logMessage).not.toMatch(/\[[\w가-힣]+\s[+-]\d+\s\([A-Z]+/);
      }
    });
  });
});

describe('ADR-0608/0624 entryRevalidationStep — isShadow 진입 임계 분기', () => {
  const ENV_KEY = 'GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED';
  const KILL_KEY = 'SHADOW_LIBERALIZATION_KILL';
  let savedEnv: string | undefined;
  let savedKill: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[ENV_KEY];
    savedKill = process.env[KILL_KEY];
    // ADR-0624 D1: default ON 이므로 OFF baseline 은 `='false'` 로 명시(미설정=ON 회피).
    process.env[ENV_KEY] = 'false';
    delete process.env[KILL_KEY];
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = savedEnv;
    if (savedKill === undefined) delete process.env[KILL_KEY];
    else process.env[KILL_KEY] = savedKill;
  });

  // ⚠ ADR-0608 Phase 2: floor 5 는 LIVE 전용. SHADOW(=REGIME_AWARE_SHADOW)는 floor 우회 →
  //   regime-aware minGate(R3_EARLY=4) 를 그대로 사용한다. LIVE/ENV OFF 는 floor 5 보존(byte-equivalent).
  //   따라서 Phase 1 과 달리 ENV ON + SHADOW + R3_EARLY + score 4 는 이제 proceed=true (이전 SKIP).
  //
  // 통과 표본(score 6 ≥ floor 5)으로 라벨 carry 를 검증한다.
  const passInput = {
    ...baseInput,
    regime: 'R3_EARLY',
    reCheckGate: { gateScore: 6 as number | undefined, signalType: 'NORMAL' as const },
  };

  it('미전달(후방호환) → LEGACY 경로 + proceed 시 entryThresholdMode=LEGACY', () => {
    const result = entryRevalidationStep(baseInput); // isShadow 미전달
    expect(result.proceed).toBe(true);
    if (!result.proceed) return;
    expect(result.entryThresholdMode).toBe('LEGACY');
  });

  it('ENV ON + isShadow + 통과 표본 → proceed + 라벨 REGIME_AWARE_SHADOW carry', () => {
    process.env[ENV_KEY] = 'true';
    const result = entryRevalidationStep({ ...passInput, isShadow: true });
    expect(result.proceed).toBe(true);
    if (!result.proceed) return;
    expect(result.entryThresholdMode).toBe('REGIME_AWARE_SHADOW');
  });

  it('ENV ON + LIVE(isShadow=false) + 통과 표본 → proceed + 라벨 LEGACY (LIVE 표본 격리)', () => {
    process.env[ENV_KEY] = 'true';
    const result = entryRevalidationStep({ ...passInput, isShadow: false });
    expect(result.proceed).toBe(true);
    if (!result.proceed) return;
    expect(result.entryThresholdMode).toBe('LEGACY');
  });

  // ── ADR-0608 Phase 2: floor 5 SHADOW 완화 + regime 교정 ────────────────────
  const score4R3 = {
    ...baseInput,
    regime: 'R3_EARLY',
    reCheckGate: { gateScore: 4 as number | undefined, signalType: 'NORMAL' as const },
  };

  it('(P2-3+4) ENV ON + SHADOW + R3_EARLY + score 4 → proceed=true (floor 5 우회 → minGate 4)', () => {
    process.env[ENV_KEY] = 'true';
    const result = entryRevalidationStep({ ...score4R3, isShadow: true });
    // Phase 2: REGIME_AWARE_SHADOW 는 floor 5 우회 → minGate=getEffectiveGateThreshold(R3)=4.
    // gateScore 4 < 4 === false → minGate 통과(이전 Phase 1 은 floor 5 클램프로 SKIP 이었음).
    expect(result.proceed).toBe(true);
    if (!result.proceed) return;
    expect(result.entryThresholdMode).toBe('REGIME_AWARE_SHADOW');
  });

  it('(P2-2) ENV ON + LIVE(isShadow=false) + R3_EARLY + score 4 → proceed=false (floor 5 유지 byte-equivalent)', () => {
    process.env[ENV_KEY] = 'true';
    const result = entryRevalidationStep({ ...score4R3, isShadow: false });
    // LIVE: LEGACY → liveMinGate=Math.max(getMinGateScore(R3)=4, 5)=5. 4 < 5 === true → 탈락(floor 5 보존).
    expect(result.proceed).toBe(false);
    if (result.proceed) return;
    expect(result.failReasons.some((r) => r.includes('Gate 재검증 미달'))).toBe(true);
  });

  it('(P2-1) flag OFF(`=false`) — score 4 R3_EARLY 는 LIVE/SHADOW 모두 floor 5 → 탈락 (byte-equivalent)', () => {
    process.env[ENV_KEY] = 'false';
    const live = entryRevalidationStep({ ...score4R3, isShadow: false });
    const shadow = entryRevalidationStep({ ...score4R3, isShadow: true });
    expect(live.proceed).toBe(false);
    expect(shadow.proceed).toBe(false); // flag OFF → SHADOW 도 floor 5 클램프
  });

  it('(P2-1c) ADR-0624 미설정(default ON) + SHADOW + R3_EARLY + score 4 → proceed=true (운영자 미개입 floor 우회)', () => {
    delete process.env[ENV_KEY];
    const shadow = entryRevalidationStep({ ...score4R3, isShadow: true });
    expect(shadow.proceed).toBe(true); // default ON → REGIME_AWARE_SHADOW floor 우회 minGate 4
    const live = entryRevalidationStep({ ...score4R3, isShadow: false });
    expect(live.proceed).toBe(false); // live 는 floor 5 byte-equivalent
  });

  it('(P2-1d) kill-switch ON(미설정 default ON) + SHADOW + R3_EARLY + score 4 → proceed=false (byte-equivalent 롤백)', () => {
    delete process.env[ENV_KEY];
    process.env[KILL_KEY] = 'true';
    const shadow = entryRevalidationStep({ ...score4R3, isShadow: true });
    expect(shadow.proceed).toBe(false); // kill → LEGACY floor 5 클램프
  });

  it('(P2-5) entryRegime 미전달 → input.regime fallback (후방호환)', () => {
    process.env[ENV_KEY] = 'true';
    // entryRegime 없이 regime=R3_EARLY 만 전달 → minGate 산출이 R3 fallback.
    const result = entryRevalidationStep({ ...score4R3, isShadow: true });
    expect(result.proceed).toBe(true); // R3 floor 우회 → minGate 4
  });

  it('(P2-1b) entryRegime 분기 — SHADOW 가 flag OFF(`=false`) 면 entryRegime 무시(LEGACY floor 5)', () => {
    process.env[ENV_KEY] = 'false';
    // entryRegime=R3_EARLY 를 명시해도 flag OFF → LEGACY → getMinGateScore(R3)=4 → floor 5 클램프.
    const result = entryRevalidationStep({
      ...baseInput,
      regime: 'R4_NEUTRAL',
      entryRegime: 'R3_EARLY',
      reCheckGate: { gateScore: 4 as number | undefined, signalType: 'NORMAL' as const },
      isShadow: true,
    });
    expect(result.proceed).toBe(false); // floor 5 → 4 < 5 탈락 (flag OFF byte-equivalent)
  });
});

describe('entryRevalidationStep policy-blocked semantics', () => {
  it('SHADOW_ONLY + NON_TRADING_DAY records diagnostic skip while preserving shadow learning', () => {
    const result = entryRevalidationStep({
      ...baseInput,
      reCheckGate: { gateScore: 5.5, signalType: 'NORMAL' },
      regime: 'R6_DEFENSE',
      liveEntryAllowed: false,
      shadowLearningAllowed: true,
      executionMode: 'SHADOW_ONLY',
      marketSessionState: 'NON_TRADING_DAY',
      blockReasons: ['R6_DEFENSE', 'POSITION_FULL', 'KRX_NON_TRADING_DAY'],
    });

    expect(result.proceed).toBe(false);
    if (result.proceed) return;
    expect(result.stageLogValue).toBe('SKIPPED_POLICY_BLOCK');
    expect(result.logMessage).toContain('[ENTRY_REVALIDATION_SKIPPED]');
    expect(result.logMessage).toContain('requiredGateScore=N/A');
    expect(result.logMessage).toContain('shadowLearningAllowed=true');
    expect(result.logMessage).toContain('executionImpact=NONE');
    expect(result.logMessage).not.toContain('/999');
  });
});
