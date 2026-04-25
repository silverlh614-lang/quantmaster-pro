// @responsibility: metaCommands.ts 회귀 테스트 — parser/keyboard/handler/now verdict 우선순위 + help message.
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  META_COMMAND_REGISTRY,
  buildHelpMessage,
  buildMetaInlineKeyboard,
  buildNowKeyboard,
  composeNowVerdict,
  encodeMetaCallback,
  handleMetaCommand,
  parseMetaCallback,
  type InlineKeyboardMarkup,
} from './metaCommands.js';

import * as state from '../state.js';
import * as macroRepo from '../persistence/macroStateRepo.js';
import * as orchestrator from '../orchestrator/tradingOrchestrator.js';
import * as scanner from '../trading/signalScanner.js';

// ────────────────────────────────────────────────────────────────────────────
// composeNowVerdict 테스트는 외부 모듈을 spy 로 stub. 각 it 마다 reset.
// ────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
  // 기본값: 정상 운영 (verdict = 🟢 OK)
  vi.spyOn(state, 'getEmergencyStop').mockReturnValue(false);
  vi.spyOn(state, 'getDataIntegrityBlocked').mockReturnValue(false);
  vi.spyOn(state, 'getAutoTradePaused').mockReturnValue(false);
  vi.spyOn(macroRepo, 'loadMacroState').mockReturnValue({
    regime: 'R3_BULL_TREND',
    mhs: 67,
  } as ReturnType<typeof macroRepo.loadMacroState>);
  vi.spyOn(orchestrator, 'getShadowTrades').mockReturnValue([]);
  // getLastBuySignalAt 는 미설정 시 0 을 반환한다 (scanDiagnostics.ts SSOT).
  vi.spyOn(scanner, 'getLastBuySignalAt').mockReturnValue(0);
});

describe('parseMetaCallback', () => {
  it('valid meta:<cmd>:<nonce> → { targetCmd, nonce }', () => {
    expect(parseMetaCallback('meta:watchlist:abc123')).toEqual({
      targetCmd: '/watchlist',
      nonce: 'abc123',
    });
  });

  it('alphanumeric nonce + colon-separated parts preserved', () => {
    expect(parseMetaCallback('meta:learning_status:nonceXY:extra')).toEqual({
      targetCmd: '/learning_status',
      nonce: 'nonceXY:extra',
    });
  });

  it('non-meta prefix → null', () => {
    expect(parseMetaCallback('op_override:RELAX:nonce')).toBeNull();
    expect(parseMetaCallback('buy_approval:abc')).toBeNull();
  });

  it('missing nonce part → null', () => {
    expect(parseMetaCallback('meta:watchlist')).toBeNull();
  });

  it('invalid command chars (uppercase / dash) → null', () => {
    expect(parseMetaCallback('meta:WatchList:nonce')).toBeNull();
    expect(parseMetaCallback('meta:watch-list:nonce')).toBeNull();
  });

  it('empty data → null', () => {
    expect(parseMetaCallback('')).toBeNull();
  });
});

describe('encodeMetaCallback', () => {
  it('strips leading slash and prefixes with meta:', () => {
    expect(encodeMetaCallback('/watchlist', 'abc')).toBe('meta:watchlist:abc');
    expect(encodeMetaCallback('pos', 'abc')).toBe('meta:pos:abc');
  });

  it('encode → parse roundtrip preserves command and nonce', () => {
    const encoded = encodeMetaCallback('/learning_status', 'xyz789');
    const parsed = parseMetaCallback(encoded);
    expect(parsed).toEqual({ targetCmd: '/learning_status', nonce: 'xyz789' });
  });
});

describe('buildMetaInlineKeyboard', () => {
  it('valid spec produces correct row count and callback_data shape', () => {
    const kb = buildMetaInlineKeyboard(META_COMMAND_REGISTRY['/watch'], 'n1');
    expect(kb.inline_keyboard.length).toBe(3); // 3 rows in /watch spec
    expect(kb.inline_keyboard[0][0]).toEqual({
      text: '/watchlist',
      callback_data: 'meta:watchlist:n1',
    });
  });

  it('throws when row exceeds 3-button mobile cap', () => {
    expect(() =>
      buildMetaInlineKeyboard(
        {
          title: 'T',
          description: 'D',
          rows: [['/a', '/b', '/c', '/d']],
        },
        'n',
      ),
    ).toThrow(/exceeds 3 buttons/);
  });

  it('all 5 registry entries have rows ≤ 3 buttons (mobile UX guard)', () => {
    for (const [name, spec] of Object.entries(META_COMMAND_REGISTRY)) {
      for (const row of spec.rows) {
        expect(row.length, `${name} row size`).toBeLessThanOrEqual(3);
      }
    }
  });

  it('all callback_data start with meta: prefix', () => {
    const kb = buildMetaInlineKeyboard(META_COMMAND_REGISTRY['/positions'], 'n2');
    for (const row of kb.inline_keyboard) {
      for (const btn of row) {
        expect(btn.callback_data.startsWith('meta:')).toBe(true);
      }
    }
  });
});

describe('META_COMMAND_REGISTRY', () => {
  it('contains exactly the 5 documented meta commands (/now is composed separately)', () => {
    const keys = Object.keys(META_COMMAND_REGISTRY).sort();
    expect(keys).toEqual([
      '/admin',
      '/control',
      '/learning',
      '/positions',
      '/watch',
    ]);
  });

  it('every alias references a single legacy command (no duplicates across registry)', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const spec of Object.values(META_COMMAND_REGISTRY)) {
      for (const row of spec.rows) {
        for (const cmd of row) {
          if (seen.has(cmd)) dupes.push(cmd);
          seen.add(cmd);
        }
      }
    }
    expect(dupes, `duplicate aliases: ${dupes.join(',')}`).toEqual([]);
  });
});

describe('composeNowVerdict — priority chain', () => {
  it('🔴 STOP when emergency stop ON (highest priority)', () => {
    vi.spyOn(state, 'getEmergencyStop').mockReturnValue(true);
    vi.spyOn(state, 'getDataIntegrityBlocked').mockReturnValue(true); // also blocked
    vi.spyOn(state, 'getAutoTradePaused').mockReturnValue(true); // also paused
    expect(composeNowVerdict()).toContain('🔴 STOP');
  });

  it('🔴 BLOCK when only data integrity blocked', () => {
    vi.spyOn(state, 'getDataIntegrityBlocked').mockReturnValue(true);
    expect(composeNowVerdict()).toContain('🔴 BLOCK');
  });

  it('🟡 PAUSE when only soft pause set', () => {
    vi.spyOn(state, 'getAutoTradePaused').mockReturnValue(true);
    expect(composeNowVerdict()).toContain('🟡 PAUSE');
  });

  it('🟡 HOLD when regime = R6_DEFENSE', () => {
    vi.spyOn(macroRepo, 'loadMacroState').mockReturnValue({
      regime: 'R6_DEFENSE',
      mhs: 25,
    } as ReturnType<typeof macroRepo.loadMacroState>);
    expect(composeNowVerdict()).toContain('🟡 HOLD');
  });

  it('🟢 OK on default normal state', () => {
    const verdict = composeNowVerdict();
    expect(verdict).toContain('🟢 OK');
    expect(verdict).toContain('R3_BULL_TREND');
    expect(verdict).toContain('MHS 67');
    expect(verdict).toContain('활성 0/8');
  });

  it('마지막 신호 KST 시각이 포맷되어 노출', () => {
    // 2026-04-25T00:23:00Z = KST 09:23
    vi.spyOn(scanner, 'getLastBuySignalAt').mockReturnValue(
      new Date('2026-04-25T00:23:00Z').getTime(),
    );
    expect(composeNowVerdict()).toContain('09:23 KST');
  });
});

describe('handleMetaCommand', () => {
  function captureReply(): {
    fn: (text: string, mk?: InlineKeyboardMarkup) => Promise<void>;
    calls: Array<{ text: string; markup?: InlineKeyboardMarkup }>;
  } {
    const calls: Array<{ text: string; markup?: InlineKeyboardMarkup }> = [];
    return {
      fn: async (text, markup) => {
        calls.push({ text, markup });
      },
      calls,
    };
  }

  it('/now sends verdict + 3-button shortcut keyboard', async () => {
    const { fn, calls } = captureReply();
    await handleMetaCommand('/now', fn);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('[NOW]');
    expect(calls[0].text).toContain('🟢 OK');
    expect(calls[0].markup?.inline_keyboard[0]).toHaveLength(3);
  });

  it('/watch sends registry title + inline keyboard', async () => {
    const { fn, calls } = captureReply();
    await handleMetaCommand('/watch', fn);
    expect(calls[0].text).toContain('워치리스트');
    expect(calls[0].markup?.inline_keyboard.length).toBe(3);
  });

  it('/positions, /learning, /control, /admin all return non-empty keyboards', async () => {
    for (const name of ['/positions', '/learning', '/control', '/admin']) {
      const { fn, calls } = captureReply();
      await handleMetaCommand(name, fn);
      expect(calls[0].markup?.inline_keyboard.length, `${name} rows`).toBeGreaterThan(0);
    }
  });

  it('unknown meta command → graceful "❓" message, no throw', async () => {
    const { fn, calls } = captureReply();
    await handleMetaCommand('/unknown_meta', fn);
    expect(calls[0].text).toMatch(/❓|알 수 없는/);
    expect(calls[0].markup).toBeUndefined();
  });
});

describe('buildNowKeyboard', () => {
  it('contains /status, /positions, /control buttons', () => {
    const kb = buildNowKeyboard('n');
    const labels = kb.inline_keyboard[0].map((b) => b.text);
    expect(labels).toEqual(['/status', '/positions', '/control']);
    expect(kb.inline_keyboard[0][0].callback_data).toBe('meta:status:n');
  });
});

describe('buildHelpMessage', () => {
  it('contains all 8 meta menu entries (/help /status /now /watch /positions /learning /control /admin)', () => {
    const help = buildHelpMessage();
    for (const cmd of [
      '/help',
      '/status',
      '/now',
      '/watch',
      '/positions',
      '/learning',
      '/control',
      '/admin',
    ]) {
      expect(help, `missing ${cmd}`).toContain(cmd);
    }
  });

  it('mentions backward-compat for legacy 51 commands', () => {
    expect(buildHelpMessage()).toMatch(/51개|직접 입력|alias/);
  });

  it('Top 5 미전달 시 — 개인화 섹션 미노출 (Stage 3 backward-compat)', () => {
    const help = buildHelpMessage();
    expect(help).not.toContain('자주 쓰는 명령 Top');
  });

  it('Top 5 전달 시 — 개인화 섹션 노출 + 카운트 표시 + 메타 메뉴 위에 위치', () => {
    const help = buildHelpMessage([
      { name: '/status', count: 142 },
      { name: '/pos', count: 89 },
      { name: '/pnl', count: 67 },
    ]);
    expect(help).toContain('자주 쓰는 명령 Top 3');
    expect(help).toContain('1. /status — 142회');
    expect(help).toContain('2. /pos — 89회');
    expect(help).toContain('3. /pnl — 67회');
    // 메타 메뉴 헤더 위에 위치하는지 검증.
    const topIdx = help.indexOf('자주 쓰는 명령 Top');
    const menuIdx = help.indexOf('자주 쓰는 메뉴');
    expect(topIdx).toBeLessThan(menuIdx);
  });

  it('Top 5 빈 배열 → 미노출 (Stage 3 신규 사용자 보호)', () => {
    expect(buildHelpMessage([])).not.toContain('자주 쓰는 명령 Top');
  });

  it('Top 5 가 6개 이상이어도 5개로 절삭', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({
      name: `/cmd${i}`,
      count: 10 - i,
    }));
    const help = buildHelpMessage(six);
    expect(help).toContain('Top 5');
    expect(help).toContain('5. /cmd4 — 6회');
    expect(help).not.toContain('6. /cmd5');
  });
});
