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

// ── 3. Phase B1 — watchlist/positions/alert barrels (17 cmd objects, 19 keys) ──

describe('commands/watchlist+positions+alert barrels — Phase B1 auto-register', () => {
  beforeAll(async () => {
    await import('./commands/watchlist/index.js');
    await import('./commands/positions/index.js');
    await import('./commands/alert/index.js');
  });

  it('all WL commands resolvable (5 names)', () => {
    for (const name of ['/watchlist', '/focus', '/add', '/remove', '/watchlist_channel']) {
      expect(commandRegistry.resolve(name), `missing ${name}`).toBeDefined();
    }
  });

  it('all POS commands resolvable (3 names)', () => {
    for (const name of ['/pos', '/pnl', '/pending']) {
      expect(commandRegistry.resolve(name), `missing ${name}`).toBeDefined();
    }
  });

  it('all ALR commands resolvable (12 keys = 9 cmd objects + 3 aliases)', () => {
    for (const name of [
      '/channel_health',
      '/channel_stats',
      '/alert_replay',
      '/alert_history',
      '/channel_test',
      '/dxy',
      '/dxy_intraday', // alias
      '/news_lag',
      '/news_patterns', // alias
      '/digest_on',
      '/digest_off',
      '/digest_status',
    ]) {
      expect(commandRegistry.resolve(name), `missing ${name}`).toBeDefined();
    }
  });

  it('aliases resolve to same instance as canonical', () => {
    expect(commandRegistry.resolve('/dxy')).toBe(commandRegistry.resolve('/dxy_intraday'));
    expect(commandRegistry.resolve('/news_lag')).toBe(
      commandRegistry.resolve('/news_patterns'),
    );
  });

  it('Phase A+B1 totals — system 9 + WL 5 + POS 3 + ALR 9 = 26 unique commands', () => {
    // commandRegistry.all() 은 등록된 모든 인스턴스를 unique 로 반환한다.
    // 본 테스트 파일 자체가 stub 6개를 추가로 등록하므로 ≥26.
    const all = commandRegistry.all();
    expect(all.length).toBeGreaterThanOrEqual(26);
    // 카테고리 검증.
    const categories = new Set(all.map((c) => c.category));
    expect(categories).toContain('SYS');
    expect(categories).toContain('WL');
    expect(categories).toContain('POS');
    expect(categories).toContain('ALR');
  });
});

// ── 4. Phase B2 — learning barrel (8 cmd, 9 keys with /risk_budget alias) ─────

describe('commands/learning barrel — Phase B2 auto-register', () => {
  beforeAll(async () => {
    await import('./commands/learning/index.js');
  });

  it('all 8 LRN commands resolvable (kelly/kelly_surface/regime_coverage/ledger/counterfactual/risk/circuits/reset_circuits)', () => {
    for (const name of [
      '/kelly',
      '/kelly_surface',
      '/regime_coverage',
      '/ledger',
      '/counterfactual',
      '/risk',
      '/circuits',
      '/reset_circuits',
    ]) {
      expect(commandRegistry.resolve(name), `missing ${name}`).toBeDefined();
    }
  });

  it('/risk has /risk_budget alias (same instance)', () => {
    expect(commandRegistry.resolve('/risk')).toBe(commandRegistry.resolve('/risk_budget'));
  });

  it('every LRN command is category=LRN', () => {
    for (const name of [
      '/kelly',
      '/kelly_surface',
      '/regime_coverage',
      '/ledger',
      '/counterfactual',
      '/risk',
      '/circuits',
      '/reset_circuits',
    ]) {
      expect(commandRegistry.resolve(name)?.category, `${name} category`).toBe('LRN');
    }
  });

  it('/reset_circuits is riskLevel=1 (light mutate); read-only LRN are riskLevel=0', () => {
    expect(commandRegistry.resolve('/reset_circuits')?.riskLevel).toBe(1);
    for (const name of [
      '/kelly',
      '/kelly_surface',
      '/regime_coverage',
      '/ledger',
      '/counterfactual',
      '/risk',
      '/circuits',
    ]) {
      expect(commandRegistry.resolve(name)?.riskLevel, `${name} riskLevel`).toBe(0);
    }
  });

  it('Phase A+B1+B2 totals — ≥34 unique cmd objects across SYS/WL/POS/ALR/LRN', () => {
    const all = commandRegistry.all();
    expect(all.length).toBeGreaterThanOrEqual(34);
    const categories = new Set(all.map((c) => c.category));
    expect(categories).toContain('LRN');
  });
});
