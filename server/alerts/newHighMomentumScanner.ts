// @responsibility newHighMomentumScanner 알림 모듈
/**
 * newHighMomentumScanner.ts — 52주 신고가 모멘텀 스캔 리포트 (IDEA 7)
 *
 * 평일 16:05 KST — 오늘 동적 유니버스에 "52W_HIGH" 으로 편입된 종목 중
 * Gate 점수 상위를 채널에 발굴 리포트로 발송한다.
 *
 * 배선:
 *   - dynamicUniverseExpander.loadDynamicUniverse() — source='52W_HIGH' 필터
 *   - watchlistRepo.loadWatchlist() — 이미 SWING 편입된 종목 gate 점수 크로스체크
 *   - fetchCurrentPrice() 로 현재가 조회 (존재 시)
 */
import { loadDynamicUniverse, type DynamicStock } from '../screener/dynamicUniverseExpander.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import { sendTelegramBroadcast } from './telegramClient.js';
import { channelHeader, CHANNEL_SEPARATOR } from './channelFormatter.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface HighCandidate {
  code: string;
  name: string;
  addedAt: string;
  daysSinceHigh: number;
  gateScore?: number;
  currentPrice?: number;
  onWatchlist: boolean;
}

// ── 후보 선정 ─────────────────────────────────────────────────────────────────

function selectTodayNewHighs(all: DynamicStock[]): DynamicStock[] {
  const todayKst = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  return all
    .filter(s => s.source === '52W_HIGH')
    .filter(s => {
      const kstAddedDate = new Date(new Date(s.addedAt).getTime() + 9 * 3_600_000)
        .toISOString().slice(0, 10);
      return kstAddedDate === todayKst;
    });
}

async function enrichCandidate(stock: DynamicStock, watchMap: Map<string, { gateScore?: number }>): Promise<HighCandidate> {
  const watch = watchMap.get(stock.code);
  const currentPriceRaw = await fetchCurrentPrice(stock.code).catch(() => null);
  const currentPrice = typeof currentPriceRaw === 'number' && currentPriceRaw > 0 ? currentPriceRaw : undefined;

  const addedMs = new Date(stock.addedAt).getTime();
  const daysSinceHigh = Math.max(0, Math.floor((Date.now() - addedMs) / 86_400_000));

  return {
    code: stock.code,
    name: stock.name,
    addedAt: stock.addedAt,
    daysSinceHigh,
    gateScore: watch?.gateScore,
    currentPrice,
    onWatchlist: !!watch,
  };
}

// ── 메시지 조립 ──────────────────────────────────────────────────────────────

/** Gate ≥ 8 필터 통과 후보를 상위 3개까지 노출. Gate 미집계 종목은 태그만 달아 병렬로 노출. */
function formatMessage(candidates: HighCandidate[]): string {
  const header = channelHeader({
    icon: '🚀',
    title: '52주 신고가 모멘텀 스캔',
    suffix: '16:05 KST',
  });

  if (candidates.length === 0) {
    return [
      header,
      '오늘 52주 신고가 돌파 종목 없음',
      CHANNEL_SEPARATOR,
    ].join('\n');
  }

  const qualified = candidates
    .filter(c => (c.gateScore ?? 0) >= 8)
    .sort((a, b) => (b.gateScore ?? 0) - (a.gateScore ?? 0))
    .slice(0, 3);

  const others = candidates
    .filter(c => !qualified.includes(c))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 5);

  const qBlock = qualified.length > 0
    ? '\n<b>🎯 Gate 8점 이상 고신뢰 후보</b>\n' +
      qualified.map((c, i) => {
        const idx = ['①','②','③'][i] ?? '•';
        const price = c.currentPrice ? ` | ${c.currentPrice.toLocaleString()}원` : '';
        const tag = c.onWatchlist ? ' · 워치리스트 편입' : ' · <b>신규</b>';
        return `  ${idx} <b>${c.name}</b>(${c.code}) Gate ${(c.gateScore ?? 0).toFixed(1)}${price}${tag}\n      신고가 갱신 D+${c.daysSinceHigh}`;
      }).join('\n')
    : '\n<b>🎯 Gate 8점 이상 고신뢰 후보</b>: 오늘 해당 없음';

  const othersBlock = others.length > 0
    ? '\n\n<b>📋 기타 신고가 편입 (Gate 미집계)</b>\n' +
      others.map(c => `  • ${c.name}(${c.code}) · D+${c.daysSinceHigh}`).join('\n')
    : '';

  const footer = `\n\n<i>→ 내일 워치리스트 등록 검토 대상</i>`;

  return [header, `오늘 52주 신고가 편입 ${candidates.length}개 감지`, qBlock + othersBlock + footer, CHANNEL_SEPARATOR].join('\n');
}

// ── 메인 엔트리 ──────────────────────────────────────────────────────────────

export async function sendNewHighMomentumScan(): Promise<void> {
  try {
    const all = loadDynamicUniverse();
    const todayNewHighs = selectTodayNewHighs(all);
    if (todayNewHighs.length === 0) {
      console.log('[NewHighScan] 오늘 52W_HIGH 편입 0건 — 스킵');
      return;
    }

    const watchlist = loadWatchlist();
    const watchMap = new Map<string, { gateScore?: number }>();
    for (const w of watchlist) watchMap.set(w.code, { gateScore: w.gateScore });

    const candidates: HighCandidate[] = [];
    for (const s of todayNewHighs) {
      candidates.push(await enrichCandidate(s, watchMap));
    }

    const message = formatMessage(candidates);
    const today = new Date().toISOString().slice(0, 10);

    await sendTelegramBroadcast(message, {
      priority: 'NORMAL',
      tier: 'T2_REPORT',
      category: 'new_high_scan',
      dedupeKey: `new_high_scan:${today}`,
      disableChannelNotification: true,
    });

    console.log(`[NewHighScan] 발송 완료 — ${candidates.length}개 후보`);
  } catch (e) {
    console.error('[NewHighScan] 발송 실패:', e instanceof Error ? e.message : e);
  }
}
