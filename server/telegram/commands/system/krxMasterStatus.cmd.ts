// @responsibility: /krx_master_status — KRX stock master 상태 진단 + Tier 추정 + 워치리스트 미등록 식별 (read-only, ADR-0013).
//
// master size 로 Tier (1≥2500 / 2≥2000 / 3≥500 / 4~100 SEED) 추정 + 워치리스트 미등록 카운트
// (/yahoo_health FETCH_FAIL 교차 검증) + per-source health score. 강제 갱신 0건.

import fs from 'fs';
import {
  getMasterSize,
  getAllStockEntries,
  getStockByCode,
  isMasterStale,
  type StockMasterEntry,
} from '../../../persistence/krxStockMasterRepo.js';
import { getHealthSnapshot, computeOverallHealth } from '../../../persistence/stockMasterHealthRepo.js';
import { loadWatchlist } from '../../../persistence/watchlistRepo.js';
import { KRX_STOCK_MASTER_FILE } from '../../../persistence/paths.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

interface TierEstimate {
  tier: 1 | 2 | 3 | 4 | null;
  label: string;
  warn: boolean;
}

/** master size 로 Tier 추정 SSOT. 예상 임계: KRX≥2500 / NAVER≥2000 / SHADOW≥500 / SEED~100. */
export function estimateTier(size: number): TierEstimate {
  if (size === 0) return { tier: null, label: '미수집 (디스크 파일 부재)', warn: true };
  if (size >= 2500) return { tier: 1, label: 'Tier 1 (KRX Open API) — 정상', warn: false };
  if (size >= 2000) return { tier: 2, label: 'Tier 2 (Naver Finance) — fallback', warn: false };
  if (size >= 500) return { tier: 3, label: 'Tier 3 (Shadow DB) — degraded', warn: true };
  return { tier: 4, label: 'Tier 4 (Static Seed ~100) — ⚠️ 결함 의심', warn: true };
}

/** market 별 카운트 분류 SSOT. */
export function countByMarket(entries: StockMasterEntry[]): {
  KOSPI: number;
  KOSDAQ: number;
  KONEX: number;
  OTHER: number;
  total: number;
} {
  const acc = { KOSPI: 0, KOSDAQ: 0, KONEX: 0, OTHER: 0, total: entries.length };
  for (const e of entries) acc[e.market]++;
  return acc;
}

/** 디스크 파일 mtime 추출 — 부재 시 null. */
function getDiskMtimeMs(): number | null {
  try {
    if (!fs.existsSync(KRX_STOCK_MASTER_FILE)) return null;
    return fs.statSync(KRX_STOCK_MASTER_FILE).mtimeMs;
  } catch {
    return null;
  }
}

/** ms → KST ISO 'YYYY-MM-DD HH:mm KST' + 경과 시간 라벨. */
function formatKstAge(ms: number | null, now: number = Date.now()): string {
  if (ms === null) return 'N/A (파일 부재)';
  const ageH = (now - ms) / (60 * 60 * 1000);
  const ageDays = ageH / 24;
  const kst = new Date(ms + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 16);
  let stale = '';
  if (ageDays >= 5) stale = ' ⚠️ STALE 5일+';
  else if (ageDays >= 2) stale = ' 🟡 2일+';
  return `${kst} KST (${ageH.toFixed(1)}h 전)${stale}`;
}

/** 워치리스트 코드 중 master 미등록 종목 식별. */
export function findWatchlistMissingFromMaster(
  watchlistCodes: Array<{ code: string; name: string }>,
): { registered: number; missing: Array<{ code: string; name: string }> } {
  const missing: Array<{ code: string; name: string }> = [];
  let registered = 0;
  for (const w of watchlistCodes) {
    const entry = getStockByCode(w.code);
    if (entry) registered++;
    else missing.push({ code: w.code, name: w.name });
  }
  return { registered, missing };
}

/** 진단 메시지 포맷터 SSOT — 단위 테스트 가능. */
export function formatKrxMasterStatusMessage(input: {
  size: number;
  market: ReturnType<typeof countByMarket>;
  tier: TierEstimate;
  fetchedAtMs: number | null;
  isStale: boolean;
  watchlistTotal: number;
  watchlistRegistered: number;
  watchlistMissing: Array<{ code: string; name: string }>;
  health: ReturnType<typeof getHealthSnapshot>;
  overallScore: number;
  now?: number;
}): string {
  const lines: string[] = [];
  lines.push('📊 <b>KRX Stock Master Status</b>');
  lines.push('');
  lines.push(`🗓️ 마지막 업데이트: ${formatKstAge(input.fetchedAtMs, input.now)}`);
  if (input.isStale) lines.push('   ⚠️ TTL 만료 (24h+) — 부팅 또는 다음 cron 사이클에서 갱신 시도');
  lines.push('');
  lines.push('📈 등록 종목 수:');
  lines.push(`   KOSPI:  ${input.market.KOSPI}`);
  lines.push(`   KOSDAQ: ${input.market.KOSDAQ}`);
  if (input.market.KONEX > 0) lines.push(`   KONEX:  ${input.market.KONEX}`);
  if (input.market.OTHER > 0) lines.push(`   OTHER:  ${input.market.OTHER}`);
  lines.push(`   TOTAL:  ${input.market.total}`);
  lines.push('');
  lines.push('🚦 Tier 추정:');
  lines.push(`   ${input.tier.label}`);
  lines.push('   (Tier 1 ≥2500 / Tier 2 ≥2000 / Tier 3 ≥500 / Tier 4 ~100)');
  lines.push('');
  lines.push('🔍 워치리스트 종목 master 검증:');
  lines.push(`   등록: ${input.watchlistRegistered}/${input.watchlistTotal}`);
  if (input.watchlistMissing.length > 0) {
    lines.push(`   미등록: ${input.watchlistMissing.length}건`);
    const shown = input.watchlistMissing.slice(0, 10);
    for (const m of shown) lines.push(`     - ${m.code} ${m.name}`);
    if (input.watchlistMissing.length > shown.length) {
      lines.push(`     ... 외 ${input.watchlistMissing.length - shown.length}건`);
    }
  } else {
    lines.push('   미등록: 0건 ✅');
  }
  lines.push('');
  lines.push(`🎯 Source Health Score (0~100, 종합 ${input.overallScore}):`);
  for (const h of input.health) {
    const cf = h.state.consecutiveFailures;
    const lastSucc = h.state.lastSuccessAt
      ? new Date(h.state.lastSuccessAt + 9 * 60 * 60 * 1000).toISOString().slice(5, 16).replace('T', ' ')
      : '없음';
    const cfTag = cf >= 3 ? ` (연속실패 ${cf}회 ⚠️)` : cf > 0 ? ` (연속실패 ${cf}회)` : '';
    lines.push(`   ${h.source}: ${h.score} — 최근성공 ${lastSucc}${cfTag}`);
  }
  lines.push('');
  lines.push('🎯 권장 조치:');
  if (input.size === 0) {
    lines.push('   ❌ 디스크 파일 부재 — 재배포 또는 부팅 cron 점검');
  } else if (input.tier.tier === 4) {
    lines.push('   ⚠️ Tier 4 fallback — KRX/Naver/Shadow 모두 실패 의심, 강제 갱신 검토');
  } else if (input.watchlistMissing.length >= 3) {
    lines.push('   ⚠️ 워치리스트 다수 미등록 — 신규/코드변경/부분 fallback 가능, 강제 갱신 권장');
  } else if (input.isStale) {
    lines.push('   🟡 master TTL 만료 — 다음 cron 사이클에서 자동 갱신');
  } else {
    lines.push('   ✅ master 정상 — 다른 진원지 (Yahoo / Sanity / Gate) 점검');
  }

  return lines.join('\n');
}

const krxMasterStatus: TelegramCommand = {
  name: '/krx_master_status',
  aliases: ['/kms'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'KRX stock master 상태 진단 — Tier 추정 + 워치리스트 미등록 + per-source health (read-only)',
  usage: '/krx_master_status (alias /kms)',
  async execute({ reply }) {
    const entries = getAllStockEntries();
    const size = getMasterSize();
    const market = countByMarket(entries);
    const tier = estimateTier(size);

    const fetchedAtMs = getDiskMtimeMs();
    const isStale = isMasterStale();

    const watchlist = loadWatchlist();
    const watchlistCodes = watchlist.map((w) => ({ code: w.code, name: w.name }));
    const { registered, missing } = findWatchlistMissingFromMaster(watchlistCodes);

    const health = getHealthSnapshot();
    const overallScore = computeOverallHealth();

    const message = formatKrxMasterStatusMessage({
      size,
      market,
      tier,
      fetchedAtMs,
      isStale,
      watchlistTotal: watchlist.length,
      watchlistRegistered: registered,
      watchlistMissing: missing,
      health,
      overallScore,
    });

    await reply(message);
  },
};

commandRegistry.register(krxMasterStatus);

export default krxMasterStatus;
