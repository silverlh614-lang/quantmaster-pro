// @responsibility tradingOrchestrator 오케스트레이터 모듈
import fs from 'fs';
import { ORCHESTRATOR_STATE_FILE, ensureDataDir } from '../persistence/paths.js';
import { loadWatchlist, saveWatchlist } from '../persistence/watchlistRepo.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import {
  BUY_TR_ID,
  refreshKisToken, kisPost,
  fetchAccountBalance,
} from '../clients/kisClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { fillMonitor } from '../trading/fillMonitor.js';
import { trancheExecutor } from '../trading/trancheExecutor.js';
import { runAutoSignalScan } from '../trading/signalScanner.js';
import { preScreenStocks, autoPopulateWatchlist, sendWatchlistRejectionReport } from '../screener/stockScreener.js';
import { generateDailyReport } from '../alerts/reportGenerator.js';
import { isRealTradeReady } from '../learning/recommendationTracker.js';
import { calculateOrderQuantity, isOpenShadowStatus } from '../trading/entryEngine.js';
import { decideScan, recordScanResult } from './adaptiveScanScheduler.js';
import { learningOrchestrator } from './learningOrchestrator.js';
import { shouldRunMonthlyEvolution, getLearningInterval } from '../learning/adaptiveLearningClock.js';
import { scanAndUpdateIntradayWatchlist } from '../screener/intradayScanner.js';
import { clearIntradayWatchlist } from '../persistence/intradayWatchlistRepo.js';
import { runPreMarketSmokeTest } from '../trading/preMarketSmokeTest.js';
import { cleanupWatchlist } from '../screener/watchlistManager.js';
import { probePreMarketGap, type GapProbeResult } from '../trading/preMarketGapProbe.js';
import { assertSafeOrder, PreOrderGuardError } from '../trading/preOrderGuard.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { getLiveRegime } from '../trading/regimeBridge.js';
import { REGIME_CONFIGS } from '../../src/services/quant/regimeEngine.js';

// ─── 편의 조회 래퍼 ────────────────────────────────────────────────────────────
export function getShadowTrades() { return loadShadowTrades(); }
export function getWatchlist()    { return loadWatchlist(); }

// ─── 아이디어 2: 동시호가 예약 주문 (08:45 KST) ──────────────────────────────────

/**
 * OPENING_AUCTION 진입 시 (08:45 KST) 워치리스트 종목에 대해:
 * 1. 동시호가 진입 전 포지션 Full 가드 (regimeConfig.maxPositions)
 * 2. preMarketGapProbe 로 KIS 전일종가 기반 갭 체크 (ADR-0004)
 * 3. ServerGate 재평가 (8개 조건) — quote 없이 워치리스트 entryPrice 기반
 * 4. assertSafeOrder 최종 Kill-Switch (LIVE 경로)
 * 5. NORMAL/STRONG → KIS 지정가 주문 or Shadow 알림
 */
export async function preMarketOrderPrep(): Promise<void> {
  const watchlist = loadWatchlist();
  if (watchlist.length === 0) {
    console.log('[PreMarket] 워치리스트 비어있음 — 예약 주문 건너뜀');
    return;
  }

  // ── 포지션 Full 가드 (진입부 즉시) ─────────────────────────────────────────
  // regimeConfig.maxPositions 이상 보유 시 preMarket 예약 주문 자체를 스킵.
  // 신호 발견 후 뒤늦게 skip 하던 기존 구조는 이미 Shadow DB 에 PROVISIONAL 기록이
  // 남아 "가득 찬 계좌에 추가 매수 시도" 이력이 누적되었다. 진입부에서 끊는다.
  const activeCount = loadShadowTrades().filter(s => isOpenShadowStatus(s.status)).length;
  const regime = getLiveRegime(loadMacroState());
  const maxPositions = REGIME_CONFIGS[regime]?.maxPositions ?? 4;
  if (activeCount >= maxPositions) {
    console.log(
      `[PreMarket] 포지션 Full (${activeCount}/${maxPositions}, regime=${regime}) — 전체 스킵`,
    );
    await sendTelegramAlert(
      `🛑 <b>[PreMarket Full 가드]</b>\n` +
      `활성 포지션 ${activeCount}/${maxPositions} (regime=${regime}) — 예약 주문 전량 스킵`
    ).catch(console.error);
    return;
  }

  console.log(
    `[PreMarket] 동시호가 예약 주문 준비 — ${watchlist.length}개 종목 ` +
    `(포지션 ${activeCount}/${maxPositions}, regime=${regime})`,
  );
  const isLive = process.env.AUTO_TRADE_MODE === 'LIVE';
  // PR-5 #11: SHADOW ↔ LIVE 계좌 잔고 분리. preMarket 사이징 capital 은
  // LIVE 면 KIS 실/모의 잔고, SHADOW 면 shadowAccountRepo 독립 원장에서 가져온다.
  let capital: number;
  if (isLive) {
    capital = (await fetchAccountBalance().catch(() => null)) ?? 10_000_000;
  } else {
    const { computeShadowAccount } = await import('../persistence/shadowAccountRepo.js');
    const { loadTradingSettings } = await import('../persistence/tradingSettingsRepo.js');
    const settings = loadTradingSettings();
    const startingCapital = Number(process.env.AUTO_TRADE_ASSETS || settings.startingCapital);
    const account = computeShadowAccount(loadShadowTrades(), startingCapital);
    capital = Math.max(0, account.cashBalance); // 사이징은 실가용 현금 기준
  }
  let orderableCash = capital;
  let orderedCount = 0;
  const skipReasonByCode = new Map<string, string>();

  for (const stock of watchlist) {
    try {
      // 루프 내부에서도 capacity 재확인 — 동일 tick 신규 주문이 한도를 넘지 않도록.
      if (activeCount + orderedCount >= maxPositions) {
        console.log(
          `[PreMarket] 한도 도달 (${activeCount + orderedCount}/${maxPositions}) — ` +
          `나머지 ${watchlist.length - orderedCount}개 건너뜀`,
        );
        break;
      }

      // ── Gap Probe (ADR-0004): KIS 전일종가 기반 ─────────────────────────────
      const probe: GapProbeResult = await probePreMarketGap({
        stockCode:  stock.code,
        entryPrice: stock.entryPrice,
      });

      if (probe.decision === 'SKIP_NO_DATA'
       || probe.decision === 'SKIP_STALE'
       || probe.decision === 'SKIP_DATA_ERROR') {
        console.log(
          `[PreMarket] ${stock.name}(${stock.code}) ${probe.decision} — ${probe.reason ?? ''}`,
        );
        skipReasonByCode.set(stock.code, probe.decision);
        continue;
      }

      // Gate 재평가는 runAutoSignalScan(MARKET_OPEN) 이 실시간 quote 로 수행한다.
      // 장전 preMarket 은 워치리스트 entry snapshot (gateScore) 을 신뢰하고, 단순
      // 구간 포지션 사이징만 적용한다. (ADR-0004: Yahoo preMarket 호출 경로 제거)
      const entryGateScore = stock.gateScore ?? 0;
      // 보수적 기본 사이징: SWING 기준 8% 표준 포지션. runAutoSignalScan 에서
      // 실가격·MTAS·레짐 반영한 사이징으로 재조정된다.
      const defaultPositionPct = entryGateScore >= 7 ? 0.10 : 0.08;

      const remainingSlots = Math.max(1, maxPositions - activeCount - orderedCount);
      const { quantity, effectiveBudget } = calculateOrderQuantity({
        totalAssets:   capital,
        orderableCash,
        positionPct:   defaultPositionPct,
        price:         stock.entryPrice,
        remainingSlots,
      });
      if (quantity <= 0) continue;

      const gapLabel = probe.gapPct != null ? ` gap=${probe.gapPct.toFixed(1)}%` : '';
      const gapWarnTag = probe.decision === 'WARN' ? ' ⚠️' : '';
      console.log(
        `[PreMarket] ${stock.name}(${stock.code}) 예약 — ${quantity}주 @${stock.entryPrice.toLocaleString()} ` +
        `(GateSnap=${entryGateScore}${gapLabel})${gapWarnTag}`
      );

      if (isLive && process.env.KIS_APP_KEY) {
        // ── Pre-Order Kill Switch (assertSafeOrder) ─────────────────────────
        // POSITION_EXPLOSION / STOPLOSS_LOGIC_BROKEN / ORDER_LOOP_SUSPECT 최종 검증.
        try {
          assertSafeOrder({
            stockCode:   stock.code,
            stockName:   stock.name,
            quantity,
            entryPrice:  stock.entryPrice,
            stopLoss:    stock.stopLoss,
            totalAssets: capital,
          });
        } catch (e) {
          const reason = e instanceof PreOrderGuardError ? e.reason : 'unknown';
          console.warn(
            `[PreMarket] ${stock.name}(${stock.code}) PreOrderGuard 차단: ${reason}`,
          );
          await sendTelegramAlert(
            `🚫 <b>[PreMarket Guard 차단]</b>\n` +
            `종목: ${stock.name} (${stock.code})\n` +
            `사유: ${reason}\n` +
            `이 종목은 건너뛰고 나머지는 계속 진행합니다.`
          ).catch(console.error);
          skipReasonByCode.set(stock.code, `GUARD_${reason}`);
          continue;
        }

        // KIS 지정가 매수 주문 (동시호가)
        const orderRes = await kisPost(BUY_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
          CANO:         process.env.KIS_ACCOUNT_NO ?? '',
          ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
          PDNO:         stock.code.padStart(6, '0'),
          ORD_DVSN:     '00', // 지정가
          ORD_QTY:      quantity.toString(),
          ORD_UNPR:     stock.entryPrice.toString(),
        }).catch((e: unknown) => {
          console.error(`[PreMarket] KIS 주문 오류 ${stock.code}:`, e instanceof Error ? e.message : e);
          return null;
        });

        const ordNo = (orderRes as { output?: { odno?: string } } | null)?.output?.odno;
        if (ordNo) {
          fillMonitor.addOrder({
            ordNo,
            stockCode:      stock.code,
            stockName:      stock.name,
            quantity,
            orderPrice:     stock.entryPrice,
            placedAt:       new Date().toISOString(),
            relatedTradeId: undefined,
          });
          orderableCash = Math.max(0, orderableCash - effectiveBudget);
          orderedCount++;
          const gapLine = probe.gapPct != null
            ? `${probe.decision === 'WARN' ? '⚠️ Gap' : 'Gap'} ${probe.gapPct.toFixed(1)}%`
            : 'Gap n/a';
          await sendTelegramAlert(
            `📋 <b>[동시호가 예약 주문]</b>\n` +
            `종목: ${stock.name} (${stock.code})\n` +
            `가격: ${stock.entryPrice.toLocaleString()}원 × ${quantity}주\n` +
            `GateSnap: ${entryGateScore} | ${gapLine}\n` +
            `주문번호: ${ordNo}`
          ).catch(console.error);
        }
      } else {
        // Shadow 모드: Telegram 알림만 (현금 차감 없음)
        orderedCount++;
        const gapLine = probe.gapPct != null
          ? `${probe.decision === 'WARN' ? '⚠️ Gap' : 'Gap'} ${probe.gapPct.toFixed(1)}%`
          : 'Gap n/a';
        await sendTelegramAlert(
          `🎭 <b>[SHADOW 동시호가 예약]</b>\n` +
          `종목: ${stock.name} (${stock.code})\n` +
          `예정가: ${stock.entryPrice.toLocaleString()}원 × ${quantity}주\n` +
          `GateSnap: ${entryGateScore} | ${gapLine}\n` +
          `⚠️ SHADOW 모드 — 실계좌 잔고 아님`
        ).catch(console.error);
      }

      await new Promise(r => setTimeout(r, 300)); // KIS rate limit 여유
    } catch (e) {
      console.error(`[PreMarket] ${stock.name}(${stock.code}) 오류:`, e instanceof Error ? e.message : e);
    }
  }

  // ── 스킵 사유 워치리스트 반영 ─────────────────────────────────────────────
  // lastSkipReason/lastSkipAt 필드는 WatchlistEntry 에 옵셔널로 정의되어 하위 호환 유지.
  if (skipReasonByCode.size > 0) {
    const nowIso = new Date().toISOString();
    const updated = watchlist.map(entry => {
      const reason = skipReasonByCode.get(entry.code);
      if (!reason) return entry;
      return { ...entry, lastSkipReason: reason, lastSkipAt: nowIso };
    });
    try { saveWatchlist(updated); } catch (e) {
      console.warn('[PreMarket] skipReason 워치리스트 저장 실패:', e instanceof Error ? e.message : e);
    }
  }

  console.log('[PreMarket] 동시호가 예약 주문 준비 완료');
}

// ─── 아이디어 1: TradingDayOrchestrator — 장 사이클 State Machine ──────────────

export type TradingState =
  | 'PRE_MARKET'       // 장 시작 전 (KST < 08:00 or > 17:00)
  | 'OPENING_AUCTION'  // 동시호가 준비 (08:00–08:59)
  | 'MARKET_OPEN'      // 시초가 구간 (09:00–09:14)
  | 'INTRADAY'         // 장중 스캔 루프 (09:15–15:19)
  | 'CLOSING_PREP'     // 장 마감 전 취소 구간 (15:20–15:29)
  | 'POST_MARKET'      // 장 마감 후 (15:30–15:59)
  | 'REPORT_ANALYSIS'  // 리포트 + 자기학습 (16:00–16:59)
  | 'WEEKEND';         // 토·일

interface OrchestratorState {
  currentState: TradingState;
  lastTransition: string;   // ISO
  tradingDate: string;      // YYYY-MM-DD (KST 기준)
  handlerRanAt: Record<string, string>; // handler key → ISO timestamp
  /** 마지막으로 월간 캘리브레이션이 완료된 월 (YYYY-MM). catch-up 판단 기준. */
  lastCalibratedMonth: string;
}

function getKstTime(): { h: number; m: number; t: number; dow: number; dateStr: string } {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const h = kst.getUTCHours();
  const m = kst.getUTCMinutes();
  return {
    h, m,
    t:       h * 100 + m,
    dow:     kst.getUTCDay(),             // 0=Sun, 6=Sat
    dateStr: kst.toISOString().slice(0, 10),
  };
}

function resolveState(h: number, m: number, dow: number): TradingState {
  if (dow === 0 || dow === 6) return 'WEEKEND';
  const t = h * 100 + m;
  if (t < 800)  return 'PRE_MARKET';
  if (t < 900)  return 'OPENING_AUCTION';
  if (t < 915)  return 'MARKET_OPEN';
  if (t < 1520) return 'INTRADAY';
  if (t < 1530) return 'CLOSING_PREP';
  if (t < 1600) return 'POST_MARKET';
  if (t < 1700) return 'REPORT_ANALYSIS';
  return 'PRE_MARKET';
}

export class TradingDayOrchestrator {
  private orch: OrchestratorState;

  constructor() {
    this.orch = this.load();
  }

  private load(): OrchestratorState {
    ensureDataDir();
    if (fs.existsSync(ORCHESTRATOR_STATE_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(ORCHESTRATOR_STATE_FILE, 'utf-8')) as Partial<OrchestratorState>;
        return {
          currentState:        saved.currentState        ?? 'PRE_MARKET',
          lastTransition:      saved.lastTransition      ?? new Date().toISOString(),
          tradingDate:         saved.tradingDate         ?? '',
          handlerRanAt:        saved.handlerRanAt        ?? {},
          lastCalibratedMonth: saved.lastCalibratedMonth ?? '',
        };
      } catch { /* fallthrough */ }
    }
    return {
      currentState:        'PRE_MARKET',
      lastTransition:      new Date().toISOString(),
      tradingDate:         '',
      handlerRanAt:        {},
      lastCalibratedMonth: '',
    };
  }

  private save(): void {
    ensureDataDir();
    fs.writeFileSync(ORCHESTRATOR_STATE_FILE, JSON.stringify(this.orch, null, 2));
  }

  private hasRan(key: string): boolean {
    // 날짜 기반 자동 리셋: tick() 호출 이전이나 재배포 직후에도 안전하게 동작
    const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
    if (this.orch.tradingDate !== today) {
      this.orch.tradingDate  = today;
      this.orch.handlerRanAt = {};
      this.save();
    }
    return !!this.orch.handlerRanAt[key];
  }

  private markRan(key: string): void {
    // tradingDate 가 비어 있으면(초기 부팅 직후, tick() 전) 현재 KST 일자를 채워서 저장한다.
    // 비어 있는 상태로 저장되면, 다음 부팅에서 hasRan() 이 무조건 tradingDate!==today 로
    // 판정해 handlerRanAt 을 지워버리는 회귀 위험이 있음.
    if (!this.orch.tradingDate) {
      this.orch.tradingDate = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
    }
    this.orch.handlerRanAt[key] = new Date().toISOString();
    this.save();
  }

  /** 현재 오케스트레이터 상태 조회 (모니터링 / API용) */
  getStatus(): OrchestratorState & { computedState: TradingState } {
    const { h, m, dow } = getKstTime();
    return { ...this.orch, computedState: resolveState(h, m, dow) };
  }

  /**
   * Phase 2.3 — 테스트 전용: 핸들러 키 이력을 외부에서 확인 가능하게 노출.
   * Railway 재배포 → orchestrator-state.json 재로드 → hasRan 반환 동작 검증용.
   * 프로덕션 코드에서는 호출하지 말 것 (비공개 상태 노출).
   */
  _testOnly_hasRan(key: string): boolean {
    return this.hasRan(key);
  }
  _testOnly_markRan(key: string): void {
    this.markRan(key);
  }
  _testOnly_getHandlerRanAt(): Record<string, string> {
    return { ...this.orch.handlerRanAt };
  }

  /**
   * 5분 간격 cron에서 호출.
   * 상태 전환 감지 → 해당 핸들러 실행.
   * Railway 재시작 안전: handlerRanAt으로 당일 중복 실행 방지.
   */
  async tick(): Promise<void> {
    const { h, m, t, dow, dateStr } = getKstTime();
    const state = resolveState(h, m, dow);

    // 날짜 변경 → 핸들러 이력 초기화 (새 거래일)
    if (dateStr !== this.orch.tradingDate) {
      this.orch.tradingDate    = dateStr;
      this.orch.handlerRanAt   = {};
      console.log(`[Orchestrator] 새 거래일 (${dateStr}) — 핸들러 이력 초기화`);
    }

    // 상태 전환 로깅
    if (state !== this.orch.currentState) {
      console.log(
        `[Orchestrator] ${this.orch.currentState} → ${state} ` +
        `(KST ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')})`
      );
      this.orch.currentState   = state;
      this.orch.lastTransition = new Date().toISOString();
      this.save();
    }

    await this.dispatch(state, t);
  }

  private async dispatch(state: TradingState, t: number): Promise<void> {
    const enabled = process.env.AUTO_TRADE_ENABLED === 'true';

    switch (state) {
      case 'OPENING_AUCTION': {
        // 08:00 이후 최초 1회: 실거래 전환 플래그 확인 → 아침 리마인더
        if (!this.hasRan('realTradeReminder') && isRealTradeReady()) {
          await sendTelegramAlert(
            `🟡 <b>[전환 대기]</b> real-trade-ready.flag 감지\n` +
            `오늘 KIS_IS_REAL=true 설정 후 재배포하면 실거래 전환됩니다.\n` +
            `준비가 됐다면 Railway 대시보드에서 변수 설정 후 Redeploy하세요.`
          ).catch(console.error);
          this.markRan('realTradeReminder');
        }

        // 08:45 이후 한 번만: 토큰 갱신 → 분할 매수 체크 → 사전 스크리닝 → 워치리스트 자동 채우기 → 예약 주문
        if (t >= 845 && !this.hasRan('openAuction')) {
          console.log('[Orchestrator] 장 전 준비 시작 (KST 08:45+)');
          await refreshKisToken().catch(console.error);
          // Phase 2차 C7 — 스모크 테스트 게이트: 실패 시 LIVE 주문 자동 차단.
          // 토큰 갱신 직후에 실행하여 토큰 유효성도 함께 검증.
          await runPreMarketSmokeTest().catch(console.error);
          // 아이디어 8: 분할 매수 대기 트랜치 실행
          await trancheExecutor.checkPendingTranches().catch(console.error);
          await preScreenStocks().catch(console.error);
          const wlBefore = new Set(loadWatchlist().map(w => w.code));
          const added = await autoPopulateWatchlist().catch(() => 0) ?? 0;
          await cleanupWatchlist().catch(console.error);
          if (added > 0) {
            const newEntries = loadWatchlist().filter(w => !wlBefore.has(w.code));
            const namesList  = newEntries.map(w => `${w.name}(${w.code})`).join('\n');
            await sendTelegramAlert(
              `📋 <b>[AutoPopulate] 워치리스트 자동 추가</b>\n신규 ${added}개:\n${namesList}`
            ).catch(console.error);
          }
          // 아이디어 5: 탈락 리포트 — 워치리스트 채운 직후 즉시 발송 (기존 16:10 cron 대체)
          await sendWatchlistRejectionReport().catch(console.error);
          if (enabled) {
            await preMarketOrderPrep().catch(console.error);
          }
          this.markRan('openAuction');
        }
        break;
      }

      case 'MARKET_OPEN': {
        // 시초가 스캔 (한 번만)
        if (enabled && !this.hasRan('marketOpen')) {
          console.log('[Orchestrator] 시초가 스캔 (KST 09:00+)');
          const shadowsBefore = loadShadowTrades().length;
          const scanResult = await runAutoSignalScan().catch(() => ({})) ?? {};
          const shadowsAfter = loadShadowTrades().length;
          const newSignals = Math.max(0, shadowsAfter - shadowsBefore);
          recordScanResult(newSignals, { positionFull: (scanResult as { positionFull?: boolean }).positionFull });
          await fillMonitor.pollFills().catch(console.error);
          this.markRan('marketOpen');
        }
        break;
      }

      case 'INTRADAY': {
        if (!enabled) break;

        // 장중 워치리스트 재스캔 — 13:00~13:30 KST 사이 한 번
        // 오전 장 전(08:45) autoPopulate에서 빠진 종목을 장중에 보완
        if (t >= 1300 && t <= 1330 && !this.hasRan('middayRescan')) {
          console.log('[Orchestrator] 장중 워치리스트 재스캔 (KST 13:00)');
          const wlBeforeMidday = new Set(loadWatchlist().map(w => w.code));
          const added = await autoPopulateWatchlist().catch(() => 0) ?? 0;
          await cleanupWatchlist().catch(console.error);
          if (added > 0) {
            const newEntries = loadWatchlist().filter(w => !wlBeforeMidday.has(w.code));
            const namesList  = newEntries.map(w => `${w.name}(${w.code})`).join('\n');
            await sendTelegramAlert(
              `📋 <b>[MiddayRescan] 장중 워치리스트 추가</b>\n신규 ${added}개:\n${namesList}`
            ).catch(console.error);
          }
          this.markRan('middayRescan');
        }

        // 장중 Watchlist 발굴·갱신 (10분 내부 쓰로틀 — 1분 tick마다 호출 안전)
        await scanAndUpdateIntradayWatchlist().catch(console.error);

        const decision = decideScan();

        if (!decision.shouldScan) {
          // 1분 tick이지만 인터벌 미충족 — 조용히 스킵
          break;
        }

        console.log(`[Orchestrator] 스캔 실행: ${decision.reason}`);

        // 스캔 전후 shadow 수 비교 → 신호 건수 피드백 (아이디어 5: 피드백 루프)
        const shadowsBefore = loadShadowTrades().length;

        let scanResult: { positionFull?: boolean } = {};
        if (decision.priority === 'SELL_ONLY') {
          scanResult = await runAutoSignalScan({ sellOnly: true }).catch(() => ({})) ?? {};
        } else {
          scanResult = await runAutoSignalScan().catch(() => ({})) ?? {};
        }

        const shadowsAfter = loadShadowTrades().length;
        const newSignals = Math.max(0, shadowsAfter - shadowsBefore);
        recordScanResult(newSignals, { positionFull: scanResult.positionFull });

        await fillMonitor.pollFills().catch(console.error);
        break;
      }

      case 'CLOSING_PREP': {
        // 15:20 도달 시 한 번만: 미체결 전량 취소
        if (enabled && !this.hasRan('closingPrep')) {
          console.log('[Orchestrator] 장 마감 전 미체결 자동 취소 (KST 15:20)');
          await fillMonitor.autoCancelAtClose().catch(console.error);
          this.markRan('closingPrep');
        }
        break;
      }

      case 'REPORT_ANALYSIS': {
        // 16:00+ 한 번만: 일일 리포트
        if (!this.hasRan('dailyReport')) {
          console.log('[Orchestrator] 일일 리포트 생성 (KST 16:00+)');
          await generateDailyReport().catch(console.error);
          this.markRan('dailyReport');
        }
        // 16:30+ 한 번만: L2 일일 평가 (evaluateRecommendations + anomaly + first-calib)
        if (t >= 1630 && !this.hasRan('evalRecs')) {
          console.log('[Orchestrator] L2 일일 평가 위임 (KST 16:30+)');
          await learningOrchestrator.runDailyEval().catch(console.error);
          this.markRan('evalRecs');
        }
        // L4 월간 진화 루프 — 적응형 트리거 (아이디어: Adaptive Learning Clock).
        // 기존 "28일 이후" 하드코드 대신 VIX/레짐 기반 calibrateTriggerDays(7/14/28)로
        // 적응. shouldRunMonthlyEvolution()이 true면 16:45+ 이후 1회 실행.
        {
          const kstNow   = new Date(Date.now() + 9 * 60 * 60 * 1000);
          const kstMonth = kstNow.toISOString().slice(0, 7); // YYYY-MM
          if (t >= 1645 && !this.hasRan('calibrate') && shouldRunMonthlyEvolution()) {
            const { mode, calibrateTriggerDays, reason } = getLearningInterval();
            console.log(
              `[Orchestrator] L4 월간 진화 루프 위임 — adaptive mode=${mode} ` +
              `(trigger=${calibrateTriggerDays}일, ${reason})`,
            );
            await learningOrchestrator.runMonthlyEvolution().catch(console.error);
            this.orch.lastCalibratedMonth = kstMonth;
            this.markRan('calibrate');
          }
        }
        break;
      }

      case 'PRE_MARKET': {
        // ── L4 캘리브레이션 catch-up ────────────────────────────────────────
        // KST 17:00+ PRE_MARKET (UTC 08:xx cron).
        // 조건: adaptive 트리거 만족 & 이번 달 미실행 & 오늘 정상/catch-up 모두 미실행.
        const kstNow   = new Date(Date.now() + 9 * 60 * 60 * 1000);
        const kstMonth = kstNow.toISOString().slice(0, 7);
        const catchupNeeded =
          shouldRunMonthlyEvolution() &&
          this.orch.lastCalibratedMonth !== kstMonth &&
          !this.hasRan('calibrate') &&
          !this.hasRan('catchupCalibrate');

        if (catchupNeeded) {
          const { mode, calibrateTriggerDays } = getLearningInterval();
          console.log(
            `[Orchestrator] L4 캘리브레이션 누락 감지 — catch-up 실행 (adaptive ${mode} / ${calibrateTriggerDays}일)`,
          );
          await sendTelegramAlert(
            `⚠️ <b>[Calibrator Catch-up]</b> 16:45 구간 누락 감지\n` +
            `${kstMonth} 캘리브레이션(adaptive ${mode} / ${calibrateTriggerDays}일)을 17:00+ catch-up으로 실행합니다.`
          ).catch(console.error);
          await learningOrchestrator.runMonthlyEvolution().catch(console.error);
          this.orch.lastCalibratedMonth = kstMonth;
          this.markRan('catchupCalibrate');
        }
        break;
      }

      default: {
        // POST_MARKET: 15:30 이후 한 번만 — 당일 장중 워치리스트 초기화
        if (state === 'POST_MARKET' && !this.hasRan('clearIntradayWatchlist')) {
          console.log('[Orchestrator] 장 마감 — 장중 워치리스트 초기화 (KST 15:30+)');
          clearIntradayWatchlist();
          this.markRan('clearIntradayWatchlist');
        }
        // WEEKEND — 대기
        break;
      }
    }
  }
}

/** 싱글턴 인스턴스 (server.ts에서 import하여 cron 연결) */
export const tradingOrchestrator = new TradingDayOrchestrator();
