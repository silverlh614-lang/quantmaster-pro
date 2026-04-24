/**
 * @responsibility Yahoo 프록시 in-flight coalescing — PR-24, ADR-0010
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inflightSize, inflightReset } from './marketDataRouter.js';

describe('marketDataRouter — in-flight Map 상태 (ADR-0010)', () => {
  beforeEach(() => inflightReset());
  afterEach(() => inflightReset());

  it('초기 상태에서 inflight 사이즈는 0', () => {
    expect(inflightSize()).toBe(0);
  });

  it('inflightReset 호출 후 사이즈 0 으로 복귀', () => {
    inflightReset();
    expect(inflightSize()).toBe(0);
  });

  // 실제 coalescing 거동은 fetchYahooHistorical 의 fetch mocking 이 필요해
  // 통합 테스트 (server/routes/marketDataRouter.integration.test.ts) 에서 검증.
  // 여기서는 인프로세스 Map 헬퍼의 export 표면만 lock.
});
