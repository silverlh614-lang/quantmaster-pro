/**
 * @responsibility health.cmd 회귀 테스트 — KRX 라인 5분기 + formatHealthMessage 통합 검증
 *
 * 사용자 요청 후속: "/health 에 KRX 연결상태 표시" — formatKrxStatusLine 5 분기 SSOT
 * + formatHealthMessage 가 KRX 라인을 정확히 1번 포함하는지 가드.
 */

import { describe, it, expect, vi } from 'vitest';

// commandRegistry 와 commandRegistry 경유 자동 등록 분리 — 단위 테스트는 import 만.
vi.mock('../../commandRegistry.js', () => ({
  commandRegistry: { register: vi.fn() },
}));

import {
  formatHealthMessage,
  formatKrxStatusLine,
} from './health.cmd.js';
import type {
  HealthSnapshot,
  HealthProbeResult,
} from '../../../health/diagnostics.js';

// ── 픽스처 ────────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    uptimeHours: '1.0',
    memMB: 128,
    commitSha: 'abc1234',
    watchlistCount: 10,
    activePositions: 0,
    autoTradeEnabled: true,
    autoTradeMode: 'SHADOW',
    emergencyStop: false,
    dailyLossPct: 0,
    dailyLossLimit: 5,
    dailyLossLimitReached: false,
    kisConfigured: true,
    kisTokenHours: 12,
    kisTokenValid: true,
    realDataTokenHours: 0,
    krxTokenConfigured: true,
    krxTokenValid: true,
    krxCircuitState: 'CLOSED',
    krxFailures: 0,
    yahoo: {
      status: 'OK',
      detail: 'OK',
      heartbeat: {
        lastSuccessAt: 0,
        lastFailureAt: 0,
        consecutiveFailures: 0,
      },
    },
    geminiRuntime: { status: 'OK' },
    volume: { ok: true },
    stream: { connected: true, subscribedCount: 5 },
    telegramConfigured: true,
    telegramBotTokenOnly: false,
    telegramChatIdOnly: false,
    lastScanTs: 0,
    lastBuyTs: 0,
    verdict: '✅ OK',
    ...overrides,
  } as HealthSnapshot;
}

const PROBES: HealthProbeResult = {
  yahoo: { severity: 'OK', message: 'Yahoo probe OK' },
  dart: { severity: 'OK', message: 'DART API status=000' },
};

// ── formatKrxStatusLine 5 분기 ────────────────────────────────────────────

describe('formatKrxStatusLine — KRX OpenAPI 회로 상태 5 분기', () => {
  it('1) 토큰 미설정 → ⚠️ + AUTH_KEY env 안내', () => {
    const s = makeSnapshot({
      krxTokenConfigured: false,
      krxTokenValid: false,
      krxFailures: 0,
    });
    const line = formatKrxStatusLine(s);
    expect(line).toBe('⚠️ 토큰 미설정 (KRX_OPEN_API_AUTH_KEY)');
  });

  it('2) 회로 OPEN → ❌ + 실패 카운트', () => {
    const s = makeSnapshot({
      krxCircuitState: 'OPEN',
      krxTokenValid: false,
      krxFailures: 7,
    });
    expect(formatKrxStatusLine(s)).toBe('❌ 회로 OPEN (실패 7회)');
  });

  it('3) 회로 HALF_OPEN → 🟡 회복 중', () => {
    const s = makeSnapshot({
      krxCircuitState: 'HALF_OPEN',
      krxTokenValid: false,
      krxFailures: 5,
    });
    expect(formatKrxStatusLine(s)).toBe('🟡 회복 중 (실패 5회)');
  });

  it('4) 회로 CLOSED + 정상 (krxTokenValid=true) → ✅ 정상', () => {
    const s = makeSnapshot({
      krxCircuitState: 'CLOSED',
      krxTokenValid: true,
      krxFailures: 0,
    });
    expect(formatKrxStatusLine(s)).toBe('✅ 정상 (실패 0회)');
  });

  it('5) 회로 CLOSED + 비활성 (krxTokenValid=false, DISABLED env) → 🟡 비활성', () => {
    const s = makeSnapshot({
      krxCircuitState: 'CLOSED',
      krxTokenValid: false,
      krxFailures: 0,
    });
    expect(formatKrxStatusLine(s)).toBe('🟡 비활성 (실패 0회)');
  });

  it('알 수 없는 회로 상태 → fallback "?" + 상태값 + 실패 카운트', () => {
    const s = makeSnapshot({
      krxCircuitState: 'WEIRD_STATE',
      krxTokenValid: false,
      krxFailures: 3,
    });
    expect(formatKrxStatusLine(s)).toBe('? WEIRD_STATE (실패 3회)');
  });

  it('우선순위: 토큰 미설정 > 회로 OPEN (회로 무관)', () => {
    const s = makeSnapshot({
      krxTokenConfigured: false,
      krxCircuitState: 'OPEN',
      krxFailures: 100,
    });
    // 토큰 미설정이 우선 — 회로 카운트 표시 무의미
    expect(formatKrxStatusLine(s)).toBe('⚠️ 토큰 미설정 (KRX_OPEN_API_AUTH_KEY)');
  });
});

// ── formatHealthMessage 통합 검증 ────────────────────────────────────────

describe('formatHealthMessage — KRX 라인 통합', () => {
  it('정상 스냅샷에 KRX OpenAPI 라인 정확히 1번 포함', () => {
    const msg = formatHealthMessage(makeSnapshot(), PROBES);
    const matches = msg.match(/KRX OpenAPI:/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(msg).toContain('KRX OpenAPI: ✅ 정상 (실패 0회)');
  });

  it('회로 OPEN 시 ❌ 마커 + 실패 카운트 노출', () => {
    const msg = formatHealthMessage(
      makeSnapshot({ krxCircuitState: 'OPEN', krxTokenValid: false, krxFailures: 12 }),
      PROBES,
    );
    expect(msg).toContain('KRX OpenAPI: ❌ 회로 OPEN (실패 12회)');
  });

  it('KIS 토큰 라인과 KRX 라인이 인접하게 (KIS → KRX → Yahoo 순서)', () => {
    const msg = formatHealthMessage(makeSnapshot(), PROBES);
    const kisIdx = msg.indexOf('KIS 토큰:');
    const krxIdx = msg.indexOf('KRX OpenAPI:');
    const yahooIdx = msg.indexOf('Yahoo probe:');
    expect(kisIdx).toBeGreaterThan(0);
    expect(krxIdx).toBeGreaterThan(kisIdx);
    expect(yahooIdx).toBeGreaterThan(krxIdx);
  });

  it('토큰 미설정 운영 환경에서도 정상 렌더 (회귀 가드)', () => {
    const msg = formatHealthMessage(
      makeSnapshot({ krxTokenConfigured: false, krxTokenValid: false }),
      PROBES,
    );
    expect(msg).toContain('KRX OpenAPI: ⚠️ 토큰 미설정');
    expect(msg).toContain('KRX_OPEN_API_AUTH_KEY');
  });
});
