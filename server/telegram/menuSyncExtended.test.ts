// @responsibility buildBotMenuCommandsExtended Telegram menu curation regression tests.
//
// Telegram setMyCommands has a hard 100 command limit. The registry may keep more
// commands than that, so the bot menu should expose a curated control surface
// while /help and direct command dispatch still use the full registry.

import { describe, it, expect, beforeAll } from 'vitest';

// Explicit barrel imports populate commandRegistry in the test environment.
import '../telegram/commands/system/index.js';
import '../telegram/commands/watchlist/index.js';
import '../telegram/commands/positions/index.js';
import '../telegram/commands/alert/index.js';
import '../telegram/commands/learning/index.js';
import '../telegram/commands/control/index.js';
import '../telegram/commands/trade/index.js';
import '../telegram/commands/infra/index.js';

import {
  buildBotMenuCommandsExtended,
  buildBotMenuCommands,
  META_COMMAND_REGISTRY,
  TELEGRAM_MENU_SOFT_CAP,
} from './metaCommands.js';
import { commandRegistry } from './commandRegistry.js';

describe('buildBotMenuCommandsExtended menu curation', () => {
  let extended: ReturnType<typeof buildBotMenuCommandsExtended>;
  let baseLen: number;

  beforeAll(() => {
    extended = buildBotMenuCommandsExtended();
    baseLen = buildBotMenuCommands().length;
  });

  it('keeps the menu below the soft cap while larger than the base menu', () => {
    expect(extended.length).toBeGreaterThan(baseLen);
    expect(extended.length).toBeLessThanOrEqual(TELEGRAM_MENU_SOFT_CAP);
  });

  it('preserves the base prelude and meta menu order', () => {
    const base = buildBotMenuCommands();
    expect(extended.slice(0, base.length)).toEqual(base);
  });

  it('keeps core operator commands visible while registry remains larger than the menu', () => {
    const extendedCmds = new Set(extended.map((e) => e.command));
    for (const name of ['status', 'health', 'supply_health', 'ghost_inspect', 'scheduler', 'learning_weights_reset', 'scan', 'scan_blockers_gate0', 'scan_blockers_gate1', 'scan_blockers_gate2', 'scan_blockers_gate3', 'buy', 'sell']) {
      expect(extendedCmds.has(name)).toBe(true);
    }
    expect(commandRegistry.all().length).toBeGreaterThan(extended.length - baseLen);
  });

  it('exposes counterfactual outcome board commands for Telegram autocomplete', () => {
    const extendedCmds = new Set(extended.map((e) => e.command));
    for (const name of [
      'counterfactual',
      'counterfactual_today',
      'counterfactual_gate1',
      'counterfactual_gate2',
      'counterfactual_gate3',
      'counterfactual_missed',
      'counterfactual_review',
      'counterfactual_debug',
    ]) {
      expect(extendedCmds.has(name)).toBe(true);
    }
  });

  it('does not expose aliases as duplicate menu commands', () => {
    const cmds = extended.map((e) => e.command);
    const dupes = cmds.filter((c, i) => cmds.indexOf(c) !== i);
    expect(dupes).toEqual([]);
  });

  it('emits Telegram-compatible command names', () => {
    for (const e of extended) {
      expect(e.command).toMatch(/^[a-z0-9_]{1,32}$/);
    }
  });

  it('emits non-empty descriptions within Telegram limits', () => {
    for (const e of extended) {
      expect(e.description.length).toBeGreaterThan(0);
      expect(e.description.length).toBeLessThanOrEqual(256);
    }
  });

  it('always includes meta registry entries and prelude commands', () => {
    const metaKeys = Object.keys(META_COMMAND_REGISTRY).map((k) => k.replace(/^\//, ''));
    const prelude = ['help', 'status', 'now'];
    const cmds = new Set(extended.map((e) => e.command));
    for (const k of [...metaKeys, ...prelude]) {
      expect(cmds.has(k)).toBe(true);
    }
  });

  it('is idempotent', () => {
    const a = buildBotMenuCommandsExtended();
    const b = buildBotMenuCommandsExtended();
    expect(a).toEqual(b);
  });

  it('serializes to the Telegram setMyCommands payload shape', () => {
    const json = JSON.parse(JSON.stringify({ commands: extended }));
    expect(json.commands).toBeInstanceOf(Array);
    for (const c of json.commands) {
      expect(Object.keys(c).sort()).toEqual(['command', 'description']);
    }
  });

  it('places system commands before emergency commands when both are visible', () => {
    const syscmds = commandRegistry.all()
      .filter((c) => c.category === 'SYS')
      .map((c) => c.name.replace(/^\//, '').toLowerCase());
    const emrcmds = commandRegistry.all()
      .filter((c) => c.category === 'EMR')
      .map((c) => c.name.replace(/^\//, '').toLowerCase());

    if (syscmds.length === 0 || emrcmds.length === 0) return;

    const sysIdx = syscmds.map((c) => extended.findIndex((e) => e.command === c)).filter((i) => i >= 0);
    const emrIdx = emrcmds.map((c) => extended.findIndex((e) => e.command === c)).filter((i) => i >= 0);

    if (sysIdx.length === 0 || emrIdx.length === 0) return;

    expect(Math.min(...sysIdx)).toBeLessThan(Math.min(...emrIdx));
  });
});
