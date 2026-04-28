/**
 * @responsibility stopApproachAlert 손절 접근 3단계 경보 단위 테스트
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../alerts/telegramClient.js', () => ({
  sendPrivateAlert: vi.fn(() => Promise.resolve()),
}));

const {
  stopApproachAlert,
  classifyStopSource,
  buildAlertSpec,
  buildAlertMessage,
  BEP_TOLERANCE_PCT,
} = await import('../stopApproachAlert.js');
const { makeMockShadow, makeMockCtx } = await import('./_testHelpers.js');
const { sendPrivateAlert } = await import('../../../../alerts/telegramClient.js');

describe('stopApproachAlert (3-stage dedupe)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('손절가 위 5% 초과 거리 → 어떤 stage 도 발동 안 함', async () => {
    const shadow = makeMockShadow({ stopLoss: 90, hardStopLoss: 90 });
    // currentPrice 100 → stopLoss 90 → distToStop ≈ 11.1% (5% 초과)
    await stopApproachAlert(makeMockCtx({ shadow, currentPrice: 100, hardStopLoss: 90 }));
    expect(shadow.stopApproachStage).toBeUndefined();
    expect(sendPrivateAlert).not.toHaveBeenCalled();
  });

  it('Stage 1 (-5% 이내) 진입 → stage=1 + 1 telegram 호출', async () => {
    const shadow = makeMockShadow({ stopLoss: 90 });
    // currentPrice 94, hardStopLoss 90 → distToStop ≈ 4.4% < 5
    await stopApproachAlert(makeMockCtx({ shadow, currentPrice: 94, hardStopLoss: 90 }));
    expect(shadow.stopApproachStage).toBe(1);
    expect(sendPrivateAlert).toHaveBeenCalledOnce();
  });

  it('Stage 2 (-3% 이내) 진입 → stage=2 + 2 telegram (1 + 2)', async () => {
    const shadow = makeMockShadow({ stopLoss: 90 });
    // currentPrice 92, hardStopLoss 90 → distToStop ≈ 2.2% < 3 (and < 5)
    await stopApproachAlert(makeMockCtx({ shadow, currentPrice: 92, hardStopLoss: 90 }));
    expect(shadow.stopApproachStage).toBe(2);
    // Stage 1 발동 (4.4% < 5) + Stage 2 발동 (2.2% < 3) = 2 호출
    expect(sendPrivateAlert).toHaveBeenCalledTimes(2);
  });

  it('Stage 3 (-1% 이내) 진입 → stage=3 + 3 telegram (모두 신규)', async () => {
    const shadow = makeMockShadow({ stopLoss: 90 });
    // currentPrice 90.5, hardStopLoss 90 → distToStop ≈ 0.55% < 1 (and < 3, < 5)
    await stopApproachAlert(makeMockCtx({ shadow, currentPrice: 90.5, hardStopLoss: 90 }));
    expect(shadow.stopApproachStage).toBe(3);
    expect(sendPrivateAlert).toHaveBeenCalledTimes(3);
  });

  it('이미 stage=2 인 상태에서 Stage 1/2 재발동 차단, Stage 3 만 신규 송출', async () => {
    const shadow = makeMockShadow({ stopLoss: 90, stopApproachStage: 2 });
    await stopApproachAlert(makeMockCtx({ shadow, currentPrice: 90.5, hardStopLoss: 90 }));
    expect(shadow.stopApproachStage).toBe(3);
    expect(sendPrivateAlert).toHaveBeenCalledTimes(1); // Stage 3 만
  });

  it('손절가 아래 (distToStop ≤ 0) → 모든 stage 차단 (하드스톱 영역)', async () => {
    const shadow = makeMockShadow({ stopLoss: 90 });
    await stopApproachAlert(makeMockCtx({ shadow, currentPrice: 89, hardStopLoss: 90 }));
    expect(shadow.stopApproachStage).toBeUndefined();
    expect(sendPrivateAlert).not.toHaveBeenCalled();
  });
});

describe('classifyStopSource (ADR-0028 보강)', () => {
  it('hardStopLoss < shadowEntryPrice (실손실) → LOSS_STOP', () => {
    expect(classifyStopSource(90, 100)).toBe('LOSS_STOP');
    expect(classifyStopSource(28500, 31000)).toBe('LOSS_STOP');
  });

  it('hardStopLoss === shadowEntryPrice (BEP) → BEP_PROTECTION', () => {
    expect(classifyStopSource(100, 100)).toBe('BEP_PROTECTION');
    expect(classifyStopSource(32096, 32096)).toBe('BEP_PROTECTION');
  });

  it('hardStopLoss 가 매수가 ±0.5% 이내 → BEP_PROTECTION', () => {
    expect(classifyStopSource(100.4, 100)).toBe('BEP_PROTECTION'); // +0.4%
    expect(classifyStopSource(99.6, 100)).toBe('BEP_PROTECTION');  // -0.4%
    expect(classifyStopSource(100.5, 100)).toBe('BEP_PROTECTION'); // 정확히 +0.5% 경계
  });

  it('hardStopLoss > shadowEntryPrice +0.5% (수익 Lock-in) → PROFIT_LOCK_IN', () => {
    expect(classifyStopSource(105, 100)).toBe('PROFIT_LOCK_IN');
    expect(classifyStopSource(33500, 32000)).toBe('PROFIT_LOCK_IN');
    expect(classifyStopSource(100.51, 100)).toBe('PROFIT_LOCK_IN'); // 경계 바로 위
  });

  it('shadowEntryPrice 0/음수/NaN → LOSS_STOP 안전 fallback', () => {
    expect(classifyStopSource(90, 0)).toBe('LOSS_STOP');
    expect(classifyStopSource(90, -100)).toBe('LOSS_STOP');
    expect(classifyStopSource(90, NaN)).toBe('LOSS_STOP');
    expect(classifyStopSource(NaN, 100)).toBe('LOSS_STOP');
    expect(classifyStopSource(Infinity, 100)).toBe('LOSS_STOP');
  });

  it('tolerance 인자 override 가능 — ±1% 로 늘리면 더 관대', () => {
    expect(classifyStopSource(100.8, 100, 1)).toBe('BEP_PROTECTION');
    expect(classifyStopSource(100.8, 100)).toBe('PROFIT_LOCK_IN'); // 기본 0.5
  });

  it('BEP_TOLERANCE_PCT 상수 = 0.5', () => {
    expect(BEP_TOLERANCE_PCT).toBe(0.5);
  });

  // ─── ADR-0079 PR-Z7 H1: BEP Glide 영역 BEP_PROTECTION 흡수 ─────────────────

  describe('ADR-0079 BEP Glide 영역 (PR-Z7 H1 fix)', () => {
    const originalDisabled = process.env.BEP_GLIDE_DISABLED;

    beforeEach(() => {
      delete process.env.BEP_GLIDE_DISABLED;
    });

    afterEach(() => {
      if (originalDisabled === undefined) {
        delete process.env.BEP_GLIDE_DISABLED;
      } else {
        process.env.BEP_GLIDE_DISABLED = originalDisabled;
      }
    });

    it('ATR=1500 / entryPrice=10000 / hardStopLoss=9250 → BEP_PROTECTION (글라이드 흡수)', () => {
      // PR-Z6 BEP Glide 적용 결과: trailingStopPrice = 10000 − 0.5 × 1500 = 9250
      // 기존 동작 (entryATR14 미전달): -7.5% 차이 → LOSS_STOP 오분류
      // PR-Z7 H1 fix: entryATR14 전달 시 글라이드 영역 BEP_PROTECTION 흡수
      expect(
        classifyStopSource(9250, 10000, BEP_TOLERANCE_PCT, 1500),
      ).toBe('BEP_PROTECTION');
    });

    it('ATR=300 / entryPrice=10000 / hardStopLoss=9850 → BEP_PROTECTION', () => {
      // 저변동 종목: 글라이드 = 10000 − 150 = 9850, -1.5% 차이
      expect(
        classifyStopSource(9850, 10000, BEP_TOLERANCE_PCT, 300),
      ).toBe('BEP_PROTECTION');
    });

    it('글라이드 하한 정확히 = entryPrice − 0.5×ATR 경계 → BEP_PROTECTION', () => {
      // 경계값 inclusive: hardStopLoss === glideFloor 인 경우도 흡수
      expect(
        classifyStopSource(9250, 10000, BEP_TOLERANCE_PCT, 1500),
      ).toBe('BEP_PROTECTION');
    });

    it('글라이드 하한 미만 → LOSS_STOP (실손실 청산 정확 분류)', () => {
      // hardStopLoss = 9249 < glideFloor 9250 → BEP 영역 밖
      expect(
        classifyStopSource(9249, 10000, BEP_TOLERANCE_PCT, 1500),
      ).toBe('LOSS_STOP');
    });

    it('entryATR14 미전달 (기존 동작 회귀 보장) — 글라이드 영역도 LOSS_STOP', () => {
      // entryATR14 옵셔널 부재 시 본 fix 미적용 — 기존 호출자 무영향
      expect(classifyStopSource(9250, 10000)).toBe('LOSS_STOP');
      expect(classifyStopSource(9250, 10000, BEP_TOLERANCE_PCT)).toBe('LOSS_STOP');
    });

    it('entryATR14=0 (회귀 보장) — 글라이드 분기 무시', () => {
      expect(
        classifyStopSource(9250, 10000, BEP_TOLERANCE_PCT, 0),
      ).toBe('LOSS_STOP');
    });

    it('entryATR14=NaN/Infinity (안전 가드) — 글라이드 분기 무시', () => {
      expect(
        classifyStopSource(9250, 10000, BEP_TOLERANCE_PCT, NaN),
      ).toBe('LOSS_STOP');
      expect(
        classifyStopSource(9250, 10000, BEP_TOLERANCE_PCT, Infinity),
      ).toBe('LOSS_STOP');
    });

    it('entryATR14=음수 (안전 가드) — 글라이드 분기 무시', () => {
      expect(
        classifyStopSource(9250, 10000, BEP_TOLERANCE_PCT, -500),
      ).toBe('LOSS_STOP');
    });

    it('BEP_GLIDE_DISABLED=true env 시 글라이드 영역도 LOSS_STOP (롤백)', () => {
      process.env.BEP_GLIDE_DISABLED = 'true';
      expect(
        classifyStopSource(9250, 10000, BEP_TOLERANCE_PCT, 1500),
      ).toBe('LOSS_STOP');
    });

    it('PROFIT_LOCK_IN 우선순위 보존 — 글라이드 분기보다 먼저 처리', () => {
      // hardStopLoss > entryPrice 면 글라이드 분기 진입 안 함
      expect(
        classifyStopSource(10500, 10000, BEP_TOLERANCE_PCT, 1500),
      ).toBe('PROFIT_LOCK_IN');
    });

    it('정확 BEP 우선순위 보존 — ±0.5% 이내는 글라이드 분기 전에 BEP_PROTECTION', () => {
      // hardStopLoss = 10000 (정확 BEP) 시 ATR 무관 BEP_PROTECTION
      expect(
        classifyStopSource(10000, 10000, BEP_TOLERANCE_PCT, 1500),
      ).toBe('BEP_PROTECTION');
    });

    it('ATR=2000 / entryPrice=10000 / hardStopLoss=9000 (글라이드 하한 내) → BEP_PROTECTION', () => {
      // 고변동: 글라이드 하한 = 10000 − 1000 = 9000
      expect(
        classifyStopSource(9000, 10000, BEP_TOLERANCE_PCT, 2000),
      ).toBe('BEP_PROTECTION');
    });
  });
});

describe('buildAlertSpec (라벨 매트릭스 SSOT)', () => {
  it('LOSS_STOP × stage 3 → 🔴 [손절 집행 임박]', () => {
    const spec = buildAlertSpec('LOSS_STOP', 3);
    expect(spec.emoji).toBe('🔴');
    expect(spec.label).toBe('[손절 집행 임박]');
    expect(spec.distSuffix).toContain('곧 청산 실행');
  });

  it('LOSS_STOP × stage 2 → 🟠 [손절 임박]', () => {
    const spec = buildAlertSpec('LOSS_STOP', 2);
    expect(spec.emoji).toBe('🟠');
    expect(spec.label).toBe('[손절 임박]');
  });

  it('LOSS_STOP × stage 1 → 🟡 [손절 임박]', () => {
    const spec = buildAlertSpec('LOSS_STOP', 1);
    expect(spec.emoji).toBe('🟡');
    expect(spec.label).toBe('[손절 임박]');
  });

  it('BEP_PROTECTION × 모든 stage → 🟡 [BEP 청산선 임박]', () => {
    expect(buildAlertSpec('BEP_PROTECTION', 1).label).toBe('[BEP 청산선 임박]');
    expect(buildAlertSpec('BEP_PROTECTION', 2).label).toBe('[BEP 청산선 임박]');
    expect(buildAlertSpec('BEP_PROTECTION', 3).label).toBe('[BEP 청산선 임박]');
    expect(buildAlertSpec('BEP_PROTECTION', 2).distSuffix).toContain('무손실');
  });

  it('PROFIT_LOCK_IN × 모든 stage → 🟢 [원금 보호선 임박]', () => {
    expect(buildAlertSpec('PROFIT_LOCK_IN', 1).label).toBe('[원금 보호선 임박]');
    expect(buildAlertSpec('PROFIT_LOCK_IN', 2).label).toBe('[원금 보호선 임박]');
    expect(buildAlertSpec('PROFIT_LOCK_IN', 3).label).toBe('[원금 보호선 임박]');
    expect(buildAlertSpec('PROFIT_LOCK_IN', 2).distSuffix).toContain('수익 락인');
  });
});

describe('buildAlertMessage (3 메트릭 동시 노출)', () => {
  it('사용자 보고 시나리오: 진입가=32,096, 현재가=32,950, hardStop=32,096 → BEP 라벨', () => {
    const msg = buildAlertMessage({
      stockName: '에코프로에이치엔',
      stockCode: '383310',
      currentPrice: 32950,
      shadowEntryPrice: 32096,
      hardStopLoss: 32096,
      distToStopPct: 2.7,
      stage: 2,
      source: 'BEP_PROTECTION',
    });
    // 라벨이 "손절 임박" 이 아닌 "BEP 청산선 임박"
    expect(msg).toContain('BEP 청산선 임박');
    expect(msg).not.toMatch(/손절\s*임박/);
    // 진입가 대비 pnlPct 표시 (수익 +2.66%)
    expect(msg).toContain('+2.66%');
    // 청산선 = 매수가 명시
    expect(msg).toContain('= 매수가');
    // BEP 청산선 라벨
    expect(msg).toContain('BEP 청산선');
    // 도달까지 -2.7% 표기는 보존
    expect(msg).toContain('-2.7%');
    expect(msg).toContain('무손실 청산 직전');
    expect(msg).toContain('에코프로에이치엔');
    expect(msg).toContain('383310');
  });

  it('PROFIT_LOCK_IN 시나리오: 진입가=100, 현재가=110, hardStop=105 → 🟢 원금 보호선', () => {
    const msg = buildAlertMessage({
      stockName: '삼성전자',
      stockCode: '005930',
      currentPrice: 110,
      shadowEntryPrice: 100,
      hardStopLoss: 105,
      distToStopPct: 4.5,
      stage: 1,
      source: 'PROFIT_LOCK_IN',
    });
    expect(msg).toContain('원금 보호선 임박');
    expect(msg).toContain('🟢');
    expect(msg).toContain('+10.00%'); // 진입가 대비 +10%
    expect(msg).toContain('매수가 +5.00%'); // 청산선이 매수가 +5%
    expect(msg).not.toMatch(/손절/);
  });

  it('LOSS_STOP 시나리오: 진입가=100, 현재가=92, hardStop=90 → 🟠 손절 임박', () => {
    const msg = buildAlertMessage({
      stockName: '삼성전자',
      stockCode: '005930',
      currentPrice: 92,
      shadowEntryPrice: 100,
      hardStopLoss: 90,
      distToStopPct: 2.2,
      stage: 2,
      source: 'LOSS_STOP',
    });
    expect(msg).toContain('손절 임박');
    expect(msg).toContain('🟠');
    expect(msg).toContain('-8.00%'); // 진입가 대비 -8%
    expect(msg).toContain('매수가 -10.00%'); // 청산선이 매수가 -10%
  });

  it('shadowEntryPrice=0 (정보 부족) → pnlPct/stopVsEntry 0% fallback, "손절가" 라벨 유지', () => {
    const msg = buildAlertMessage({
      stockName: 'TEST',
      stockCode: 'X',
      currentPrice: 100,
      shadowEntryPrice: 0,
      hardStopLoss: 90,
      distToStopPct: 10,
      stage: 1,
      source: 'LOSS_STOP',
    });
    expect(msg).toContain('+0.00%');
    expect(msg).toContain('손절가');
  });
});

describe('stopApproachAlert + classifyStopSource 통합 (사용자 보고 시나리오)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('hardStop 가 진입가까지 상향된 BEP 케이스 → 알림 메시지가 "BEP 청산선 임박" 라벨', async () => {
    // 사용자 시나리오 그대로: 진입가 32,096 = hardStopLoss 32,096 = BEP, 현재가 32,950 = +2.66% 수익
    const shadow = makeMockShadow({
      stockName: '에코프로에이치엔',
      stockCode: '383310',
      shadowEntryPrice: 32096,
      stopLoss: 32096,
      hardStopLoss: 32096,
    });
    // distToStop = (32950 - 32096) / 32096 = 2.66% → Stage 1 + Stage 2 발동
    await stopApproachAlert(makeMockCtx({ shadow, currentPrice: 32950, hardStopLoss: 32096 }));
    expect(shadow.stopApproachStage).toBe(2);
    expect(sendPrivateAlert).toHaveBeenCalledTimes(2);
    // 두 호출 모두 BEP 라벨 + "손절 임박" 단어 부재
    for (const call of (sendPrivateAlert as unknown as { mock: { calls: unknown[][] } }).mock.calls) {
      const msg = String(call[0]);
      expect(msg).toContain('BEP 청산선 임박');
      expect(msg).not.toMatch(/손절\s*임박/);
      expect(msg).toContain('+2.66%');
      expect(msg).toContain('= 매수가');
    }
  });

  it('hardStop > 진입가 (수익 Lock-in) 케이스 → 알림 메시지가 "원금 보호선 임박" 라벨', async () => {
    const shadow = makeMockShadow({
      shadowEntryPrice: 100,
      stopLoss: 105,
      hardStopLoss: 105,
    });
    // currentPrice 109 → distToStop = (109-105)/105 ≈ 3.81% → Stage 1 만
    await stopApproachAlert(makeMockCtx({ shadow, currentPrice: 109, hardStopLoss: 105 }));
    expect(shadow.stopApproachStage).toBe(1);
    expect(sendPrivateAlert).toHaveBeenCalledOnce();
    const msg = String(((sendPrivateAlert as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]));
    expect(msg).toContain('원금 보호선 임박');
    expect(msg).toContain('🟢');
    expect(msg).not.toMatch(/손절/);
  });

  it('실손실 케이스 (hardStop < 진입가) → 기존 동작 유지: 🚨 손절 임박 라벨', async () => {
    const shadow = makeMockShadow({ shadowEntryPrice: 100, stopLoss: 90, hardStopLoss: 90 });
    await stopApproachAlert(makeMockCtx({ shadow, currentPrice: 92, hardStopLoss: 90 }));
    expect(shadow.stopApproachStage).toBe(2);
    expect(sendPrivateAlert).toHaveBeenCalledTimes(2);
    const stage2Msg = String(((sendPrivateAlert as unknown as { mock: { calls: unknown[][] } }).mock.calls[1]![0]));
    expect(stage2Msg).toContain('손절 임박');
    expect(stage2Msg).toContain('🟠');
    // pnlPct 음수 표시
    expect(stage2Msg).toContain('-8.00%');
  });
});
