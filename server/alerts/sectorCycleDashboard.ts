// @responsibility sectorCycleDashboard 알림 모듈
/**
 * sectorCycleDashboard.ts — 섹터 사이클 현황 대시보드 (IDEA 8)
 *
 * 평일 14:30 KST, 구독자에게 "지금 어느 섹터로 자금이 가고 있고, 각 섹터가 사이클
 * 어디에 있는지" 를 한 장으로 요약한다. 신규 계산 없이 기존 데이터 재사용:
 *
 *   1. sectorEtfMomentum 최신 리포트 → 미국 섹터 composite RS 랭킹 (한국 연결 맵)
 *   2. macroState.sectorCycleStage / leadingSectorRS → 전체 사이클 단계
 *   3. watchlist 그룹핑 → 각 섹터별 현재 후보수·평균 Gate
 *
 * 출력: DM+채널 브로드캐스트 1건.
 */
import { getLatestSectorEtfReport } from './sectorEtfMomentum.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { loadWatchlist, type WatchlistEntry } from '../persistence/watchlistRepo.js';
import { sendTelegramBroadcast } from './telegramClient.js';
import { channelHeader, CHANNEL_SEPARATOR } from './channelFormatter.js';

// ── 사이클 단계 라벨 ─────────────────────────────────────────────────────────
const STAGE_LABEL: Record<string, string> = {
  EARLY:   '🌱 EARLY',
  MID:     '📈 MID',
  LATE:    '⚠️ LATE',
  TURNING: '🔄 TURNING',
};

function stageLabel(stage?: string): string {
  return (stage && STAGE_LABEL[stage]) ?? '— 정보 없음';
}

// ── 섹터별 워치리스트 집계 ───────────────────────────────────────────────────
interface SectorWatchSummary {
  sector: string;
  count: number;
  avgGate: number;
}

function groupWatchlistBySector(watchlist: WatchlistEntry[]): SectorWatchSummary[] {
  const buckets = new Map<string, { sum: number; cnt: number }>();
  for (const w of watchlist) {
    if (!w.sector) continue;
    const b = buckets.get(w.sector) ?? { sum: 0, cnt: 0 };
    b.sum += w.gateScore ?? 0;
    b.cnt += 1;
    buckets.set(w.sector, b);
  }
  return Array.from(buckets.entries())
    .map(([sector, { sum, cnt }]) => ({ sector, count: cnt, avgGate: cnt > 0 ? sum / cnt : 0 }))
    .sort((a, b) => b.avgGate * b.count - a.avgGate * a.count);
}

// ── RS 진행 바 ───────────────────────────────────────────────────────────────
/** composite % → 10칸 블록 바. 0 기준, 최대 ±5% 범위를 10칸으로 매핑. */
function rsBar(compositePct: number): string {
  const clamped = Math.max(-5, Math.min(5, compositePct));
  const filled = Math.round(((clamped + 5) / 10) * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// ── 메시지 조립 ──────────────────────────────────────────────────────────────

export async function sendSectorCycleDashboard(): Promise<void> {
  try {
    const etfReport = getLatestSectorEtfReport();
    const macro = loadMacroState();
    const watchlist = loadWatchlist();

    if (!etfReport && !macro?.sectorCycleStage) {
      console.log('[SectorDashboard] 소스 데이터 없음 — 스킵');
      return;
    }

    const sortedEtf = etfReport
      ? [...etfReport.momentums]
          .filter(m => m.composite != null)
          .sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0))
      : [];

    const etfBlock = sortedEtf.length > 0
      ? sortedEtf.map(m => {
          const c = m.composite ?? 0;
          const sign = c >= 0 ? '+' : '';
          const stageRank = c >= 2 ? stageLabel('LATE') : c >= 0.5 ? stageLabel('MID') : c >= -1 ? stageLabel('EARLY') : '⛔ 약세';
          return `${m.koreaSectors.padEnd(16).slice(0, 16)} ${stageRank.padEnd(10)} ${rsBar(c)} ${sign}${c}%`;
        }).join('\n')
      : '(섹터 ETF 데이터 없음)';

    const watchSectors = groupWatchlistBySector(watchlist);
    const watchBlock = watchSectors.length > 0
      ? '\n\n<b>📋 국내 워치리스트 섹터 분포</b>\n' +
        watchSectors.slice(0, 6).map(s =>
          `  • ${s.sector} — ${s.count}개, 평균 Gate ${s.avgGate.toFixed(1)}`
        ).join('\n')
      : '';

    const strategyBlock = buildStrategyHints(macro?.sectorCycleStage, sortedEtf);

    const header = channelHeader({
      icon: '🗺️',
      title: '섹터 사이클 현황',
      suffix: '14:30 KST',
    });

    const macroLine = macro?.leadingSectorRS !== undefined
      ? `전체 사이클: ${stageLabel(macro.sectorCycleStage)} · 선행 섹터 RS ${macro.leadingSectorRS.toFixed(0)}`
      : `전체 사이클: ${stageLabel(macro?.sectorCycleStage)}`;

    const message = [
      header,
      macroLine,
      '',
      '<b>💠 美 섹터 ETF → 韓 섹터 선행 RS</b>',
      `<code>${etfBlock}</code>`,
      watchBlock,
      strategyBlock,
      CHANNEL_SEPARATOR,
    ].filter(Boolean).join('\n');

    await sendTelegramBroadcast(message, {
      priority: 'NORMAL',
      tier: 'T2_REPORT',
      category: 'sector_cycle_dashboard',
      dedupeKey: `sector_dashboard:${new Date().toISOString().slice(0, 10)}`,
      disableChannelNotification: true,
    });

    console.log('[SectorDashboard] 발송 완료');
  } catch (e) {
    console.error('[SectorDashboard] 발송 실패:', e instanceof Error ? e.message : e);
  }
}

type SectorMomentumEntry = { koreaSectors: string; composite: number | null };

function buildStrategyHints(
  stage: string | undefined,
  sortedEtf: SectorMomentumEntry[],
): string {
  const top = sortedEtf[0];
  const bottom = sortedEtf[sortedEtf.length - 1];
  const lines: string[] = [];

  if (top && typeof top.composite === 'number' && top.composite >= 0.5) {
    lines.push(`  진입 적합: ${top.koreaSectors} (composite +${top.composite}%)`);
  }
  if (stage === 'LATE') {
    lines.push(`  ⚠️ 전체 사이클 LATE — 신규 진입은 상위 RS 섹터로 제한`);
  } else if (stage === 'TURNING') {
    lines.push(`  🔄 전환 구간 — 방어·공격 비중 점검`);
  } else if (stage === 'EARLY') {
    lines.push(`  🌱 EARLY — 선행 섹터 편입 기회, 분할 진입 권장`);
  }
  if (bottom && typeof bottom.composite === 'number' && bottom.composite <= -0.8) {
    lines.push(`  회피: ${bottom.koreaSectors} (composite ${bottom.composite}%)`);
  }

  return lines.length > 0 ? `\n\n💡 <b>오늘의 전략</b>\n${lines.join('\n')}` : '';
}
