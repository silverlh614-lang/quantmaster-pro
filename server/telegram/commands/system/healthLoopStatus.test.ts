// @responsibility healthLoopStatus.cmd — formatHealthLoopStatusMessage 분기 + 등록 회귀 (ADR-0131)
import { describe, it, expect } from 'vitest';
import { formatHealthLoopStatusMessage } from './healthLoopStatus.cmd.js';
import type { HealthSnapshot } from '../../../health/diagnostics.js';

const baseSnapshot = {
  uptimeHours: '1.0',
  memMB: 50,
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
  realDataTokenHours: 12,
  krxTokenConfigured: true,
  krxTokenValid: true,
  krxCircuitState: 'CLOSED',
  krxFailures: 0,
  yahoo: { status: 'OK', detail: 'HAS_CANDIDATES', heartbeat: {} },
  geminiRuntime: {} as unknown,
  volume: { ok: true },
  stream: {} as unknown,
  telegramConfigured: true,
  telegramBotTokenOnly: false,
  telegramChatIdOnly: false,
  lastScanTs: 0,
  lastBuyTs: 0,
  lastScanSummary: null,
  intradayYield: null,
  verdict: '🟢 OK',
} as unknown as HealthSnapshot;

describe('ADR-0131 — formatHealthLoopStatusMessage', () => {
  it('정상 데이터 — 3티어 라인 + KIS + 인증키 D-100 ✅', () => {
    const msg = formatHealthLoopStatusMessage({
      loopState: {
        lastTier1RunAt: '2026-04-30T01:00:00Z',
        lastTier2RunAt: '2026-04-30T00:00:00Z',
        lastTier3RunAt: '2026-04-30T00:00:00Z',
      },
      credentialState: {},
      credentialEvaluations: [
        {
          id: 'KRX_API_KEY',
          label: 'KRX OpenAPI 인증키',
          expiresAt: '2027-04-19',
          daysUntilExpiry: 354,
          threshold: null,
        },
      ],
      postHolidayState: {},
      snapshot: baseSnapshot,
    });
    expect(msg).toContain('🩺');
    expect(msg).toContain('Tier 1');
    expect(msg).toContain('Tier 2');
    expect(msg).toContain('Tier 3');
    expect(msg).toContain('KIS 토큰');
    expect(msg).toContain('워치리스트: 10개');
    expect(msg).toContain('KRX OpenAPI 인증키');
  });

  it('Tier 미실행 시 "미실행" 라벨', () => {
    const msg = formatHealthLoopStatusMessage({
      loopState: {},
      credentialState: {},
      credentialEvaluations: [],
      postHolidayState: {},
      snapshot: baseSnapshot,
    });
    expect(msg).toContain('미실행');
    expect(msg).toContain('등록된 credential 없음');
  });

  it('KIS 토큰 만료 시 🚨 라벨', () => {
    const msg = formatHealthLoopStatusMessage({
      loopState: {},
      credentialState: {},
      credentialEvaluations: [],
      postHolidayState: {},
      snapshot: { ...baseSnapshot, kisTokenHours: 0 } as HealthSnapshot,
    });
    expect(msg).toContain('🚨 만료');
  });

  it('KIS 토큰 잔여 4h 시 ⚠️ 라벨', () => {
    const msg = formatHealthLoopStatusMessage({
      loopState: {},
      credentialState: {},
      credentialEvaluations: [],
      postHolidayState: {},
      snapshot: { ...baseSnapshot, kisTokenHours: 4 } as HealthSnapshot,
    });
    expect(msg).toContain('⚠️');
  });

  it('인증키 D-7 → ⚠️ 라벨', () => {
    const msg = formatHealthLoopStatusMessage({
      loopState: {},
      credentialState: {},
      credentialEvaluations: [
        {
          id: 'KRX_API_KEY',
          label: 'KRX OpenAPI 인증키',
          expiresAt: '2027-04-19',
          daysUntilExpiry: 5,
          threshold: 7,
        },
      ],
      postHolidayState: {},
      snapshot: baseSnapshot,
    });
    expect(msg).toContain('⚠️ KRX');
    expect(msg).toContain('D-5');
  });

  it('Pre-Market Kickstart 마지막 실행 결과 표기', () => {
    const msg = formatHealthLoopStatusMessage({
      loopState: {},
      credentialState: {},
      credentialEvaluations: [],
      postHolidayState: {
        lastFirstDayCheckedAt: '2026-04-27T22:30:00Z',
        lastFirstDayDate: '2026-04-28',
        lastChecks: [
          { name: 'A', status: 'FAIL', detail: 'fail' },
          { name: 'B', status: 'WARN', detail: 'warn' },
          { name: 'C', status: 'PASS', detail: 'pass' },
        ],
      },
      snapshot: baseSnapshot,
    });
    expect(msg).toContain('마지막: 2026-04-28');
    expect(msg).toContain('FAIL 1건');
    expect(msg).toContain('WARN 1건');
  });

  it('alias /hls 등록 검증', async () => {
    const { commandRegistry } = await import('../../commandRegistry.js');
    const cmd = commandRegistry.resolve('/hls');
    expect(cmd).toBeDefined();
    expect(cmd?.name).toBe('/health_loop_status');
  });
});
