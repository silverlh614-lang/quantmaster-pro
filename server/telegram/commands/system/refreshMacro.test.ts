// @responsibility refreshMacro.cmd 회귀 테스트 (ADR 미생성, 사용자 명시 정책 정합).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock 은 import 보다 hoisted — refreshMarketRegimeVars 본체 호출 0건 격리.
vi.mock('../../../trading/marketDataRefresh.js', () => ({
  refreshMarketRegimeVars: vi.fn().mockResolvedValue({ mhs: 50, regime: 'GREEN' }),
}));

// commandRegistry 격리 — 다중 register 방지.
vi.mock('../../commandRegistry.js', () => {
  const registry = new Map();
  return {
    commandRegistry: {
      register: (cmd: { name: string }) => registry.set(cmd.name, cmd),
      resolve: (name: string) => registry.get(name),
      all: () => Array.from(registry.values()),
      clear: () => registry.clear(),
    },
  };
});

import { refreshMarketRegimeVars } from '../../../trading/marketDataRefresh.js';
import refreshMacro, {
  __resetRefreshMacroRateLimitForTests,
  isRefreshMacroDisabled,
} from './refreshMacro.cmd.js';

describe('refreshMacro.cmd (ADR 미생성, 사용자 명시 정책)', () => {
  beforeEach(() => {
    __resetRefreshMacroRateLimitForTests();
    vi.clearAllMocks();
    delete process.env.REFRESH_MACRO_CMD_DISABLED;
  });

  afterEach(() => {
    delete process.env.REFRESH_MACRO_CMD_DISABLED;
  });

  describe('메타데이터', () => {
    it('name + aliases 등록', () => {
      expect(refreshMacro.name).toBe('/refresh_macro');
      expect(refreshMacro.aliases).toEqual(['/macro_refresh', '/refresh_market']);
    });

    it('category=SYS, riskLevel=1, visibility=ADMIN', () => {
      expect(refreshMacro.category).toBe('SYS');
      expect(refreshMacro.riskLevel).toBe(1);
      expect(refreshMacro.visibility).toBe('ADMIN');
    });

    it('description + usage 명시', () => {
      expect(refreshMacro.description).toContain('시장 지표 강제 갱신');
      expect(refreshMacro.usage).toBe('/refresh_macro');
    });
  });

  describe('isRefreshMacroDisabled ENV 정확 비교 (ADR-0157)', () => {
    it('default OFF — 미설정 false', () => {
      expect(isRefreshMacroDisabled()).toBe(false);
    });

    it('"true" 정확 매칭만 활성', () => {
      process.env.REFRESH_MACRO_CMD_DISABLED = 'true';
      expect(isRefreshMacroDisabled()).toBe(true);
    });

    it('"1"/"TRUE"/"yes" 거부 (ADR-0157 정확 비교)', () => {
      for (const v of ['1', 'TRUE', 'yes', 'True']) {
        process.env.REFRESH_MACRO_CMD_DISABLED = v;
        expect(isRefreshMacroDisabled()).toBe(false);
      }
    });

    it('"false"/"" 미적용', () => {
      process.env.REFRESH_MACRO_CMD_DISABLED = 'false';
      expect(isRefreshMacroDisabled()).toBe(false);
      process.env.REFRESH_MACRO_CMD_DISABLED = '';
      expect(isRefreshMacroDisabled()).toBe(false);
    });
  });

  describe('execute 정상 흐름', () => {
    it('refreshMarketRegimeVars 호출 + 시작/완료 메시지 2건', async () => {
      const replies: string[] = [];
      const reply = async (msg: string) => {
        replies.push(msg);
      };

      await refreshMacro.execute({ args: [], reply });

      expect(refreshMarketRegimeVars).toHaveBeenCalledTimes(1);
      expect(replies).toHaveLength(2);
      expect(replies[0]).toContain('시장 지표 강제 갱신 시작');
      expect(replies[1]).toContain('시장 지표 갱신 완료');
      expect(replies[1]).toContain('/sector_energy_diag');
    });
  });

  describe('5분 rate-limit 가드', () => {
    it('5분 이내 재호출 차단 + 카운트다운', async () => {
      const replies: string[] = [];
      const reply = async (msg: string) => {
        replies.push(msg);
      };

      await refreshMacro.execute({ args: [], reply });
      replies.length = 0;

      await refreshMacro.execute({ args: [], reply });

      expect(refreshMarketRegimeVars).toHaveBeenCalledTimes(1);
      expect(replies[0]).toContain('5분 이내 재호출 차단');
      expect(replies[0]).toMatch(/\d+초 후/);
    });

    it('reset 후 재실행 가능', async () => {
      const reply = async () => {};
      await refreshMacro.execute({ args: [], reply });
      __resetRefreshMacroRateLimitForTests();
      await refreshMacro.execute({ args: [], reply });
      expect(refreshMarketRegimeVars).toHaveBeenCalledTimes(2);
    });
  });

  describe('ENV 비활성화', () => {
    it('REFRESH_MACRO_CMD_DISABLED=true 시 refreshMarketRegimeVars 호출 0건', async () => {
      process.env.REFRESH_MACRO_CMD_DISABLED = 'true';
      const replies: string[] = [];
      const reply = async (msg: string) => {
        replies.push(msg);
      };

      await refreshMacro.execute({ args: [], reply });

      expect(refreshMarketRegimeVars).toHaveBeenCalledTimes(0);
      expect(replies[0]).toContain('명령 비활성');
    });
  });

  describe('throw graceful', () => {
    it('refreshMarketRegimeVars throw 시 ❌ 메시지 + 텔레그램 응답 차단 안 됨', async () => {
      vi.mocked(refreshMarketRegimeVars).mockRejectedValueOnce(new Error('KIS timeout'));

      const replies: string[] = [];
      const reply = async (msg: string) => {
        replies.push(msg);
      };

      await refreshMacro.execute({ args: [], reply });

      expect(replies).toHaveLength(2);
      expect(replies[1]).toContain('❌');
      expect(replies[1]).toContain('KIS timeout');
    });
  });
});
