// @responsibility ADR-0149 27 조건 매핑 정정 회귀 — 클라 SSOT 진실 정착 + drift 영구 차단
import { describe, it, expect } from 'vitest';
import {
  CONDITION_NAMES,
  serverConditionKey,
  conditionIdFromServerKey,
} from './attributionAnalyzer.js';
import {
  buildEntryConditionScores,
  ENTRY_CONDITION_HIGH_SCORE,
  ENTRY_CONDITION_NEUTRAL_SCORE,
} from './entryConditionScores.js';

/**
 * ADR-0149: 클라이언트 SSOT (evolutionEngine.ALL_CONDITIONS + CHECKLIST_TO_CONDITION_ID)
 * 의 27/27 일치 의미를 진실의 출처로 채택. 본 회귀가 드리프트 차단 가드.
 *
 * 변경 시 의무:
 *   1) 본 테스트 의 EXPECTED 사본 갱신 (의도된 변경)
 *   2) 클라 SSOT 양쪽 동기 업데이트
 *   3) ADR-0149 §"호출자 영향" 시나리오 재검증
 */

// 클라이언트 SSOT 의 27 ID 의미 (evolutionEngine.ALL_CONDITIONS / checklistToConditionScores
// CHECKLIST_TO_CONDITION_ID 는 서버에서 직접 import 불가 — 절대 규칙 #3 서버↔클라 직접
// import 금지. 본 사본은 클라이언트 SSOT 와 정합 의무).
const EXPECTED_CONDITION_KEYWORDS: Record<number, string[]> = {
  1:  ['주도주', '사이클', 'Cycle'],
  2:  ['모멘텀', 'Momentum'],
  3:  ['ROE'],
  4:  ['수급', 'Supply'],
  5:  ['Risk-On', '시장', '환경'],
  6:  ['일목', 'Ichimoku'],
  7:  ['손절', 'Stop'],
  8:  ['해자', 'Moat'],
  9:  ['신규', '주도주', 'New Leader'],
  10: ['정배열', 'Technical'],
  11: ['거래량', 'Volume'],
  12: ['기관', '외인', 'Institutional'],
  13: ['목표가', 'Upside'],
  14: ['실적', '서프라이즈', 'Earnings'],
  15: ['실체', '펀더멘털', 'Reality'],
  16: ['정책', '매크로', 'Policy'],
  17: ['심리', 'Psychology'],
  18: ['터틀', 'Turtle'],
  19: ['피보나치', 'Fibonacci'],
  20: ['엘리엇', 'Elliott'],
  21: ['OCF', '이익의 질'],
  22: ['마진', '가속도', 'OPM'],
  23: ['ICR', '재무', '방어'],
  24: ['상대강도', 'RS'],
  25: ['VCP', '변동성'],
  26: ['다이버전스', 'Divergence'],
  27: ['촉매', 'Catalyst'],
};

describe('ADR-0149 — CONDITION_NAMES 27 ID 클라 의미 정합', () => {
  it('27 ID 모두 정의되어 있다 (1~27)', () => {
    for (let id = 1; id <= 27; id += 1) {
      expect(CONDITION_NAMES[id]).toBeDefined();
      expect(typeof CONDITION_NAMES[id]).toBe('string');
      expect(CONDITION_NAMES[id].length).toBeGreaterThan(0);
    }
  });

  it.each(Array.from({ length: 27 }, (_, i) => i + 1))(
    'ID %d 의 라벨이 클라 SSOT 의미와 정합 (drift 차단)',
    (id) => {
      const label = CONDITION_NAMES[id];
      const expectedKeywords = EXPECTED_CONDITION_KEYWORDS[id];
      // 라벨에 expected keywords 중 *하나 이상* 포함 — 다양한 표기 허용 (한글/영문)
      const matchedKeywords = expectedKeywords.filter((kw) => label.includes(kw));
      expect(
        matchedKeywords.length,
        `ID ${id} 라벨 "${label}" 이 [${expectedKeywords.join(', ')}] 중 하나 이상 포함 의무`,
      ).toBeGreaterThan(0);
    },
  );

  it('이전 매핑 (서버 ID 의미) 회귀 차단', () => {
    // ADR-0149 이전 잘못된 매핑이 다시 등장하면 fail
    expect(CONDITION_NAMES[2]).not.toContain('ROE'); // 이전: ROE 유형 3
    expect(CONDITION_NAMES[3]).not.toContain('Risk-On'); // 이전: 시장 환경 Risk-On
    expect(CONDITION_NAMES[18]).not.toContain('모멘텀'); // 이전: 모멘텀 순위
    expect(CONDITION_NAMES[20]).not.toContain('터틀'); // 이전: 터틀 돌파
  });
});

describe('ADR-0149 — CONDITION_TO_SERVER_KEY 8 키 매핑 정정', () => {
  // 정정된 매핑 (클라 ID 의미 기준)
  const EXPECTED_MAPPING: Array<[number, string | null]> = [
    [2, 'momentum'],
    [4, 'supply_confluence'],
    [10, 'ma_alignment'],
    [11, 'volume_breakout'],
    [18, 'turtle_high'],
    [21, 'earnings_quality'],
    [24, 'relative_strength'],
    [25, 'vcp'],
  ];

  it.each(EXPECTED_MAPPING)('클라 ID %d → 서버 키 %s 정합', (id, expectedKey) => {
    expect(serverConditionKey(id)).toBe(expectedKey);
  });

  it('이전 잘못된 매핑 회귀 차단 (서버 ID 의미)', () => {
    // ADR-0149 이전: ID 9, 17 에 매핑 있었음 (잘못된 의미)
    expect(serverConditionKey(9)).toBeNull();
    expect(serverConditionKey(17)).toBeNull();
    expect(serverConditionKey(20)).toBeNull(); // 이전: turtle_high (서버 의미)

    // ID 18 은 매핑 자체는 유지되지만 서버 키가 변경
    expect(serverConditionKey(18)).not.toBe('momentum'); // 이전: momentum (서버 의미)
    expect(serverConditionKey(18)).toBe('turtle_high'); // 정정: turtle_high (클라 의미)

    // ID 10 은 매핑 자체는 유지되지만 서버 키가 변경
    expect(serverConditionKey(10)).not.toBe('volume_breakout'); // 이전: volume_breakout (서버 의미)
    expect(serverConditionKey(10)).toBe('ma_alignment'); // 정정: ma_alignment (클라 의미)
  });

  it('매핑 없는 ID 는 null 반환', () => {
    // 매핑 안 된 19개 ID 가 모두 null
    const mappedIds = new Set(EXPECTED_MAPPING.map(([id]) => id));
    for (let id = 1; id <= 27; id += 1) {
      if (mappedIds.has(id)) continue;
      expect(serverConditionKey(id), `ID ${id} 는 매핑 없어 null 반환 의무`).toBeNull();
    }
  });

  it('역매핑 conditionIdFromServerKey 정합', () => {
    expect(conditionIdFromServerKey('momentum')).toBe(2);
    expect(conditionIdFromServerKey('supply_confluence')).toBe(4);
    expect(conditionIdFromServerKey('ma_alignment')).toBe(10);
    expect(conditionIdFromServerKey('volume_breakout')).toBe(11);
    expect(conditionIdFromServerKey('turtle_high')).toBe(18);
    expect(conditionIdFromServerKey('earnings_quality')).toBe(21);
    expect(conditionIdFromServerKey('relative_strength')).toBe(24);
    expect(conditionIdFromServerKey('vcp')).toBe(25);
    // 매핑 없는 키
    expect(conditionIdFromServerKey('breakout_momentum')).toBeNull();
    expect(conditionIdFromServerKey('rsi_zone')).toBeNull();
    expect(conditionIdFromServerKey('per')).toBeNull();
  });
});

describe('ADR-0149 — buildEntryConditionScores 자동 정합 (호출자 변경 0)', () => {
  it('momentum 키 입력 → 클라 ID 2 에 HIGH_SCORE (ID 18 회귀 차단)', () => {
    const scores = buildEntryConditionScores(['momentum']);
    expect(scores[2]).toBe(ENTRY_CONDITION_HIGH_SCORE);
    expect(scores[18]).toBe(ENTRY_CONDITION_NEUTRAL_SCORE); // 이전: 18 에 HIGH 였음 (잘못)
  });

  it('volume_breakout 키 입력 → 클라 ID 11 에 HIGH (ID 10 회귀 차단)', () => {
    const scores = buildEntryConditionScores(['volume_breakout']);
    expect(scores[11]).toBe(ENTRY_CONDITION_HIGH_SCORE);
    expect(scores[10]).toBe(ENTRY_CONDITION_NEUTRAL_SCORE); // 이전: 10 (잘못)
  });

  it('turtle_high 키 입력 → 클라 ID 18 에 HIGH (ID 20 회귀 차단)', () => {
    const scores = buildEntryConditionScores(['turtle_high']);
    expect(scores[18]).toBe(ENTRY_CONDITION_HIGH_SCORE);
    expect(scores[20]).toBe(ENTRY_CONDITION_NEUTRAL_SCORE); // 이전: 20 (잘못)
  });

  it('ma_alignment 키 입력 → 클라 ID 10 에 HIGH (ID 9 회귀 차단)', () => {
    const scores = buildEntryConditionScores(['ma_alignment']);
    expect(scores[10]).toBe(ENTRY_CONDITION_HIGH_SCORE);
    expect(scores[9]).toBe(ENTRY_CONDITION_NEUTRAL_SCORE); // 이전: 9 (잘못)
  });

  it('relative_strength 키 입력 → 클라 ID 24 에 HIGH (ID 17 회귀 차단)', () => {
    const scores = buildEntryConditionScores(['relative_strength']);
    expect(scores[24]).toBe(ENTRY_CONDITION_HIGH_SCORE);
    expect(scores[17]).toBe(ENTRY_CONDITION_NEUTRAL_SCORE); // 이전: 17 (잘못)
  });

  it('vcp 키 입력 → 클라 ID 25 에 HIGH (이전과 동일 — 정합 보존)', () => {
    const scores = buildEntryConditionScores(['vcp']);
    expect(scores[25]).toBe(ENTRY_CONDITION_HIGH_SCORE);
  });

  it('ADR-0149 신규 매핑 — supply_confluence → ID 4', () => {
    const scores = buildEntryConditionScores(['supply_confluence']);
    expect(scores[4]).toBe(ENTRY_CONDITION_HIGH_SCORE);
  });

  it('ADR-0149 신규 매핑 — earnings_quality → ID 21', () => {
    const scores = buildEntryConditionScores(['earnings_quality']);
    expect(scores[21]).toBe(ENTRY_CONDITION_HIGH_SCORE);
  });

  it('다중 키 입력 — 8 키 모두 클라 ID 의미로 정합', () => {
    const allKeys = [
      'momentum',
      'supply_confluence',
      'ma_alignment',
      'volume_breakout',
      'turtle_high',
      'earnings_quality',
      'relative_strength',
      'vcp',
    ];
    const scores = buildEntryConditionScores(allKeys);
    // 8 매핑된 ID 는 HIGH
    expect(scores[2]).toBe(ENTRY_CONDITION_HIGH_SCORE);
    expect(scores[4]).toBe(ENTRY_CONDITION_HIGH_SCORE);
    expect(scores[10]).toBe(ENTRY_CONDITION_HIGH_SCORE);
    expect(scores[11]).toBe(ENTRY_CONDITION_HIGH_SCORE);
    expect(scores[18]).toBe(ENTRY_CONDITION_HIGH_SCORE);
    expect(scores[21]).toBe(ENTRY_CONDITION_HIGH_SCORE);
    expect(scores[24]).toBe(ENTRY_CONDITION_HIGH_SCORE);
    expect(scores[25]).toBe(ENTRY_CONDITION_HIGH_SCORE);
    // 나머지 19 ID 는 NEUTRAL
    const highIds = new Set([2, 4, 10, 11, 18, 21, 24, 25]);
    for (let id = 1; id <= 27; id += 1) {
      if (highIds.has(id)) continue;
      expect(scores[id], `ID ${id} 는 NEUTRAL 의무`).toBe(ENTRY_CONDITION_NEUTRAL_SCORE);
    }
  });

  it('서버 자체 키 (매핑 없음) — 무시되고 NEUTRAL 유지', () => {
    // breakout_momentum, rsi_zone, macd_bull, pullback, ma60_rising, weekly_rsi_zone, per
    // 는 클라 27 조건과 직접 매핑 없는 서버 자체 평가 키 — buildEntryConditionScores
    // 가 무시 (NEUTRAL 유지) 보장.
    const scores = buildEntryConditionScores([
      'breakout_momentum',
      'rsi_zone',
      'macd_bull',
      'pullback',
      'ma60_rising',
      'weekly_rsi_zone',
      'per',
    ]);
    // 모든 ID NEUTRAL
    for (let id = 1; id <= 27; id += 1) {
      expect(scores[id]).toBe(ENTRY_CONDITION_NEUTRAL_SCORE);
    }
  });
});

describe('ADR-0149 — 호출자 자동 정합 (정적 grep 가드)', () => {
  it('serverConditionKey 호출자 8 site 가 변경 없이 정합 동작', async () => {
    // 호출자 매트릭스 (audit findings.md §"호출자 매트릭스"):
    //   1. server/learning/incrementalCalibrator.ts
    //   2. server/learning/signalCalibrator.ts
    //   3. server/learning/phaseMapCalibrator.ts
    //   4. server/learning/weeklySharpeMonitor.ts
    //   5. server/learning/conditionBoostHints.ts
    //   6. server/learning/failureToWeight.ts
    //   7. server/routes/systemRouter.ts
    //   8. server/trading/signalScanner/__tests__/conditionScoresWiring.test.ts
    //
    // 모두 *추상화 conditionId* 사용 — 매핑 정정 자체가 자동 정합 효과.
    // 본 케이스는 검증 자체보다는 호출자 list 의 SSOT 영속화 (drift 차단).
    const { readFileSync } = await import('fs');
    const expectedCallers = [
      'server/learning/incrementalCalibrator.ts',
      'server/learning/signalCalibrator.ts',
      'server/learning/phaseMapCalibrator.ts',
      'server/learning/weeklySharpeMonitor.ts',
      'server/learning/conditionBoostHints.ts',
      'server/learning/failureToWeight.ts',
      'server/routes/systemRouter.ts',
    ];
    for (const caller of expectedCallers) {
      const src = readFileSync(caller, 'utf-8');
      expect(
        src,
        `호출자 ${caller} 가 serverConditionKey 사용 의무 (drift 시 본 PR 영향 평가 갱신)`,
      ).toMatch(/serverConditionKey/);
    }
  });

  it('conditionIdFromServerKey 단일 호출자 entryConditionScores.ts 정합', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('server/learning/entryConditionScores.ts', 'utf-8');
    expect(src).toContain('conditionIdFromServerKey');
    expect(src).toContain('buildEntryConditionScores');
  });
});
