// @responsibility weeklyDeepAnalysis 알림 모듈
/**
 * weeklyDeepAnalysis.ts — 주간 심층 분석 카드 (IDEA 10)
 *
 * 매주 수요일 15:00 KST, 현재 SWING 워치리스트에서 Gate 점수 상위 1종목을
 * 심층 카드 형식으로 픽 채널에 발송한다. 기술적·펀더멘털·매크로 근거를
 * 한 장에 모아 신규 구독자에게 "왜 이 종목인가"를 명시한다.
 *
 * 데이터 소스:
 *   - watchlistRepo — entryPrice/stopLoss/targetPrice/rrr/sector/profileType/gateScore
 *   - macroStateRepo — 현재 레짐·MHS·사이클 단계
 *   - fetchCurrentPrice — 현재가 (가능 시)
 *   - geminiClient.callGemini — 1문장 종합 코멘트 (선택)
 */
import { loadWatchlist, type WatchlistEntry } from '../persistence/watchlistRepo.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import { callGemini } from '../clients/geminiClient.js';
import { sendPickChannelAlert } from './telegramClient.js';
import { channelHeader, CHANNEL_SEPARATOR } from './channelFormatter.js';
import { getLiveRegime } from '../trading/regimeBridge.js';

// ── 후보 선정 ─────────────────────────────────────────────────────────────────

function pickTopCandidate(watchlist: WatchlistEntry[]): WatchlistEntry | null {
  const swings = watchlist
    .filter(w => w.section === 'SWING' || (!w.section && w.track === 'B'))
    .filter(w => w.gateScore !== undefined)
    .sort((a, b) => (b.gateScore ?? 0) - (a.gateScore ?? 0));
  return swings[0] ?? null;
}

// ── 거리 지표 ─────────────────────────────────────────────────────────────────

function computeDistances(entry: WatchlistEntry, currentPrice: number | null) {
  if (!currentPrice) return null;
  const toEntry = ((entry.entryPrice - currentPrice) / currentPrice) * 100;
  const toStop  = ((entry.stopLoss   - currentPrice) / currentPrice) * 100;
  const toTarget = ((entry.targetPrice - currentPrice) / currentPrice) * 100;
  return { toEntry, toStop, toTarget };
}

// ── Gemini 요약 (선택) ────────────────────────────────────────────────────────

async function getGeminiNarrative(entry: WatchlistEntry, regime: string): Promise<string | null> {
  const prompt =
    `한국 주식 ${entry.name}(${entry.code}) 에 대해 현재 시장 레짐 ${regime} 에서 ` +
    `진입 타당성을 1~2문장으로만 한국어로 요약하라. ` +
    `섹터: ${entry.sector ?? '미분류'}, Gate 점수: ${(entry.gateScore ?? 0).toFixed(1)}, ` +
    `RRR: ${entry.rrr?.toFixed(2) ?? 'N/A'}. 주의할 리스크 1개만 덧붙여라.`;
  const res = await callGemini(prompt, 'weekly-deep-analysis').catch(() => null);
  return res?.trim() || null;
}

// ── 메시지 조립 ──────────────────────────────────────────────────────────────

function formatCard(args: {
  entry: WatchlistEntry;
  regime: string;
  mhs: number | null;
  currentPrice: number | null;
  narrative: string | null;
}): string {
  const { entry, regime, mhs, currentPrice, narrative } = args;
  const distances = computeDistances(entry, currentPrice);

  const header = channelHeader({
    icon: '🔬',
    title: '주간 심층 분석',
    suffix: entry.name,
  });

  const scoreLine = `📊 Gate 종합: <b>${(entry.gateScore ?? 0).toFixed(1)}</b>점`;

  const fieldsBlock = [
    `섹터:      ${entry.sector ?? '미분류'}`,
    `프로파일:  ${entry.profileType ?? '미분류'}`,
    `진입가:    ${entry.entryPrice.toLocaleString()}원`,
    `손절:      ${entry.stopLoss.toLocaleString()}원`,
    `목표:      ${entry.targetPrice.toLocaleString()}원`,
    `RRR:       1:${entry.rrr?.toFixed(2) ?? 'N/A'}`,
  ].join('\n');

  const priceBlock = distances
    ? `\n\n<b>📍 현재 위치</b>\n` +
      `현재가 ${currentPrice!.toLocaleString()}원\n` +
      `→ 진입까지 ${distances.toEntry >= 0 ? '+' : ''}${distances.toEntry.toFixed(1)}% | ` +
      `손절까지 ${distances.toStop.toFixed(1)}% | ` +
      `목표까지 ${distances.toTarget >= 0 ? '+' : ''}${distances.toTarget.toFixed(1)}%`
    : '';

  const macroBlock =
    `\n\n<b>🗺️ 매크로 컨텍스트</b>\n` +
    `레짐: ${regime}` + (mhs !== null ? ` · MHS ${mhs}` : '');

  const entryMemoBlock = entry.memo
    ? `\n\n<b>📝 진입 근거</b>\n${entry.memo}`
    : '';

  const narrativeBlock = narrative ? `\n\n🤖 <b>AI 요약</b>\n${narrative}` : '';

  return [
    header,
    scoreLine,
    '',
    `<code>${fieldsBlock}</code>` + priceBlock + macroBlock + entryMemoBlock + narrativeBlock,
    CHANNEL_SEPARATOR,
  ].join('\n');
}

// ── 메인 엔트리 ──────────────────────────────────────────────────────────────

export async function sendWeeklyDeepAnalysis(): Promise<void> {
  try {
    const watchlist = loadWatchlist();
    const entry = pickTopCandidate(watchlist);
    if (!entry) {
      console.log('[WeeklyDeep] SWING 후보 없음 — 스킵');
      return;
    }

    const macro = loadMacroState();
    const regime = getLiveRegime(macro);
    const currentPriceRaw = await fetchCurrentPrice(entry.code).catch(() => null);
    const currentPrice = typeof currentPriceRaw === 'number' && currentPriceRaw > 0 ? currentPriceRaw : null;
    const narrative = await getGeminiNarrative(entry, regime);

    const message = formatCard({
      entry,
      regime,
      mhs: macro?.mhs ?? null,
      currentPrice,
      narrative,
    });

    await sendPickChannelAlert(message);
    console.log(`[WeeklyDeep] ${entry.name} 심층 카드 발송`);
  } catch (e) {
    console.error('[WeeklyDeep] 발송 실패:', e instanceof Error ? e.message : e);
  }
}
