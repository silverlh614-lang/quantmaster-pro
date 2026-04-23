/**
 * stockPickReporter.ts — 일일 종목 픽 리포트 (16:30 KST)
 *
 * 세 섹션으로 구성된 당일 종목 픽을 TELEGRAM_PICK_CHANNEL_ID로 발송.
 *
 * 섹션 구성:
 *   1. 지금 살 종목 (최대 3개) — Track B, 현재가 ≤ 진입가 × 1.02, Gate ≥ 7, 거래량 ≥ 1.3×
 *   2. 미리 살 종목 (최대 5개) — 전체 워치리스트, PreBreakout 징후 3개 이상
 *   3. 숨은 종목 (화·목요일만, 최대 3개) — 저거래량 + 외국인·기관 동시 순매수
 *
 * 레짐 게이트:
 *   R6_DEFENSE  → 관망 권고 메시지만 발송, 섹션 없음
 *   R5_CAUTION   → 섹션 1 스킵
 *   R1~R4     → 전체 발송
 */

import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { getLiveRegime } from '../trading/regimeBridge.js';
import { fetchYahooQuote } from '../screener/stockScreener.js';
import {
  detectPreBreakoutAccumulation,
  type PreBreakoutInput,
} from '../trading/preBreakoutAccumulationDetector.js';
import { fetchKisInvestorFlow } from '../clients/kisClient.js';
import { getScreenerCache } from '../screener/stockScreener.js';
import { sendPickChannelAlert } from './telegramClient.js';
import { dispatchAlert } from './alertRouter.js';
import { AlertCategory } from './alertCategories.js';

// ─── KST 현재 요일 (0=일, 1=월, ... 6=토) ───────────────────────────────────
function getKstDayOfWeek(): number {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCDay();
}

// ─── KST 날짜 문자열 ──────────────────────────────────────────────────────────
function getKstDateStr(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const mm = (kst.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = kst.getUTCDate().toString().padStart(2, '0');
  return `${mm}/${dd}`;
}

/**
 * 일일 종목 픽 리포트 생성 및 발송.
 * scheduler.ts에서 평일 16:30 KST (UTC 07:30)에 호출.
 */
export async function generateDailyPickReport(): Promise<void> {
  const macroState = loadMacroState();
  const regime     = getLiveRegime(macroState);
  const dateStr    = getKstDateStr();

  console.log(`[PickReport] 시작 — ${dateStr}, 레짐: ${regime}`);

  // ── R6: 관망 권고만 발송 ────────────────────────────────────────────────────
  if (regime === 'R6_DEFENSE') {
    const r6Msg =
      `⚠️ <b>[${dateStr} 종목 픽] 관망 권고</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `현재 레짐: <b>${regime}</b> (시장 붕괴 국면)\n\n` +
      `오늘은 신규 매수를 자제하고 현금 비중을 높여 관망하는 것을 권고합니다.\n` +
      `━━━━━━━━━━━━━━━━━━━━`;
    await sendPickChannelAlert(r6Msg);
    // 분석 채널로도 미러링 — 운영자가 picks 수신을 끄더라도 분석 흐름엔 남김.
    await dispatchAlert(AlertCategory.ANALYSIS, r6Msg, { disableNotification: true })
      .catch(e => console.error('[PickReport] ANALYSIS 미러링 실패:', e));
    return;
  }

  const watchlist  = loadWatchlist();
  const dayOfWeek  = getKstDayOfWeek(); // 2=화, 4=목
  const isTueThu   = dayOfWeek === 2 || dayOfWeek === 4;

  // ── 섹션 1: 지금 살 종목 (R5에서는 스킵) ────────────────────────────────────
  let section1 = '';
  if (regime !== 'R5_CAUTION') {
    const buyNowCandidates: Array<{
      name: string;
      code: string;
      price: number;
      entryPrice: number;
      gateScore: number;
      volumeRatio: number;
      rrr?: number;
    }> = [];

    const trackBEntries = watchlist.filter(e => e.section === 'SWING' || e.section === 'CATALYST' || (!e.section && e.track === 'B'));

    for (const entry of trackBEntries) {
      try {
        const quote = await fetchYahooQuote(`${entry.code}.KS`);
        if (!quote) continue;
        // 거래정지/관리종목/zero-volume 위험 종목은 픽에서 제외 (사용자 피해 방지)
        if (quote.isHighRisk) {
          console.log(`[PickReport] ⏭️ 위험 종목 제외(지금 살): ${entry.name}(${entry.code})`);
          continue;
        }

        const price       = quote.price;
        const gateScore   = entry.gateScore ?? 0;
        const volumeRatio = quote.vol20dAvg > 0 ? quote.volume / quote.vol20dAvg : 0;

        if (
          price <= entry.entryPrice * 1.02 &&
          gateScore >= 7 &&
          volumeRatio >= 1.3
        ) {
          buyNowCandidates.push({
            name: entry.name,
            code: entry.code,
            price,
            entryPrice: entry.entryPrice,
            gateScore,
            volumeRatio,
            rrr: entry.rrr,
          });
        }
      } catch (e) {
        console.warn(`[PickReport] 지금 살 Yahoo 조회 실패: ${entry.code}`, e);
      }
    }

    // Gate 점수 내림차순 정렬, 상위 3개
    const top3 = buyNowCandidates
      .sort((a, b) => b.gateScore - a.gateScore)
      .slice(0, 3);

    if (top3.length > 0) {
      const lines = top3.map((s, i) =>
        `${i + 1}. <b>${s.name}</b> (${s.code})\n` +
        `   현재가: ${s.price.toLocaleString()}원 | 진입가: ${s.entryPrice.toLocaleString()}원\n` +
        `   Gate: ${s.gateScore} | 거래량: ${s.volumeRatio.toFixed(1)}× | RRR: ${s.rrr?.toFixed(1) ?? 'N/A'}`,
      ).join('\n');

      section1 =
        `🟢 <b>지금 살 종목 (${top3.length}개)</b>\n` +
        `진입가 근접 + Gate ≥ 7 + 거래량 1.3×\n` +
        `${lines}`;
    } else {
      section1 = `🟢 <b>지금 살 종목</b>\n조건 충족 종목 없음`;
    }
  } else {
    section1 = `🟡 <b>지금 살 종목</b>\n${regime} 레짐 — 신규 진입 자제`;
  }

  // ── 섹션 2: 미리 살 종목 ──────────────────────────────────────────────────
  const preBuyCandidates: Array<{
    name: string;
    code: string;
    price: number;
    entryPrice: number;
    detectedSigns: number;
    signSummary: string;
  }> = [];

  // 아직 진입하지 않은 항목만 (현재가 ≤ 진입가 × 1.05)
  const notYetTriggered = watchlist.filter(e => !e.isFocus);

  for (const entry of notYetTriggered) {
    try {
      const quote = await fetchYahooQuote(`${entry.code}.KS`);
      if (!quote) continue;
      if (quote.isHighRisk) {
        console.log(`[PickReport] ⏭️ 위험 종목 제외(미리 살): ${entry.name}(${entry.code})`);
        continue;
      }
      if (quote.price > entry.entryPrice * 1.05) continue; // 이미 돌파

      const pbInput: PreBreakoutInput = {
        recentCloses:         quote.recentCloses10d ?? [],
        recentVolumes:        quote.recentVolumes10d ?? [],
        avgVolume20d:         quote.vol20dAvg,
        recentHighs:          quote.recentHighs10d ?? [],
        recentLows:           quote.recentLows10d ?? [],
        atrRatio:             quote.price > 0 ? quote.atr / quote.price : 0,
        foreignNetBuy5d:      0, // Yahoo에서 미지원 — 징후5는 KIS 미확인 시 0
        institutionalNetBuy5d: 0,
      };

      const result = detectPreBreakoutAccumulation(pbInput);
      if (result.detectedSigns >= 3) {
        preBuyCandidates.push({
          name: entry.name,
          code: entry.code,
          price: quote.price,
          entryPrice: entry.entryPrice,
          detectedSigns: result.detectedSigns,
          signSummary: result.summary,
        });
      }
    } catch (e) {
      console.warn(`[PickReport] 미리 살 Yahoo 조회 실패: ${entry.code}`, e);
    }
  }

  // 징후 수 내림차순 정렬, 상위 5개
  const top5pb = preBuyCandidates
    .sort((a, b) => b.detectedSigns - a.detectedSigns)
    .slice(0, 5);

  let section2 = '';
  if (top5pb.length > 0) {
    const lines = top5pb.map((s, i) =>
      `${i + 1}. <b>${s.name}</b> (${s.code})\n` +
      `   현재가: ${s.price.toLocaleString()}원 | 진입가: ${s.entryPrice.toLocaleString()}원\n` +
      `   매집 징후: ${s.detectedSigns}/5개 — ${s.signSummary}`,
    ).join('\n');

    section2 =
      `🔵 <b>미리 살 종목 (${top5pb.length}개)</b>\n` +
      `매집 징후 3개 이상 포착\n` +
      `${lines}`;
  } else {
    section2 = `🔵 <b>미리 살 종목</b>\n매집 징후 3개 이상 종목 없음`;
  }

  // ── 섹션 3: 숨은 종목 (화·목요일만) ─────────────────────────────────────────
  let section3 = '';
  if (isTueThu) {
    const allScreened = getScreenerCache();
    if (allScreened.length > 0) {
      // 거래량 오름차순 정렬 → 하위 30% 추출
      const sortedByVol = [...allScreened].sort((a, b) => a.volume - b.volume);
      const bottomCount = Math.ceil(sortedByVol.length * 0.3);
      const lowVolStocks = sortedByVol.slice(0, bottomCount);

      const hiddenCandidates: Array<{
        name: string;
        code: string;
        price: number;
        foreignNetBuy: number;
        institutionalNetBuy: number;
      }> = [];

      for (const s of lowVolStocks) {
        try {
          const flow = await fetchKisInvestorFlow(s.code);
          if (!flow) continue;
          if (flow.foreignNetBuy > 0 && flow.institutionalNetBuy > 0) {
            hiddenCandidates.push({
              name: s.name,
              code: s.code,
              price: s.currentPrice,
              foreignNetBuy: flow.foreignNetBuy,
              institutionalNetBuy: flow.institutionalNetBuy,
            });
          }
        } catch (e) {
          console.warn(`[PickReport] 숨은 종목 KIS 조회 실패: ${s.code}`, e);
        }
      }

      const top3hidden = hiddenCandidates
        .sort((a, b) => (b.foreignNetBuy + b.institutionalNetBuy) - (a.foreignNetBuy + a.institutionalNetBuy))
        .slice(0, 3);

      if (top3hidden.length > 0) {
        const lines = top3hidden.map((s, i) =>
          `${i + 1}. <b>${s.name}</b> (${s.code})\n` +
          `   현재가: ${s.price.toLocaleString()}원\n` +
          `   외국인 순매수: +${s.foreignNetBuy.toLocaleString()}주 | 기관: +${s.institutionalNetBuy.toLocaleString()}주`,
        ).join('\n');

        section3 =
          `🟣 <b>숨은 종목 (${top3hidden.length}개)</b>\n` +
          `저거래량 + 외국인·기관 동시 순매수\n` +
          `${lines}`;
      } else {
        section3 = `🟣 <b>숨은 종목</b>\n조건 충족 종목 없음 (KIS 수급 미설정 시 비어있을 수 있음)`;
      }
    } else {
      section3 = `🟣 <b>숨은 종목</b>\n스크리너 캐시 없음`;
    }
  }

  // ── 최종 메시지 조립 ─────────────────────────────────────────────────────────
  const regimeLabel = regime.replace('_', ' ');
  const sections = [section1, section2];
  if (isTueThu && section3) sections.push(section3);

  const message =
    `📊 <b>[${dateStr} 일일 종목 픽] 16:30 KST</b>\n` +
    `레짐: ${regimeLabel} | 워치리스트: ${watchlist.length}개\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    sections.join('\n━━━━━━━━━━━━━━━━━━━━\n') +
    `\n━━━━━━━━━━━━━━━━━━━━\n` +
    `<i>* 투자 참고용 — 최종 판단은 본인 책임</i>`;

  await sendPickChannelAlert(message);
  // ANALYSIS 채널로도 발송 — AI/스크리너가 도출한 추천 내용은 분석 채널의 핵심 흐름.
  // disableNotification 으로 알림은 PICK 채널만 보내고 ANALYSIS 는 조용히 누적.
  await dispatchAlert(AlertCategory.ANALYSIS, message, { disableNotification: true })
    .catch(e => console.error('[PickReport] ANALYSIS 미러링 실패:', e));
  console.log(`[PickReport] 발송 완료 — 지금살:${regime !== 'R5_CAUTION' ? (section1.includes('없음') ? 0 : section1.split('\n').filter(l => l.match(/^\d+\./)).length) : 'skip'} 미리살:${top5pb.length} 숨은:${isTueThu ? '조회됨' : '스킵(월수금)'}`);
}
