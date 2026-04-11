/**
 * autoTradeEngine.ts — 서버사이드 24시간 자동매매 엔진 (주문 집행 메인 채널)
 *
 * ⚠️  역할 분리: 이 모듈이 실주문 집행의 유일한 채널입니다.
 *     클라이언트사이드 autoTrading.ts는 수동 Shadow Trading + 분석 전용이며,
 *     AUTO_TRADE_ENABLED=true일 때 클라이언트 실주문은 자동 차단됩니다.
 *
 * Railway에서 브라우저 없이 실행됩니다.
 * - process.env 사용 (import.meta.env 없음)
 * - KIS REST API 직접 호출 (프록시 경유 없음)
 * - 파일시스템 기반 상태 저장 (watchlist.json, shadow-trades.json)
 */

import fs from 'fs';
import { evaluateServerGate } from './serverQuantFilter.js';
import {
  ORCHESTRATOR_STATE_FILE,
  ensureDataDir,
} from './persistence/paths.js';
import { loadWatchlist } from './persistence/watchlistRepo.js';
import { loadMacroState } from './persistence/macroStateRepo.js';
import {
  type ServerShadowTrade,
  loadShadowTrades, saveShadowTrades, appendShadowLog,
} from './persistence/shadowTradeRepo.js';
import { addToBlacklist, isBlacklisted } from './persistence/blacklistRepo.js';
import { loadConditionWeights } from './persistence/conditionWeightsRepo.js';
import {
  BUY_TR_ID,
  refreshKisToken, kisPost,
  fetchCurrentPrice, fetchAccountBalance, placeKisSellOrder,
} from './clients/kisClient.js';
import { sendTelegramAlert } from './alerts/telegramClient.js';
import {
  RRR_MIN_THRESHOLD, MAX_CONCURRENT_POSITIONS, MAX_SECTOR_CONCENTRATION,
  calcRRR, checkEuphoria,
} from './trading/riskManager.js';
import { fillMonitor } from './trading/fillMonitor.js';
import { addRecommendation, isRealTradeReady, evaluateRecommendations } from './learning/recommendationTracker.js';
import { trancheExecutor } from './trading/trancheExecutor.js';
import { fetchYahooQuote, preScreenStocks, autoPopulateWatchlist } from './screener/stockScreener.js';
import { calibrateSignalWeights } from './learning/signalCalibrator.js';
import { generateDailyReport } from './alerts/reportGenerator.js';


// ─── 블랙리스트 (Cascade -30% 진입 금지 목록) ──────────────────────────────────
export type { BlacklistEntry } from './persistence/blacklistRepo.js';
export { loadBlacklist, saveBlacklist, addToBlacklist, isBlacklisted } from './persistence/blacklistRepo.js';

// ─── 아이디어 4: FSS 외국인 수급 일별 기록 I/O ────────────────────────────────────
export type { FssRecordRow } from './persistence/fssRepo.js';
export { loadFssRecords, saveFssRecords, upsertFssRecord } from './persistence/fssRepo.js';

// ─── RRR + 리스크 상수 ──────────────────────────────────────────────────────────
export { calcRRR, checkEuphoria, RRR_MIN_THRESHOLD, MAX_CONCURRENT_POSITIONS, MAX_SECTOR_CONCENTRATION } from './trading/riskManager.js';

// ─── 아이디어 6: 조건별 가중치 파일 I/O ────────────────────────────────────────
export { loadConditionWeights, saveConditionWeights } from './persistence/conditionWeightsRepo.js';



// ─── 워치리스트 파일 I/O ────────────────────────────────────────────────────────
export type { WatchlistEntry } from './persistence/watchlistRepo.js';
export { loadWatchlist, saveWatchlist } from './persistence/watchlistRepo.js';



// ─── 아이디어 8: Macro State 파일 I/O ──────────────────────────────────────────
export type { MacroState } from './persistence/macroStateRepo.js';
export { loadMacroState, saveMacroState } from './persistence/macroStateRepo.js';

// ─── Shadow Trade 파일 I/O ──────────────────────────────────────────────────────
export type { ServerShadowTrade } from './persistence/shadowTradeRepo.js';
export { loadShadowTrades, saveShadowTrades, appendShadowLog } from './persistence/shadowTradeRepo.js';

// ─── KIS API 헬퍼 (서버사이드 전용) ────────────────────────────────────────────
export { refreshKisToken, KIS_IS_REAL } from './clients/kisClient.js';

// ─── 아이디어 1: 신호 스캔 ──────────────────────────────────────────────────────

/**
 * 장중 5분 간격 자동 신호 스캔
 * - 관심 종목 현재가 조회
 * - 진입 조건 판정: 현재가 ≥ entryPrice AND 손절선 이상
 * - 조건 충족 시 Shadow 또는 실 주문 실행
 */
export async function runAutoSignalScan(): Promise<void> {
  if (!process.env.KIS_APP_KEY) {
    console.warn('[AutoTrade] KIS_APP_KEY 미설정 — 스캔 건너뜀');
    return;
  }

  const watchlist = loadWatchlist();
  if (watchlist.length === 0) return;

  const shadowMode = process.env.AUTO_TRADE_MODE !== 'LIVE'; // 기본 Shadow 모드

  // 투자 총자산: KIS 계좌 잔고 → 환경변수 → 기본값 순으로 결정
  let totalAssets = Number(process.env.AUTO_TRADE_ASSETS || 0);
  if (!totalAssets) {
    const balance = await fetchAccountBalance().catch(() => null);
    totalAssets = balance ?? 30_000_000; // 모의계좌 기본 3천만원
    console.log(`[AutoTrade] 계좌 잔고 조회 → ${totalAssets.toLocaleString()}원`);
  }

  console.log(`[AutoTrade] 스캔 시작 — ${watchlist.length}개 종목 / 모드: ${shadowMode ? 'SHADOW' : 'LIVE'} / 총자산: ${totalAssets.toLocaleString()}원`);

  const shadows = loadShadowTrades();

  // ── 아이디어 5: MHS 하드 게이트 (서버사이드 매크로 브레이커) ──
  const macroState = loadMacroState();
  const macroRegime = macroState?.regime ?? (
    macroState ? (macroState.mhs < 30 ? 'RED' : macroState.mhs < 60 ? 'YELLOW' : 'GREEN') : 'GREEN'
  );

  if (macroRegime === 'RED') {
    await sendTelegramAlert(
      `🔴 <b>[매크로 RED] 신규 진입 전면 차단</b>\n` +
      `MHS: ${macroState?.mhs ?? 'N/A'} | 기존 포지션 모니터링만 수행`
    ).catch(console.error);
    console.warn(`[AutoTrade] 매크로 RED (MHS=${macroState?.mhs}) — 신규 진입 전면 차단`);
    await updateShadowResults(shadows);
    saveShadowTrades(shadows);
    return;
  }

  // 아이디어 9: MAPC — 조정 켈리 = 기본 켈리 × (MHS / 100), 최소 30% 유지
  const mapcMhs = macroState?.mhs ?? 100;
  const mapcFactor = Math.max(0.30, mapcMhs / 100);
  if (mapcFactor < 1) {
    console.warn(`[AutoTrade] MAPC 적용 (MHS=${mapcMhs}) — 포지션 ${Math.round(mapcFactor * 100)}% 수준으로 자동 조절`);
  }

  // ── 아이디어 7: 동시 최대 보유 종목 제한 ──
  const activeCount = shadows.filter(
    (s) => s.status === 'PENDING' || s.status === 'ACTIVE'
  ).length;
  if (activeCount >= MAX_CONCURRENT_POSITIONS) {
    console.log(
      `[AutoTrade] 최대 동시 포지션 도달 (${activeCount}/${MAX_CONCURRENT_POSITIONS}) — 신규 진입 스킵`
    );
    await updateShadowResults(shadows);
    saveShadowTrades(shadows);
    return;
  }

  for (const stock of watchlist) {
    // 아이디어 7: 루프 내에서도 포지션 수 재확인 (같은 스캔 중 복수 진입 방지)
    const currentActive = shadows.filter(
      (s) => s.status === 'PENDING' || s.status === 'ACTIVE'
    ).length;
    if (currentActive >= MAX_CONCURRENT_POSITIONS) {
      console.log(`[AutoTrade] 최대 포지션 도달 (${currentActive}/${MAX_CONCURRENT_POSITIONS}) — 나머지 종목 스킵`);
      break;
    }

    try {
      const currentPrice = await fetchCurrentPrice(stock.code).catch(() => null);
      if (!currentPrice) continue;

      // 진입 조건: 현재가가 entryPrice ± 1% 이내로 도달
      const nearEntry = Math.abs(currentPrice - stock.entryPrice) / stock.entryPrice <= 0.01;
      // 손절 상향: 아직 손절선 위에 있어야 함
      const aboveStop = currentPrice > stock.stopLoss;
      // 상승 모멘텀: 현재가가 entry 이상
      const breakout = currentPrice >= stock.entryPrice;

      if (!(nearEntry || breakout) || !aboveStop) continue;

      // 버그 6 수정: 당일 재진입 방지 — PENDING/ACTIVE 및 당일 이미 거래한 종목 제외
      const today = new Date().toISOString().split('T')[0];
      const alreadyTraded = shadows.some(
        (s) => s.stockCode === stock.code &&
        (s.status === 'PENDING' || s.status === 'ACTIVE' ||
         s.signalTime.startsWith(today))
      );
      if (alreadyTraded) continue;

      // ── 블랙리스트 확인 (Cascade -30% 편입 종목) ──
      if (isBlacklisted(stock.code)) {
        console.log(`[AutoTrade] 🚫 ${stock.name}(${stock.code}) 블랙리스트 — 진입 차단`);
        continue;
      }

      // ── 추가 매수 차단 플래그 확인 (Cascade -7% 이후) ──
      const blockedShadow = shadows.find(
        s => s.stockCode === stock.code && s.addBuyBlocked === true
      );
      if (blockedShadow) {
        console.log(`[AutoTrade] ⚠️  ${stock.name}(${stock.code}) 추가 매수 차단 중 (Cascade -7%)`);
        continue;
      }

      // ── RRR 필터 (Risk-Reward Ratio 최소값 미달 종목 제외) ──
      const rrr = calcRRR(stock.entryPrice, stock.targetPrice, stock.stopLoss);
      if (rrr < RRR_MIN_THRESHOLD) {
        console.log(
          `[AutoTrade] 📐 ${stock.name}(${stock.code}) RRR ${rrr.toFixed(2)} < ${RRR_MIN_THRESHOLD} — 진입 제외`
        );
        continue;
      }

      // ── 아이디어 4: 섹터 집중도 가드 (Correlation Guard) ──
      if (stock.sector) {
        const activeSectorCodes = watchlist
          .filter(w => shadows.some(
            s => s.stockCode === w.code && (s.status === 'PENDING' || s.status === 'ACTIVE')
          ))
          .map(w => w.sector)
          .filter(Boolean);
        const sectorCount = activeSectorCodes.filter(s => s === stock.sector).length;
        if (sectorCount >= MAX_SECTOR_CONCENTRATION) {
          console.log(
            `[CorrelationGuard] ${stock.name}(${stock.sector}) 진입 보류 — ` +
            `동일 섹터 ${sectorCount}/${MAX_SECTOR_CONCENTRATION}개 포화`
          );
          await sendTelegramAlert(
            `🚧 <b>[가드] ${stock.name} 진입 보류</b>\n` +
            `섹터: ${stock.sector}\n` +
            `동일 섹터 보유 ${sectorCount}/${MAX_SECTOR_CONCENTRATION}개 → 분산 한도 초과`
          ).catch(console.error);
          continue;
        }
      }

      const slippage = 0.003;
      const shadowEntryPrice = Math.round(currentPrice * (1 + slippage));
      // 버그 5 수정: Gate 점수 기반 간이 Kelly 포지션 사이징
      const gateScore = stock.gateScore ?? 0;
      const isStrongBuy = gateScore >= 25;

      const rawPositionPct = isStrongBuy       ? 0.12
                           : gateScore >= 20   ? 0.08
                           : gateScore >= 15   ? 0.05
                           : 0.03;
      // 아이디어 9: MAPC — 조정 켈리 = 기본 켈리 × (MHS / 100)
      const positionPct = rawPositionPct * mapcFactor;
      const quantity = Math.floor((totalAssets * positionPct) / shadowEntryPrice);

      if (quantity < 1) continue;

      // 아이디어 8: STRONG_BUY → 분할 매수 1차 진입 (전체 수량의 50%)
      // 잔여 30%·20%는 trancheExecutor가 3일·7일 후 실행
      const execQty = isStrongBuy ? Math.max(1, Math.floor(quantity * 0.5)) : quantity;

      const trade: ServerShadowTrade = {
        id: `srv_${Date.now()}_${stock.code}`,
        stockCode: stock.code,
        stockName: stock.name,
        signalTime: new Date().toISOString(),
        signalPrice: currentPrice,
        shadowEntryPrice,
        quantity: execQty,
        originalQuantity: execQty,  // 최초 진입 수량 보존 — EUPHORIA 부분 매도 후 감사용
        stopLoss: stock.stopLoss,
        targetPrice: stock.targetPrice,
        status: 'PENDING',
      };

      // 아이디어 10: 추천 기록 — 신호 발생 즉시 저장 (WIN/LOSS 추후 평가)
      // 버그 4 수정: gateScore·signalType을 워치리스트 entry에서 가져와 자기학습 통계 정상화
      addRecommendation({
        stockCode:        stock.code,
        stockName:        stock.name,
        signalTime:       new Date().toISOString(),
        priceAtRecommend: currentPrice,
        stopLoss:         stock.stopLoss,
        targetPrice:      stock.targetPrice,
        kellyPct:         Math.round(positionPct * 100),
        gateScore:        gateScore,
        signalType:       isStrongBuy ? 'STRONG_BUY' : 'BUY',
        conditionKeys:    stock.conditionKeys ?? [],
      });

      const trancheLabel = isStrongBuy ? ` (1차/${execQty}주, 총${quantity}주)` : '';

      if (shadowMode) {
        shadows.push(trade);
        console.log(`[AutoTrade SHADOW] ${stock.name}(${stock.code}) 신호 등록 @${currentPrice}${trancheLabel}`);
        appendShadowLog({ event: 'SIGNAL', ...trade });

        await sendTelegramAlert(
          `⚡ <b>[Shadow] 매수 신호${isStrongBuy ? ' — 분할 1차' : ''}</b>\n` +
          `종목: ${stock.name} (${stock.code})\n` +
          `현재가: ${currentPrice.toLocaleString()}원 × ${execQty}주${isStrongBuy ? ` (총${quantity}주)` : ''}\n` +
          `손절: ${stock.stopLoss.toLocaleString()}원 | 목표: ${stock.targetPrice.toLocaleString()}원`
        ).catch(console.error);
      } else {
        // LIVE 모드: 실제 주문 (1차 수량만)
        const orderData = await kisPost(BUY_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
          CANO: process.env.KIS_ACCOUNT_NO ?? '',
          ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
          PDNO: stock.code.padStart(6, '0'),
          ORD_DVSN: '01', // 시장가
          ORD_QTY: execQty.toString(),
          ORD_UNPR: '0',
          SLL_BUY_DVSN_CD: '02',
          CTAC_TLNO: '',
          MGCO_APTM_ODNO: '',
          ORD_SVR_DVSN_CD: '0',
        });
        const ordNo = orderData?.output?.ODNO;
        console.log(`[AutoTrade LIVE] ${stock.name} 매수 주문 완료 — ODNO: ${ordNo}${trancheLabel}`);
        appendShadowLog({ event: 'ORDER', code: stock.code, price: currentPrice, ordNo, tranche: isStrongBuy ? 1 : 0 });

        if (ordNo) {
          fillMonitor.addOrder({
            ordNo,
            stockCode:      stock.code,
            stockName:      stock.name,
            quantity:       execQty,
            orderPrice:     shadowEntryPrice,
            placedAt:       new Date().toISOString(),
            relatedTradeId: trade.id,
          });
        }

        trade.status = 'ACTIVE';
        shadows.push(trade);

        await sendTelegramAlert(
          `🚀 <b>[LIVE] 매수 주문${isStrongBuy ? ' — 분할 1차' : ''}</b>\n` +
          `종목: ${stock.name} (${stock.code})\n` +
          `체결가: ${currentPrice.toLocaleString()}원 × ${execQty}주${isStrongBuy ? ` (총${quantity}주)` : ''}\n` +
          `주문번호: ${ordNo ?? 'N/A'}\n` +
          `손절: ${stock.stopLoss.toLocaleString()}원 | 목표: ${stock.targetPrice.toLocaleString()}원`
        ).catch(console.error);
      }

      // 아이디어 8: STRONG_BUY → 2·3차 분할 매수 스케줄 등록
      if (isStrongBuy && quantity > 1) {
        trancheExecutor.scheduleTranches({
          parentTradeId: trade.id,
          stockCode:     stock.code,
          stockName:     stock.name,
          totalQuantity: quantity,
          firstQuantity: execQty,
          entryPrice:    shadowEntryPrice,
          stopLoss:      stock.stopLoss,
          targetPrice:   stock.targetPrice,
        });
      }
    } catch (err: unknown) {
      console.error(`[AutoTrade] ${stock.code} 스캔 실패:`, err instanceof Error ? err.message : err);
    }
  }

  await updateShadowResults(shadows);
  saveShadowTrades(shadows);
}

/** Shadow 진행 중 거래 결과 업데이트 — Macro/포지션 제한 시에도 재사용 */
async function updateShadowResults(shadows: ServerShadowTrade[]): Promise<void> {
  for (const shadow of shadows) {
    // PENDING: 4분 경과 후 ACTIVE 전환
    if (shadow.status === 'PENDING') {
      const ageMs = Date.now() - new Date(shadow.signalTime).getTime();
      if (ageMs < 4 * 60 * 1000) continue;
      shadow.status = 'ACTIVE';
      continue;
    }

    if (shadow.status !== 'ACTIVE' && shadow.status !== 'EUPHORIA_PARTIAL') continue;

    const currentPrice = await fetchCurrentPrice(shadow.stockCode).catch(() => null);
    if (!currentPrice) continue;

    const returnPct = ((currentPrice - shadow.shadowEntryPrice) / shadow.shadowEntryPrice) * 100;

    // ① 목표가 달성 → 익절 전량 매도
    if (currentPrice >= shadow.targetPrice) {
      Object.assign(shadow, { status: 'HIT_TARGET', exitPrice: currentPrice, exitTime: new Date().toISOString(), returnPct });
      appendShadowLog({ event: 'HIT_TARGET', ...shadow });
      console.log(`[AutoTrade] ✅ ${shadow.stockName} 목표가 달성 +${returnPct.toFixed(2)}% @${currentPrice.toLocaleString()}`);
      await placeKisSellOrder(shadow.stockCode, shadow.stockName, shadow.quantity, 'TAKE_PROFIT');
      continue;
    }

    // ② -30% 블랙리스트 편입 / -25% 전량 청산 (Final Exit)
    if (returnPct <= -25) {
      const isBlacklistStep = returnPct <= -30;
      Object.assign(shadow, { status: 'HIT_STOP', exitPrice: currentPrice, exitTime: new Date().toISOString(), returnPct });
      appendShadowLog({ event: isBlacklistStep ? 'CASCADE_STOP_BLACKLIST' : 'CASCADE_STOP_FINAL', ...shadow });
      console.log(`[AutoTrade] ❌ ${shadow.stockName} Cascade ${returnPct.toFixed(2)}% — 전량 청산${isBlacklistStep ? ' + 블랙리스트 180일' : ''}`);
      await placeKisSellOrder(shadow.stockCode, shadow.stockName, shadow.quantity, 'STOP_LOSS');
      if (isBlacklistStep) {
        addToBlacklist(shadow.stockCode, shadow.stockName, `Cascade ${returnPct.toFixed(1)}%`);
        await sendTelegramAlert(
          `🚫 <b>[블랙리스트] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
          `손실 ${returnPct.toFixed(1)}% → 180일 재진입 금지`
        ).catch(console.error);
      }
      continue;
    }

    // ③ -15% 반매도 (cascadeStep 2, 1회만)
    if (returnPct <= -15 && (shadow.cascadeStep ?? 0) < 2) {
      const halfQty = Math.max(1, Math.floor(shadow.quantity / 2));
      shadow.cascadeStep = 2;
      shadow.halfSoldAt  = new Date().toISOString();
      shadow.originalQuantity ??= shadow.quantity;
      shadow.quantity -= halfQty;
      appendShadowLog({ event: 'CASCADE_HALF_SELL', ...shadow, soldQty: halfQty, returnPct });
      console.log(`[AutoTrade] 🔶 ${shadow.stockName} Cascade -15% — 반매도 ${halfQty}주 (잔여 ${shadow.quantity}주)`);
      await placeKisSellOrder(shadow.stockCode, shadow.stockName, halfQty, 'STOP_LOSS');
      await sendTelegramAlert(
        `🔶 <b>[Cascade -15%] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
        `손실 ${returnPct.toFixed(1)}% — 반매도 ${halfQty}주 (잔여 ${shadow.quantity}주)`
      ).catch(console.error);
      continue;
    }

    // ④ -7% 추가 매수 차단 + 경고 (cascadeStep 1, 1회만)
    if (returnPct <= -7 && (shadow.cascadeStep ?? 0) < 1) {
      shadow.cascadeStep    = 1;
      shadow.addBuyBlocked  = true;
      appendShadowLog({ event: 'CASCADE_WARN', ...shadow, returnPct });
      console.warn(`[AutoTrade] ⚠️  ${shadow.stockName} Cascade -7% — 추가 매수 차단`);
      await sendTelegramAlert(
        `⚠️ <b>[Cascade -7%] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
        `손실 ${returnPct.toFixed(1)}% — 추가 매수 차단 (모니터링 강화)`
      ).catch(console.error);
      continue;
    }

    // ⑤ 손절선 터치 → 전량 청산
    if (currentPrice <= shadow.stopLoss) {
      Object.assign(shadow, { status: 'HIT_STOP', exitPrice: currentPrice, exitTime: new Date().toISOString(), returnPct });
      appendShadowLog({ event: 'HIT_STOP', ...shadow });
      console.log(`[AutoTrade] ❌ ${shadow.stockName} 손절 ${returnPct.toFixed(2)}% @${currentPrice.toLocaleString()}`);
      await placeKisSellOrder(shadow.stockCode, shadow.stockName, shadow.quantity, 'STOP_LOSS');
      continue;
    }

    // ⑥ 손절가 5% 이내 접근 경고 (1회만 발송)
    if (!shadow.stopApproachAlerted) {
      const distToStop = (currentPrice - shadow.stopLoss) / shadow.stopLoss * 100;
      if (distToStop > 0 && distToStop < 5) {
        shadow.stopApproachAlerted = true;
        await sendTelegramAlert(
          `🟡 <b>[손절 접근 경고] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
          `현재가: ${currentPrice.toLocaleString()}원\n` +
          `손절까지: -${distToStop.toFixed(1)}%\n` +
          `손절가: ${shadow.stopLoss.toLocaleString()}원`
        ).catch(console.error);
      }
    }

    // ⑦ 과열 탐지 — ACTIVE 상태에서만 첫 번째 부분 매도 발동
    if (shadow.status === 'ACTIVE') {
      const euphoria = checkEuphoria(shadow, currentPrice);
      if (euphoria.triggered) {
        const halfQty = Math.max(1, Math.floor(shadow.quantity / 2));
        console.log(
          `[AutoTrade] 🌡️ ${shadow.stockName} 과열 감지 (${euphoria.count}개 신호) — 절반 매도 ${halfQty}주\n  신호: ${euphoria.signals.join(', ')}`
        );
        shadow.originalQuantity ??= shadow.quantity;
        shadow.quantity -= halfQty;
        shadow.status = 'EUPHORIA_PARTIAL';
        appendShadowLog({
          event: 'EUPHORIA_PARTIAL',
          ...shadow,
          exitPrice: currentPrice,
          euphoriaSoldQty: halfQty,
          originalQuantity: shadow.originalQuantity,
        });
        await placeKisSellOrder(shadow.stockCode, shadow.stockName, halfQty, 'EUPHORIA');
      }
    }
  }
}

// ─── 아이디어 3: 일일 리포트 이메일 ────────────────────────────────────────────
export { generateDailyReport, generateWeeklyReport, sendWatchlistBriefing, sendIntradayCheckIn } from './alerts/reportGenerator.js';

// ─── 스크리너 ────────────────────────────────────────────────────────────────
export type { ScreenedStock, YahooQuoteExtended } from './screener/stockScreener.js';
export { getScreenerCache, preScreenStocks, autoPopulateWatchlist, STOCK_UNIVERSE } from './screener/stockScreener.js';

// ─── 아이디어 6: DART 공시 폴링 + 이메일 알림 ─────────────────────────────────


export type { DartAlert } from './persistence/dartRepo.js';
export { getDartAlerts } from './persistence/dartRepo.js';

// ─── 아이디어 12: Telegram Bot 알림 ────────────────────────────────────────────
export { sendTelegramAlert } from './alerts/telegramClient.js';

// ─── 아이디어 10: 추천 적중률 자기학습 루프
export type { RecommendationRecord, MonthlyStats } from './learning/recommendationTracker.js';
export { addRecommendation, getRecommendations, getMonthlyStats, isRealTradeReady, evaluateRecommendations } from './learning/recommendationTracker.js';

// ─── 아이디어 6: Signal Calibrator — 자기학습 피드백 루프
export { calibrateSignalWeights } from './learning/signalCalibrator.js';

// ─── Shadow Trades REST용 공개 조회 ────────────────────────────────────────────

export function getShadowTrades() { return loadShadowTrades(); }
export function getWatchlist()    { return loadWatchlist(); }

// ─── 아이디어 3: FillMonitor — 체결 확인 폴링 루프 ─────────────────────────────
export type { PendingOrder } from './trading/fillMonitor.js';
export { FillMonitor, fillMonitor } from './trading/fillMonitor.js';

// ─── 아이디어 11: DART 즉시 반응 + Bear/MHS/IPS 알림 폴러
export { fastDartCheck, pollDartDisclosures, classifyDisclosure, FAST_DART_KEYWORDS } from './alerts/dartPoller.js';
export { pollBearRegime, BEAR_ALERT_COOLDOWN_MS } from './alerts/bearRegimeAlert.js';
export type { BearAlertState } from './alerts/bearRegimeAlert.js';
export { pollMhsMorningAlert } from './alerts/mhsAlert.js';
export type { MhsMorningAlertState } from './alerts/mhsAlert.js';
export { pollIpsAlert, IPS_ALERT_COOLDOWN_MS } from './alerts/ipsAlert.js';
export type { IpsAlertState } from './alerts/ipsAlert.js';
// ─── 아이디어 8: TrancheExecutor — 분할 매수 자동화
export type { TrancheSchedule } from './trading/trancheExecutor.js';
export { TrancheExecutor, trancheExecutor } from './trading/trancheExecutor.js';

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
        // checkDailyLossLimit은 server.ts tick-wrapper에서 호출
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
