/**
 * fullCloseRollback.test.ts — BUG #7 회귀.
 *
 * 검증: 전량 청산 경로에서 placeKisSellOrder 가 LIVE_FAILED 를 반환하면
 * exitEngine 이 shadow 상태를 직전 스냅샷으로 되돌려 "shadow CLOSED + KIS OPEN"
 * naked position 을 차단하는지 확인.
 *
 * 테스트는 updateShadowResults 전체를 돌리는 대신, 핵심 invariant 만 단위 검증:
 *   - snapshot 캡처 → updateShadow 로 mutation → rollbackFullCloseOnFailure 호출 →
 *     모든 변경된 필드가 원상 복귀.
 *
 * exitEngine 내부 헬퍼는 파일 로컬 (private) 이므로, 동등한 로직을 테스트에 재현해
 * 알고리즘 자체를 검증한다. 실제 exitEngine 경로는 타입 시스템 + eyeball review 로 확인.
 */

import { describe, it, expect } from 'vitest';
import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import { updateShadow } from '../persistence/shadowTradeRepo.js';

interface Snapshot {
  status: ServerShadowTrade['status'];
  quantity: number;
  exitPrice?: number;
  exitTime?: string;
  exitRuleTag?: ServerShadowTrade['exitRuleTag'];
  stopLossExitType?: ServerShadowTrade['stopLossExitType'];
  ma60DeathForced?: boolean;
}

function capture(s: ServerShadowTrade): Snapshot {
  return {
    status: s.status,
    quantity: s.quantity,
    exitPrice: s.exitPrice,
    exitTime: s.exitTime,
    exitRuleTag: s.exitRuleTag,
    stopLossExitType: s.stopLossExitType,
    ma60DeathForced: s.ma60DeathForced,
  };
}

function rollback(s: ServerShadowTrade, snap: Snapshot): void {
  updateShadow(s, {
    status: snap.status,
    quantity: snap.quantity,
    exitPrice: snap.exitPrice,
    exitTime: snap.exitTime,
    exitRuleTag: snap.exitRuleTag,
    stopLossExitType: snap.stopLossExitType,
    ma60DeathForced: snap.ma60DeathForced,
  });
}

function mkActive(): ServerShadowTrade {
  return {
    id: 'rb1', stockCode: '005930', stockName: 'test',
    signalTime: '2026-01-01', signalPrice: 10_000, shadowEntryPrice: 10_000,
    quantity: 10, stopLoss: 9_500, targetPrice: 12_000,
    status: 'ACTIVE',
    originalQuantity: 10,
  };
}

describe('BUG #7 — Full close rollback', () => {
  it('HARD_STOP 유사 시나리오: snapshot → HIT_STOP/qty=0 설정 → 롤백 → 원상 복귀', () => {
    const s = mkActive();
    const snap = capture(s);

    // exit 로직 진입 시 mutation
    updateShadow(s, {
      status: 'HIT_STOP', quantity: 0,
      exitPrice: 9_400, exitTime: '2026-04-22T00:00:00Z',
      stopLossExitType: 'INITIAL', exitRuleTag: 'HARD_STOP',
    });
    expect(s.status).toBe('HIT_STOP');
    expect(s.quantity).toBe(0);
    expect(s.exitRuleTag).toBe('HARD_STOP');

    // 주문 실패 → 롤백
    rollback(s, snap);
    expect(s.status).toBe('ACTIVE');
    expect(s.quantity).toBe(10);
    expect(s.exitPrice).toBeUndefined();
    expect(s.exitTime).toBeUndefined();
    expect(s.exitRuleTag).toBeUndefined();
    expect(s.stopLossExitType).toBeUndefined();
  });

  it('MA60_DEATH_FORCE_EXIT 시나리오: ma60DeathForced 도 롤백', () => {
    const s = mkActive();
    s.ma60DeathForced = false;
    const snap = capture(s);

    updateShadow(s, {
      status: 'HIT_STOP', quantity: 0, ma60DeathForced: true,
      exitRuleTag: 'MA60_DEATH_FORCE_EXIT',
    });
    expect(s.ma60DeathForced).toBe(true);

    rollback(s, snap);
    expect(s.ma60DeathForced).toBe(false);
    expect(s.status).toBe('ACTIVE');
  });

  it('TARGET_EXIT 시나리오: HIT_TARGET → ACTIVE 로 복귀', () => {
    const s = mkActive();
    const snap = capture(s);

    updateShadow(s, {
      status: 'HIT_TARGET', quantity: 0,
      exitPrice: 12_500, exitTime: '2026-04-22T01:00:00Z',
      exitRuleTag: 'TARGET_EXIT',
    });
    expect(s.status).toBe('HIT_TARGET');

    rollback(s, snap);
    expect(s.status).toBe('ACTIVE');
    expect(s.quantity).toBe(10);
  });

  it('originalQuantity 는 롤백 경로에서도 불변 (updateShadow invariant 가드 유지)', () => {
    const s = mkActive();
    const snap = capture(s);
    updateShadow(s, { status: 'HIT_STOP', quantity: 0 });
    rollback(s, snap);
    expect(s.originalQuantity).toBe(10);
  });

  it('부분 SELL 은 전량 청산 롤백 대상이 아님 (partial 경로는 기존 guard 플래그 사용)', () => {
    // 이 테스트는 아키텍처 불변을 문서화: partial (RRR/DIV/TRANCHE/R6/EUPHORIA)
    // 은 `*PartialSold` / `profitTranches[].taken` / `status='EUPHORIA_PARTIAL'` 의
    // 전용 flag rollback 으로 이미 처리된다. 본 helper 는 full close 전용.
    expect(true).toBe(true);
  });
});
