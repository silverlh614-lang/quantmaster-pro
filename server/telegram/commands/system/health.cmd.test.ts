/**
 * @responsibility health.cmd 회귀 테스트 — KRX connection / master usability 분리 표시 검증.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../commandRegistry.js', () => ({
  commandRegistry: { register: vi.fn() },
}));

const krxRepoMock = vi.hoisted(() => ({
  getMasterSize: vi.fn(() => 2500),
  isMasterStale: vi.fn(() => false),
}));

vi.mock('../../../persistence/krxStockMasterRepo.js', () => krxRepoMock);

import {
  formatHealthMessage,
  formatKrxStatusLine,
  formatKrxMasterUsabilityLine,
  resolveHealthVerdict,
} from './health.cmd.js';
import type { HealthSnapshot, HealthProbeResult } from '../../../health/diagnostics.js';

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
      heartbeat: { lastSuccessAt: 0, lastFailureAt: 0, consecutiveFailures: 0 },
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

describe('formatKrxStatusLine', () => {
  it('connection OK와 master usable은 별도 레이어로 표시한다', () => {
    expect(formatKrxStatusLine(makeSnapshot())).toBe('✅ connection OK (실패 0회)');
  });

  it('토큰 미설정은 AUTH_KEY 안내를 우선한다', () => {
    expect(formatKrxStatusLine(makeSnapshot({ krxTokenConfigured: false, krxTokenValid: false })))
      .toBe('⚠️ 토큰 미설정 (KRX_OPEN_API_AUTH_KEY)');
  });

  it('회로 OPEN은 connection layer 실패로 표시한다', () => {
    expect(formatKrxStatusLine(makeSnapshot({ krxCircuitState: 'OPEN', krxFailures: 7, krxTokenValid: false })))
      .toBe('❌ 회로 OPEN (실패 7회)');
  });
});

describe('formatKrxMasterUsabilityLine', () => {
  beforeEach(() => {
    krxRepoMock.getMasterSize.mockReturnValue(2500);
    krxRepoMock.isMasterStale.mockReturnValue(false);
  });

  it('master total >= 2000 이고 fresh이면 usable', () => {
    const result = formatKrxMasterUsabilityLine();
    expect(result.blocked).toBe(false);
    expect(result.line).toContain('✅ usable');
    expect(result.line).toContain('total 2500 ≥ 2000');
  });

  it('master total < 2000이면 production scan BLOCKED', () => {
    krxRepoMock.getMasterSize.mockReturnValue(395);
    const result = formatKrxMasterUsabilityLine();
    expect(result.blocked).toBe(true);
    expect(result.line).toContain('❌ master unusable');
    expect(result.line).toContain('total 395 < 2000');
    expect(result.line).toContain('production scan BLOCKED');
  });

  it('TTL 만료이면 production scan BLOCKED', () => {
    krxRepoMock.isMasterStale.mockReturnValue(true);
    const result = formatKrxMasterUsabilityLine();
    expect(result.blocked).toBe(true);
    expect(result.line).toContain('TTL expired');
  });
});

describe('formatHealthMessage — KRX connection / master usability 통합', () => {
  beforeEach(() => {
    krxRepoMock.getMasterSize.mockReturnValue(2500);
    krxRepoMock.isMasterStale.mockReturnValue(false);
  });

  it('정상 master이면 KRX OpenAPI와 KRX Master 라인을 각각 1번 표시한다', () => {
    const msg = formatHealthMessage(makeSnapshot(), PROBES);
    expect(msg.match(/KRX OpenAPI:/g)).toHaveLength(1);
    expect(msg.match(/KRX Master:/g)).toHaveLength(1);
    expect(msg).toContain('KRX OpenAPI: ✅ connection OK (실패 0회)');
    expect(msg).toContain('KRX Master: ✅ usable — total 2500 ≥ 2000');
    expect(msg).toContain('판정: ✅ OK');
  });

  it('connection OK라도 master unusable이면 최종 판정을 DEGRADED로 승격한다', () => {
    krxRepoMock.getMasterSize.mockReturnValue(395);
    const msg = formatHealthMessage(makeSnapshot(), PROBES);
    expect(msg).toContain('KRX OpenAPI: ✅ connection OK (실패 0회)');
    expect(msg).toContain('KRX Master: ❌ master unusable — total 395 < 2000');
    expect(msg).toContain('판정: 🔴 DEGRADED — KRX master unusable / scanner BLOCKED');
    expect(msg).toContain('시장 데이터 품질: ❌ CRITICAL — KRX master unusable / scanner BLOCKED');
  });
});

describe('resolveHealthVerdict', () => {
  it('master usable이면 기존 verdict를 보존한다', () => {
    expect(resolveHealthVerdict('✅ OK', false)).toBe('✅ OK');
  });

  it('master blocked이면 기존 OK를 DEGRADED로 승격한다', () => {
    expect(resolveHealthVerdict('✅ OK', true)).toContain('DEGRADED');
  });
});
