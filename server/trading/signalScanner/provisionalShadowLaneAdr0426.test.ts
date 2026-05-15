// @responsibility ADR-0426 Provisional Shadow Lane 회귀 테스트.
//
// 사용자 §G 12 케이스 + 정적 grep 가드 (LIVE 매매 영향 0 / KIS 주문 import 0건).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  deriveR3ProvisionalShadowCandidate,
  formatProvisionalShadowSection,
  summarizeProvisionalShadowCandidates,
  type DeriveR3ProvisionalShadowInput,
  type ProvisionalShadowCandidate,
} from './provisionalShadowLane.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MODULE_PATH = join(__dirname, 'provisionalShadowLane.ts');
const MODULE_SOURCE = readFileSync(MODULE_PATH, 'utf-8');

// 기본 입력 — R3_EARLY + Gate1 통과 + Gate2 미통과 + SOFT_DEGRADE
function baseInput(overrides: Partial<DeriveR3ProvisionalShadowInput> = {}): DeriveR3ProvisionalShadowInput {
  return {
    symbol: '005930',
    name: '삼성전자',
    regime: 'R3_EARLY',
    gate1Passed: true,
    gate2Passed: false,
    ...overrides,
  };
}

describe('ADR-0426 Provisional Shadow Lane', () => {
  // ────────────────────────────────────────────────────────
  // §G #1: R3_EARLY + Gate1 통과 + SOFT_DEGRADE → provisional 생성
  // ────────────────────────────────────────────────────────
  it('§G#1: R3_EARLY + Gate1 통과 + SOFT_DEGRADE → provisional 생성', () => {
    const result = deriveR3ProvisionalShadowCandidate(baseInput({
      router: {
        severity: 'SOFT_DEGRADE',
        reasons: ['SECTOR_DATA_STALE', 'DATA_UNAVAILABLE'],
        liveAllowed: false,
        paperAllowed: false,
        shadowAllowed: true,
        watchAllowed: true,
        label: 'SOFT_DEGRADE_DATA',
        operatorMessage: '',
      },
    }));
    expect(result).not.toBeNull();
    expect(result?.liveAllowed).toBe(false);
    expect(result?.shadowAllowed).toBe(true);
    expect(result?.source).toBe('ADR-0426');
    expect(result?.regime).toBe('R3_EARLY');
    expect(result?.gate1Passed).toBe(true);
    expect(result?.gate2Passed).toBe(false);
    expect(result?.reasons).toContain('R3_EARLY');
    expect(result?.reasons).toContain('GATE1_SURVIVOR');
    expect(result?.reasons).toContain('NO_HARD_RISK');
    expect(result?.reasons).toContain('SOFT_DEGRADE_DATA');
  });

  // ────────────────────────────────────────────────────────
  // §G #2: HARD_BLOCK → null
  // ────────────────────────────────────────────────────────
  it('§G#2: router.severity HARD_BLOCK → null', () => {
    const result = deriveR3ProvisionalShadowCandidate(baseInput({
      router: {
        severity: 'HARD_BLOCK',
        reasons: ['EMERGENCY_STOP'],
        liveAllowed: false,
        paperAllowed: false,
        shadowAllowed: false,
        watchAllowed: false,
        label: 'BLOCK_RISK',
        operatorMessage: '',
      },
    }));
    expect(result).toBeNull();
  });

  // ────────────────────────────────────────────────────────
  // §G #3: SELL_ONLY → shadow-observable live-only block
  // ────────────────────────────────────────────────────────
  it('§G#3: SELL_ONLY remains provisional shadow-observable', () => {
    const result = deriveR3ProvisionalShadowCandidate(baseInput({
      riskFlags: { sellOnly: true },
    }));
    expect(result).not.toBeNull();
    expect(result?.liveAllowed).toBe(false);
    expect(result?.shadowAllowed).toBe(true);
    expect(result?.reasons).toContain('NO_HARD_RISK');
  });

  // ────────────────────────────────────────────────────────
  // §G #4: R6_DEFENSE → shadow-observable live-only block
  // ────────────────────────────────────────────────────────
  it('§G#4: R6_DEFENSE remains provisional shadow-observable', () => {
    const result = deriveR3ProvisionalShadowCandidate(baseInput({
      riskFlags: { r6Defense: true },
    }));
    expect(result).not.toBeNull();
    expect(result?.liveAllowed).toBe(false);
    expect(result?.shadowAllowed).toBe(true);
    expect(result?.reasons).toContain('NO_HARD_RISK');
  });

  // ────────────────────────────────────────────────────────
  // §G #5: Gate1 미통과 → null
  // ────────────────────────────────────────────────────────
  it('§G#5: Gate1 미통과 → null', () => {
    const result = deriveR3ProvisionalShadowCandidate(baseInput({
      gate1Passed: false,
    }));
    expect(result).toBeNull();
  });

  // ────────────────────────────────────────────────────────
  // §G #6: Gate2 통과 → null (정상 통과 경로, provisional 아님)
  // ────────────────────────────────────────────────────────
  it('§G#6: Gate2 통과 → null (정상 경로)', () => {
    const result = deriveR3ProvisionalShadowCandidate(baseInput({
      gate2Passed: true,
    }));
    expect(result).toBeNull();
  });

  // ────────────────────────────────────────────────────────
  // §G #7: SectorEnergy DEGRADED → 탈락 아님, reason 으로 기록
  // ────────────────────────────────────────────────────────
  it('§G#7: SectorEnergy DEGRADED → 탈락 아님, reason 기록 + label DATA_DEGRADED', () => {
    const result = deriveR3ProvisionalShadowCandidate(baseInput({
      sectorEnergyDiagnostic: {
        dataQuality: 'DEGRADED',
        validSectorCount: 11,
        expectedSectorCount: 12,
        totalSectorRows: 12,
        rowsWithIndexCode: 2,
        indexCodeCoverage: 0.187,
        missingIndexCodeCount: 10,
        symmetryValidationPassed: false,
        fallbackUsed: 'STOCK_DAILY',
        reasons: ['INDEX_CODE_COVERAGE_LOW'],
        shouldBlockLeadershipConfidence: true,
        operatorMessage: '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    }));
    expect(result).not.toBeNull();
    expect(result?.reasons).toContain('SECTOR_DATA_DEGRADED');
    expect(result?.label).toBe('R3_PROVISIONAL_LEADER_DATA_DEGRADED');
  });

  // ────────────────────────────────────────────────────────
  // §G #8: DATA_UNAVAILABLE → 탈락 아님, reason 기록
  // ────────────────────────────────────────────────────────
  it('§G#8: DATA_UNAVAILABLE 우세 → reason 기록 + label DATA_DEGRADED', () => {
    const result = deriveR3ProvisionalShadowCandidate(baseInput({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      conditionBuckets: [
        {
          conditionKey: 'supply_confluence',
          passed: 0,
          failed: 0,
          unavailable: 8,
          error: 0,
          skipped: 0,
          total: 8,
          failedRate: 0,
          unavailableRate: 1,
          errorRate: 0,
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any,
    }));
    expect(result).not.toBeNull();
    expect(result?.reasons).toContain('DATA_UNAVAILABLE');
    expect(result?.label).toBe('R3_PROVISIONAL_LEADER_DATA_DEGRADED');
  });

  // ────────────────────────────────────────────────────────
  // §G #9: technicalBreakdown → null
  // ────────────────────────────────────────────────────────
  it('§G#9: technicalBreakdown → null (학습 표본 오염 차단)', () => {
    const result = deriveR3ProvisionalShadowCandidate(baseInput({
      riskFlags: { technicalBreakdown: true },
    }));
    expect(result).toBeNull();
  });

  // ────────────────────────────────────────────────────────
  // §G #10: formatter 가 R3 Provisional Shadow Lane 섹션 표시
  // ────────────────────────────────────────────────────────
  it('§G#10: formatter R3 Provisional Shadow Lane 섹션 표시', () => {
    const candidates: ProvisionalShadowCandidate[] = [
      {
        symbol: '005930',
        label: 'R3_PROVISIONAL_LEADER_DATA_DEGRADED',
        reasons: ['R3_EARLY', 'GATE1_SURVIVOR', 'SECTOR_DATA_DEGRADED', 'DATA_UNAVAILABLE', 'GATE2_NOT_CONFIRMED', 'NO_HARD_RISK'],
        liveAllowed: false,
        shadowAllowed: true,
        source: 'ADR-0426',
        regime: 'R3_EARLY',
        gate1Passed: true,
        gate2Passed: false,
      },
    ];
    const summary = summarizeProvisionalShadowCandidates(candidates);
    const section = formatProvisionalShadowSection(summary);
    expect(section).toBeTruthy();
    expect(section).toContain('R3 Provisional Shadow Lane (ADR-0426');
    expect(section).toContain('eligible:');
    expect(section).toContain('1');
    expect(section).toContain('label:');
    expect(section).toContain('R3_PROVISIONAL_LEADER_DATA_DEGRADED');
    expect(section).toContain('top reasons:');
    expect(section).toContain('SECTOR_DATA_DEGRADED');
    expect(section).toContain('DATA_UNAVAILABLE');
    expect(section).toContain('GATE2_NOT_CONFIRMED');
    expect(section).toContain('live=❌');
    expect(section).toContain('shadow=✅');
  });

  it('§G#10b: eligible=0 시 noEligibleReason 표시', () => {
    const section = formatProvisionalShadowSection({
      eligible: 0,
      noEligibleReason: 'HARD_BLOCK / no Gate1 survivor / true technical breakdown',
    });
    expect(section).toContain('eligible:');
    expect(section).toContain('0');
    expect(section).toContain('blockedBy');
    expect(section).toContain('HARD_BLOCK');
  });

  // ────────────────────────────────────────────────────────
  // §G #11: label 과 reasons 가 후보 metadata 에 저장됨
  // ────────────────────────────────────────────────────────
  it('§G#11: label + reasons + source + lanes 모두 후보 metadata 저장', () => {
    const result = deriveR3ProvisionalShadowCandidate(baseInput({
      blockReasons: { preBreakoutWait: true },
      nowKst: '2026-05-07T15:30:00+09:00',
    }));
    expect(result).not.toBeNull();
    expect(result?.label).toBe('R3_PROVISIONAL_LEADER_PRE_BREAKOUT');
    expect(result?.reasons).toEqual(expect.arrayContaining([
      'R3_EARLY',
      'GATE1_SURVIVOR',
      'NO_HARD_RISK',
      'PRE_BREAKOUT_WAIT',
      'GATE2_NOT_CONFIRMED',
    ]));
    expect(result?.source).toBe('ADR-0426');
    expect(result?.liveAllowed).toBe(false);
    expect(result?.shadowAllowed).toBe(true);
    expect(result?.createdAtKst).toBe('2026-05-07T15:30:00+09:00');
  });

  // ────────────────────────────────────────────────────────
  // §G #12: KIS order path import 부재 (정적 grep 가드)
  // ────────────────────────────────────────────────────────
  describe('§G#12: 정적 grep 가드 — LIVE 매매 영향 0', () => {
    it('KIS 주문 함수 5종 import 0건', () => {
      expect(MODULE_SOURCE).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder/);
    });

    it('autoTradeEngine import 0건', () => {
      expect(MODULE_SOURCE).not.toMatch(/autoTradeEngine/);
    });

    it('orderExecutor / trancheExecutor import 0건', () => {
      expect(MODULE_SOURCE).not.toMatch(/orderExecutor|trancheExecutor/);
    });

    it('Gate threshold 변경 키워드 부재', () => {
      expect(MODULE_SOURCE).not.toMatch(/setGateThreshold|MIN_GATE_OVERRIDE|GATE_RELAX/);
    });

    it('STRONG_BUY 조건 변경 키워드 부재', () => {
      expect(MODULE_SOURCE).not.toMatch(/STRONG_BUY_OVERRIDE|setStrongBuyThreshold/);
    });

    it('외부 fetch / axios / API 호출 0건', () => {
      expect(MODULE_SOURCE).not.toMatch(/\bfetch\(|axios\.|node-fetch/);
    });

    it('liveAllowed: false literal type — TypeScript 강제', () => {
      // SSOT 시그니처상 liveAllowed: false (literal) 이라 호출자가 true 부여 시 컴파일 에러
      expect(MODULE_SOURCE).toContain('liveAllowed: false');
      expect(MODULE_SOURCE).toContain('shadowAllowed: true');
    });
  });

  // ────────────────────────────────────────────────────────
  // 보너스: emergencyStop → null
  // ────────────────────────────────────────────────────────
  it('보너스: emergencyStop → null (HARD_BLOCK 의미)', () => {
    const result = deriveR3ProvisionalShadowCandidate(baseInput({
      riskFlags: { emergencyStop: true },
    }));
    expect(result).toBeNull();
  });

  // ────────────────────────────────────────────────────────
  // 보너스: regime ≠ R3_EARLY → null
  // ────────────────────────────────────────────────────────
  it('보너스: regime=R2_BULL → null (R3_EARLY 외 차단)', () => {
    const result = deriveR3ProvisionalShadowCandidate(baseInput({
      regime: 'R2_BULL',
    }));
    expect(result).toBeNull();
  });

  // ────────────────────────────────────────────────────────
  // 보너스: TRUE_WEAKNESS → null (Shadow 도 차단)
  // ────────────────────────────────────────────────────────
  it('보너스: router.severity TRUE_WEAKNESS → null (Shadow 차단)', () => {
    const result = deriveR3ProvisionalShadowCandidate(baseInput({
      router: {
        severity: 'TRUE_WEAKNESS',
        reasons: ['TRUE_NO_LEADERSHIP'],
        liveAllowed: false,
        paperAllowed: false,
        shadowAllowed: false,
        watchAllowed: true,
        label: 'BLOCK_TRUE_WEAKNESS',
        operatorMessage: '',
      },
    }));
    expect(result).toBeNull();
  });

  // ────────────────────────────────────────────────────────
  // 보너스: shadowAllowed=false 명시 시 차단
  // ────────────────────────────────────────────────────────
  it('보너스: router.shadowAllowed=false 명시 → null', () => {
    const result = deriveR3ProvisionalShadowCandidate(baseInput({
      router: {
        severity: 'WATCH_ONLY',
        reasons: [],
        liveAllowed: false,
        paperAllowed: false,
        shadowAllowed: false,
        watchAllowed: true,
        label: 'WATCH_PRE_BREAKOUT',
        operatorMessage: '',
      },
    }));
    expect(result).toBeNull();
  });

  // ────────────────────────────────────────────────────────
  // 보너스: liquidity / RRR severe block → null
  // ────────────────────────────────────────────────────────
  it('보너스: liquidityBlock → null', () => {
    const result = deriveR3ProvisionalShadowCandidate(baseInput({
      riskFlags: { liquidityBlock: true },
    }));
    expect(result).toBeNull();
  });

  it('보너스: rrrBlock → null', () => {
    const result = deriveR3ProvisionalShadowCandidate(baseInput({
      riskFlags: { rrrBlock: true },
    }));
    expect(result).toBeNull();
  });

  // ────────────────────────────────────────────────────────
  // 보너스: pre-breakout wait → label PRE_BREAKOUT
  // ────────────────────────────────────────────────────────
  it('보너스: pre-breakout wait + sector OK → label PRE_BREAKOUT', () => {
    const result = deriveR3ProvisionalShadowCandidate(baseInput({
      blockReasons: { preBreakoutWait: true },
    }));
    expect(result).not.toBeNull();
    expect(result?.label).toBe('R3_PROVISIONAL_LEADER_PRE_BREAKOUT');
    expect(result?.reasons).toContain('PRE_BREAKOUT_WAIT');
  });

  // ────────────────────────────────────────────────────────
  // 보너스: 단순 Gate2 미완 (sector OK + pre-breakout 무관) → label GATE2_NOT_CONFIRMED
  // ────────────────────────────────────────────────────────
  it('보너스: 단순 Gate2 미완 → label GATE2_NOT_CONFIRMED', () => {
    const result = deriveR3ProvisionalShadowCandidate(baseInput());
    expect(result).not.toBeNull();
    expect(result?.label).toBe('R3_PROVISIONAL_LEADER_GATE2_NOT_CONFIRMED');
  });

  // ────────────────────────────────────────────────────────
  // summarize 헬퍼 — 빈 입력
  // ────────────────────────────────────────────────────────
  it('summarizeProvisionalShadowCandidates 빈 입력 → eligible=0', () => {
    const summary = summarizeProvisionalShadowCandidates([]);
    expect(summary.eligible).toBe(0);
    expect(summary.created).toBe(0);
  });

  it('summarize — 다중 후보 reasons 빈도 정렬', () => {
    const candidates: ProvisionalShadowCandidate[] = [
      {
        symbol: 'A', label: 'R3_PROVISIONAL_LEADER_DATA_DEGRADED',
        reasons: ['R3_EARLY', 'GATE1_SURVIVOR', 'NO_HARD_RISK', 'SECTOR_DATA_DEGRADED', 'GATE2_NOT_CONFIRMED'],
        liveAllowed: false, shadowAllowed: true, source: 'ADR-0426', regime: 'R3_EARLY',
        gate1Passed: true, gate2Passed: false,
      },
      {
        symbol: 'B', label: 'R3_PROVISIONAL_LEADER_DATA_DEGRADED',
        reasons: ['R3_EARLY', 'GATE1_SURVIVOR', 'NO_HARD_RISK', 'SECTOR_DATA_DEGRADED', 'DATA_UNAVAILABLE', 'GATE2_NOT_CONFIRMED'],
        liveAllowed: false, shadowAllowed: true, source: 'ADR-0426', regime: 'R3_EARLY',
        gate1Passed: true, gate2Passed: false,
      },
    ];
    const summary = summarizeProvisionalShadowCandidates(candidates);
    expect(summary.eligible).toBe(2);
    expect(summary.dominantLabel).toBe('R3_PROVISIONAL_LEADER_DATA_DEGRADED');
    // SECTOR_DATA_DEGRADED 2회 / DATA_UNAVAILABLE 1회 / GATE2_NOT_CONFIRMED 2회
    expect(summary.topReasons?.[0]).toBeOneOf(['SECTOR_DATA_DEGRADED', 'GATE2_NOT_CONFIRMED']);
  });

  // ────────────────────────────────────────────────────────
  // formatter null 입력 처리
  // ────────────────────────────────────────────────────────
  it('formatter null/undefined 입력 → null', () => {
    expect(formatProvisionalShadowSection(null)).toBeNull();
    expect(formatProvisionalShadowSection(undefined)).toBeNull();
  });
});
