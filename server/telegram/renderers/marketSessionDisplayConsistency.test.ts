// @responsibility ADR-0555 정합 회귀 — compact·raw·canonical 헤더 3출처 marketSession 표시 byte-equivalence 검증.

import { describe, expect, it } from 'vitest';
import type { ScanSummary } from '../../trading/signalScanner/scanDiagnostics/scanSummaryTypes.js';
import { resolveScanMarketSessionView } from '../../trading/signalScanner/state/scanEvaluationState.js';
import { buildSnapshotBundleFromScanSummary } from './snapshotBundle.js';
import { buildQmpGateDetailHeaderView } from './qmpGateDetailHeaderCanonical.js';
import { formatScanBlockersCompactMessage } from '../commands/system/scanBlockersCompactAdr0506.js';

/**
 * compact 명령은 `• marketSession: <값>` 라인을 출력한다(scanBlockersCompactAdr0506.ts:1071).
 * 표시 텍스트에서 해당 값을 추출하여 raw/canonical 헤더와 비교한다.
 */
function compactMarketSession(summary: ScanSummary): string {
  const message = formatScanBlockersCompactMessage(summary);
  const line = message.split('\n').find((l) => l.includes('• marketSession:'));
  expect(line, 'compact 메시지에 marketSession 라인이 있어야 한다').toBeTruthy();
  return String(line).replace(/^.*•\s*marketSession:\s*/u, '').trim().toUpperCase();
}

function rawMarketSession(summary: ScanSummary): string {
  return buildSnapshotBundleFromScanSummary(summary).marketSession.toUpperCase();
}

function canonicalHeaderMarketSession(summary: ScanSummary): string {
  return buildQmpGateDetailHeaderView(summary).session.marketSessionState.toUpperCase();
}

function ssotMarketSession(summary: ScanSummary): string {
  return resolveScanMarketSessionView({
    explicitMarketSessionState: summary.scanEvaluation?.marketSessionState,
    macroGateState: summary.macroGateState,
    asOf: summary.scanEvaluation?.asOf,
    timeLabel: summary.time,
  }).marketSessionState.toUpperCase();
}

interface SessionFixtureOptions {
  time: string;
  asOf?: string;
  explicitMarketSessionState?: string;
  canonicalSession?: string;
  displaySession?: string;
  sellOnlyMode?: boolean;
}

/**
 * 최소 ScanSummary fixture — 세 출처가 모두 읽는 필드(time/scanEvaluation/macroGateState)만 구성.
 * macro displaySession/canonicalSession 를 다양화하여 폴백 진원(부재→UNKNOWN) 회귀를 막는다.
 */
function buildSessionFixture(options: SessionFixtureOptions): ScanSummary {
  return {
    time: options.time,
    snapshotId: 'scan-eval-session-consistency',
    candidates: 12,
    trackB: 0,
    swing: 0,
    catalyst: 0,
    momentum: 0,
    yahooFails: 0,
    gateMisses: 0,
    rrrMisses: 0,
    entries: 0,
    scanEvaluation: {
      scanId: 'scan-eval-session-consistency',
      asOf: options.asOf ?? options.time,
      evaluationState: 'EVALUATED_PARTIAL',
      marketSessionState: options.explicitMarketSessionState ?? 'BUY_ALLOWED',
      engineMode: 'NORMAL',
      effectiveRegime: 'R3_EARLY',
      totalCandidates: 12,
      evaluated: 12,
      skipped: 0,
      rejected: 10,
      survivors: 2,
      quoteHydrated: 12,
      quoteHydrationFailed: 0,
      sourcePath: 'test',
      executionImpact: 'NONE',
      shadowLearningAllowed: true,
    },
    macroGateState: {
      emergencyStop: false,
      autoTradeEnabled: true,
      regime: 'R3_EARLY',
      kellyMultiplierFromRegime: 1,
      fomcPhase: 'NONE',
      fomcKellyMultiplier: 1,
      finalKellyMultiplier: 1,
      vixGatingActive: false,
      bearDefenseMode: false,
      mhsBelow30: false,
      watchlistEmpty: false,
      sellOnlyMode: options.sellOnlyMode ?? false,
      engineMode: 'NORMAL',
      displayRegime: 'R3_EARLY',
      macroRegimeRaw: 'R3_EARLY',
      macroRegimeEffective: 'R3_EARLY',
      riskOverride: 'NONE',
      ...(options.canonicalSession !== undefined ? { canonicalSession: options.canonicalSession } : {}),
      ...(options.displaySession !== undefined ? { displaySession: options.displaySession } : {}),
      brokerRouteAlive: true,
      brokerLiveOrderAllowed: true,
      brokerExitOrderAllowed: true,
      paperOrderAllowed: true,
      shadowAllowed: true,
      shadowBuyAllowed: true,
      shadowLearningAllowed: true,
      counterfactualAllowed: true,
    },
  } as unknown as ScanSummary;
}

function assertThreeSourceEquivalence(summary: ScanSummary): string {
  const ssot = ssotMarketSession(summary);
  const compact = compactMarketSession(summary);
  const raw = rawMarketSession(summary);
  const header = canonicalHeaderMarketSession(summary);
  expect(compact).toBe(ssot);
  expect(raw).toBe(ssot);
  expect(header).toBe(ssot);
  // 3출처 상호 동일 (byte-equivalence)
  expect(new Set([compact, raw, header]).size).toBe(1);
  return ssot;
}

describe('marketSession 3출처 표시 정합 (ADR-0555, compact·raw·canonical 헤더 byte-equivalence)', () => {
  it('장중 09:2x KST + macro UNKNOWN → 3출처 모두 REGULAR_OPEN', () => {
    const summary = buildSessionFixture({
      time: '2026-06-09 09:24:00 KST',
      asOf: '2026-06-09T09:24:00+09:00',
      // macro 가 canonical/display session 을 carry 하지 않음 (raw 경로 UNKNOWN 진원 재현)
    });
    // 장중(REGULAR_OPEN)에서 SSOT marketSessionState = explicitMarketSessionState ?? 'BUY_ALLOWED'
    // (scanEvaluationState.ts:233~235). canonicalSession 은 REGULAR_OPEN 이나 표시값은 BUY_ALLOWED.
    const value = assertThreeSourceEquivalence(summary);
    expect(value).toBe('BUY_ALLOWED');
    // canonical 분류 자체는 REGULAR_OPEN 임을 SSOT 로 확인 (false-CLOSED 회귀 가드).
    expect(
      resolveScanMarketSessionView({
        explicitMarketSessionState: summary.scanEvaluation?.marketSessionState,
        macroGateState: summary.macroGateState,
        asOf: summary.scanEvaluation?.asOf,
        timeLabel: summary.time,
      }).canonicalSession,
    ).toBe('REGULAR_OPEN');
  });

  it('장중 09:2x KST + macro stale CLOSED (flag OFF) → 3출처 동일값 (정합은 보정값과 직교)', () => {
    const prev = process.env.SCAN_SESSION_WALLCLOCK_CORRECTION_ENABLED;
    delete process.env.SCAN_SESSION_WALLCLOCK_CORRECTION_ENABLED;
    try {
      const summary = buildSessionFixture({
        time: '2026-06-09 09:24:00 KST',
        asOf: '2026-06-09T09:24:00+09:00',
        canonicalSession: 'CLOSED',
        displaySession: 'CLOSED',
      });
      // flag OFF 라 CLOSED 유지 — 핵심은 3출처가 *서로* 동일하다는 것 (표시 정합).
      assertThreeSourceEquivalence(summary);
    } finally {
      if (prev === undefined) delete process.env.SCAN_SESSION_WALLCLOCK_CORRECTION_ENABLED;
      else process.env.SCAN_SESSION_WALLCLOCK_CORRECTION_ENABLED = prev;
    }
  });

  it('장후 15:40 KST → 3출처 동일값', () => {
    const summary = buildSessionFixture({
      time: '2026-06-09 15:40:00 KST',
      asOf: '2026-06-09T15:40:00+09:00',
      canonicalSession: 'POST_CLOSE',
      displaySession: 'POST_CLOSE_SHADOW_OBSERVE',
    });
    assertThreeSourceEquivalence(summary);
  });

  it('주말(토요일) → 3출처 모두 HOLIDAY', () => {
    // 2026-06-13 은 토요일
    const summary = buildSessionFixture({
      time: '2026-06-13 09:24:00 KST',
      asOf: '2026-06-13T09:24:00+09:00',
      canonicalSession: 'REGULAR_OPEN',
      displaySession: 'REGULAR_OPEN',
    });
    const value = assertThreeSourceEquivalence(summary);
    expect(value).toBe('HOLIDAY');
  });

  it('macro UNKNOWN + wall-clock 미해석(시각 라벨 없음) → 3출처 모두 UNKNOWN (false-open 금지)', () => {
    const summary = buildSessionFixture({
      time: '미실행',
      asOf: '미실행',
      explicitMarketSessionState: 'UNKNOWN',
    });
    const value = assertThreeSourceEquivalence(summary);
    expect(value).toBe('UNKNOWN');
  });

  it('flag ON/OFF 양쪽에서 3출처는 항상 서로 동일 (정합은 flag 무관)', () => {
    const prev = process.env.SCAN_SESSION_WALLCLOCK_CORRECTION_ENABLED;
    const summary = buildSessionFixture({
      time: '2026-06-09 09:24:00 KST',
      asOf: '2026-06-09T09:24:00+09:00',
      canonicalSession: 'CLOSED',
      displaySession: 'CLOSED',
    });
    try {
      process.env.SCAN_SESSION_WALLCLOCK_CORRECTION_ENABLED = 'true';
      assertThreeSourceEquivalence(summary);
      process.env.SCAN_SESSION_WALLCLOCK_CORRECTION_ENABLED = 'false';
      assertThreeSourceEquivalence(summary);
    } finally {
      if (prev === undefined) delete process.env.SCAN_SESSION_WALLCLOCK_CORRECTION_ENABLED;
      else process.env.SCAN_SESSION_WALLCLOCK_CORRECTION_ENABLED = prev;
    }
  });
});
