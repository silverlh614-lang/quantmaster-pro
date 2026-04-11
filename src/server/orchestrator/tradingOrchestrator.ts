import fs from 'fs';
import { evaluateServerGate } from '../serverQuantFilter.js';
import { ORCHESTRATOR_STATE_FILE, ensureDataDir } from '../persistence/paths.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { loadConditionWeights } from '../persistence/conditionWeightsRepo.js';
import {
  BUY_TR_ID,
  refreshKisToken, kisPost,
  fetchAccountBalance,
} from '../clients/kisClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { fillMonitor } from '../trading/fillMonitor.js';
import { trancheExecutor } from '../trading/trancheExecutor.js';
import { runAutoSignalScan } from '../trading/signalScanner.js';
import { fetchYahooQuote, preScreenStocks, autoPopulateWatchlist } from '../screener/stockScreener.js';
import { generateDailyReport } from '../alerts/reportGenerator.js';
import { evaluateRecommendations, isRealTradeReady } from '../learning/recommendationTracker.js';
import { calibrateSignalWeights } from '../learning/signalCalibrator.js';

// ─── 편의 조회 래퍼 ────────────────────────────────────────────────────────────
export function getShadowTrades() { return loadShadowTrades(); }
export function getWatchlist()    { return loadWatchlist(); }

// ─── 아이디어 2: 동시호가 예약 주문 (08:45 KST) ──────────────────────────────────

/**
 * OPENING_AUCTION 진입 시 (08:45 KST) 워치리스트 종목에 대해:
 * 1. Yahoo Finance로 전일 종가 조회
 * 2. 진입가 대비 ±2% 이내 괴리율 체크
 * 3. ServerGate 재평가 (8개 조건)
 * 4. NORMAL/STRONG → KIS 지정가 주문 or Shadow 알림
 */
export async function preMarketOrderPrep(): Promise<void> {
  const watchlist = loadWatchlist();
  if (watchlist.length === 0) {
    console.log('[PreMarket] 워치리스트 비어있음 — 예약 주문 건너뜀');
    return;
  }

  console.log(`[PreMarket] 동시호가 예약 주문 준비 — ${watchlist.length}개 종목`);
  const isLive = process.env.AUTO_TRADE_MODE === 'LIVE';
  const capital = (await fetchAccountBalance().catch(() => null)) ?? 10_000_000;

  for (const stock of watchlist) {
    try {
      // Yahoo Finance 시세 조회 (KS 접미사 → KQ 폴백)
      const quote = (await fetchYahooQuote(`${stock.code}.KS`).catch(() => null))
                 ?? (await fetchYahooQuote(`${stock.code}.KQ`).catch(() => null));

      if (!quote || quote.price <= 0) {
        console.log(`[PreMarket] ${stock.name}(${stock.code}) Yahoo 시세 없음 — 건너뜀`);
        continue;
      }

      // ±2% gap 체크: 전일 종가 대비 워치리스트 진입가 괴리율
      const gapPct = Math.abs((quote.price - stock.entryPrice) / stock.entryPrice) * 100;
      if (gapPct > 2) {
        console.log(`[PreMarket] ${stock.name}(${stock.code}) Gap ${gapPct.toFixed(1)}% > 2% — 스킵`);
        continue;
      }

      // Gate 재평가 (Yahoo 데이터 기반 8개 조건, 자기학습 가중치 적용)
      const gate = evaluateServerGate(quote, loadConditionWeights());
      if (gate.signalType === 'SKIP') {
        console.log(`[PreMarket] ${stock.name}(${stock.code}) Gate ${gate.gateScore}/8 SKIP — 미달`);
        continue;
      }

      const quantity = Math.floor((capital * gate.positionPct) / stock.entryPrice);
      if (quantity <= 0) continue;

      console.log(
        `[PreMarket] ${stock.name}(${stock.code}) 예약 — ${quantity}주 @${stock.entryPrice.toLocaleString()} ` +
        `(Gate=${gate.gateScore}/8 ${gate.signalType} gap=${gapPct.toFixed(1)}%)`
      );

      if (isLive && process.env.KIS_APP_KEY) {
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
          await sendTelegramAlert(
            `📋 <b>[동시호가 예약 주문]</b>\n` +
            `종목: ${stock.name} (${stock.code})\n` +
            `가격: ${stock.entryPrice.toLocaleString()}원 × ${quantity}주\n` +
            `Gate: ${gate.gateScore}/8 (${gate.signalType}) | Gap: ${gapPct.toFixed(1)}%\n` +
            `주문번호: ${ordNo}`
          ).catch(console.error);
        }
      } else {
        // Shadow 모드: Telegram 알림만
        await sendTelegramAlert(
          `🎭 <b>[동시호가 Shadow 예약]</b>\n` +
          `종목: ${stock.name} (${stock.code})\n` +
          `예정가: ${stock.entryPrice.toLocaleString()}원 × ${quantity}주\n` +
          `Gate: ${gate.gateScore}/8 (${gate.signalType}) | Gap: ${gapPct.toFixed(1)}%`
        ).catch(console.error);
      }

      await new Promise(r => setTimeout(r, 300)); // Yahoo rate limit 방지
    } catch (e) {
      console.error(`[PreMarket] ${stock.name}(${stock.code}) 오류:`, e instanceof Error ? e.message : e);
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
        return JSON.parse(fs.readFileSync(ORCHESTRATOR_STATE_FILE, 'utf-8')) as OrchestratorState;
      } catch { /* fallthrough */ }
    }
    return {
      currentState:  'PRE_MARKET',
      lastTransition: new Date().toISOString(),
      tradingDate:    '',
      handlerRanAt:   {},
    };
  }

  private save(): void {
    ensureDataDir();
    fs.writeFileSync(ORCHESTRATOR_STATE_FILE, JSON.stringify(this.orch, null, 2));
  }

  private hasRan(key: string): boolean {
    return !!this.orch.handlerRanAt[key];
  }

  private markRan(key: string): void {
    this.orch.handlerRanAt[key] = new Date().toISOString();
    this.save();
  }

  /** 현재 오케스트레이터 상태 조회 (모니터링 / API용) */
  getStatus(): OrchestratorState & { computedState: TradingState } {
    const { h, m, dow } = getKstTime();
    return { ...this.orch, computedState: resolveState(h, m, dow) };
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
          // 아이디어 8: 분할 매수 대기 트랜치 실행
          await trancheExecutor.checkPendingTranches().catch(console.error);
          await preScreenStocks().catch(console.error);
          const added = await autoPopulateWatchlist().catch(() => 0) ?? 0;
          if (added > 0) {
            await sendTelegramAlert(
              `📋 <b>[AutoPopulate] 워치리스트 자동 추가</b>\n신규 ${added}개 종목 추가됨`
            ).catch(console.error);
          }
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
          await runAutoSignalScan().catch(console.error);
          await fillMonitor.pollFills().catch(console.error);
          this.markRan('marketOpen');
        }
        break;
      }

      case 'INTRADAY': {
        // 매 tick(5분): 신호 스캔 + 체결 확인
        if (enabled) {
          await runAutoSignalScan().catch(console.error);
          await fillMonitor.pollFills().catch(console.error);
        }
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
        // 16:30+ 한 번만: 자기학습 추천 평가
        if (t >= 1630 && !this.hasRan('evalRecs')) {
          console.log('[Orchestrator] 자기학습 추천 평가 (KST 16:30+)');
          await evaluateRecommendations().catch(console.error);
          this.markRan('evalRecs');
        }
        // 월말(28일 이후) 16:45+ 한 번만: Signal Calibrator 가중치 보정
        {
          const kstDay = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCDate();
          if (kstDay >= 28 && t >= 1645 && !this.hasRan('calibrate')) {
            console.log('[Orchestrator] Signal Calibrator 가중치 보정 (월말)');
            await calibrateSignalWeights().catch(console.error);
            this.markRan('calibrate');
          }
        }
        break;
      }

      default:
        // PRE_MARKET, POST_MARKET, WEEKEND — 대기
        break;
    }
  }
}

/** 싱글턴 인스턴스 (server.ts에서 import하여 cron 연결) */
export const tradingOrchestrator = new TradingDayOrchestrator();
