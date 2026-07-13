// @responsibility /ghost_kis_diag — Ghost cron KIS 호출 실패 가설 4종 분리 진단 (read-only)
import {
  getCircuitBreakerStats,
  HAS_REAL_DATA_CLIENT,
  getRealDataTokenRemainingHours,
} from '../../../clients/kisClient.js';
import { getRateLimiterStats } from '../../../clients/kisRateLimiter.js';
import {
  getKisEndpointBlacklist,
  isEndpointBlacklisted,
} from '../../../persistence/kisEndpointBlacklistRepo.js';
import { getJobMetrics, getLastRunByJob } from '../../../scheduler/scheduleCatalog.js';
import { isMarketOpen, describeMarketPhase } from '../../../utils/marketClock.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

// SSOT — ghostPortfolioTracker.ts:79 + kisClient.ts:798 + learningJobs.ts:69
const GHOST_KIS_FUNCTION = 'fetchCurrentPrice';
const GHOST_KIS_TR_ID = 'FHKST01010100';
const GHOST_KIS_ENDPOINT = '/uapi/domestic-stock/v1/quotations/inquire-price';
const GHOST_CRON_KST = '15:40';
const GHOST_JOB_NAME = 'ghost_portfolio';

type Ternary = 'YES' | 'NO' | 'UNKNOWN';
type HypothesisKey = 'h1_egressGuard' | 'h2_blacklist' | 'h3_rateLimit' | 'h4_deprecated';

interface GhostKisDiagSnapshot {
  capturedAt: string;
  egress: { blocksGhostCron: Ternary; nowKst: string; isMarketOpenNow: boolean; note: string };
  circuit: {
    hardOpen: boolean; softOpen: boolean;
    hardFailures: number; softFailures: number;
    openForMs: number; lastBlockedBy?: 'HARD' | 'SOFT';
  };
  blacklist: {
    totalSize: number; isGhostEndpointBlacklisted: boolean;
    ghostEntry?: { blockedUntilIso: string; reason: string; recentFailureCount: number; firstSeenAtIso: string };
  };
  rateLimit: { perSecondLimit: number; availableTokens: number; queueLength: number; batchExceedsCapacity: Ternary };
  hypotheses: Record<HypothesisKey, Ternary>;
  cron: {
    runCount: number; successCount: number; failCount: number; skippedCount: number;
    lastErrorMessage?: string; lastStatus?: 'success' | 'failure' | 'skipped'; lastRunAtIso?: string;
  };
  topHypothesis: { name: string; confidence: 'STRONG' | 'WEAK' | 'NONE'; recommendation: string };
}

function fmtKstHm(date: Date): string {
  return new Date(date.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * H1 EgressGuard: HOST_RULES Yahoo only — KIS pass-through (영구 NO).
 * H2 Blacklist 24h 무한루프: blacklist entry 존재 시 YES.
 * H3 Rate Limit: 토큰 버킷 자연 직렬화 — 큐 적체 시만 YES.
 * H4 Deprecated 엔드포인트: SOFT 회로/softFailures 누적 시 YES (KIS 가 404).
 */
function collectGhostKisDiag(now: Date = new Date()): GhostKisDiagSnapshot {
  const cs = getCircuitBreakerStats().find((s) => s.trId === GHOST_KIS_TR_ID);
  const circuit = {
    hardOpen: !!cs && cs.lastBlockedBy === 'HARD' && cs.openFor > 0,
    softOpen: !!cs && cs.lastBlockedBy === 'SOFT' && cs.openFor > 0,
    hardFailures: cs?.hardFailures ?? 0,
    softFailures: cs?.softFailures ?? 0,
    openForMs: cs?.openFor ?? 0,
    lastBlockedBy: cs?.lastBlockedBy,
  };

  const ge = getKisEndpointBlacklist().find((e) => e.trId === GHOST_KIS_TR_ID);
  const blacklist = {
    totalSize: getKisEndpointBlacklist().length,
    isGhostEndpointBlacklisted: isEndpointBlacklisted(GHOST_KIS_TR_ID),
    ghostEntry: ge && {
      blockedUntilIso: new Date(ge.blockedUntil).toISOString(),
      reason: ge.reason,
      recentFailureCount: ge.recentFailureCount,
      firstSeenAtIso: new Date(ge.firstSeenAt).toISOString(),
    },
  };

  const rs = getRateLimiterStats();
  const rateLimit = {
    perSecondLimit: rs.maxTokens,
    availableTokens: rs.availableTokens,
    queueLength: rs.queueLength,
    batchExceedsCapacity: (rs.queueLength > 100 ? 'YES' : 'NO') as Ternary,
  };

  const hypotheses: Record<HypothesisKey, Ternary> = {
    h1_egressGuard: 'NO',
    h2_blacklist: blacklist.isGhostEndpointBlacklisted ? 'YES' : 'NO',
    h3_rateLimit: rateLimit.batchExceedsCapacity,
    h4_deprecated:
      circuit.softFailures >= 3 || circuit.lastBlockedBy === 'SOFT' ? 'YES' : 'NO',
  };

  const m = getJobMetrics(GHOST_JOB_NAME);
  const lr = getLastRunByJob(GHOST_JOB_NAME);
  const cron = {
    runCount: m?.runCount ?? 0,
    successCount: m?.successCount ?? 0,
    failCount: m?.failCount ?? 0,
    skippedCount: m?.skippedCount ?? 0,
    lastErrorMessage: m?.lastErrorMessage,
    lastStatus: lr?.status,
    lastRunAtIso: lr?.finishedAt,
  };

  // Top hypothesis 우선순위: H2 > H4 > H3 > cron 진단 > 미확정
  const topHypothesis: GhostKisDiagSnapshot['topHypothesis'] = pickTop(
    hypotheses,
    circuit.softFailures,
    rateLimit.queueLength,
    cron,
  );

  return {
    capturedAt: now.toISOString(),
    egress: {
      blocksGhostCron: 'NO',
      nowKst: fmtKstHm(now),
      isMarketOpenNow: isMarketOpen(now),
      note: 'EgressGuard host 화이트리스트 = Yahoo only (egressGuard.ts:43) — KIS pass-through',
    },
    circuit,
    blacklist,
    rateLimit,
    hypotheses,
    cron,
    topHypothesis,
  };
}

function pickTop(
  h: Record<HypothesisKey, Ternary>,
  softFailures: number,
  queueLength: number,
  cron: { runCount: number; successCount: number; failCount: number; lastErrorMessage?: string },
): GhostKisDiagSnapshot['topHypothesis'] {
  if (h.h2_blacklist === 'YES') return {
    name: 'H2: Blacklist 24h 무한루프', confidence: 'STRONG',
    recommendation: '`/reset_circuits` 로 회로+blacklist 동시 해제 후 재시도. 반복 시 KIS_DISABLE_404_BLACKLIST=true 임시 우회.',
  };
  if (h.h4_deprecated === 'YES') return {
    name: 'H4: KIS 엔드포인트 404 누적 (deprecated 또는 일시 장애)', confidence: 'STRONG',
    recommendation: `${GHOST_KIS_TR_ID} TR softFailures ${softFailures}회 — KIS 가이드 변경 또는 일시 장애. /circuits 상세 확인.`,
  };
  if (h.h3_rateLimit === 'YES') return {
    name: 'H3: Rate Limit 큐 적체', confidence: 'WEAK',
    recommendation: `현재 큐 ${queueLength}건 — 다른 cron 과 경합. ghost cron 시간 분산 검토.`,
  };
  if (cron.failCount > 0 && cron.successCount === 0) return {
    name: '4가설 모두 NO — cron 실행 실패만 누적', confidence: 'NONE',
    recommendation: `lastErrorMessage 직접 추적: ${cron.lastErrorMessage ?? '에러 메시지 부재'}. KIS 토큰 만료/네트워크/응답 파싱 가능성.`,
  };
  if (cron.runCount === 0) return {
    name: 'cron 실행 이력 0건', confidence: 'NONE',
    recommendation: '평일 15:40 KST 도달 전이거나 ScheduleClass 차단 — `/scheduler` 등록 확인.',
  };
  return {
    name: '4가설 모두 NO — 가설 미확정', confidence: 'NONE',
    recommendation: 'fetcher throw 다른 원인 (timeout/토큰/파싱). lastErrorMessage 점검.',
  };
}

function tokenLine(): string {
  if (!HAS_REAL_DATA_CLIENT) return '실계좌 클라이언트 미설정 — 모의계좌 폴백';
  const h = getRealDataTokenRemainingHours();
  return h > 0 ? `${h}시간 남음` : '만료 또는 미발급';
}

function formatGhostKisDiagMessage(snap: GhostKisDiagSnapshot): string {
  const phase = describeMarketPhase(new Date(snap.capturedAt));
  const c = snap.circuit;
  const cooldown = c.openForMs > 0 ? `${Math.floor(c.openForMs / 1000)}초` : '없음';
  const r = snap.rateLimit;
  const k = snap.cron;
  const h = snap.hypotheses;
  const be = snap.blacklist.ghostEntry;
  const lines: string[] = [
    '🔬 Ghost KIS Diagnostics',
    '━━━━━━━━━━━━━━━━',
    '',
    '📡 Ghost가 사용하는 KIS 엔드포인트:',
    `   함수: ${GHOST_KIS_FUNCTION} / TR: ${GHOST_KIS_TR_ID}`,
    `   엔드포인트: ${GHOST_KIS_ENDPOINT}`,
    `   cron 시각: KST ${GHOST_CRON_KST} (평일) / 토큰: ${tokenLine()}`,
    '',
    '🛡 EgressGuard:',
    `   현재: ${snap.egress.nowKst} KST [${phase}] / market-hour: ${snap.egress.isMarketOpenNow ? 'IN_MARKET' : 'OUT_OF_MARKET'}`,
    `   ghost cron 차단 여부: ${snap.egress.blocksGhostCron}`,
    `   ℹ️ ${snap.egress.note}`,
    '',
    '🚧 KIS Circuit Breaker:',
    `   hard: ${c.hardOpen ? 'OPEN' : 'CLOSED'} (5xx/403 ${c.hardFailures}) / soft: ${c.softOpen ? 'OPEN' : 'CLOSED'} (404 ${c.softFailures})`,
    `   cooldown: ${cooldown} / 마지막 차단: ${c.lastBlockedBy ?? 'N/A'}`,
    '',
    '📋 KIS Endpoint Blacklist (24h):',
    `   크기: ${snap.blacklist.totalSize}건 / ${GHOST_KIS_TR_ID} 등재: ${snap.blacklist.isGhostEndpointBlacklisted ? 'YES' : 'NO'}`,
  ];
  if (be) lines.push(
    `   진입: ${be.firstSeenAtIso} / 해제: ${be.blockedUntilIso}`,
    `   사유: ${be.reason} (${be.recentFailureCount}회)`,
  );
  lines.push(
    '',
    '⏱ KIS Rate Limit:',
    `   초당 ${r.perSecondLimit}건 / 가용 ${r.availableTokens} / 큐 ${r.queueLength} / 188건 batch 초과: ${r.batchExceedsCapacity}`,
    '',
    '🎯 가설 판정:',
    `   H1 EgressGuard: ${h.h1_egressGuard}  H2 Blacklist: ${h.h2_blacklist}  H3 RateLimit: ${h.h3_rateLimit}  H4 Deprecated: ${h.h4_deprecated}`,
    '',
    `📊 ghost_portfolio cron: ${k.runCount}회 (✅${k.successCount} / ❌${k.failCount} / ⏭️${k.skippedCount})`,
  );
  if (k.lastErrorMessage) lines.push(`   마지막 에러: ${k.lastErrorMessage.slice(0, 120)}`);
  lines.push(
    '',
    '━━━━━━━━━━━━━━━━',
    `🔍 Top 가설: ${snap.topHypothesis.name} [${snap.topHypothesis.confidence}]`,
    `→ ${snap.topHypothesis.recommendation}`,
    '',
    `<i>capturedAt: ${snap.capturedAt}</i>`,
  );
  return lines.join('\n');
}

const ghostKisDiag: TelegramCommand = {
  name: '/ghost_kis_diag',
  aliases: ['/gkd'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description:
    'Ghost cron KIS 호출 실패 가설 4종 분리 진단 — EgressGuard / Blacklist / Rate Limit / Deprecated 엔드포인트',
  usage: '/ghost_kis_diag (alias /gkd)',
  async execute({ reply }) {
    try {
      await reply(formatGhostKisDiagMessage(collectGhostKisDiag()));
    } catch (e) {
      console.error('[TelegramBot] /ghost_kis_diag 실패:', e);
      await reply('❌ Ghost KIS 진단 실패 — 일부 메트릭 미확인.');
    }
  },
};

commandRegistry.register(ghostKisDiag);
