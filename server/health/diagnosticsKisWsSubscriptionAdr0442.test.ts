/**
 * @responsibility ADR-0442 — collectHealthSnapshot 의 kisWsSubscription wiring 회귀.
 *
 * 사용자 명시 1순위 #2 — `formatKisWsSubscriptionSection` /scan_blockers + /health 임베드
 * (운영자 슬롯 분배 가시화). 본 파일은 collectHealthSnapshot 의 kisWsSubscription 수집 SSOT 검증.
 *
 * 검증:
 *   - ENV 비활성 (default) → snapshot.kisWsSubscription 정의됨 + total=0 (구독 0건 시점)
 *   - mock subscribe 1건 시점 → kisWsSubscription.total=1
 *   - ENV ON → kisWsSubscription undefined (운영자 표시 비활성)
 *   - buildSubscriptionDiagnosis throw mock → undefined + console.warn (try/catch 격리 검증)
 *   - HealthSnapshot 타입에 kisWsSubscription? 옵셔널 필드 존재 (정적 grep 가드)
 *   - collectHealthSnapshot 안에 buildSubscriptionDiagnosis 호출 1건 + try/catch 사용 (정적 grep 가드)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 외부 SSOT stub — collectHealthSnapshot 호출 가능하도록 최소 mock.
import * as watchlistRepo from '../persistence/watchlistRepo.js';
import * as shadowRepo from '../persistence/shadowTradeRepo.js';
import * as state from '../state.js';
import * as kisClient from '../clients/kisClient.js';
import * as kisStream from '../clients/kisStreamClient.js';
import * as gemini from '../clients/geminiClient.js';
import * as marketRefresh from '../trading/marketDataRefresh.js';
import * as scheduler from '../orchestrator/adaptiveScanScheduler.js';
import * as scanner from '../trading/signalScanner.js';
import * as paths from '../persistence/paths.js';
import * as krxOpenApi from '../clients/krxOpenApi.js';
import * as intradayYield from '../alerts/intradayYieldTicker.js';

// ADR-0442 SSOT 호출자 — buildSubscriptionDiagnosis throw mock 을 위해 import.
import * as kisWsManager from '../clients/kisWebSocketSubscriptionManager.js';
// P3 진단 warn 의 dedup 윈도를 두 collectHealthSnapshot 호출 사이에 초기화하기 위해 import.
import { clearWarnDedupStore } from '../observability/warnDedupStore.js';

import { collectHealthSnapshot } from './diagnostics.js';

const ENV_KEY = 'KIS_WS_SUBSCRIPTION_DIAG_DISABLED';
const DIAGNOSTICS_PATH = resolve(__dirname, 'diagnostics.ts');
const DIAGNOSTICS_SRC = readFileSync(DIAGNOSTICS_PATH, 'utf-8');

const FRESH_HEARTBEAT = {
  lastSuccessAt: Date.now() - 60_000,
  lastFailureAt: 0,
  consecutiveFailures: 0,
  status: 'OK' as const,
};

function setupBaseMocks() {
  vi.spyOn(watchlistRepo, 'loadWatchlist').mockReturnValue([]);
  vi.spyOn(shadowRepo, 'loadShadowTrades').mockReturnValue([]);
  vi.spyOn(state, 'getEmergencyStop').mockReturnValue(false);
  vi.spyOn(state, 'getDailyLossPct').mockReturnValue(0);
  vi.spyOn(kisClient, 'getKisTokenRemainingHours').mockReturnValue(8);
  vi.spyOn(kisClient, 'getRealDataTokenRemainingHours').mockReturnValue(8);
  vi.spyOn(kisStream, 'getStreamStatus').mockReturnValue({
    connected: false,
    subscribedCount: 0,
    activePrices: 0,
    reconnectCount: 0,
    lastPongAt: null,
    recentEvents: [],
    sessionLifespanEmaMs: null,
    stableResetThresholdMs: 0,
    close1006WindowCount: 0,
  });
  vi.spyOn(gemini, 'getGeminiRuntimeState').mockReturnValue({
    status: 'IDLE',
    label: null,
    caller: null,
    reason: null,
    updatedAt: null,
  });
  vi.spyOn(marketRefresh, 'getYahooHealthSnapshot').mockReturnValue(FRESH_HEARTBEAT);
  vi.spyOn(scheduler, 'getLastScanAt').mockReturnValue(Date.now());
  vi.spyOn(scanner, 'getLastBuySignalAt').mockReturnValue(Date.now() - 3600_000);
  vi.spyOn(scanner, 'getLastScanSummary').mockReturnValue(null);
  vi.spyOn(scanner, 'isOpenShadowStatus').mockReturnValue(false);
  vi.spyOn(paths, 'verifyVolumeMount').mockReturnValue({ ok: true });
  vi.spyOn(krxOpenApi, 'getKrxOpenApiStatus').mockReturnValue({
    enabled: true,
    authKeyConfigured: true,
    circuitState: 'CLOSED',
    failures: 0,
    cacheKeys: [],
    base: '',
  });
  vi.spyOn(krxOpenApi, 'isKrxOpenApiHealthy').mockReturnValue(true);
  vi.spyOn(intradayYield, 'getCachedIntradayYield').mockReturnValue({
    computedAt: new Date().toISOString(),
    discoveryYield: 0,
    gateYield: 0,
    signalYield: 0,
    counts: {
      universeScanned: 0,
      watchlistCount: 0,
      scanCandidates: 0,
      gateReached: 0,
      gatePassed: 0,
      buyExecuted: 0,
    },
    status: { discovery: 'gray', gate: 'gray', signal: 'gray' },
  } as never);
}

describe('ADR-0442 collectHealthSnapshot — kisWsSubscription wiring', () => {
  const originalEnv = process.env[ENV_KEY];

  beforeEach(() => {
    vi.restoreAllMocks();
    setupBaseMocks();
    // 매 테스트 전 module-local 구독 상태 reset
    kisWsManager.__resetKisWsSubscriptionStateForTests();
    delete process.env[ENV_KEY];
    process.env.AUTO_TRADE_ENABLED = 'true';
    process.env.AUTO_TRADE_MODE = 'SHADOW';
    process.env.KIS_APP_KEY = 'dummy';
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
    vi.restoreAllMocks();
  });

  it('default ENV (미설정) → kisWsSubscription 정의됨 + total=0 (구독 0건 시점)', () => {
    const s = collectHealthSnapshot();
    expect(s.kisWsSubscription).toBeDefined();
    expect(s.kisWsSubscription?.total).toBe(0);
    expect(s.kisWsSubscription?.limit).toBeGreaterThan(0);
    expect(s.kisWsSubscription?.openPositionCount).toBe(0);
    expect(s.kisWsSubscription?.liveEligibleCount).toBe(0);
  });

  it('mock subscribe 1건 → kisWsSubscription.total=1 + open/live/shadow 카운트 정합', () => {
    // module-local subscribedPriorities Map 직접 사용 (subscribeFn mock 으로 외부 호출 0건)
    kisWsManager.requestKisWsSubscription(
      {
        code: '005930',
        reasons: ['OPEN_POSITION'],
        openPosition: true,
      },
      {
        subscribeFn: () => true,
        unsubscribeFn: () => {},
      },
    );
    const s = collectHealthSnapshot();
    expect(s.kisWsSubscription).toBeDefined();
    expect(s.kisWsSubscription?.total).toBe(1);
    expect(s.kisWsSubscription?.openPositionCount).toBe(1);
  });

  it('ENV `KIS_WS_SUBSCRIPTION_DIAG_DISABLED=true` → kisWsSubscription undefined', () => {
    process.env[ENV_KEY] = 'true';
    // 실제 구독 1건 있어도 ENV 비활성이면 undefined 반환
    kisWsManager.requestKisWsSubscription(
      { code: '005930', reasons: ['OPEN_POSITION'], openPosition: true },
      { subscribeFn: () => true, unsubscribeFn: () => {} },
    );
    const s = collectHealthSnapshot();
    expect(s.kisWsSubscription).toBeUndefined();
  });

  it('buildSubscriptionDiagnosis throw → undefined (try/catch 격리) + 중앙 P3 diagnostic warn 경유', () => {
    // 출력 드리프트 정정: safeBuildKisWsSubscriptionDiagnosis 의 catch 가 raw console.warn 에서
    // emitDiagnosticWarn(priority:'P3', code:'P3_DIAGNOSTIC_SUPPRESSED') 중앙 경로로 이주됨
    // (diagnostics.ts L342). P3 는 OPERATIONAL_WARN_DEBUG!='true' 시 runtime 출력 억제(노이즈 감축)
    // 이고, 출력 시 executionImpact='NONE' → classify 'info' → console.info 로 라우팅된다(console.warn 아님).
    //   핵심 안전 불변(진단 throw 격리 → snapshot 차단 없음 → kisWsSubscription=undefined)은 동일하게 검증.
    vi.spyOn(kisWsManager, 'buildSubscriptionDiagnosis').mockImplementation(() => {
      throw new Error('mock buildSubscriptionDiagnosis throw');
    });

    // (1) 기본(runtime 억제): throw 가 격리되어 undefined 반환 + snapshot 자체는 정상 생성.
    const sSuppressed = collectHealthSnapshot();
    expect(sSuppressed.kisWsSubscription).toBeUndefined();

    // (2) OPERATIONAL_WARN_DEBUG=true: P3 진단 warn 이 중앙 logger(console.info) 로 표면화됨.
    //     첫 호출이 동일 dedupKey 를 등록했으므로 dedup 윈도를 비워 두 번째 emission 을 보장한다.
    clearWarnDedupStore();
    const prevDebug = process.env.OPERATIONAL_WARN_DEBUG;
    process.env.OPERATIONAL_WARN_DEBUG = 'true';
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const s = collectHealthSnapshot();
      expect(s.kisWsSubscription).toBeUndefined();
      const calls = infoSpy.mock.calls.map((c) => String(c[0]));
      expect(
        calls.some(
          (m) =>
            m.includes('P3_DIAGNOSTIC_SUPPRESSED') ||
            m.includes('subscription diagnosis failed') ||
            m.includes('DIAGNOSTIC'),
        ),
      ).toBe(true);
    } finally {
      infoSpy.mockRestore();
      if (prevDebug === undefined) delete process.env.OPERATIONAL_WARN_DEBUG;
      else process.env.OPERATIONAL_WARN_DEBUG = prevDebug;
    }
  });

  it('HealthSnapshot 타입에 kisWsSubscription? 옵셔널 필드 존재 (정적 grep 가드)', () => {
    expect(DIAGNOSTICS_SRC).toMatch(/kisWsSubscription\?: SubscriptionDiagnosis/);
  });

  it('collectHealthSnapshot 안에 buildSubscriptionDiagnosis 호출 + try/catch 사용 (정적 grep 가드)', () => {
    // SSOT 호출은 wrapper safeBuildKisWsSubscriptionDiagnosis 안에 있어야 함
    expect(DIAGNOSTICS_SRC).toMatch(/safeBuildKisWsSubscriptionDiagnosis/);
    // wrapper 안에 buildSubscriptionDiagnosis 호출 1건
    const buildCallMatches = DIAGNOSTICS_SRC.match(/buildSubscriptionDiagnosis\(\)/g) ?? [];
    expect(buildCallMatches.length).toBeGreaterThanOrEqual(1);
    // try/catch 격리
    expect(DIAGNOSTICS_SRC).toMatch(
      /function safeBuildKisWsSubscriptionDiagnosis[\s\S]+?try\s*\{[\s\S]+?buildSubscriptionDiagnosis\(\)[\s\S]+?\}\s*catch/,
    );
    // ADR-0442 추적 주석
    expect(DIAGNOSTICS_SRC).toMatch(/ADR-0442/);
  });
});
