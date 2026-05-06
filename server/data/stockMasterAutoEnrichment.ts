// @responsibility stockMaster 자동 보완 + 정합성 검증 cron (ADR-0242 + ADR-0245)
/**
 * stockMasterAutoEnrichment.ts — KRX 마스터 자동 갱신 + 시장 분류 정합성 검증.
 *
 * 사용자 5/6 보고: 054300 (패션플랫폼) / 298060 (SCM라이프사이언스) 같은
 * KOSDAQ 종목이 stockUniverse 에 없거나 잘못된 시장으로 등록 → fetchYahoo 가
 * .KS / .KQ 매핑 결함 누적.
 *
 * 본 모듈 책임:
 *   1. ADR-0242: refreshMultiSourceMaster() 호출 — 4-tier KRX/Naver/Shadow/Seed 갱신
 *   2. 갱신 전후 master 비교 — *추가된 종목* + *시장 변경된 종목* 진단
 *   3. ADR-0245: KRX vs 기존 master 시장 분류 mismatch 자동 수정 (refresh 가 처리)
 *   4. watchlist coverage 검증 — watchlist 에 있고 fresh master 에 없는 종목 알림
 *   5. Telegram 알림 + summary 반환
 *
 * 절대 규칙:
 *   - master 직접 수정 0건 — refreshMultiSourceMaster 단일 통로 (PR #-stockMaster
 *     prior wiring 의 SSOT). 본 모듈은 *전후 비교 + 보고* 만.
 *   - ENV `STOCK_MASTER_AUTO_ENRICHMENT_DISABLED=true` 우회.
 *
 * cron: maintenanceJobs.ts 등록 (KST 06:00 = UTC 21:00 전날, ALWAYS_ON).
 */

import {
  getAllStockEntries,
  type StockMasterEntry,
} from '../persistence/krxStockMasterRepo.js';
import { refreshMultiSourceMaster } from '../services/multiSourceStockMaster.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

export interface MasterEnrichmentChange {
  code: string;
  name: string;
  oldMarket?: string;       // 갱신 전 시장 — undefined 면 신규 추가
  newMarket: string;
}

export interface MasterEnrichmentReport {
  ranAt: string;
  /** refreshMultiSourceMaster 결과 */
  refreshOk: boolean;
  refreshSource?: string;   // 'KRX_OPENAPI' / 'KRX_CSV' / 'NAVER' / 'SHADOW' / 'SEED'
  totalMasterAfter: number;
  /** 신규 추가된 종목 (KRX 에 있고 기존 master 에 없음) */
  added: MasterEnrichmentChange[];
  /** 시장 분류 변경 (KOSPI ↔ KOSDAQ ↔ KONEX) */
  marketChanged: MasterEnrichmentChange[];
  /** watchlist 에 있고 fresh master 에 없는 종목 (커버리지 누락) */
  watchlistMissing: Array<{ code: string; name: string }>;
  /** Telegram 알림 발송 여부 */
  telegramSent: boolean;
}

const TELEGRAM_PREVIEW_LIMIT = 5;

function isAutoEnrichmentDisabled(): boolean {
  return process.env.STOCK_MASTER_AUTO_ENRICHMENT_DISABLED === 'true';
}

function snapshotMasterByCode(): Map<string, StockMasterEntry> {
  const map = new Map<string, StockMasterEntry>();
  for (const entry of getAllStockEntries()) {
    map.set(entry.code, entry);
  }
  return map;
}

function diffMasters(
  before: Map<string, StockMasterEntry>,
  after: Map<string, StockMasterEntry>,
): { added: MasterEnrichmentChange[]; marketChanged: MasterEnrichmentChange[] } {
  const added: MasterEnrichmentChange[] = [];
  const marketChanged: MasterEnrichmentChange[] = [];
  for (const [code, newEntry] of after.entries()) {
    const oldEntry = before.get(code);
    if (!oldEntry) {
      added.push({ code, name: newEntry.name, newMarket: newEntry.market });
    } else if (oldEntry.market !== newEntry.market) {
      marketChanged.push({
        code,
        name: newEntry.name,
        oldMarket: oldEntry.market,
        newMarket: newEntry.market,
      });
    }
  }
  return { added, marketChanged };
}

function detectWatchlistMissing(
  master: Map<string, StockMasterEntry>,
): Array<{ code: string; name: string }> {
  const missing: Array<{ code: string; name: string }> = [];
  for (const w of loadWatchlist()) {
    if (!master.has(w.code)) {
      missing.push({ code: w.code, name: w.name });
    }
  }
  return missing;
}

function buildTelegramMessage(report: MasterEnrichmentReport): string | null {
  const parts: string[] = [];
  if (report.added.length > 0) {
    const preview = report.added
      .slice(0, TELEGRAM_PREVIEW_LIMIT)
      .map(c => `${c.code} ${c.name} (${c.newMarket})`)
      .join(', ');
    const more = report.added.length > TELEGRAM_PREVIEW_LIMIT
      ? ` 외 ${report.added.length - TELEGRAM_PREVIEW_LIMIT}건`
      : '';
    parts.push(`➕ 신규 ${report.added.length}건: ${preview}${more}`);
  }
  if (report.marketChanged.length > 0) {
    const preview = report.marketChanged
      .slice(0, TELEGRAM_PREVIEW_LIMIT)
      .map(c => `${c.code} ${c.oldMarket}→${c.newMarket}`)
      .join(', ');
    const more = report.marketChanged.length > TELEGRAM_PREVIEW_LIMIT
      ? ` 외 ${report.marketChanged.length - TELEGRAM_PREVIEW_LIMIT}건`
      : '';
    parts.push(`🔀 시장 변경 ${report.marketChanged.length}건: ${preview}${more}`);
  }
  if (report.watchlistMissing.length > 0) {
    const preview = report.watchlistMissing
      .slice(0, TELEGRAM_PREVIEW_LIMIT)
      .map(w => `${w.code} ${w.name}`)
      .join(', ');
    const more = report.watchlistMissing.length > TELEGRAM_PREVIEW_LIMIT
      ? ` 외 ${report.watchlistMissing.length - TELEGRAM_PREVIEW_LIMIT}건`
      : '';
    parts.push(`⚠️ 워치리스트 미커버 ${report.watchlistMissing.length}건: ${preview}${more}`);
  }

  if (parts.length === 0) return null;
  return [
    `📋 [stockMaster 자동 보완] (ADR-0242 + ADR-0245)`,
    `갱신 source: ${report.refreshSource ?? 'UNKNOWN'} | 총 ${report.totalMasterAfter}개`,
    ...parts,
  ].join('\n');
}

/**
 * stockMaster 자동 갱신 + 전후 비교 + watchlist 커버리지 진단.
 *
 * @returns 변경 요약 — Telegram 알림 발송 여부 포함.
 */
export async function autoEnrichAndVerifyStockMaster(): Promise<MasterEnrichmentReport> {
  const ranAt = new Date().toISOString();

  if (isAutoEnrichmentDisabled()) {
    return {
      ranAt,
      refreshOk: false,
      totalMasterAfter: getAllStockEntries().length,
      added: [],
      marketChanged: [],
      watchlistMissing: [],
      telegramSent: false,
    };
  }

  // 1. 갱신 전 snapshot
  const before = snapshotMasterByCode();

  // 2. refreshMultiSourceMaster — 4-tier 갱신 SSOT (ADR-0242)
  let refreshOk = false;
  let refreshSource: string | undefined;
  try {
    const result = await refreshMultiSourceMaster();
    refreshOk = result.finalSource !== 'NONE' && result.finalCount > 0;
    refreshSource = result.finalSource;
  } catch (e) {
    console.warn('[stockMasterAutoEnrichment] refresh 실패:', e);
  }

  // 3. 갱신 후 snapshot + diff (ADR-0245 mismatch 는 refresh 가 자동 처리)
  const after = snapshotMasterByCode();
  const { added, marketChanged } = diffMasters(before, after);

  // 4. watchlist 커버리지 진단
  const watchlistMissing = detectWatchlistMissing(after);

  const report: MasterEnrichmentReport = {
    ranAt,
    refreshOk,
    refreshSource,
    totalMasterAfter: after.size,
    added,
    marketChanged,
    watchlistMissing,
    telegramSent: false,
  };

  // 5. Telegram 알림 — 변경/누락 있을 때만
  const msg = buildTelegramMessage(report);
  if (msg) {
    try {
      await sendTelegramAlert(msg, {
        priority: 'NORMAL',
        category: 'analysis_meta',
        dedupeKey: `stock_master_enrichment:${ranAt.slice(0, 10)}`,
        cooldownMs: 24 * 60 * 60 * 1000,
      });
      report.telegramSent = true;
    } catch (e) {
      console.warn('[stockMasterAutoEnrichment] Telegram 알림 실패:', e);
    }
  }

  return report;
}
