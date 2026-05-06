// @responsibility 워치리스트 시장 분포 다양성 모니터 — 코스닥 부당 차단 진단 (ADR-0248)
/**
 * watchlistDiversityMonitor.ts — 페르소나 원칙 4 (직전 주도주보다 새 주도주 초기
 * 신호 우선) 시스템적 강제. 코스닥 비중이 한국 시장 평균 (50%) 보다 비정상적으로
 * 낮으면 시장 분류 결함 / 데이터 품질 격리 누적 의심 → 운영자 알림.
 *
 * 사용자 5/6 보고 시나리오: KOSDAQ 12종목 STALE_BASE 누적 → universe 격리 →
 * watchlist 코스닥 비중 ↓. 본 모듈은 그 결과를 *역방향* 으로 진단해 결함의
 * 시스템 영향 가시화.
 *
 * cron: maintenanceJobs.ts 등록 (KST 06:30 평일, ADR-0242 master enrichment 직후).
 * ENV `WATCHLIST_DIVERSITY_MONITOR_DISABLED=true` 우회.
 */

import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { getStockByCode } from '../persistence/krxStockMasterRepo.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

export interface WatchlistDiversityReport {
  ranAt: string;
  totalCount: number;
  swingCount: number;       // section='SWING' (매수 후보)
  distribution: Record<string, number>;  // 'KOSPI' | 'KOSDAQ' | 'KONEX' | 'OTHER' | 'UNKNOWN' (마스터 미등록)
  kosdaqRatio: number;       // SWING 중 KOSDAQ 비중 (0~1)
  kospiRatio: number;
  unknownRatio: number;      // 마스터 미등록 비중 (ADR-0242 보완 후보)
  alertLevel: 'OK' | 'LOW_KOSDAQ' | 'HIGH_UNKNOWN' | 'INSUFFICIENT_SAMPLE';
  alertReason?: string;
  telegramSent: boolean;
}

const KOSDAQ_LOW_THRESHOLD = 0.3;       // 한국 시장 평균 ~50%
const UNKNOWN_HIGH_THRESHOLD = 0.05;     // 마스터 미커버 5%+ → 알림
const MIN_SAMPLE_SIZE = 10;

function isMonitorDisabled(): boolean {
  return process.env.WATCHLIST_DIVERSITY_MONITOR_DISABLED === 'true';
}

function classifyMarket(code: string): string {
  const entry = getStockByCode(code);
  if (!entry) return 'UNKNOWN';
  return entry.market;
}

/** SWING (매수 후보) 종목의 시장 분포 계산. */
export function computeWatchlistDiversity(): WatchlistDiversityReport {
  const ranAt = new Date().toISOString();
  const watchlist = loadWatchlist();
  const swingList = watchlist.filter(w => w.section === 'SWING');

  const distribution: Record<string, number> = {};
  for (const w of swingList) {
    const market = classifyMarket(w.code);
    distribution[market] = (distribution[market] ?? 0) + 1;
  }

  const swingCount = swingList.length;
  const kospi = distribution.KOSPI ?? 0;
  const kosdaq = distribution.KOSDAQ ?? 0;
  const unknown = distribution.UNKNOWN ?? 0;

  const kospiRatio = swingCount > 0 ? kospi / swingCount : 0;
  const kosdaqRatio = swingCount > 0 ? kosdaq / swingCount : 0;
  const unknownRatio = swingCount > 0 ? unknown / swingCount : 0;

  // 알림 레벨 판정 — 우선순위 (UNKNOWN > LOW_KOSDAQ).
  let alertLevel: WatchlistDiversityReport['alertLevel'] = 'OK';
  let alertReason: string | undefined;
  if (swingCount < MIN_SAMPLE_SIZE) {
    alertLevel = 'INSUFFICIENT_SAMPLE';
    alertReason = `SWING 표본 ${swingCount}개 < ${MIN_SAMPLE_SIZE}개 — 통계 분기 보류`;
  } else if (unknownRatio >= UNKNOWN_HIGH_THRESHOLD) {
    alertLevel = 'HIGH_UNKNOWN';
    alertReason = `마스터 미등록 비중 ${(unknownRatio * 100).toFixed(0)}% — autoEnrichStockMaster (ADR-0242) 누락 의심`;
  } else if (kosdaqRatio < KOSDAQ_LOW_THRESHOLD) {
    alertLevel = 'LOW_KOSDAQ';
    alertReason = `코스닥 비중 ${(kosdaqRatio * 100).toFixed(0)}% < 평균 50% (한국 시장) — 시장 분류 결함 / 데이터 품질 격리 누적 의심 (ADR-0241/0252)`;
  }

  return {
    ranAt,
    totalCount: watchlist.length,
    swingCount,
    distribution,
    kosdaqRatio,
    kospiRatio,
    unknownRatio,
    alertLevel,
    alertReason,
    telegramSent: false,
  };
}

/**
 * cron 진입점 — diversity 계산 + 알림 발송.
 * INSUFFICIENT_SAMPLE / OK 는 silent (로그만), 그 외는 Telegram 알림.
 */
export async function runWatchlistDiversityMonitor(): Promise<WatchlistDiversityReport> {
  if (isMonitorDisabled()) {
    return {
      ranAt: new Date().toISOString(),
      totalCount: 0,
      swingCount: 0,
      distribution: {},
      kosdaqRatio: 0,
      kospiRatio: 0,
      unknownRatio: 0,
      alertLevel: 'OK',
      telegramSent: false,
    };
  }

  const report = computeWatchlistDiversity();

  if (report.alertLevel === 'LOW_KOSDAQ' || report.alertLevel === 'HIGH_UNKNOWN') {
    const distLine = Object.entries(report.distribution)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}: ${v}건`)
      .join(' | ');
    const msg = [
      `⚠️ <b>[WatchlistDiversity]</b> ${report.alertLevel}`,
      `SWING ${report.swingCount}건 분포 — ${distLine}`,
      `KOSPI ${(report.kospiRatio * 100).toFixed(0)}% / KOSDAQ ${(report.kosdaqRatio * 100).toFixed(0)}% / UNKNOWN ${(report.unknownRatio * 100).toFixed(0)}%`,
      report.alertReason ?? '',
    ].filter(Boolean).join('\n');
    try {
      await sendTelegramAlert(msg, {
        priority: 'NORMAL',
        category: 'analysis_meta',
        dedupeKey: `watchlist_diversity:${report.alertLevel}:${report.ranAt.slice(0, 10)}`,
        cooldownMs: 24 * 60 * 60 * 1000,
      });
      report.telegramSent = true;
    } catch (e) {
      console.warn('[watchlistDiversityMonitor] Telegram 알림 실패:', e);
    }
  } else {
    console.log(
      `[WatchlistDiversity] ${report.alertLevel} — SWING ${report.swingCount}건 ` +
      `(KOSPI ${(report.kospiRatio * 100).toFixed(0)}% / KOSDAQ ${(report.kosdaqRatio * 100).toFixed(0)}%)`,
    );
  }

  return report;
}
