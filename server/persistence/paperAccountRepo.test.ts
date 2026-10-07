// @responsibility Verify virtual account durability across failures.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import { advancePaperAccount, createPaperAccount } from '../trading/paper/paperAccount.js';
import { legacyStrategyLedger, strategyTestSnapshot } from '../trading/paper/paperStrategyFixtures.js';

let directory: string, root: string, repo: typeof import('./paperAccountRepo.js');
beforeAll(async () => {
  root = path.resolve(process.env.PERSIST_DATA_DIR ?? os.tmpdir()); fs.mkdirSync(root, { recursive: true });
  directory = fs.mkdtempSync(path.join(root, 'virtual-account-'));
  vi.stubEnv('PERSIST_DATA_DIR', directory); vi.resetModules(); repo = await import('./paperAccountRepo.js');
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const name of fs.readdirSync(directory)) {
    const target = path.resolve(directory, name);
    if (path.dirname(target) !== directory) throw new Error('Unsafe cleanup');
    fs.unlinkSync(target);
  }
});
afterAll(() => { vi.unstubAllEnvs(); if (directory && path.dirname(directory) === root) fs.rmdirSync(directory); });
const account = () => createPaperAccount({ initialCash: 10000, maxPositionPct: 20, includeExploration: false }, '2026-09-18T00:00:00Z', 'account');
describe('virtual account persistence', () => {
  it('keeps completed order evidence immutable across subsequent saves', () => {
    const input = account(); input.config.initialCash = 1000000;
    const strategy = legacyStrategyLedger(), snapshot = strategyTestSnapshot();
    strategy.trades[0].strategyVersion = 'adaptive-features-v1'; snapshot.observations[0].source = 'KIS';
    const result = advancePaperAccount(input, strategy, snapshot);
    expect(result.orders[0].status).toBe('FILLED'); repo.savePaperAccount(result);
    const changed = structuredClone(result); changed.orders[0].signalReason = 'rewritten';
    expect(() => repo.savePaperAccount(changed)).toThrow('기존 주문·체결 변경 금지');
    expect(repo.loadPaperAccount()).toEqual(result);
  });
  it('retains configuration and control history after reload', () => {
    const input = account(); repo.savePaperAccount(input);
    const restored = repo.loadPaperAccount()!;
    restored.buyPaused = true; restored.controls.push({ at: '2026-09-18T01:00:00Z', buyPaused: true }); repo.savePaperAccount(restored);
    expect(repo.loadPaperAccount()).toEqual(restored);
    expect(() => repo.savePaperAccount(input)).toThrow('계좌 제어 이력 변경 금지');
  });
  it('preserves the last committed account when atomic replacement fails', () => {
    const input = account(); repo.savePaperAccount(input);
    const spy = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('disk failure'); });
    expect(() => repo.savePaperAccount({ ...input, lastSnapshotAt: '2026-09-18T01:00:00Z' })).toThrow('disk failure');
    spy.mockRestore(); expect(repo.loadPaperAccount()).toEqual(input);
    expect(fs.readdirSync(directory)).toEqual(['paper-virtual-account.json']);
  });
  it('refuses damaged ledgers and account resets', () => {
    repo.savePaperAccount(account());
    expect(() => repo.savePaperAccount({ ...account(), id: 'replacement' })).toThrow('교체 금지');
    fs.writeFileSync(repo.PAPER_ACCOUNT_FILE, '{broken');
    expect(() => repo.loadPaperAccount()).toThrow(); expect(() => repo.savePaperAccount(account())).toThrow();
    expect(fs.readFileSync(repo.PAPER_ACCOUNT_FILE, 'utf8')).toBe('{broken');
  });
});
