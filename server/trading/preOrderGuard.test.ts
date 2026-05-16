/**
 * preOrderGuard.test.ts — Phase 2차 C3 회귀 테스트
 *
 * 가드가 3가지 위험 입력에 대해 반드시 throw 하고, 정상 입력은 통과시키는
 * 계약을 고정한다. 사이드이펙트(state 변화, 파일 쓰기)는 mock 으로 격리.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('preOrderGuard — Automated Kill Switch', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    // 외부 I/O 차단 — 텔레그램 실제 발송/KIS API 콜 방지
    vi.resetModules();
    vi.doMock('../alerts/telegramClient.js', () => ({
      sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('../emergency.js', () => ({
      cancelAllPendingOrders: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('../alerts/contaminationBlastRadius.js', () => ({
      sendBlastRadiusReport: vi.fn().mockResolvedValue(true),
    }));
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
    vi.doUnmock('../alerts/telegramClient.js');
    vi.doUnmock('../emergency.js');
    vi.doUnmock('../alerts/contaminationBlastRadius.js');
  });

  it('정상 주문 — throw 하지 않음', async () => {
    const { assertSafeOrder, _resetRecentOrders } = await import('./preOrderGuard.js');
    _resetRecentOrders();
    expect(() => assertSafeOrder({
      stockCode: '005930', stockName: '삼성전자',
      quantity: 10, entryPrice: 70000, stopLoss: 66000,
      totalAssets: 100_000_000,
    })).not.toThrow();
  });

  it('POSITION_EXPLOSION — 주문가치 > 총자산×1.5 시 throw + incident 기록', async () => {
    const { assertSafeOrder, PreOrderGuardError, _resetRecentOrders } = await import('./preOrderGuard.js');
    _resetRecentOrders();
    expect(() => assertSafeOrder({
      stockCode: '005930', stockName: '삼성전자',
      quantity: 1000, entryPrice: 200_000, stopLoss: 190_000,  // 2억
      totalAssets: 100_000_000,  // 1억 → ×1.5 = 1.5억 < 2억
    })).toThrow(PreOrderGuardError);

    // incident log 에 기록됐는지
    const incidentFile = path.join(tmpDir, 'incident-log.json');
    expect(fs.existsSync(incidentFile)).toBe(true);
    const entries = JSON.parse(fs.readFileSync(incidentFile, 'utf-8'));
    expect(entries.length).toBe(1);
    expect(entries[0].reason).toContain('주문가치');
    expect(entries[0].context.reason).toBe('POSITION_EXPLOSION');
  });

  it('STOPLOSS_LOGIC_BROKEN — stopLoss >= entryPrice 시 throw', async () => {
    const { assertSafeOrder, PreOrderGuardError, _resetRecentOrders } = await import('./preOrderGuard.js');
    _resetRecentOrders();
    expect(() => assertSafeOrder({
      stockCode: '005930', stockName: '삼성전자',
      quantity: 10, entryPrice: 70000, stopLoss: 70000,  // equal → BROKEN
      totalAssets: 100_000_000,
    })).toThrow(PreOrderGuardError);
  });

  it('ORDER_LOOP_SUSPECT — 동일 종목 3회 주문 시 3번째에서 throw', async () => {
    const { assertSafeOrder, PreOrderGuardError, _resetRecentOrders } = await import('./preOrderGuard.js');
    _resetRecentOrders();
    const base = {
      stockCode: '005930', stockName: '삼성전자',
      quantity: 10, entryPrice: 70000, stopLoss: 66000,
      totalAssets: 100_000_000,
    };
    expect(() => assertSafeOrder(base)).not.toThrow();
    expect(() => assertSafeOrder(base)).not.toThrow();
    expect(() => assertSafeOrder(base)).toThrow(PreOrderGuardError);
  });

  it('totalAssets 미상(null) → 팽창 검사 건너뜀', async () => {
    const { assertSafeOrder, _resetRecentOrders } = await import('./preOrderGuard.js');
    _resetRecentOrders();
    expect(() => assertSafeOrder({
      stockCode: '005930', stockName: '삼성전자',
      quantity: 10_000, entryPrice: 200_000, stopLoss: 190_000,  // 20억
      totalAssets: null,  // 미상 → 검사 skip
    })).not.toThrow();
  });
});

// ─── PR-Z7 H2: cron 외 진입점 우회 차단 (emergencyStop + dailyLossLimit) ─────
// state.ts mock 패턴 사용 — production module-level state 무수정 → 다른 테스트 worker 에 leak 차단.

describe('preOrderGuard — H2 emergencyStop + dailyLossLimit 가드', () => {
  let tmpDir: string;
  const originalDailyLossLimit = process.env.DAILY_LOSS_LIMIT;
  // closure-scoped state — 각 테스트가 직접 mutate 하면 mock getter 가 반영
  const stateMock = { emergencyStop: false, dailyLoss: 0 };

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-h2-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    delete process.env.DAILY_LOSS_LIMIT; // default 5% 사용
    stateMock.emergencyStop = false;
    stateMock.dailyLoss = 0;
    vi.resetModules();
    vi.doMock('../state.js', () => ({
      getEmergencyStop: () => stateMock.emergencyStop,
      setEmergencyStop: (v: boolean) => { stateMock.emergencyStop = v; },
      getDailyLossPct: () => stateMock.dailyLoss,
      setDailyLoss: (pct: number) => { stateMock.dailyLoss = pct; },
    }));
    vi.doMock('../alerts/telegramClient.js', () => ({
      sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('../emergency.js', () => ({
      cancelAllPendingOrders: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('../alerts/contaminationBlastRadius.js', () => ({
      sendBlastRadiusReport: vi.fn().mockResolvedValue(true),
    }));
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    if (originalDailyLossLimit === undefined) {
      delete process.env.DAILY_LOSS_LIMIT;
    } else {
      process.env.DAILY_LOSS_LIMIT = originalDailyLossLimit;
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
    vi.doUnmock('../state.js');
    vi.doUnmock('../alerts/telegramClient.js');
    vi.doUnmock('../emergency.js');
    vi.doUnmock('../alerts/contaminationBlastRadius.js');
  });

  it('정상 상태 (emergencyStop=false + dailyLoss=0) → 통과 (기존 동작 회귀 보장)', async () => {
    const { assertSafeOrder, _resetRecentOrders } = await import('./preOrderGuard.js');
    _resetRecentOrders();
    expect(() => assertSafeOrder({
      stockCode: '005930', stockName: '삼성전자',
      quantity: 10, entryPrice: 70000, stopLoss: 66000,
      totalAssets: 100_000_000,
    })).not.toThrow();
  });

  it('EMERGENCY_STOP_ACTIVE — emergencyStop=true 시 throw + incident 기록', async () => {
    const { assertSafeOrder, PreOrderGuardError, _resetRecentOrders } = await import('./preOrderGuard.js');
    stateMock.emergencyStop = true;
    _resetRecentOrders();
    expect(() => assertSafeOrder({
      stockCode: '005930', stockName: '삼성전자',
      quantity: 10, entryPrice: 70000, stopLoss: 66000,
      totalAssets: 100_000_000,
    })).toThrow(PreOrderGuardError);

    const incidentFile = path.join(tmpDir, 'incident-log.json');
    expect(fs.existsSync(incidentFile)).toBe(true);
    const entries = JSON.parse(fs.readFileSync(incidentFile, 'utf-8'));
    expect(entries[0].context.reason).toBe('EMERGENCY_STOP_ACTIVE');
    expect(entries[0].reason).toContain('emergencyStop=true');
  });

  it('DAILY_LOSS_LIMIT_HIT — dailyLoss >= 5%(default) 시 throw', async () => {
    const { assertSafeOrder, PreOrderGuardError, _resetRecentOrders } = await import('./preOrderGuard.js');
    stateMock.dailyLoss = 5.5; // 한도 5% 초과
    _resetRecentOrders();
    expect(() => assertSafeOrder({
      stockCode: '005930', stockName: '삼성전자',
      quantity: 10, entryPrice: 70000, stopLoss: 66000,
      totalAssets: 100_000_000,
    })).toThrow(PreOrderGuardError);

    const incidentFile = path.join(tmpDir, 'incident-log.json');
    const entries = JSON.parse(fs.readFileSync(incidentFile, 'utf-8'));
    expect(entries[0].context.reason).toBe('DAILY_LOSS_LIMIT_HIT');
    expect(entries[0].reason).toContain('일일 손실');
    expect(entries[0].reason).toContain('5.50%');
  });

  it('dailyLoss 경계값 (정확히 5.00%) → throw (>= 비교)', async () => {
    const { assertSafeOrder, PreOrderGuardError, _resetRecentOrders } = await import('./preOrderGuard.js');
    stateMock.dailyLoss = 5.0;
    _resetRecentOrders();
    expect(() => assertSafeOrder({
      stockCode: '005930', stockName: '삼성전자',
      quantity: 10, entryPrice: 70000, stopLoss: 66000,
      totalAssets: 100_000_000,
    })).toThrow(PreOrderGuardError);
  });

  it('dailyLoss 경계 미달 (4.99%) → 통과', async () => {
    const { assertSafeOrder, _resetRecentOrders } = await import('./preOrderGuard.js');
    stateMock.dailyLoss = 4.99;
    _resetRecentOrders();
    expect(() => assertSafeOrder({
      stockCode: '005930', stockName: '삼성전자',
      quantity: 10, entryPrice: 70000, stopLoss: 66000,
      totalAssets: 100_000_000,
    })).not.toThrow();
  });

  it('DAILY_LOSS_LIMIT env override — 10% 한도 시 7% 손실 통과', async () => {
    process.env.DAILY_LOSS_LIMIT = '10';
    const { assertSafeOrder, _resetRecentOrders } = await import('./preOrderGuard.js');
    stateMock.dailyLoss = 7.0;
    _resetRecentOrders();
    expect(() => assertSafeOrder({
      stockCode: '005930', stockName: '삼성전자',
      quantity: 10, entryPrice: 70000, stopLoss: 66000,
      totalAssets: 100_000_000,
    })).not.toThrow();
  });

  it('emergencyStop 우선순위 — 동시 위반 시 EMERGENCY_STOP_ACTIVE 가 먼저 throw', async () => {
    const { assertSafeOrder, PreOrderGuardError, _resetRecentOrders } = await import('./preOrderGuard.js');
    stateMock.emergencyStop = true;
    stateMock.dailyLoss = 10.0; // 한도 초과
    _resetRecentOrders();
    try {
      assertSafeOrder({
        stockCode: '005930', stockName: '삼성전자',
        quantity: 10, entryPrice: 70000, stopLoss: 66000,
        totalAssets: 100_000_000,
      });
      throw new Error('should have thrown');
    } catch (e) {
      /* SDS-ignore: test intentionally captures expected PreOrderGuardError for reason assertion. */
      expect(e).toBeInstanceOf(PreOrderGuardError);
      expect((e as { reason: string }).reason).toBe('EMERGENCY_STOP_ACTIVE');
    }
  });

  it('NaN dailyLoss (안전 가드) → 통과 (incident 기록 없음)', async () => {
    const { assertSafeOrder, _resetRecentOrders } = await import('./preOrderGuard.js');
    stateMock.dailyLoss = NaN;
    _resetRecentOrders();
    expect(() => assertSafeOrder({
      stockCode: '005930', stockName: '삼성전자',
      quantity: 10, entryPrice: 70000, stopLoss: 66000,
      totalAssets: 100_000_000,
    })).not.toThrow();
  });

  it('새 가드 진입부 우선순위 — POSITION_EXPLOSION 보다 먼저 검증', async () => {
    // emergencyStop=true + 동시에 POSITION_EXPLOSION 위반 시
    // EMERGENCY_STOP_ACTIVE 가 먼저 발사 (incident 가 EMERGENCY_STOP 으로 기록)
    const { assertSafeOrder, PreOrderGuardError, _resetRecentOrders } = await import('./preOrderGuard.js');
    stateMock.emergencyStop = true;
    _resetRecentOrders();
    try {
      assertSafeOrder({
        stockCode: '005930', stockName: '삼성전자',
        quantity: 1000, entryPrice: 200_000, stopLoss: 190_000, // 2억 (POSITION_EXPLOSION)
        totalAssets: 100_000_000,
      });
      throw new Error('should have thrown');
    } catch (e) {
      /* SDS-ignore: test intentionally captures expected PreOrderGuardError for reason assertion. */
      expect(e).toBeInstanceOf(PreOrderGuardError);
      expect((e as { reason: string }).reason).toBe('EMERGENCY_STOP_ACTIVE');
    }
  });
});

describe('preOrderGuard — Phase 1-② 섹터 노출 선검증', () => {
  it('포트폴리오 비어있을 때 신규 진입 허용', async () => {
    const { checkSectorExposureBefore } = await import('./preOrderGuard.js');
    const r = checkSectorExposureBefore({
      candidateSector: '반도체',
      candidateValue: 3_000_000,
      currentSectorValue: new Map(),
      pendingSectorValue: new Map(),
      totalAssets: 100_000_000,
    });
    expect(r.allowed).toBe(true);
  });

  it('단일 섹터 40% 초과 — 같은 tick 의 pending 포함 투영 비중으로 차단', async () => {
    const { checkSectorExposureBefore } = await import('./preOrderGuard.js');
    // 현재 금융 섹터 보유 20M, 같은 tick 에서 이미 15M 예약, 신규 후보 10M → 45M / 총분모
    const r = checkSectorExposureBefore({
      candidateSector: '금융',
      candidateValue: 10_000_000,
      currentSectorValue: new Map([['금융', 20_000_000]]),
      pendingSectorValue: new Map([['금융', 15_000_000]]),
      totalAssets: 100_000_000,
    });
    // denom = 100M + 15M + 10M = 125M, numer = 20+15+10 = 45M → 36% → 아직 통과
    // 더 큰 값으로 차단 확인
    const r2 = checkSectorExposureBefore({
      candidateSector: '금융',
      candidateValue: 30_000_000,
      currentSectorValue: new Map([['금융', 20_000_000]]),
      pendingSectorValue: new Map([['금융', 15_000_000]]),
      totalAssets: 100_000_000,
    });
    // denom = 145M, numer = 65M → 44.8% > 40% → 차단
    expect(r.allowed).toBe(true);
    expect(r2.allowed).toBe(false);
    expect(r2.reason).toContain('금융');
    expect(r2.projectedSectorWeight).toBeGreaterThan(0.40);
  });

  it('상관 그룹 50% 초과 — 경기민감_대형 묶음에서 차단', async () => {
    const { checkSectorExposureBefore } = await import('./preOrderGuard.js');
    // 경기민감_대형: 철강, 조선, 자동차, 화학, 에너지, 금융
    // 현재 철강 20M + 조선 20M + 자동차 20M = 60M, 신규 금융 10M
    const r = checkSectorExposureBefore({
      candidateSector: '금융',
      candidateValue: 10_000_000,
      currentSectorValue: new Map([
        ['철강', 20_000_000],
        ['조선', 20_000_000],
        ['자동차', 20_000_000],
      ]),
      pendingSectorValue: new Map(),
      totalAssets: 100_000_000,
    });
    // 금융 단일 비중: 10M / 110M = 9% → 단일 OK
    // 그룹 비중: 70M / 110M = 63.6% > 50% → 차단
    expect(r.allowed).toBe(false);
    expect(r.group).toBe('경기민감_대형');
    expect(r.projectedGroupWeight).toBeGreaterThan(0.50);
  });

  it('미분류·빈 섹터 → 회귀 방지를 위해 통과', async () => {
    const { checkSectorExposureBefore } = await import('./preOrderGuard.js');
    const r1 = checkSectorExposureBefore({
      candidateSector: undefined,
      candidateValue: 50_000_000,
      currentSectorValue: new Map(),
      pendingSectorValue: new Map(),
      totalAssets: 100_000_000,
    });
    const r2 = checkSectorExposureBefore({
      candidateSector: '미분류',
      candidateValue: 50_000_000,
      currentSectorValue: new Map(),
      pendingSectorValue: new Map(),
      totalAssets: 100_000_000,
    });
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
  });

  it('totalAssets <= 0 → skip (분모 0 방어)', async () => {
    const { checkSectorExposureBefore } = await import('./preOrderGuard.js');
    const r = checkSectorExposureBefore({
      candidateSector: '금융',
      candidateValue: 10_000_000,
      currentSectorValue: new Map([['금융', 50_000_000]]),
      pendingSectorValue: new Map(),
      totalAssets: 0,
    });
    expect(r.allowed).toBe(true);
  });

  it('같은 tick pending 만으로도 한도 초과 — 두번째 후보 차단 (원자적 예약 시나리오)', async () => {
    const { checkSectorExposureBefore } = await import('./preOrderGuard.js');
    // 00:40 시나리오 재현: 현재 포트폴리오 비어있고, 이미 큐에 금융 30M 들어가 있는 상태에서
    // 금융 후보 50M 을 평가 → (30+50)/(100+30+50) = 80/180 = 44.4% > 40% → 차단
    const r = checkSectorExposureBefore({
      candidateSector: '금융',
      candidateValue: 50_000_000,
      currentSectorValue: new Map(),
      pendingSectorValue: new Map([['금융', 30_000_000]]),
      totalAssets: 100_000_000,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('선검증 차단');
  });
});
