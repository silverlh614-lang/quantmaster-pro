import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import { COUNTERFACTUAL_FILE } from '../persistence/paths.js';

vi.mock('./suggestNotifier.js', () => ({
  sendSuggestAlert: vi.fn().mockResolvedValue(true),
}));

import { sendSuggestAlert } from './suggestNotifier.js';
import {
  recordCounterfactual,
  evaluateCounterfactualSuggestion,
  type CounterfactualEntry,
} from './counterfactualShadow.js';

const mockSend = sendSuggestAlert as unknown as ReturnType<typeof vi.fn>;
const _backup = fs.existsSync(COUNTERFACTUAL_FILE)
  ? fs.readFileSync(COUNTERFACTUAL_FILE, 'utf-8')
  : null;

function reset() {
  if (fs.existsSync(COUNTERFACTUAL_FILE)) fs.unlinkSync(COUNTERFACTUAL_FILE);
  mockSend.mockClear();
}

afterAll(() => {
  if (_backup !== null) fs.writeFileSync(COUNTERFACTUAL_FILE, _backup);
  else if (fs.existsSync(COUNTERFACTUAL_FILE)) fs.unlinkSync(COUNTERFACTUAL_FILE);
});

function writeEntries(entries: CounterfactualEntry[]): void {
  fs.writeFileSync(COUNTERFACTUAL_FILE, JSON.stringify(entries));
}

function buildEntry(
  code: string,
  gateScore: number,
  return30d: number,
  daysAgo: number,
): CounterfactualEntry {
  const ms = Date.now() - daysAgo * 86_400_000;
  const iso = new Date(ms).toISOString();
  return {
    id: `cf_${code}_${ms}`,
    stockCode: code,
    stockName: `T_${code}`,
    signalDate: iso.slice(0, 10),
    signalTime: iso,
    priceAtSignal: 10_000,
    gateScore,
    regime: 'R2_BULL',
    conditionKeys: [],
    skipReason: 'GATE_UNDER',
    return30d,
  };
}

describe('evaluateCounterfactualSuggestion', () => {
  beforeEach(reset);

  it('샘플 부족(<30) → no-op, suggest 호출 없음', async () => {
    for (let i = 0; i < 20; i++) {
      writeEntries([buildEntry(`00${i}`, 6, 5, 40)]);
    }
    // 누적 저장이 아닌 최신만 남으므로 직접 배열 생성.
    const entries: CounterfactualEntry[] = Array.from({ length: 20 }, (_, i) =>
      buildEntry(`s${i.toString().padStart(3, '0')}`, 6, 5, 40),
    );
    writeEntries(entries);
    const ok = await evaluateCounterfactualSuggestion();
    expect(ok).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('30건 이상 + 탈락 평균이 통과 평균의 80% 이상 → suggest 1회 호출', async () => {
    const entries: CounterfactualEntry[] = [];
    // 통과 (gateScore=8): 평균 5%.
    for (let i = 0; i < 15; i++) {
      entries.push(buildEntry(`pass${i.toString().padStart(3, '0')}`, 8, 5, 40));
    }
    // 탈락 (gateScore=5): 평균 4.5% (ratio 0.9 > 0.8).
    for (let i = 0; i < 20; i++) {
      entries.push(buildEntry(`skip${i.toString().padStart(3, '0')}`, 5, 4.5, 40));
    }
    writeEntries(entries);

    const ok = await evaluateCounterfactualSuggestion();
    expect(ok).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const payload = mockSend.mock.calls[0][0];
    expect(payload.moduleKey).toBe('counterfactual');
    expect(payload.signature).toMatch(/^counterfactual-\d{4}-\d{2}-\d{2}$/);
  });

  it('샘플 30건 이상이지만 ratio < 0.8 → no-op', async () => {
    const entries: CounterfactualEntry[] = [];
    for (let i = 0; i < 20; i++) {
      entries.push(buildEntry(`pass${i.toString().padStart(3, '0')}`, 8, 10, 40));
    }
    for (let i = 0; i < 20; i++) {
      entries.push(buildEntry(`skip${i.toString().padStart(3, '0')}`, 5, 3, 40)); // ratio 0.3
    }
    writeEntries(entries);

    const ok = await evaluateCounterfactualSuggestion();
    expect(ok).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('통과 평균 ≤ 0 → no-op (ratio 의미 없음)', async () => {
    const entries: CounterfactualEntry[] = [];
    for (let i = 0; i < 20; i++) {
      entries.push(buildEntry(`pass${i.toString().padStart(3, '0')}`, 8, -2, 40));
    }
    for (let i = 0; i < 20; i++) {
      entries.push(buildEntry(`skip${i.toString().padStart(3, '0')}`, 5, -1, 40));
    }
    writeEntries(entries);

    const ok = await evaluateCounterfactualSuggestion();
    expect(ok).toBe(false);
  });
});
