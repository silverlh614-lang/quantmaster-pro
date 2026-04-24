/**
 * @responsibility 16:40 KST 오늘 스캔 회고 — fill SSOT 기반 매수/실현 집계와 내일 후보 리포트
 *
 * 장마감 후 스캔 트레이스·샤도우 체결·워치리스트를 교차해
 * 구독자용 채널에 "왜 매수 안 됐는지"·"내일 후보는 뭔지"를 명시한 리포트를 발송한다.
 *
 * 배선:
 *   - 데이터: scanTracer(오늘 traces) + shadowTradeRepo + watchlistRepo
 *   - 발송: sendTelegramBroadcast (DM + 채널 = TELEGRAM_CHAT_ID)
 *   - 스케줄: 평일 16:40 KST (reportJobs.ts)
 */
import { loadTodayScanTraces, summarizeScanTraces, topFailureReasons, type ScanTraceSummary } from '../trading/scanTracer.js';
import { loadWatchlist, type WatchlistEntry } from '../persistence/watchlistRepo.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { sendTelegramBroadcast } from './telegramClient.js';
import { CHANNEL_SEPARATOR, channelHeader, kstMMDD } from './channelFormatter.js';
import { getRemainingQty, isOpenShadowStatus } from '../trading/signalScanner.js';
import {
  collectTodayRealizations,
  summarizeTodayRealizations,
  collectTodayBuyEvents,
  summarizeTodayBuyEvents,
} from './reportGenerator.js';

// ── 탈락 이유 라벨 매핑 ─────────────────────────────────────────────────────────
// scanTracer.stages.<stageKey> 에 저장된 FAIL(reason) 토큰을 사람이 읽을 수 있는 한국어로 번역.
const REASON_LABELS: Record<string, string> = {
  // 가격 스테이지
  'price:no_price':      '가격 조회 실패',
  'price:stale':         '가격 스테일',
  // RRR 스테이지
  'rrr:below_threshold': 'RRR 미달 (수익비 2.0 미만)',
  'rrr:negative':        'RRR 음수',
  // Gate 스테이지
  'gate:yahoo':          'Yahoo 데이터 불가',
  'gate:score_low':      'Gate 점수 미달',
  'gate:mtas_low':       'MTAS ≤ 3 (타임프레임 불일치)',
  'gate:cs_low':         'CS 0.6 미만',
  // Volume clock / 시간대
  'volume_clock:early':  'Volume Clock — 시간대 미도달',
  'volume_clock:late':   'Volume Clock — 시간대 초과',
  // 재검증
  'entryRevalidation:failed': 'entryRevalidation 재검증 탈락',
  // 기타
  'regime:blocked':      '레짐 차단',
  'cooldown:active':     '쿨다운 활성',
};

function labelReason(stage: string, reason: string): string {
  const key = `${stage}:${reason}`;
  return REASON_LABELS[key] ?? `${stage} (${reason})`;
}

// ── 내일 후보 추출 ────────────────────────────────────────────────────────────
/**
 * SWING + CATALYST 섹션에서 gateScore 상위 N개를 내일 진입 대기 후보로 제시.
 * MOMENTUM 은 관찰 전용이므로 제외.
 */
function pickTomorrowCandidates(watchlist: WatchlistEntry[], excludedCodes: Set<string>, n = 5): WatchlistEntry[] {
  return watchlist
    .filter(w => w.section === 'SWING' || w.section === 'CATALYST'
              || (!w.section && (w.track === 'B' || w.addedBy === 'MANUAL' || w.addedBy === 'DART')))
    .filter(w => !excludedCodes.has(w.code))
    .sort((a, b) => (b.gateScore ?? 0) - (a.gateScore ?? 0))
    .slice(0, n);
}

// ── 메시지 조립 ──────────────────────────────────────────────────────────────
export interface ScanReviewMessageInput {
  summary: ScanTraceSummary;
  tomorrowCandidates: WatchlistEntry[];
  /** PR-17: fill SSOT 기반 오늘 실현 통계 */
  realizationCount: number;
  winFills: number;
  lossFills: number;
  partialOnlyCount: number;
  fullClosedCount: number;
  weightedReturnPct: number;
  /** PR-17: fill SSOT 기반 오늘 매수 통계 */
  todayBuys: number;
  newEntries: number;
  tranches: number;
}

export function formatScanReviewMessage(input: ScanReviewMessageInput): string {
  const {
    summary, tomorrowCandidates,
    realizationCount, winFills, lossFills, partialOnlyCount, fullClosedCount, weightedReturnPct,
    todayBuys, newEntries, tranches,
  } = input;
  // PR-17: "매수 N개" 를 scanTrace 카운터가 아닌 실제 fill 기반 체결 수로 대체해
  // 어제 signaled → 오늘 tranche 체결 케이스도 정확히 반영.
  const totalFailures = Math.max(0, summary.totalCandidates - todayBuys);

  const header = channelHeader({
    icon: '📋',
    title: '오늘 스캔 결과',
    suffix: kstMMDD(),
  });

  const buyDetail = tranches > 0
    ? ` (신규 ${newEntries} · tranche ${tranches})`
    : '';
  const statLine = `스캔 ${summary.totalCandidates}개 → 매수 ${todayBuys}개${buyDetail} / 탈락 ${totalFailures}개`;
  const realizationLine = realizationCount > 0
    ? `실현 ${realizationCount}건 (익 ${winFills} / 손 ${lossFills})` +
      (partialOnlyCount > 0 ? ` · 부분매도 ${partialOnlyCount}건` : '') +
      (fullClosedCount > 0 ? ` · 전량 ${fullClosedCount}건` : '') +
      ` | P&L(가중) ${weightedReturnPct >= 0 ? '+' : ''}${weightedReturnPct.toFixed(2)}%`
    : '실현: 없음';

  // 탈락 상위 이유 (top 3)
  const topReasons = topFailureReasons(summary, 3);
  const reasonBlock = topReasons.length > 0
    ? '\n🔻 <b>탈락 상위 이유</b>:\n' +
      topReasons.map((r, i) => `  ${['①','②','③'][i] ?? '•'} ${labelReason(r.stage, r.reason)} (${r.count}개)`).join('\n')
    : '\n🔻 <b>탈락 상위 이유</b>: 기록 없음';

  // 내일 후보
  const candidateBlock = tomorrowCandidates.length > 0
    ? '\n\n💡 <b>내일 진입 대기 종목</b>:\n' +
      tomorrowCandidates.map(w => {
        const gate = w.gateScore !== undefined ? `Gate ${w.gateScore.toFixed(1)}` : 'Gate N/A';
        const sec = w.section ?? (w.track === 'B' ? 'SWING' : 'WATCH');
        const entry = `진입가 ${w.entryPrice.toLocaleString()}원`;
        return `  • <b>${w.name}</b>(${w.code}) — ${gate} · ${entry} [${sec}]`;
      }).join('\n')
    : '\n\n💡 <b>내일 진입 대기 종목</b>: (워치리스트 비어있음)';

  const footer = summary.lastScanTime
    ? `\n\n<i>마지막 스캔: ${summary.lastScanTime} KST</i>`
    : '';

  return [
    header,
    statLine,
    realizationLine,
    reasonBlock + candidateBlock + footer,
  ].join('\n');
}

// ── 메인 엔트리 ──────────────────────────────────────────────────────────────
/**
 * 오늘 스캔 회고 리포트 발송. 평일 16:40 KST cron에서 호출.
 * DM + 채널 동시 브로드캐스트.
 */
export async function sendScanReviewReport(): Promise<void> {
  try {
    const traces = loadTodayScanTraces();
    if (traces.length === 0) {
      console.log('[ScanReview] 오늘 트레이스 0건 — 발송 스킵');
      return;
    }

    const summary = summarizeScanTraces(traces);
    // KST 오늘 날짜 — fill timestamp 기준 비교에 사용.
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    const trades = loadShadowTrades();

    // PR-17: "내일 진입 제외" 는 ACTIVE 포지션 + 오늘 신규 진입 trade 기준.
    //   fill SSOT 기반 신규 진입 trade 는 collectTodayBuyEvents 에서 isInitial=true 로 확정.
    const todayBuyEvents = collectTodayBuyEvents(trades, today);
    const todaysNewTradeCodes = new Set(
      todayBuyEvents.filter((e) => e.isInitial).map((e) => e.trade.stockCode),
    );
    const excludedCodes = new Set<string>();
    for (const s of trades) {
      if (isOpenShadowStatus(s.status) && getRemainingQty(s) > 0) excludedCodes.add(s.stockCode);
    }
    for (const c of todaysNewTradeCodes) excludedCodes.add(c);

    const watchlist = loadWatchlist();
    const tomorrowCandidates = pickTomorrowCandidates(watchlist, excludedCodes, 5);

    // PR-17: fill SSOT 기반 오늘 실현 + 오늘 매수 통계.
    const realization = summarizeTodayRealizations(collectTodayRealizations(trades, today));
    const buyStats = summarizeTodayBuyEvents(todayBuyEvents);

    const message = formatScanReviewMessage({
      summary,
      tomorrowCandidates,
      realizationCount: realization.realizationCount,
      winFills: realization.wins,
      lossFills: realization.losses,
      partialOnlyCount: realization.partialOnlyCount,
      fullClosedCount: realization.fullClosedCount,
      weightedReturnPct: realization.weightedReturnPct,
      todayBuys: buyStats.totalBuys,
      newEntries: buyStats.newEntries,
      tranches: buyStats.tranches,
    });

    await sendTelegramBroadcast(message, {
      priority: 'NORMAL',
      tier: 'T2_REPORT',
      category: 'scan_review',
      dedupeKey: `scan_review:${today}`,
      disableChannelNotification: true,
    });

    console.log(`[ScanReview] 리포트 발송 완료 — 스캔 ${summary.totalCandidates}개, 후보 ${tomorrowCandidates.length}개`);
  } catch (e) {
    console.error('[ScanReview] 발송 실패:', e instanceof Error ? e.message : e);
  }
}
