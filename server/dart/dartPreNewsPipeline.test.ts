import { describe, expect, it } from 'vitest';
import { runDartPreNewsPipeline } from './dartPreNewsPipeline.js';
import { dedupeDartPreNewsCandidates } from './dartPreNewsStore.js';
import type { DartDisclosureRecord, DartFetchResult } from './dartPreNewsTypes.js';

const disclosure: DartDisclosureRecord = {
  corpCode: '00126380',
  stockCode: '005930',
  corpName: '삼성전자',
  market: 'KOSPI',
  disclosureId: '20260517000001',
  disclosureTitle: '단일판매ㆍ공급계약 체결',
  disclosureType: '단일판매ㆍ공급계약 체결',
  receivedAt: '2026-05-17T00:00:00.000Z',
  reportUrl: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260517000001',
  bodyText: '계약금액 200,000,000,000 원 최근매출액대비 55% 계약기간 2026.05.17 2029.05.17',
};

describe('runDartPreNewsPipeline', () => {
  it('DART API key missing 시 throw하지 않고 providerIssue=true 후보를 반환한다', async () => {
    const fetchResult: DartFetchResult = {
      disclosures: [],
      providerIssue: true,
      dataHealth: 'MISSING',
      reasons: ['PROVIDER_DART_API_KEY_MISSING'],
      missingData: ['DART_API_KEY'],
      executionImpact: 'NONE',
    };
    await expect(runDartPreNewsPipeline({ fetchResult, persist: false })).resolves.toMatchObject({
      providerIssue: true,
      executionImpact: 'NONE',
    });
  });

  it('AI interpretation 필드를 AI_ESTIMATED로 표시한다', async () => {
    const result = await runDartPreNewsPipeline({
      disclosures: [disclosure],
      persist: false,
      config: { enableAiInterpretation: true },
      now: new Date('2026-05-17T01:00:00.000Z'),
    });
    expect(result.candidates[0].aiInterpretation?.confidence).toBe('AI_ESTIMATED');
    expect(result.candidates[0].dataConfidence.aiEstimated).toBe(1);
  });

  it('pipeline 결과의 executionImpact가 항상 NONE이다', async () => {
    const result = await runDartPreNewsPipeline({ disclosures: [disclosure], persist: false });
    expect(result.executionImpact).toBe('NONE');
    expect(result.candidates.every((candidate) => candidate.executionImpact === 'NONE')).toBe(true);
    expect(result.shadowTelemetry.every((item) => item.liveExecutionAllowed === false && item.shadowLearning === true)).toBe(true);
  });

  it('allowed stage가 OBSERVE/SHADOW_SCORE/ADVISORY를 넘지 않는다', async () => {
    const result = await runDartPreNewsPipeline({ disclosures: [disclosure], persist: false });
    expect(result.candidates.map((candidate) => candidate.stage)).toEqual(['ADVISORY']);
    expect(result.candidates.every((candidate) => ['OBSERVE', 'SHADOW_SCORE', 'ADVISORY'].includes(candidate.stage))).toBe(true);
  });

  it('동일 disclosureId가 중복 저장되지 않는다', () => {
    const one = {
      id: 'a', corpName: 'A', disclosureId: 'same', disclosureTitle: 't', disclosureType: 't', receivedAt: '2026-05-17T00:00:00.000Z',
      stage: 'OBSERVE' as const, catalystCategory: 'UNKNOWN' as const, catalystScore: 0, riskScore: 0, extractedFacts: [],
      dataConfidence: { verified: 0, degraded: 0, stale: 0, missing: 0, aiEstimated: 0, unknown: 0 }, providerIssue: false, marketSignal: false,
      executionImpact: 'NONE' as const, reasons: [], risks: [], missingData: [], createdAt: 'now', updatedAt: 'now',
    };
    const two = { ...one, id: 'b', disclosureTitle: 'updated' };
    expect(dedupeDartPreNewsCandidates([one, two])).toHaveLength(1);
    expect(dedupeDartPreNewsCandidates([one, two])[0].id).toBe('b');
  });
});
