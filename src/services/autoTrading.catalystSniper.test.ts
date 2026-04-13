import { describe, expect, it } from 'vitest';
import {
  catalystTimingFilter,
  sniperEntryCheck,
  countTradingDays,
  CATALYST_TIMING_MATRIX,
  type CatalystTimingInput,
  type CatalystType,
  type OrderBookSnapshot,
  type SniperEntryInput,
} from './autoTrading/autoTradeEngine';

// ═══════════════════════════════════════════════════════════════════════════════
// ── countTradingDays 유틸 ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('countTradingDays', () => {
  it('같은 날 → 0 거래일', () => {
    expect(countTradingDays('2026-04-13', '2026-04-13')).toBe(0);
  });

  it('월→화 (1 거래일)', () => {
    expect(countTradingDays('2026-04-13', '2026-04-14')).toBe(1);
  });

  it('월→금 (4 거래일)', () => {
    expect(countTradingDays('2026-04-13', '2026-04-17')).toBe(4);
  });

  it('금→월 (주말 제외, 1 거래일)', () => {
    expect(countTradingDays('2026-04-17', '2026-04-20')).toBe(1);
  });

  it('금→다음 금 (5 거래일)', () => {
    expect(countTradingDays('2026-04-10', '2026-04-17')).toBe(5);
  });

  it('역순 날짜 → 0', () => {
    expect(countTradingDays('2026-04-15', '2026-04-10')).toBe(0);
  });

  it('2주간 (10 거래일)', () => {
    expect(countTradingDays('2026-04-06', '2026-04-20')).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── Catalyst Timing Matrix ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function makeTimingInput(overrides: Partial<CatalystTimingInput>): CatalystTimingInput {
  return {
    catalystType: 'LARGE_ORDER',
    catalystDate: '2026-04-10',
    currentDate: '2026-04-10',
    marketMinutesSinceOpen: 90, // 10:30 KST
    ...overrides,
  };
}

// ─── 타이밍 매트릭스 상수 테이블 검증 ─────────────────────────────────────────

describe('CATALYST_TIMING_MATRIX — 상수 테이블', () => {
  it('5가지 촉매 유형 모두 등록', () => {
    const types: CatalystType[] = [
      'LARGE_ORDER', 'EARNINGS_SURPRISE', 'TARGET_UPGRADE',
      'POLICY_BENEFIT', 'FOREIGN_BULK_BUY',
    ];
    for (const t of types) {
      expect(CATALYST_TIMING_MATRIX[t]).toBeDefined();
    }
  });

  it('LARGE_ORDER: 즉일 50% 진입 허용', () => {
    const rule = CATALYST_TIMING_MATRIX.LARGE_ORDER;
    expect(rule.minDelayDays).toBe(0);
    expect(rule.sameDayEntryRatio).toBe(0.5);
  });

  it('EARNINGS_SURPRISE: 즉일 진입 자제, 2일 대기', () => {
    const rule = CATALYST_TIMING_MATRIX.EARNINGS_SURPRISE;
    expect(rule.minDelayDays).toBe(2);
    expect(rule.sameDayEntryRatio).toBe(0);
  });

  it('POLICY_BENEFIT: 즉일 금지, 3일 대기', () => {
    const rule = CATALYST_TIMING_MATRIX.POLICY_BENEFIT;
    expect(rule.minDelayDays).toBe(3);
    expect(rule.sameDayEntryRatio).toBe(0);
  });

  it('FOREIGN_BULK_BUY: 1일 대기, 당일 진입 금지', () => {
    const rule = CATALYST_TIMING_MATRIX.FOREIGN_BULK_BUY;
    expect(rule.minDelayDays).toBe(1);
    expect(rule.sameDayEntryRatio).toBe(0);
  });
});

// ─── ① 대형 수주 공시 ─────────────────────────────────────────────────────────

describe('catalystTimingFilter — ① 대형 수주 공시 (LARGE_ORDER)', () => {
  it('즉일 갭상승 유지 + 10시 이후 → canEnter=true, 50% 진입', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'LARGE_ORDER',
      catalystDate: '2026-04-10',
      currentDate: '2026-04-10',
      marketMinutesSinceOpen: 90,
      gapChangePercent: 3.5,
    }));
    expect(result.canEnter).toBe(true);
    expect(result.entryRatio).toBe(0.5);
    expect(result.reason).toContain('50%');
  });

  it('즉일 갭 메꿈 (음수) → canEnter=false', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'LARGE_ORDER',
      catalystDate: '2026-04-10',
      currentDate: '2026-04-10',
      marketMinutesSinceOpen: 90,
      gapChangePercent: -1.2,
    }));
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('갭 메꿈');
  });

  it('즉일 10시 전 → canEnter=false (안정화 대기)', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'LARGE_ORDER',
      catalystDate: '2026-04-10',
      currentDate: '2026-04-10',
      marketMinutesSinceOpen: 30,  // 09:30 KST
    }));
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('장 경과 대기');
  });

  it('공시 2일 후 → canEnter=true, 100% 진입', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'LARGE_ORDER',
      catalystDate: '2026-04-10',
      currentDate: '2026-04-14',   // 월(13) = 1거래일, 화(14) = 2거래일
      marketMinutesSinceOpen: 90,
    }));
    expect(result.canEnter).toBe(true);
    expect(result.entryRatio).toBe(1.0);
  });

  it('공시 4일 후(maxDelay 초과) → 촉매 효력 소멸', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'LARGE_ORDER',
      catalystDate: '2026-04-06',   // 월요일
      currentDate: '2026-04-13',    // 다음 월 = 5거래일
      marketMinutesSinceOpen: 90,
    }));
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('효력 소멸');
  });
});

// ─── ② 실적 서프라이즈 ───────────────────────────────────────────────────────

describe('catalystTimingFilter — ② 실적 서프라이즈 (EARNINGS_SURPRISE)', () => {
  it('즉일 → canEnter=false (최소 2일 대기)', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'EARNINGS_SURPRISE',
      catalystDate: '2026-04-10',
      currentDate: '2026-04-10',
    }));
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('대기 중');
  });

  it('1거래일 경과 → canEnter=false (아직 대기)', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'EARNINGS_SURPRISE',
      catalystDate: '2026-04-10',
      currentDate: '2026-04-13',
    }));
    expect(result.canEnter).toBe(false);
  });

  it('2거래일 + 첫 양봉 미출현 → canEnter=false', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'EARNINGS_SURPRISE',
      catalystDate: '2026-04-08',  // 수요일
      currentDate: '2026-04-10',   // 금요일 = 2거래일
      firstBullishCandleAppeared: false,
    }));
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('첫 양봉 미출현');
  });

  it('3거래일 + 첫 양봉 출현 → canEnter=true', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'EARNINGS_SURPRISE',
      catalystDate: '2026-04-07',  // 화요일
      currentDate: '2026-04-10',   // 금요일 = 3거래일
      firstBullishCandleAppeared: true,
    }));
    expect(result.canEnter).toBe(true);
    expect(result.entryRatio).toBe(1.0);
    expect(result.reason).toContain('첫 양봉 출현');
  });

  it('6거래일 (maxDelay=5 초과) → 효력 소멸', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'EARNINGS_SURPRISE',
      catalystDate: '2026-04-01',  // 수요일
      currentDate: '2026-04-10',   // 다음주 금요일 = 7거래일
      firstBullishCandleAppeared: true,
    }));
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('효력 소멸');
  });
});

// ─── ③ 애널리스트 목표가 상향 ─────────────────────────────────────────────────

describe('catalystTimingFilter — ③ 애널리스트 목표가 상향 (TARGET_UPGRADE)', () => {
  it('당일 10시 이후 → canEnter=true, 100% 진입', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'TARGET_UPGRADE',
      catalystDate: '2026-04-10',
      currentDate: '2026-04-10',
      marketMinutesSinceOpen: 70,   // 10:10 KST
    }));
    expect(result.canEnter).toBe(true);
    expect(result.entryRatio).toBe(1.0);
  });

  it('당일 10시 전 → canEnter=false', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'TARGET_UPGRADE',
      catalystDate: '2026-04-10',
      currentDate: '2026-04-10',
      marketMinutesSinceOpen: 45,   // 09:45 KST
    }));
    expect(result.canEnter).toBe(false);
  });

  it('3거래일 후(maxDelay=2 초과) → 효력 소멸', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'TARGET_UPGRADE',
      catalystDate: '2026-04-07',
      currentDate: '2026-04-10',   // 3거래일
      marketMinutesSinceOpen: 90,
    }));
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('효력 소멸');
  });
});

// ─── ④ 정책 수혜 발표 ─────────────────────────────────────────────────────────

describe('catalystTimingFilter — ④ 정책 수혜 발표 (POLICY_BENEFIT)', () => {
  it('즉일 → canEnter=false (3일 대기 필요)', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'POLICY_BENEFIT',
      catalystDate: '2026-04-10',
      currentDate: '2026-04-10',
    }));
    expect(result.canEnter).toBe(false);
  });

  it('2거래일 → canEnter=false (아직 대기)', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'POLICY_BENEFIT',
      catalystDate: '2026-04-08',
      currentDate: '2026-04-10',
    }));
    expect(result.canEnter).toBe(false);
  });

  it('3거래일 + 눌림목 미출현 → canEnter=false', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'POLICY_BENEFIT',
      catalystDate: '2026-04-07',
      currentDate: '2026-04-10',   // 3거래일
      pullbackAppeared: false,
    }));
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('눌림목 미출현');
  });

  it('4거래일 + 눌림목 출현 → canEnter=true', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'POLICY_BENEFIT',
      catalystDate: '2026-04-06',   // 월요일
      currentDate: '2026-04-10',    // 금요일 = 4거래일
      pullbackAppeared: true,
    }));
    expect(result.canEnter).toBe(true);
    expect(result.entryRatio).toBe(1.0);
  });

  it('8거래일 (maxDelay=7 초과) → 효력 소멸', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'POLICY_BENEFIT',
      catalystDate: '2026-03-30',   // 2주 전
      currentDate: '2026-04-10',    // 9거래일
      pullbackAppeared: true,
    }));
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('효력 소멸');
  });
});

// ─── ⑤ 외국인 갑작스러운 대량 매수 ───────────────────────────────────────────

describe('catalystTimingFilter — ⑤ 외국인 대량 매수 (FOREIGN_BULK_BUY)', () => {
  it('당일 → canEnter=false (익일 대기)', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'FOREIGN_BULK_BUY',
      catalystDate: '2026-04-10',
      currentDate: '2026-04-10',
    }));
    expect(result.canEnter).toBe(false);
  });

  it('익일 10시 전 → canEnter=false (장 경과 대기)', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'FOREIGN_BULK_BUY',
      catalystDate: '2026-04-10',
      currentDate: '2026-04-13',   // 1거래일 (주말 건너뜀)
      marketMinutesSinceOpen: 30,
    }));
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('장 경과 대기');
  });

  it('익일 10시 이후 → canEnter=true', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'FOREIGN_BULK_BUY',
      catalystDate: '2026-04-10',
      currentDate: '2026-04-13',   // 1거래일
      marketMinutesSinceOpen: 70,
    }));
    expect(result.canEnter).toBe(true);
    expect(result.entryRatio).toBe(1.0);
  });

  it('4거래일 후(maxDelay=3 초과) → 효력 소멸', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'FOREIGN_BULK_BUY',
      catalystDate: '2026-04-06',
      currentDate: '2026-04-10',   // 4거래일
      marketMinutesSinceOpen: 90,
    }));
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('효력 소멸');
  });
});

// ─── 공통 동작 ─────────────────────────────────────────────────────────────────

describe('catalystTimingFilter — 공통 동작', () => {
  it('result에 tradingDaysElapsed와 rule이 항상 포함', () => {
    const result = catalystTimingFilter(makeTimingInput({
      catalystType: 'LARGE_ORDER',
    }));
    expect(typeof result.tradingDaysElapsed).toBe('number');
    expect(result.rule).toBeDefined();
    expect(result.rule.description).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── Sniper Entry ────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function makeOrderBook(overrides: Partial<OrderBookSnapshot>): OrderBookSnapshot {
  return {
    totalBidQty: 15000,
    totalAskQty: 10000,
    recentBuyVolume: 5000,
    recentSellVolume: 3000,
    largeSellBurstDetected: false,
    ...overrides,
  };
}

function makeSniperInput(overrides?: Partial<SniperEntryInput>): SniperEntryInput {
  return {
    orderBook: makeOrderBook({}),
    retryCount: 0,
    ...overrides,
  };
}

// ─── FIRE (즉시 발주) ─────────────────────────────────────────────────────────

describe('sniperEntryCheck — FIRE (즉시 발주)', () => {
  it('매수벽 1.5× + 체결 매수 우세 → FIRE', () => {
    const result = sniperEntryCheck(makeSniperInput({
      orderBook: makeOrderBook({ totalBidQty: 15000, totalAskQty: 10000 }),
    }));
    expect(result.decision).toBe('FIRE');
    expect(result.bidAskRatio).toBe(1.5);
    expect(result.executionStrength).toBeGreaterThan(1.0);
  });

  it('매수벽 2.0× + 강한 매수 체결 → FIRE', () => {
    const result = sniperEntryCheck(makeSniperInput({
      orderBook: makeOrderBook({
        totalBidQty: 20000, totalAskQty: 10000,
        recentBuyVolume: 8000, recentSellVolume: 3000,
      }),
    }));
    expect(result.decision).toBe('FIRE');
    expect(result.bidAskRatio).toBe(2.0);
  });

  it('FIRE 시 reason에 "즉시 발주" 포함', () => {
    const result = sniperEntryCheck(makeSniperInput());
    expect(result.reason).toContain('즉시 발주');
  });
});

// ─── DELAY (1분 지연) ─────────────────────────────────────────────────────────

describe('sniperEntryCheck — DELAY (1분 지연)', () => {
  it('매수벽 부족 (1.2×) → DELAY', () => {
    const result = sniperEntryCheck(makeSniperInput({
      orderBook: makeOrderBook({ totalBidQty: 12000, totalAskQty: 10000 }),
    }));
    expect(result.decision).toBe('DELAY');
    expect(result.bidAskRatio).toBe(1.2);
  });

  it('체결 강도 매도 우세 → DELAY', () => {
    const result = sniperEntryCheck(makeSniperInput({
      orderBook: makeOrderBook({
        totalBidQty: 15000, totalAskQty: 10000,
        recentBuyVolume: 2000, recentSellVolume: 3000,
      }),
    }));
    expect(result.decision).toBe('DELAY');
    expect(result.executionStrength).toBeLessThan(1.0);
  });

  it('대량 매도 연속 감지 → 즉시 DELAY', () => {
    const result = sniperEntryCheck(makeSniperInput({
      orderBook: makeOrderBook({
        totalBidQty: 20000, totalAskQty: 10000,
        largeSellBurstDetected: true,
      }),
    }));
    expect(result.decision).toBe('DELAY');
    expect(result.reason).toContain('대량 매도');
  });

  it('매도호가 잔량 0 + 매도 체결만 → DELAY (체결 강도 0)', () => {
    const result = sniperEntryCheck(makeSniperInput({
      orderBook: makeOrderBook({
        totalBidQty: 0, totalAskQty: 10000,
        recentBuyVolume: 0, recentSellVolume: 1000,
      }),
    }));
    expect(result.decision).toBe('DELAY');
  });

  it('DELAY 시 reason에 재판단 횟수 포함', () => {
    const result = sniperEntryCheck(makeSniperInput({
      orderBook: makeOrderBook({ totalBidQty: 10000, totalAskQty: 10000 }),
      retryCount: 1,
    }));
    expect(result.decision).toBe('DELAY');
    expect(result.reason).toContain('2/3');
  });
});

// ─── ABORT (발주 취소) ────────────────────────────────────────────────────────

describe('sniperEntryCheck — ABORT (발주 취소)', () => {
  it('재판단 3회 초과 → ABORT', () => {
    const result = sniperEntryCheck(makeSniperInput({
      orderBook: makeOrderBook({ totalBidQty: 8000, totalAskQty: 10000 }),
      retryCount: 3,
    }));
    expect(result.decision).toBe('ABORT');
    expect(result.reason).toContain('발주 취소');
  });

  it('재판단 4회 → ABORT', () => {
    const result = sniperEntryCheck(makeSniperInput({
      orderBook: makeOrderBook({}),
      retryCount: 4,
    }));
    expect(result.decision).toBe('ABORT');
  });

  it('조건 충족이어도 retryCount ≥ 3이면 ABORT 우선', () => {
    // 완벽한 호가 조건이어도 재판단 한도 초과 시 ABORT
    const result = sniperEntryCheck(makeSniperInput({
      orderBook: makeOrderBook({
        totalBidQty: 30000, totalAskQty: 10000,
        recentBuyVolume: 10000, recentSellVolume: 1000,
      }),
      retryCount: 3,
    }));
    expect(result.decision).toBe('ABORT');
  });
});

// ─── 엣지 케이스 ─────────────────────────────────────────────────────────────

describe('sniperEntryCheck — 엣지 케이스', () => {
  it('매도호가 잔량 0, 매수호가 있음 → bidAskRatio=Infinity → FIRE 조건 충족', () => {
    const result = sniperEntryCheck(makeSniperInput({
      orderBook: makeOrderBook({
        totalBidQty: 10000, totalAskQty: 0,
        recentBuyVolume: 5000, recentSellVolume: 3000,
      }),
    }));
    // Infinity >= 1.5 is true
    expect(result.decision).toBe('FIRE');
  });

  it('모든 잔량 0 → bidAskRatio=0 → DELAY', () => {
    const result = sniperEntryCheck(makeSniperInput({
      orderBook: makeOrderBook({
        totalBidQty: 0, totalAskQty: 0,
        recentBuyVolume: 0, recentSellVolume: 0,
      }),
    }));
    expect(result.decision).toBe('DELAY');
  });

  it('경계값: bidAskRatio 정확히 1.5 + executionStrength 정확히 1.0 → FIRE', () => {
    const result = sniperEntryCheck(makeSniperInput({
      orderBook: makeOrderBook({
        totalBidQty: 15000, totalAskQty: 10000,
        recentBuyVolume: 5000, recentSellVolume: 5000,
      }),
    }));
    expect(result.decision).toBe('FIRE');
    expect(result.bidAskRatio).toBe(1.5);
    expect(result.executionStrength).toBe(1.0);
  });

  it('bidAskRatio 1.49 (경계값 미만) → DELAY', () => {
    const result = sniperEntryCheck(makeSniperInput({
      orderBook: makeOrderBook({
        totalBidQty: 14900, totalAskQty: 10000,
        recentBuyVolume: 5000, recentSellVolume: 3000,
      }),
    }));
    expect(result.decision).toBe('DELAY');
    expect(result.bidAskRatio).toBe(1.49);
  });

  it('retryCount 기본값 0 (미지정)', () => {
    const result = sniperEntryCheck({ orderBook: makeOrderBook({}) });
    expect(result.decision).toBe('FIRE');
  });

  it('largeSellBurst는 bidAskRatio 무관하게 DELAY 우선', () => {
    const result = sniperEntryCheck(makeSniperInput({
      orderBook: makeOrderBook({
        totalBidQty: 50000, totalAskQty: 10000,  // 매수벽 5×
        recentBuyVolume: 10000, recentSellVolume: 1000,
        largeSellBurstDetected: true,
      }),
    }));
    expect(result.decision).toBe('DELAY');
  });
});

// ─── Sniper 연속 재판단 시뮬레이션 ─────────────────────────────────────────────

describe('sniperEntryCheck — 연속 재판단 시나리오', () => {
  it('3회 연속 매도벽 우세 → DELAY×3 → 4회차 ABORT', () => {
    const weakBook = makeOrderBook({ totalBidQty: 8000, totalAskQty: 10000 });

    const r0 = sniperEntryCheck({ orderBook: weakBook, retryCount: 0 });
    expect(r0.decision).toBe('DELAY');

    const r1 = sniperEntryCheck({ orderBook: weakBook, retryCount: 1 });
    expect(r1.decision).toBe('DELAY');

    const r2 = sniperEntryCheck({ orderBook: weakBook, retryCount: 2 });
    expect(r2.decision).toBe('DELAY');

    const r3 = sniperEntryCheck({ orderBook: weakBook, retryCount: 3 });
    expect(r3.decision).toBe('ABORT');
  });

  it('2회 DELAY 후 조건 충족 → FIRE', () => {
    const strongBook = makeOrderBook({
      totalBidQty: 20000, totalAskQty: 10000,
      recentBuyVolume: 6000, recentSellVolume: 3000,
    });

    const r2 = sniperEntryCheck({ orderBook: strongBook, retryCount: 2 });
    expect(r2.decision).toBe('FIRE');
  });
});
