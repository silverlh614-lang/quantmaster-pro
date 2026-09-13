// @responsibility Verify durable bot delivery state.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
let repo: typeof import('./paperBotRepo.js');
let temporaryRoot: string;
let testDataDir: string;
beforeAll(async () => {
  temporaryRoot = path.resolve(process.env.PERSIST_DATA_DIR ?? os.tmpdir());
  fs.mkdirSync(temporaryRoot, { recursive: true });
  testDataDir = fs.mkdtempSync(path.join(temporaryRoot, 'paper-bot-'));
  vi.stubEnv('PERSIST_DATA_DIR', testDataDir); vi.resetModules(); repo = await import('./paperBotRepo.js');
});
afterAll(() => {
  vi.unstubAllEnvs();
  if (testDataDir && path.dirname(path.resolve(testDataDir)) === temporaryRoot) fs.rmSync(testDataDir, { recursive: true, force: true });
});
describe('bot persistence', () => {
  it('retains confirmed deliveries and seen events across a module restart', async () => {
    const state = repo.loadPaperBotState();
    expect(state.initializedAt).toBeNull();
    state.initializedAt = '2026-09-14T00:00:00Z';
    state.seenEvents['trade:BUY'] = state.initializedAt;
    state.messages.push({ id: 'paper:morning:2026-09-14', kind: 'morning', message: 'report', createdAt: state.initializedAt, expiresAt: '2026-09-14T01:00:00Z', nextAttemptAt: state.initializedAt, state: 'SENT', attempts: 1, messageId: 123, sentAt: state.initializedAt });
    repo.savePaperBotState(state); vi.resetModules(); repo = await import('./paperBotRepo.js');
    expect(repo.loadPaperBotState()).toEqual(state);
    expect(fs.readdirSync(testDataDir)).toEqual(['paper-bot.json']);
  });
  it('preserves separate channel delivery alongside existing private records', () => {
    const state = repo.loadPaperBotState();
    const source = state.messages[0];
    state.messages.push({ ...source, id: 'channel-signal', channel: 'TRADE' as NonNullable<typeof source.channel> },
      { ...source, id: 'channel-analysis', channel: 'ANALYSIS' as NonNullable<typeof source.channel>, state: 'PENDING', messageId: undefined });
    repo.savePaperBotState(state);
    const restored = repo.loadPaperBotState();
    expect(restored.messages.map(item => item.channel)).toEqual([undefined, 'TRADE', 'ANALYSIS']);
    expect(restored.messages[2].state).toBe('PENDING');
    fs.writeFileSync(repo.PAPER_BOT_FILE, JSON.stringify({ ...state, messages: [{ ...source, channel: 'UNKNOWN' }] }));
    expect(() => repo.loadPaperBotState()).toThrow('PAPER_BOT_STATE_INVALID');
  });
  it('does not erase a corrupt ledger and replay notifications', () => {
    fs.writeFileSync(repo.PAPER_BOT_FILE, '{broken');
    expect(() => repo.loadPaperBotState()).toThrow();
    expect(fs.readFileSync(repo.PAPER_BOT_FILE, 'utf8')).toBe('{broken');
    fs.writeFileSync(repo.PAPER_BOT_FILE, JSON.stringify({ schemaVersion: 1, messages: [{ id: 'x', state: 'SENT' }], seenEvents: {} }));
    expect(() => repo.loadPaperBotState()).toThrow('PAPER_BOT_STATE_INVALID');
  });
});
