/**
 * @responsibility ADR-0128 dataHoldRolePolicy 회귀 테스트 — HELD_POSITION blockSell=false 절대 가드
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type DataHoldRole,
  isDataHoldRolePolicyDisabled,
  resolveDataHoldAction,
} from './dataHoldRolePolicy.js';

const ENV_KEY = 'DATA_HOLD_ROLE_POLICY_DISABLED';

beforeEach(() => {
  delete process.env[ENV_KEY];
});

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe('dataHoldRolePolicy — 3 역할 매트릭스 SSOT', () => {
  it('BUY_CANDIDATE — blockBuy=true + blockSell=false + uiMarker=NONE', () => {
    const action = resolveDataHoldAction('BUY_CANDIDATE');
    expect(action.blockBuy).toBe(true);
    expect(action.blockSell).toBe(false); // N/A — 안전 default
    expect(action.blockAlert).toBe(true);
    expect(action.uiMarker).toBe('NONE');
    expect(action.reason).toContain('매수 후보');
  });

  it('WATCHLIST — blockBuy=true + blockSell=false + uiMarker=PENDING_VERIFICATION', () => {
    const action = resolveDataHoldAction('WATCHLIST');
    expect(action.blockBuy).toBe(true);
    expect(action.blockSell).toBe(false);
    expect(action.blockAlert).toBe(true);
    expect(action.uiMarker).toBe('PENDING_VERIFICATION');
    expect(action.reason).toContain('워치리스트');
  });

  it('HELD_POSITION — blockBuy=true + blockSell=false (절대 규칙) + uiMarker=PENDING_VERIFICATION', () => {
    const action = resolveDataHoldAction('HELD_POSITION');
    expect(action.blockBuy).toBe(true);
    // 절대 규칙 — exit 경로 보존
    expect(action.blockSell).toBe(false);
    expect(action.blockAlert).toBe(true);
    expect(action.uiMarker).toBe('PENDING_VERIFICATION');
    expect(action.reason).toContain('exit 경로');
  });

  it('HELD_POSITION blockSell=false 절대 규칙 — 어떤 호출에서도 true 반환 안 됨', () => {
    // 본 가드가 깨지면 보유 포지션 손절 차단 위험. 100회 호출 모두 false 검증.
    for (let i = 0; i < 100; i++) {
      const action = resolveDataHoldAction('HELD_POSITION');
      expect(action.blockSell).toBe(false);
    }
  });
});

describe('dataHoldRolePolicy — ENV 우회', () => {
  it('DATA_HOLD_ROLE_POLICY_DISABLED=true — 모든 역할 안전 default + isDisabled=true', () => {
    process.env[ENV_KEY] = 'true';
    expect(isDataHoldRolePolicyDisabled()).toBe(true);

    const roles: DataHoldRole[] = ['BUY_CANDIDATE', 'WATCHLIST', 'HELD_POSITION'];
    for (const role of roles) {
      const action = resolveDataHoldAction(role);
      expect(action.blockBuy).toBe(true);
      // 안전 default — exit 항상 보존
      expect(action.blockSell).toBe(false);
      expect(action.uiMarker).toBe('NONE'); // 우회 시 PENDING 마킹도 비활성
      expect(action.reason).toContain('disabled');
    }
  });
});
