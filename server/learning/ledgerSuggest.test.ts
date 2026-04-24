import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { LEDGER_FILE } from '../persistence/paths.js';

vi.mock('./suggestNotifier.js', () => ({
  sendSuggestAlert: vi.fn().mockResolvedValue(true),
}));

import { sendSuggestAlert } from './suggestNotifier.js';
import { evaluateLedgerSuggestion, type LedgerEntry } from './ledgerSimulator.js';

const mockSend = sendSuggestAlert as unknown as ReturnType<typeof vi.fn>;
const _backup = fs.existsSync(LEDGER_FILE) ? fs.readFileSync(LEDGER_FILE, 'utf-8') : null;

function reset() {
  if (fs.existsSync(LEDGER_FILE)) fs.unlinkSync(LEDGER_FILE);
  mockSend.mockClear();
}

afterAll(() => {
  if (_backup !== null) fs.writeFileSync(LEDGER_FILE, _backup);
  else if (fs.existsSync(LEDGER_FILE)) fs.unlinkSync(LEDGER_FILE);
});

function buildTriplet(
  groupIdx: number,
  returns: { A: number; B: number; C: number },
): LedgerEntry[] {
  const groupId = `grp_2026-04-01_stock${groupIdx}`;
  return (['A', 'B', 'C'] as const).map((u) => ({
    id: `${groupId}_${u}`,
    groupId,
    universe: u,
    stockCode: `S${groupIdx.toString().padStart(4, '0')}`,
    stockName: `T${groupIdx}`,
    signalTime: '2026-04-01T00:00:00Z',
    entryPrice: 10_000,
    targetPrice: 11_200,
    stopPrice: 9_500,
    kellyFactor: u === 'A' ? 1.0 : u === 'B' ? 0.6 : 0.25,
    status: 'HIT_TP',
    resolvedAt: '2026-04-10T00:00:00Z',
    exitPrice: 10_000 * (1 + returns[u] / 100),
    returnPct: returns[u],
  }));
}

function writeLedger(entries: LedgerEntry[]) {
  fs.mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(entries));
}

describe('evaluateLedgerSuggestion', () => {
  beforeEach(reset);

  it('triplet 부족(<30) → no-op', async () => {
    const entries: LedgerEntry[] = [];
    for (let i = 0; i < 10; i++) {
      entries.push(...buildTriplet(i, { A: 3, B: 10, C: 10 }));
    }
    writeLedger(entries);
    const ok = await evaluateLedgerSuggestion();
    expect(ok).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('30쌍 이상 + Universe B 가 A +5%p, MaxDD 동등 → suggest B', async () => {
    const entries: LedgerEntry[] = [];
    for (let i = 0; i < 30; i++) {
      entries.push(...buildTriplet(i, { A: 3, B: 10, C: 4 })); // B - A = 7%p
    }
    writeLedger(entries);
    const ok = await evaluateLedgerSuggestion();
    expect(ok).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const payload = mockSend.mock.calls[0][0];
    expect(payload.moduleKey).toBe('ledger');
    expect(payload.signature).toMatch(/^ledger-B-\d{4}-\d{2}-\d{2}$/);
  });

  it('B, C 모두 edge 충족 시 edge 가 큰 쪽 1건만 suggest', async () => {
    const entries: LedgerEntry[] = [];
    for (let i = 0; i < 30; i++) {
      entries.push(...buildTriplet(i, { A: 2, B: 8, C: 12 })); // C - A = 10%p > B - A = 6%p
    }
    writeLedger(entries);
    const ok = await evaluateLedgerSuggestion();
    expect(ok).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].signature).toMatch(/^ledger-C-/);
  });

  it('B edge 충족하지만 MaxDD > A 의 MaxDD → suggest 안 함 (B), C 도 미달 → no-op', async () => {
    const entries: LedgerEntry[] = [];
    for (let i = 0; i < 29; i++) {
      entries.push(...buildTriplet(i, { A: 5, B: 10, C: 4 }));
    }
    // B 에 큰 손실 triplet 하나 주입 — MaxDD B=15 > MaxDD A=0 이 되도록.
    entries.push(...buildTriplet(29, { A: 5, B: -15, C: 4 }));
    writeLedger(entries);
    const ok = await evaluateLedgerSuggestion();
    expect(ok).toBe(false);
  });
});
