/**
 * @responsibility ADR-0442 — `/scan_blockers` 의 KIS WebSocket Subscription Queue 진단 섹션 wiring 회귀.
 *
 * 사용자 명시 1순위 #2 — 운영자 슬롯 분배 가시화. ADR-0437 SSOT 호출만 추가, 본체 무수정.
 *
 * 검증:
 *   - ENV 비활성 (default) + total>0 → kisWsSubscriptionSection 노출
 *   - ENV 비활성 + total=0 → 섹션 미노출 (구독 0건 시점 — 운영자 noise 차단)
 *   - ENV `KIS_WS_SUBSCRIPTION_DIAG_DISABLED=true` → 섹션 미노출
 *   - buildSubscriptionDiagnosis throw mock → baseMessage 만 출력 + console.warn (try/catch 격리)
 *   - 정적 grep: `parts.push(kisWsSubscriptionSection)` 호출 + import 정합 (3종)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../commandRegistry.js', () => ({
  commandRegistry: { register: vi.fn() },
}));

const SCAN_BLOCKERS_PATH = resolve(__dirname, 'scanBlockers.cmd.ts');
const SCAN_BLOCKERS_SRC = readFileSync(SCAN_BLOCKERS_PATH, 'utf-8');

// 외부 SSOT mock — scan_blockers.cmd 가 호출하는 의존성 stub.
import * as scanDiagnostics from '../../../trading/signalScanner/scanDiagnostics.js';
import * as watchlistRepo from '../../../persistence/watchlistRepo.js';
import * as cfLedgerRepo from '../../../persistence/counterfactualShadowLearningRepo.js';
import * as cfPerfReport from '../../../learning/counterfactualShadowLearningPerformanceReport.js';
import * as cfPriceProvider from '../../../learning/counterfactualShadowPriceProviderAdapter.js';
import * as provisionalLedger from '../../../persistence/provisionalShadowLedger.js';
import * as provisionalPerfReport from '../../../learning/provisionalShadowPerformanceReport.js';
import * as promotionReco from '../../../learning/shadowLearningPromotionRecommendation.js';
import * as universeLearningRepo from '../../../persistence/counterfactualUniverseLearningRepo.js';
import * as investorFlowHealth from '../../../supply/investorFlowProviderHealth.js';
import * as kisWsManager from '../../../clients/kisWebSocketSubscriptionManager.js';

import scanBlockers from './scanBlockers.cmd.js';

const ENV_KEY = 'KIS_WS_SUBSCRIPTION_DIAG_DISABLED';

describe('ADR-0442 /scan_blockers — kisWsSubscription 섹션 wiring', () => {
  const originalEnv = process.env[ENV_KEY];

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env[ENV_KEY];
    // 매 테스트 전 module-local 구독 상태 reset
    kisWsManager.__resetKisWsSubscriptionStateForTests();

    // baseMessage minimum stub
    vi.spyOn(scanDiagnostics, 'getLastScanSummary').mockReturnValue(null);
    vi.spyOn(scanDiagnostics, 'formatScanBlockersMessage').mockReturnValue('🛡️ baseMessage');
    vi.spyOn(scanDiagnostics, 'formatTechnicalProviderDegradedSection').mockReturnValue(null);

    // 다른 섹션 모두 비활성 — kisWsSubscription 섹션만 검증
    vi.spyOn(watchlistRepo, 'loadWatchlist').mockReturnValue([]);
    vi.spyOn(cfLedgerRepo, 'loadCounterfactualShadowLearningLedger').mockReturnValue([]);
    vi.spyOn(cfPerfReport, 'buildCounterfactualShadowPerformanceReport').mockResolvedValue({
      summary: {
        status: 'NO_DATA',
        totalEntries: 0,
        observedEntries: 0,
        pendingEntries: 0,
        dataUnavailableEntries: 0,
        marketClosedEntries: 0,
        insufficientDataEntries: 0,
        errorEntries: 0,
        avgReturnPct: null,
        winRateObserved: null,
        topWinners: [],
        topLosers: [],
        labelBreakdown: {},
        blockedByBreakdown: {},
        windowStartKst: '',
        windowEndKst: '',
      },
      records: [],
    } as never);
    vi.spyOn(cfPerfReport, 'formatCounterfactualShadowSummaryLine').mockReturnValue(null);
    vi.spyOn(cfPriceProvider, 'createCounterfactualShadowPriceProvider').mockReturnValue({
      lookup: vi.fn(),
    } as never);
    vi.spyOn(provisionalLedger, 'loadProvisionalShadowLedger').mockReturnValue([]);
    vi.spyOn(provisionalPerfReport, 'buildProvisionalShadowPerformanceReport').mockResolvedValue({
      summary: {
        status: 'NO_DATA',
        totalEntries: 0,
        observedEntries: 0,
        pendingEntries: 0,
        dataUnavailableEntries: 0,
        marketClosedEntries: 0,
        insufficientDataEntries: 0,
        errorEntries: 0,
        avgReturnPct: null,
        winRateObserved: null,
        topWinners: [],
        topLosers: [],
        labelBreakdown: {},
        blockedByBreakdown: {},
        windowStartKst: '',
        windowEndKst: '',
      },
      records: [],
    } as never);
    vi.spyOn(promotionReco, 'buildShadowLearningPromotionRecommendations').mockReturnValue({
      candidates: [],
      meta: { totalConsidered: 0, windowStartKst: '', windowEndKst: '' },
    } as never);
    vi.spyOn(promotionReco, 'formatShadowLearningPromotionSummaryLine').mockReturnValue(null);
    vi.spyOn(universeLearningRepo, 'summarizeCounterfactualUniverseLearningLedger').mockReturnValue({
      total: 0,
      todayCount: 0,
      latestSnapshot: null,
      blockedByBreakdown: {},
      preflightStageBreakdown: {},
    } as never);
    vi.spyOn(universeLearningRepo, 'formatCounterfactualUniverseLearningSummarySection').mockReturnValue(
      null,
    );
    vi.spyOn(investorFlowHealth, 'getLastInvestorFlowProviderHealth').mockReturnValue([]);
    vi.spyOn(investorFlowHealth, 'summarizeInvestorFlowProviderHealth').mockReturnValue('');
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
    vi.restoreAllMocks();
  });

  it('default ENV + 구독 1건 (total>0) → kisWsSubscription 섹션 노출', async () => {
    // module-local Map 에 구독 1건 추가 (subscribeFn mock 으로 외부 호출 0건)
    kisWsManager.requestKisWsSubscription(
      { code: '005930', reasons: ['OPEN_POSITION'], openPosition: true },
      { subscribeFn: () => true, unsubscribeFn: () => {} },
    );
    let captured = '';
    // ADR-0506 — default mode 가 compact 로 변경되어 full 명시 필요 (기존 동작 보존).
    // Patch-SUPPLY-DIAG-ACCURACY: full mode 가 4096 budget 초과 시 paginated reply — 모든 페이지 concat.
    await scanBlockers.execute({
      args: ['full'],
      reply: async (msg: string) => {
        captured += (captured ? '\n' : '') + msg;
      },
    } as never);
    expect(captured).toContain('🛡️ baseMessage');
    // ADR-0437 헤더 + 카운트 SSOT 표시
    expect(captured).toContain('🛰️ KIS WebSocket Subscription Queue (ADR-0437)');
    expect(captured).toContain('total: 1/');
    expect(captured).toContain('open: 1');
  });

  it('default ENV + 구독 0건 (total=0) → 섹션 미노출 (운영자 noise 차단)', async () => {
    let captured = '';
    // ADR-0506 — default mode 가 compact 로 변경되어 full 명시 필요 (기존 동작 보존).
    // Patch-SUPPLY-DIAG-ACCURACY: full mode 가 4096 budget 초과 시 paginated reply — 모든 페이지 concat.
    await scanBlockers.execute({
      args: ['full'],
      reply: async (msg: string) => {
        captured += (captured ? '\n' : '') + msg;
      },
    } as never);
    // ADR-0506 — full 모드는 header + baseMessage + (ADR-0505 NOT_EMITTED) 포함, baseMessage 만 단독 strict equality 부적합.
    expect(captured).toContain('🛡️ baseMessage');
    expect(captured).not.toContain('KIS WebSocket Subscription Queue');
  });

  it('ENV `KIS_WS_SUBSCRIPTION_DIAG_DISABLED=true` → 섹션 미노출 (구독 1건 있어도)', async () => {
    process.env[ENV_KEY] = 'true';
    kisWsManager.requestKisWsSubscription(
      { code: '005930', reasons: ['OPEN_POSITION'], openPosition: true },
      { subscribeFn: () => true, unsubscribeFn: () => {} },
    );
    let captured = '';
    // ADR-0506 — default mode 가 compact 로 변경되어 full 명시 필요 (기존 동작 보존).
    // Patch-SUPPLY-DIAG-ACCURACY: full mode 가 4096 budget 초과 시 paginated reply — 모든 페이지 concat.
    await scanBlockers.execute({
      args: ['full'],
      reply: async (msg: string) => {
        captured += (captured ? '\n' : '') + msg;
      },
    } as never);
    // ADR-0506 — full 모드는 header + baseMessage + (ADR-0505 NOT_EMITTED) 포함, baseMessage 만 단독 strict equality 부적합.
    expect(captured).toContain('🛡️ baseMessage');
    expect(captured).not.toContain('KIS WebSocket Subscription Queue');
  });

  it('buildSubscriptionDiagnosis throw → baseMessage 만 출력 + 구조화 경고 로그 (try/catch 격리)', async () => {
    // Patch-VITEST-CAT-C: 섹션 경고가 raw console.warn → emitReportSectionWarn(구조화 P2)
    // 로 리팩토링됨. executionImpact=NONE 인 P2 는 console.info 로 라우팅되므로 양쪽 채널을 감시한다.
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(kisWsManager, 'buildSubscriptionDiagnosis').mockImplementation(() => {
      throw new Error('mock buildSubscriptionDiagnosis throw');
    });
    let captured = '';
    let threw = false;
    try {
      // ADR-0506 — default mode 가 compact 로 변경되어 full 명시 필요.
      // Patch-SUPPLY-DIAG-ACCURACY: full mode 가 4096 budget 초과 시 paginated reply — 모든 페이지 concat.
      await scanBlockers.execute({
        args: ['full'],
        reply: async (msg: string) => {
          captured += (captured ? '\n' : '') + msg;
        },
      } as never);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    // baseMessage 는 정상 출력 — kisWs 섹션만 미노출
    expect(captured).toContain('🛡️ baseMessage');
    expect(captured).not.toContain('KIS WebSocket Subscription Queue');
    // 구조화 경고 로그 호출 (격리 검증) — warn/info 어느 채널이든 메시지가 실려야 한다.
    const allWarnLines = [
      ...consoleWarnSpy.mock.calls,
      ...consoleInfoSpy.mock.calls,
    ].map((c) => String(c[0]));
    expect(allWarnLines.some((m) => m.includes('kis-ws subscription'))).toBe(true);
  });


  it('SCAN-BLOCKERS duplicate reply guard — compact/supply/sector/runtime/unknown are single reply, supply full is paginated', async () => {
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const singleModes: Array<{ args: string[]; expectedMode: string }> = [
      { args: ['compact'], expectedMode: 'compact' },
      { args: ['supply'], expectedMode: 'supply' },
      { args: ['sector'], expectedMode: 'sector' },
      { args: ['runtime'], expectedMode: 'runtime' },
      { args: ['unknown-mode'], expectedMode: 'compact' },
    ];

    for (const { args, expectedMode } of singleModes) {
      const replies: string[] = [];
      await scanBlockers.execute({
        args,
        reply: async (msg: string) => {
          replies.push(msg);
        },
      } as never);
      expect(replies, args.join(' ')).toHaveLength(1);
      const commandLogs = consoleInfoSpy.mock.calls.map((c) => String(c[0]));
      expect(
        commandLogs.some((m) =>
          m.includes('[SCAN_BLOCKERS_COMMAND]') &&
          m.includes(`mode=${expectedMode}`) &&
          m.includes('replyMode=single'),
        ),
      ).toBe(true);
      consoleInfoSpy.mockClear();
    }

    const paginatedReplies: string[] = [];
    await scanBlockers.execute({
      args: ['supply', 'full'],
      reply: async (msg: string) => {
        paginatedReplies.push(msg);
      },
    } as never);
    expect(paginatedReplies.length).toBeGreaterThanOrEqual(1);
    const paginatedLogs = consoleInfoSpy.mock.calls.map((c) => String(c[0]));
    expect(
      paginatedLogs.some((m) =>
        m.includes('[SCAN_BLOCKERS_COMMAND]') &&
        m.includes('mode=supply') &&
        m.includes('subMode=full') &&
        m.includes('replyMode=paginated') &&
        m.includes(`pages=${paginatedReplies.length}`),
      ),
    ).toBe(true);
  });

  it('정적 grep — ADR-0442 import 3종 + parts.push(kisWsSubscriptionSection) 호출', () => {
    // import 3종 정합
    expect(SCAN_BLOCKERS_SRC).toMatch(/buildSubscriptionDiagnosis/);
    expect(SCAN_BLOCKERS_SRC).toMatch(/formatKisWsSubscriptionSection/);
    expect(SCAN_BLOCKERS_SRC).toMatch(/isKisWsSubscriptionDiagDisabled/);
    expect(SCAN_BLOCKERS_SRC).toMatch(
      /from\s+['"]\.\.\/\.\.\/\.\.\/clients\/kisWebSocketSubscriptionManager\.js['"]/,
    );
    // parts.push wiring
    expect(SCAN_BLOCKERS_SRC).toMatch(/parts\.push\(kisWsSubscriptionSection\)/);
    // try/catch 격리 (정적 패턴)
    expect(SCAN_BLOCKERS_SRC).toMatch(
      /try\s*\{[\s\S]+?isKisWsSubscriptionDiagDisabled[\s\S]+?\}\s*catch/,
    );
    // ADR-0442 추적 주석
    expect(SCAN_BLOCKERS_SRC).toMatch(/ADR-0442/);
    // total > 0 가드 (운영자 noise 차단)
    expect(SCAN_BLOCKERS_SRC).toMatch(/diag\.total\s*>\s*0/);
  });
});
