// @responsibility: commandRegistry 의 register/resolve/all/keys 와 system barrel 자동 등록 회귀 테스트.
import { describe, it, expect, beforeAll } from 'vitest';

import { commandRegistry } from './commandRegistry.js';
import type { TelegramCommand } from './commands/_types.js';

// ── 1. registry semantics — 격리된 stub 명령으로 검증 ───────────────────────

function makeStub(name: string, aliases: string[] = []): TelegramCommand {
  return {
    name,
    aliases,
    category: 'SYS',
    visibility: 'HIDDEN',
    riskLevel: 0,
    description: `stub ${name}`,
    async execute() {
      /* no-op */
    },
  };
}

describe('commandRegistry — basic semantics', () => {
  it('register + resolve by canonical name (case-insensitive)', () => {
    const stub = makeStub('/__test_resolve_basic');
    commandRegistry.register(stub);
    expect(commandRegistry.resolve('/__test_resolve_basic')).toBe(stub);
    expect(commandRegistry.resolve('/__TEST_RESOLVE_BASIC')).toBe(stub);
  });

  it('register with aliases — both name and alias resolve to same instance', () => {
    const stub = makeStub('/__test_alias_a', ['/__test_alias_b', '/__test_alias_c']);
    commandRegistry.register(stub);
    expect(commandRegistry.resolve('/__test_alias_a')).toBe(stub);
    expect(commandRegistry.resolve('/__test_alias_b')).toBe(stub);
    expect(commandRegistry.resolve('/__test_alias_c')).toBe(stub);
  });

  it('resolve unknown command returns undefined', () => {
    expect(commandRegistry.resolve('/__never_registered')).toBeUndefined();
  });

  it('duplicate name (different instance) throws', () => {
    const a = makeStub('/__test_dupe_name');
    const b = makeStub('/__test_dupe_name');
    commandRegistry.register(a);
    expect(() => commandRegistry.register(b)).toThrow(/중복 등록/);
  });

  it('duplicate alias (different instance) throws', () => {
    const a = makeStub('/__test_dupe_alias_a', ['/__test_dupe_alias_shared']);
    const b = makeStub('/__test_dupe_alias_b', ['/__test_dupe_alias_shared']);
    commandRegistry.register(a);
    expect(() => commandRegistry.register(b)).toThrow(/중복 등록/);
  });

  it('same instance re-register is idempotent (HMR safety)', () => {
    const stub = makeStub('/__test_idempotent');
    commandRegistry.register(stub);
    expect(() => commandRegistry.register(stub)).not.toThrow();
    expect(commandRegistry.resolve('/__test_idempotent')).toBe(stub);
  });
});

// ── 2. Phase A barrel — system/*.cmd.ts 9개 자동 등록 검증 ─────────────────

describe('commands/system barrel — 9 read-only commands auto-registered', () => {
  beforeAll(async () => {
    // 본 import 가 모든 system .cmd.ts 를 로드해 commandRegistry 등록 트리거.
    await import('./commands/system/index.js');
  });

  it('all 9 system commands are resolvable by canonical name', () => {
    const expectedNames = [
      '/market',
      '/status',
      '/regime',
      '/health',
      '/ai_status',
      '/scheduler',
      '/learning_status',
      '/learning_history',
      '/todaylog',
    ];
    for (const name of expectedNames) {
      expect(commandRegistry.resolve(name), `missing ${name}`).toBeDefined();
    }
  });

  it('/scheduler has /schedule alias', () => {
    const sch = commandRegistry.resolve('/scheduler');
    const alias = commandRegistry.resolve('/schedule');
    expect(sch).toBeDefined();
    expect(alias).toBe(sch);
  });

  it('every system command exposes name+description+execute (interface contract)', () => {
    const names = [
      '/market',
      '/status',
      '/regime',
      '/health',
      '/ai_status',
      '/scheduler',
      '/learning_status',
      '/learning_history',
      '/todaylog',
    ];
    for (const n of names) {
      const cmd = commandRegistry.resolve(n)!;
      expect(cmd.name, `${n} name`).toBe(n);
      expect(cmd.description.length, `${n} description`).toBeGreaterThan(0);
      expect(typeof cmd.execute).toBe('function');
      expect(cmd.riskLevel).toBe(0); // Phase A is read-only only
    }
  });

  it('all() returns unique instances (alias not double-counted)', () => {
    const all = commandRegistry.all();
    const names = all.map((c) => c.name);
    const unique = new Set(names);
    expect(names.length).toBe(unique.size);
    // 9 system commands + N test stubs (semantics test 가 등록한 것). ≥ 9 이면 충분.
    expect(all.length).toBeGreaterThanOrEqual(9);
  });

  it('keys() includes both /scheduler and /schedule (alias key counted)', () => {
    const keys = commandRegistry.keys();
    expect(keys).toContain('/scheduler');
    expect(keys).toContain('/schedule');
  });
});
