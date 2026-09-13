// @responsibility: metaCommands.ts 회귀 테스트 — parser/keyboard/handler/now verdict 우선순위 + help message.
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  META_COMMAND_REGISTRY,
  buildHelpMessage,
  buildMetaInlineKeyboard,
  buildNowKeyboard,
  composeNowVerdict,
  encodeMetaCallback,
  ensureNowReplyPayload,
  handleMetaCommand,
  parseMetaCallback,
  type InlineKeyboardMarkup,
} from './metaCommands.js';

import * as state from '../state.js';
import * as macroRepo from '../persistence/macroStateRepo.js';
import * as orchestrator from '../orchestrator/tradingOrchestrator.js';
import * as scanner from '../trading/signalScanner.js';
import * as regimeRepo from '../persistence/regimeTransitionStateRepo.js';
import * as paperRunner from '../trading/paper/paperExperimentRunner.js';
import * as paperBotRepo from '../persistence/paperBotRepo.js';
import * as paperBot from '../alerts/paperBot.js';
import * as regimeResolver from '../trading/regime/regimeResolver.js';

// ────────────────────────────────────────────────────────────────────────────
// composeNowVerdict 테스트는 외부 모듈을 spy 로 stub. 각 it 마다 reset.
// ────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(state, 'getTradingMode').mockReturnValue('PAPER');
  vi.spyOn(paperRunner, 'getPaperExperimentView').mockReturnValue({
    mode: 'SHADOW', strategyVersion: 'shadow-baseline-v1', totalCount: 4, openCount: 2, completedCount: 2,
    experiments: [], groups: [], outcomes: [],
    lastRun: { snapshotId: 'snapshot-test', asOf: '2026-04-25T00:23:00.000Z', candidateCount: 10, observedCount: 8, missingPriceCount: 2,
      openedCount: 4, completedCount: 2, marketOpen: true, issues: [] },
  });
  vi.spyOn(paperBotRepo, 'loadPaperBotState').mockReturnValue({
    schemaVersion: 1, initializedAt: null, lastCheckedAt: null, health: 'OK', notifiedHealth: 'OK', seenEvents: {}, messages: [],
  });
  vi.spyOn(paperBot, 'recentPaperNews').mockReturnValue([]);

  // 기본값: 정상 운영 (verdict = 🟢 OK)
  vi.spyOn(state, 'getEmergencyStop').mockReturnValue(false);
  vi.spyOn(state, 'getDataIntegrityBlocked').mockReturnValue(false);
  vi.spyOn(state, 'getAutoTradePaused').mockReturnValue(false);
  vi.spyOn(macroRepo, 'loadMacroState').mockReturnValue({
    regime: 'R3_BULL_TREND',
    mhs: 67,
    updatedAt: new Date().toISOString(),
  } as ReturnType<typeof macroRepo.loadMacroState>);
  vi.spyOn(orchestrator, 'getShadowTrades').mockReturnValue([]);
  // getLastBuySignalAt 는 미설정 시 0 을 반환한다 (scanDiagnostics.ts SSOT).
  vi.spyOn(scanner, 'getLastBuySignalAt').mockReturnValue(0);
  vi.spyOn(regimeRepo, 'loadRegimeTransitionState').mockReturnValue(
    regimeRepo.defaultRegimeTransitionState(new Date().toISOString()),
  );
  vi.spyOn(regimeRepo, 'saveRegimeTransitionState').mockReturnValue(undefined);
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

describe('composeNowVerdict — 현재 Shadow 관측·건강 상태', () => {
  beforeEach(() => { vi.spyOn(state, 'getTradingMode').mockReturnValue('SHADOW'); });
  it('실주문 비상정지와 독립 관측 상태를 함께 표시한다', () => {
    vi.spyOn(state, 'getEmergencyStop').mockReturnValue(true);
    const text = composeNowVerdict();
    expect(text).toContain('실주문 비상정지 ON');
    expect(text).toContain('자동 관측 활성');
    expect(text).toContain('후보 10');
  });
  it('기존 데이터 게이트가 신규 관측 기록을 숨기지 않는다', () => {
    vi.spyOn(state, 'getDataIntegrityBlocked').mockReturnValue(true);
    expect(composeNowVerdict()).toContain('현재가 확인 8');
  });
  it('사용자의 관측 일시정지를 표시한다', () => {
    vi.spyOn(state, 'getAutoTradePaused').mockReturnValue(true);
    expect(composeNowVerdict()).toContain('자동 관측 일시정지');
  });
  it('폐기한 레짐 resolver를 호출하지 않는다', () => {
    vi.spyOn(regimeResolver, 'resolveRegimeSnapshot').mockImplementation(() => { throw new Error('REGIME_RETIRED'); });
    expect(composeNowVerdict()).toContain('Shadow 현재 현황');
    expect(regimeResolver.resolveRegimeSnapshot).not.toHaveBeenCalled();
  });
  it('현재 관측 수와 봇 건강 상태를 표시한다', () => {
    const text = composeNowVerdict();
    expect(text).toContain('누적 4');
    expect(text).toContain('관측 상태 정상');
    expect(text).not.toContain('Effective regime:');
  });
  it('오래된 R6 매크로 기록을 현재 매매 제한으로 표시하지 않는다', () => {
    vi.spyOn(macroRepo, 'loadMacroState').mockReturnValue({ regime: 'R6_DEFENSE', mhs: 20 } as any);
    expect(composeNowVerdict()).not.toContain('R6_DEFENSE');
    expect(macroRepo.loadMacroState).not.toHaveBeenCalled();
  });
  it('하나의 현재 원장 조회에서 보고서를 만든다', () => {
    composeNowVerdict();
    expect(paperRunner.getPaperExperimentView).toHaveBeenCalledExactlyOnceWith(true);
    expect(paperBotRepo.loadPaperBotState).toHaveBeenCalledOnce();
  });
  it('마지막 관측의 한국 시각을 표시한다', () => {
    expect(composeNowVerdict(new Date(), { mode: 'DEBUG', includeRaw: true })).toContain('09:23');
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
    expect(calls[0].text).toContain('현재가 확인 8');
    expect(calls[0].text).not.toContain('rawData:');
    expect(calls[0].text).not.toContain('macroState:');
    expect(calls[0].markup?.inline_keyboard[0]).toHaveLength(3);
  });

  it('/now_debug sends raw detail view + 3-button shortcut keyboard', async () => {
    const { fn, calls } = captureReply();
    await handleMetaCommand('/now_debug', fn);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('[NOW DEBUG]');
    expect(calls[0].text).toContain('Shadow 알림 봇');
    expect(calls[0].text).toContain('관측 상태 정상');
    expect(calls[0].text.trim().length).toBeGreaterThan(0);
    expect(calls[0].markup?.inline_keyboard[0]).toHaveLength(3);
  });

  it('guards /now_debug against empty renderer payloads', () => {
    expect(ensureNowReplyPayload('', { mode: 'DEBUG', includeRaw: true })).toContain('NOW DEBUG render failed');
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
  it('contains compact NOW and debug NOW help entries', () => {
    const help = buildHelpMessage();
    for (const cmd of [
      '/help',
      '/status',
      '/now',
      '/now_debug',
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
