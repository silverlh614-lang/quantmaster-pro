import fs from 'fs';
import { TRANCHE_FILE, ensureDataDir } from '../persistence/paths.js';
import { loadConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { evaluateServerGate } from '../quantFilter.js';
import { kisPost, BUY_TR_ID, fetchCurrentPrice } from '../clients/kisClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { fillMonitor } from './fillMonitor.js';
import { fetchYahooQuote } from '../screener/stockScreener.js';
import { loadShadowTrades, type ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { getLiveRegime } from './regimeBridge.js';

export interface TrancheSchedule {
  id: string;
  parentTradeId: string;
  stockCode: string;
  stockName: string;
  trancheNumber: 2 | 3;
  scheduledDate: string;   // YYYY-MM-DD KST — 이 날짜 이후 첫 장 개시에 실행
  quantity: number;
  entryPrice: number;      // 1차 진입가 (기준가)
  stopLoss: number;
  targetPrice: number;
  status: 'PENDING' | 'EXECUTED' | 'CANCELLED';
  executedAt?: string;
  cancelReason?: string;
}

function loadTranches(): TrancheSchedule[] {
  ensureDataDir();
  if (!fs.existsSync(TRANCHE_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(TRANCHE_FILE, 'utf-8')); } catch { return []; }
}

function saveTranches(list: TrancheSchedule[]): void {
  ensureDataDir();
  // PENDING만 무제한, 완료·취소는 최근 200건 보관
  const active  = list.filter(t => t.status === 'PENDING');
  const history = list.filter(t => t.status !== 'PENDING').slice(-200);
  fs.writeFileSync(TRANCHE_FILE, JSON.stringify([...active, ...history], null, 2));
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
// NOTE: KRX 휴장일은 해마다 변동되므로 연 단위 점검/갱신 필요.
const DEFAULT_KRX_HOLIDAYS = new Set<string>([
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-05-05', '2026-05-25',
  '2026-06-06', '2026-08-15', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03', '2026-10-09', '2026-12-25',
  '2027-01-01', '2027-02-06', '2027-02-07', '2027-02-08', '2027-03-01', '2027-05-05', '2027-05-12',
  '2027-06-06', '2027-08-15', '2027-09-14', '2027-09-15', '2027-09-16', '2027-10-03', '2027-10-09', '2027-12-25',
]);
const TRANCHE_MAX_DROP_PCT = -3;
const REGIME_BLOCK_SET = new Set(['R5_BEAR', 'R6_DEFENSE']);

function formatKstYmd(kstDate: Date): string {
  const y = kstDate.getUTCFullYear();
  const m = `${kstDate.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${kstDate.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function kstTodayYmd(nowMs = Date.now()): string {
  return formatKstYmd(new Date(nowMs + KST_OFFSET_MS));
}

function isKrxBusinessDay(ymd: string, holidays = DEFAULT_KRX_HOLIDAYS): boolean {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !holidays.has(ymd);
}

export function addBusinessDaysFromKstDate(baseYmd: string, businessDays: number, holidays = DEFAULT_KRX_HOLIDAYS): string {
  if (businessDays <= 0) return baseYmd;
  const d = new Date(`${baseYmd}T00:00:00.000Z`);
  let added = 0;
  while (added < businessDays) {
    d.setUTCDate(d.getUTCDate() + 1);
    const ymd = formatKstYmd(d);
    if (isKrxBusinessDay(ymd, holidays)) added += 1;
  }
  return formatKstYmd(d);
}

/** KST 날짜 문자열 (YYYY-MM-DD) 반환 */
function kstDateStr(offsetDays = 0): string {
  if (offsetDays <= 0) return kstTodayYmd();
  return addBusinessDaysFromKstDate(kstTodayYmd(), offsetDays);
}

function regimeRiskRank(regime: string | undefined): number {
  if (!regime) return 4;
  const m = regime.match(/^R([1-6])_/);
  if (!m) return 4;
  return Number(m[1]);
}

function isOpenShadowStatus(status: ServerShadowTrade['status']): boolean {
  return status === 'PENDING'
    || status === 'ORDER_SUBMITTED'
    || status === 'PARTIALLY_FILLED'
    || status === 'ACTIVE'
    || status === 'EUPHORIA_PARTIAL';
}

export function evaluateTrancheRevalidation(input: {
  currentPrice: number;
  entryPrice: number;
  stopLoss: number;
  currentRegime: string;
  entryRegime?: string;
  cascadeStep?: 0 | 1 | 2;
  addBuyBlocked?: boolean;
}): { ok: boolean; reason?: string; dropPct: number } {
  const dropPct = ((input.currentPrice - input.entryPrice) / input.entryPrice) * 100;

  if (input.currentPrice <= input.stopLoss) {
    return { ok: false, reason: '1차 포지션 손절선 하회', dropPct };
  }

  if (input.currentPrice < input.entryPrice) {
    return { ok: false, reason: '상승형 피라미딩 조건 미충족 (기준가 하회)', dropPct };
  }

  if (dropPct <= TRANCHE_MAX_DROP_PCT) {
    return { ok: false, reason: `기준가 대비 ${dropPct.toFixed(1)}% 하락`, dropPct };
  }

  if (input.addBuyBlocked) {
    const stepTag = (input.cascadeStep ?? 0) > 0 ? ` (cascadeStep=${input.cascadeStep})` : '';
    return { ok: false, reason: `추가매수 차단 플래그 활성화${stepTag}`, dropPct };
  }
  if ((input.cascadeStep ?? 0) > 0) {
    return { ok: false, reason: `Cascade 단계 진입(cascadeStep=${input.cascadeStep ?? 0})`, dropPct };
  }

  if (REGIME_BLOCK_SET.has(input.currentRegime)) {
    return { ok: false, reason: `레짐 악화(${input.currentRegime})`, dropPct };
  }

  if (regimeRiskRank(input.currentRegime) > regimeRiskRank(input.entryRegime)) {
    return { ok: false, reason: `진입 레짐(${input.entryRegime ?? 'N/A'}) 대비 악화(${input.currentRegime})`, dropPct };
  }

  return { ok: true, dropPct };
}

export class TrancheExecutor {
  /**
   * STRONG_BUY 1차 진입 직후 호출.
   * 2차(+3 영업일, 30%)·3차(+7 영업일, 20%) 스케줄 등록.
   */
  scheduleTranches(opts: {
    parentTradeId: string;
    stockCode: string;
    stockName: string;
    totalQuantity: number;
    firstQuantity: number;
    entryPrice: number;
    stopLoss: number;
    targetPrice: number;
  }): void {
    const remaining = opts.totalQuantity - opts.firstQuantity;
    if (remaining < 1) return;

    const qty2 = Math.max(1, Math.floor(opts.totalQuantity * 0.30));
    const qty3 = Math.max(1, opts.totalQuantity - opts.firstQuantity - qty2);

    const list = loadTranches();
    const base: Omit<TrancheSchedule, 'id' | 'trancheNumber' | 'scheduledDate' | 'quantity'> = {
      parentTradeId: opts.parentTradeId,
      stockCode:     opts.stockCode,
      stockName:     opts.stockName,
      entryPrice:    opts.entryPrice,
      stopLoss:      opts.stopLoss,
      targetPrice:   opts.targetPrice,
      status:        'PENDING',
    };
    list.push({ ...base, id: `tr2_${Date.now()}_${opts.stockCode}`, trancheNumber: 2, scheduledDate: kstDateStr(3),  quantity: qty2 });
    list.push({ ...base, id: `tr3_${Date.now()}_${opts.stockCode}`, trancheNumber: 3, scheduledDate: kstDateStr(7),  quantity: qty3 });
    saveTranches(list);
    console.log(`[Tranche] 스케줄 등록: ${opts.stockName}(${opts.stockCode}) 2차 ${qty2}주(+3영업일) / 3차 ${qty3}주(+7영업일)`);
  }

  /**
   * 장 전 OPENING_AUCTION 핸들러에서 호출.
   * scheduledDate <= 오늘 이고 PENDING인 트랜치를 실행 or 취소.
   * 가드: 현재가가 기준가(entryPrice) 대비 -3% 이하 → 해당 parentTradeId 전체 취소.
   */
  async checkPendingTranches(): Promise<void> {
    if (!process.env.KIS_APP_KEY) return;
    const list = loadTranches();
    const today = kstDateStr();
    const pending = list.filter(t => t.status === 'PENDING' && t.scheduledDate <= today);
    if (pending.length === 0) return;

    console.log(`[Tranche] 실행 대상 ${pending.length}건 점검`);
    const isLive = process.env.AUTO_TRADE_MODE === 'LIVE';
    let changed = false;
    const shadowsById = new Map(loadShadowTrades().map((s) => [s.id, s]));
    const currentRegime = getLiveRegime(loadMacroState());

    // parentTradeId별로 취소 여부를 캐싱 (현재가는 한 번만 조회)
    const cancelledParents = new Set<string>();
    const priceCache: Record<string, number | null> = {};
    const cancelParentPending = (parentTradeId: string, reason: string): void => {
      let updated = false;
      for (const item of list) {
        if (item.parentTradeId !== parentTradeId || item.status !== 'PENDING') continue;
        item.status = 'CANCELLED';
        item.cancelReason = reason;
        updated = true;
      }
      if (updated) {
        cancelledParents.add(parentTradeId);
        changed = true;
      }
    };

    for (const t of pending) {
      try {
        // 이미 같은 parentTrade가 취소된 경우 연쇄 취소
        if (cancelledParents.has(t.parentTradeId)) {
          t.status = 'CANCELLED';
          t.cancelReason = '동일 포지션 취소 연쇄';
          changed = true;
          continue;
        }

        const parentTrade = shadowsById.get(t.parentTradeId);
        if (!parentTrade || !isOpenShadowStatus(parentTrade.status)) {
          cancelParentPending(t.parentTradeId, `1차 포지션 비활성(${parentTrade?.status ?? 'NOT_FOUND'})`);
          continue;
        }

        // 현재가 조회 (캐시 활용)
        if (!(t.stockCode in priceCache)) {
          priceCache[t.stockCode] = await fetchCurrentPrice(t.stockCode).catch(() => null);
        }
        const currentPrice = priceCache[t.stockCode];

        if (!currentPrice) {
          console.warn(`[Tranche] ${t.stockName} 현재가 조회 실패 — 다음 실행으로 연기`);
          continue;
        }

        // 2·3차 실행 전 엄격 재검증 (손절선, 캐스케이드, 레짐 악화, 상승형 피라미딩)
        const revalidation = evaluateTrancheRevalidation({
          currentPrice,
          entryPrice: t.entryPrice,
          stopLoss: t.stopLoss,
          currentRegime,
          entryRegime: parentTrade.entryRegime,
          cascadeStep: parentTrade.cascadeStep,
          addBuyBlocked: parentTrade.addBuyBlocked,
        });
        if (!revalidation.ok) {
          cancelParentPending(t.parentTradeId, revalidation.reason ?? '2·3차 재검증 실패');
          console.warn(`[Tranche] ${t.stockName} ${t.trancheNumber}차 취소 — ${revalidation.reason}`);
          await sendTelegramAlert(
            `🚫 <b>[분할 매수 ${t.trancheNumber}차 취소]</b> ${t.stockName}(${t.stockCode})\n` +
            `${revalidation.reason}\n` +
            `현재가 ${currentPrice.toLocaleString()}원 | 기준가 대비 ${revalidation.dropPct.toFixed(1)}%`
          ).catch(console.error);
          continue;
        }

        // Gate 1 재검증: 시장 상황 변화 반영 (Yahoo Finance 기반 serverQuantFilter)
        const reCheckQuote = await fetchYahooQuote(`${t.stockCode}.KS`).catch(() => null)
                          ?? await fetchYahooQuote(`${t.stockCode}.KQ`).catch(() => null);
        if (reCheckQuote) {
          const gate = evaluateServerGate(reCheckQuote, loadConditionWeights());
          if (gate.signalType === 'SKIP') {
            t.status = 'CANCELLED';
            t.cancelReason = `Gate 재검증 실패 (score=${gate.gateScore.toFixed(1)}, SKIP)`;
            changed = true;
            console.warn(`[Tranche] ${t.stockName} ${t.trancheNumber}차 취소 — Gate 재검증 실패 (${gate.gateScore.toFixed(1)}/8)`);
            await sendTelegramAlert(
              `🚫 <b>[분할 매수 ${t.trancheNumber}차 취소]</b> ${t.stockName}(${t.stockCode})\n` +
              `Gate 재검증 SKIP (score=${gate.gateScore.toFixed(1)}/8) — 시장 상황 변화`
            ).catch(console.error);
            continue;
          }
        }

        // 실행
        if (isLive) {
          const orderData = await kisPost(BUY_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
            CANO:         process.env.KIS_ACCOUNT_NO ?? '',
            ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
            PDNO:         t.stockCode.padStart(6, '0'),
            ORD_DVSN:     '01', // 시장가
            ORD_QTY:      t.quantity.toString(),
            ORD_UNPR:     '0',
            SLL_BUY_DVSN_CD: '02',
            CTAC_TLNO: '', MGCO_APTM_ODNO: '', ORD_SVR_DVSN_CD: '0',
          }).catch(() => null);

          const ordNo = (orderData as { output?: { ODNO?: string } } | null)?.output?.ODNO;
          if (ordNo) {
            fillMonitor.addOrder({
              ordNo,
              stockCode:      t.stockCode,
              stockName:      t.stockName,
              quantity:       t.quantity,
              orderPrice:     currentPrice,
              placedAt:       new Date().toISOString(),
              relatedTradeId: t.parentTradeId,
            });
          }
          console.log(`[Tranche] LIVE ${t.trancheNumber}차 주문 — ${t.stockName} ${t.quantity}주 ODNO=${ordNo}`);
        }

        t.status     = 'EXECUTED';
        t.executedAt = new Date().toISOString();
        changed = true;

        await sendTelegramAlert(
          `📈 <b>[분할 매수 ${t.trancheNumber}차${isLive ? '' : ' Shadow'}]</b> ${t.stockName}(${t.stockCode})\n` +
          `${t.quantity}주 @${currentPrice.toLocaleString()}원 | 기준가 대비 ${revalidation.dropPct >= 0 ? '+' : ''}${revalidation.dropPct.toFixed(1)}%`
        ).catch(console.error);
      } catch (e) {
        console.error(`[Tranche] ${t.stockName}(${t.stockCode}) 오류:`, e instanceof Error ? e.message : e);
      }
    }

    if (changed) saveTranches(list);
  }

  getPendingTranches(): TrancheSchedule[] {
    return loadTranches().filter(t => t.status === 'PENDING');
  }
}

export const trancheExecutor = new TrancheExecutor();
