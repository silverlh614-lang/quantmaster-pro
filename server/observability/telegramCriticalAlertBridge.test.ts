import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn(() => Promise.resolve(1)),
}));

import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { clearWarnDedupStore } from './warnDedupStore.js';
import { emitTelegramCriticalAlert, formatTelegramCriticalWarn } from './telegramCriticalAlertBridge.js';

describe('telegramCriticalAlertBridge', () => {
  beforeEach(() => {
    clearWarnDedupStore();
    vi.mocked(sendTelegramAlert).mockClear();
  });

  it('formats compact P0 alert and deduplicates telegram delivery', () => {
    const payload = {
      priority: 'P0' as const,
      domain: 'EXECUTION' as const,
      code: 'LIVE_SELL_ORDER_FAILED',
      message: 'failed',
      executionImpact: 'LIVE_SELL_BLOCKED' as const,
      mode: 'LIVE' as const,
      symbol: '005930',
      dedupKey: 'railway-dedup',
      ttlSec: 30,
    };

    expect(formatTelegramCriticalWarn(payload)).toContain('🚨 P0 EXECUTION');
    emitTelegramCriticalAlert(payload);
    emitTelegramCriticalAlert(payload);

    expect(sendTelegramAlert).toHaveBeenCalledTimes(1);
    expect(sendTelegramAlert).toHaveBeenCalledWith(
      expect.stringContaining('code=LIVE_SELL_ORDER_FAILED'),
      expect.objectContaining({
        priority: 'CRITICAL',
        dedupeKey: 'telegram:p0:LIVE_SELL_ORDER_FAILED:005930:LIVE',
      }),
    );
  });

  // ADR-0573 후속: 한 incident 의 여러 P0 코드가 ackFamilyKey 로 묶여 ack/에스컬레이션
  // 중복을 차단하는지 검증. (사용자 보고: "[T1 60분 미확인 에스컬레이션]" 이중 발생)
  it('correlationId 가 있으면 incident 단위 ackFamilyKey 를 전파 (코드 달라도 동일 패밀리)', () => {
    const base = {
      priority: 'P0' as const,
      domain: 'EXECUTION' as const,
      executionImpact: 'SHADOW_EXECUTION_DEGRADED' as const,
      mode: 'SHADOW' as const,
      symbol: '011070',
      dedupKey: 'railway-dedup',
      ttlSec: 30,
      correlationId: 'trade-xyz-1',
    };
    emitTelegramCriticalAlert({ ...base, code: 'P0_BUY_SIGNAL_STUCK', message: 'stuck' });
    emitTelegramCriticalAlert({ ...base, code: 'P0_SHADOW_EXECUTION_STUCK', message: 'stuck' });

    // 두 코드는 telegramDedupKey 가 달라 각각 발송되지만, ackFamilyKey 는 동일해야 한다.
    expect(sendTelegramAlert).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(sendTelegramAlert).mock.calls) {
      expect(call[1]).toMatchObject({ ackFamilyKey: 'op_warn_p0:corr:trade-xyz-1' });
    }
  });

  it('correlationId 부재 시 symbol+mode 로 ackFamilyKey 폴백', () => {
    emitTelegramCriticalAlert({
      priority: 'P0', domain: 'EXECUTION', code: 'P0_SHADOW_EXECUTION_STUCK',
      message: 'stuck', executionImpact: 'SHADOW_EXECUTION_DEGRADED', mode: 'SHADOW',
      symbol: '011070', dedupKey: 'd', ttlSec: 30,
    });
    expect(vi.mocked(sendTelegramAlert).mock.calls[0]![1]).toMatchObject({
      ackFamilyKey: 'op_warn_p0:sym:011070:SHADOW',
    });
  });

  it('symbol·correlationId 모두 부재(글로벌 P0) → ackFamilyKey undefined (기존 동작 보존)', () => {
    emitTelegramCriticalAlert({
      priority: 'P0', domain: 'EXECUTION', code: 'P0_GLOBAL_THING',
      message: 'x', executionImpact: 'NONE', dedupKey: 'd', ttlSec: 30,
    });
    expect(vi.mocked(sendTelegramAlert).mock.calls[0]![1]!.ackFamilyKey).toBeUndefined();
  });

  // ADR-0576: SHADOW P0 는 ack 폐루프/60분 에스컬레이션 제외 (불변식 #8).
  describe('ADR-0576 SHADOW P0 ack 루프 제외', () => {
    const orig = process.env.SHADOW_P0_ACK_LOOP_ENABLED;
    afterEach(() => {
      if (orig === undefined) delete process.env.SHADOW_P0_ACK_LOOP_ENABLED;
      else process.env.SHADOW_P0_ACK_LOOP_ENABLED = orig;
    });

    it('SHADOW P0 → requireAck:false (ack 미등록 → 재발송/에스컬레이션 없음)', () => {
      delete process.env.SHADOW_P0_ACK_LOOP_ENABLED;
      emitTelegramCriticalAlert({
        priority: 'P0', domain: 'EXECUTION', code: 'P0_SHADOW_EXECUTION_STUCK',
        message: 'stuck', executionImpact: 'SHADOW_EXECUTION_DEGRADED', mode: 'SHADOW',
        symbol: '011070', dedupKey: 'd', ttlSec: 30,
      });
      expect(vi.mocked(sendTelegramAlert).mock.calls[0]![1]).toMatchObject({ requireAck: false });
    });

    it('LIVE P0 → requireAck 미설정(undefined) → 기존 ack 루프 유지', () => {
      delete process.env.SHADOW_P0_ACK_LOOP_ENABLED;
      emitTelegramCriticalAlert({
        priority: 'P0', domain: 'EXECUTION', code: 'P0_LIVE_EXECUTION_STUCK',
        message: 'stuck', executionImpact: 'LIVE_ORDER_BLOCKED', mode: 'LIVE',
        symbol: '005930', dedupKey: 'd', ttlSec: 30,
      });
      expect(vi.mocked(sendTelegramAlert).mock.calls[0]![1]!.requireAck).toBeUndefined();
    });

    it('SHADOW_P0_ACK_LOOP_ENABLED=true → SHADOW 도 기존 ack 루프 복원(requireAck 미설정)', () => {
      process.env.SHADOW_P0_ACK_LOOP_ENABLED = 'true';
      emitTelegramCriticalAlert({
        priority: 'P0', domain: 'EXECUTION', code: 'P0_SHADOW_EXECUTION_STUCK',
        message: 'stuck', executionImpact: 'SHADOW_EXECUTION_DEGRADED', mode: 'SHADOW',
        symbol: '011070', dedupKey: 'd', ttlSec: 30,
      });
      expect(vi.mocked(sendTelegramAlert).mock.calls[0]![1]!.requireAck).toBeUndefined();
    });
  });
});
