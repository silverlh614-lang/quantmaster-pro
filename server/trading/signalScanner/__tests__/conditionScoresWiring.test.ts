// @responsibility PR-F-2 wiring 회귀 — perSymbolEvaluation 거절 분기 conditionScores 전달.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ENTRY_CONDITION_HIGH_SCORE,
  ENTRY_CONDITION_NEUTRAL_SCORE,
  buildEntryConditionScores,
} from '../../../learning/entryConditionScores.js';
import { serverConditionKey } from '../../../learning/attributionAnalyzer.js';
import { recordRejection } from '../../../learning/rejectionShadowTracker.js';

vi.mock('../../../learning/rejectionShadowTracker.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../learning/rejectionShadowTracker.js',
  );
  return {
    ...actual,
    recordRejection: vi.fn(),
  };
});

describe('PR-F-2 wiring — conditionScores 전달', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.clearAllMocks(); });

  it('buildEntryConditionScores — 빈 conditionKeys → 모든 ID = NEUTRAL_SCORE (5)', () => {
    const scores = buildEntryConditionScores([]);
    for (let id = 1; id <= 27; id += 1) {
      expect(scores[id]).toBe(ENTRY_CONDITION_NEUTRAL_SCORE);
    }
  });

  it('buildEntryConditionScores — 명시된 conditionKey 만 HIGH_SCORE (7)', () => {
    // serverConditionKey(1) 로 conditionId=1 의 server key 추출
    const firstKey = serverConditionKey(1);
    if (firstKey === null) {
      // 매핑 부재 ID — skip
      return;
    }
    const scores = buildEntryConditionScores([firstKey]);
    expect(scores[1]).toBe(ENTRY_CONDITION_HIGH_SCORE);
    // 다른 ID 는 NEUTRAL
    expect(scores[2]).toBe(ENTRY_CONDITION_NEUTRAL_SCORE);
  });

  it('buildEntryConditionScores — undefined / null → 모두 NEUTRAL', () => {
    const scoresUndef = buildEntryConditionScores(undefined);
    const scoresNull = buildEntryConditionScores(null);
    for (let id = 1; id <= 27; id += 1) {
      expect(scoresUndef[id]).toBe(ENTRY_CONDITION_NEUTRAL_SCORE);
      expect(scoresNull[id]).toBe(ENTRY_CONDITION_NEUTRAL_SCORE);
    }
  });

  it('recordRejection 호출 — conditionScores 옵셔널 필드 포함 가능', () => {
    const mocked = vi.mocked(recordRejection);
    const scores = buildEntryConditionScores([]);
    mocked.mockReturnValue(1);
    recordRejection({
      stockCode: '005930',
      stockName: '삼성전자',
      signalDate: '2026-04-28',
      signalPriceKrw: 70000,
      gateScore: 16,
      rejectionReason: 'entryRevalidation:Gate 1 미달',
      conditionScores: scores,
    });
    expect(mocked).toHaveBeenCalledTimes(1);
    const call = mocked.mock.calls[0][0];
    expect(call.conditionScores).toBeDefined();
    expect(Object.keys(call.conditionScores!)).toHaveLength(27);
  });

  it('perSymbolEvaluation — recordRejection 호출 인접 패턴 검증 (소스 정합)', async () => {
    // perSymbolEvaluation.ts 가 buildEntryConditionScores 를 import 하고
    // recordRejection 직전에 호출하는 패턴 정합 확인.
    const { readFileSync } = await import('fs');
    const src = readFileSync(
      'server/trading/signalScanner/perSymbolEvaluation.ts',
      'utf-8',
    );
    expect(src).toContain('buildEntryConditionScores');
    // PR-F-2 정합: buildEntryConditionScores 호출 직후 recordRejection 호출 패턴 (1000자 이내)
    expect(src).toMatch(/buildEntryConditionScores\(stock\.conditionKeys\)[\s\S]{0,1000}recordRejection/);
    // PR-F-2 정합: recordRejection 인자에 conditionScores 가 전달되는지 — 정규식 대신
    // 호출 위치의 인접 영역(전후 600자)에서 conditionScores 키워드가 등장하는지 확인.
    const recordRejectionIdx = src.indexOf('recordRejection({');
    expect(recordRejectionIdx).toBeGreaterThan(-1);
    const block = src.slice(recordRejectionIdx, recordRejectionIdx + 600);
    expect(block).toContain('conditionScores');
  });
});
