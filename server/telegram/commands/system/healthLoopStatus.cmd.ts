// @responsibility healthLoopStatus.cmd — /hls 3티어 헬스루프 + 인증키 + 휴장후 점검 통합 진단 (ADR-0131)

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { loadHealthLoopState } from '../../../scheduler/healthLoop.js';
import {
  loadCredentialExpiryState,
  KNOWN_CREDENTIALS,
  evaluateCredential,
  type CredentialEvaluation,
} from '../../../health/credentialExpiryWatchdog.js';
import { loadPostHolidayState } from '../../../scheduler/postHolidayKickstart.js';
import { collectHealthSnapshot, type HealthSnapshot } from '../../../health/diagnostics.js';
import { getJobMetrics } from '../../../scheduler/scheduleCatalog.js';

function toKstHm(iso: string | undefined): string {
  if (!iso) return '미실행';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '미실행';
    return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '미실행';
  }
}

function tierLine(label: string, jobName: string, runAt?: string): string {
  const metrics = getJobMetrics(jobName);
  const lastRun = runAt ?? metrics?.lastSuccessAt;
  const runs = metrics?.runCount ?? 0;
  const fails = metrics?.failCount ?? 0;
  return `${label}: ${toKstHm(lastRun)} (실행 ${runs}회 / 실패 ${fails}회)`;
}

function credentialLine(eval0: CredentialEvaluation): string {
  if (eval0.daysUntilExpiry < 0) {
    return `🚨 ${eval0.label} — 만료됨 (${Math.abs(eval0.daysUntilExpiry)}일 경과)`;
  }
  if (eval0.daysUntilExpiry === 0) return `🚨 ${eval0.label} — 오늘 만료`;
  if (eval0.daysUntilExpiry <= 7) return `⚠️ ${eval0.label} — D-${eval0.daysUntilExpiry}`;
  if (eval0.daysUntilExpiry <= 30) return `🟡 ${eval0.label} — D-${eval0.daysUntilExpiry}`;
  return `✅ ${eval0.label} — D-${eval0.daysUntilExpiry}`;
}

export interface HealthLoopStatusInputs {
  loopState: ReturnType<typeof loadHealthLoopState>;
  credentialState: ReturnType<typeof loadCredentialExpiryState>;
  credentialEvaluations: CredentialEvaluation[];
  postHolidayState: ReturnType<typeof loadPostHolidayState>;
  snapshot: HealthSnapshot;
}

export function formatHealthLoopStatusMessage(input: HealthLoopStatusInputs): string {
  const { loopState, credentialEvaluations, postHolidayState, snapshot } = input;

  const lines: string[] = [];
  lines.push('🩺 헬스 루프 상태 (ADR-0131)');
  lines.push('');
  lines.push('━ 3티어 마지막 실행 ━');
  lines.push(tierLine('Tier 1 (5분)', 'health_loop_tier1', loopState.lastTier1RunAt));
  lines.push(tierLine('Tier 2 (1시간)', 'health_loop_tier2', loopState.lastTier2RunAt));
  lines.push(tierLine('Tier 3 (일일)', 'health_loop_tier3', loopState.lastTier3RunAt));

  lines.push('');
  lines.push('━ 현재 스냅샷 ━');
  if (snapshot.kisConfigured) {
    const hours = snapshot.kisTokenHours;
    const tokenLabel = hours === 0 ? '🚨 만료' : hours < 6 ? `⚠️ ${hours.toFixed(1)}h` : `${hours.toFixed(1)}h`;
    lines.push(`KIS 토큰: ${tokenLabel}`);
  } else {
    lines.push('KIS 토큰: ⚠️ 미설정');
  }
  lines.push(`자동매매: ${snapshot.autoTradeEnabled ? '✅ 활성' : '🟡 비활성'} (${snapshot.autoTradeMode})`);
  lines.push(`워치리스트: ${snapshot.watchlistCount}개 / 활성 포지션 ${snapshot.activePositions}개`);

  lines.push('');
  lines.push('━ 인증키 만료 ━');
  if (credentialEvaluations.length === 0) {
    lines.push('등록된 credential 없음');
  } else {
    for (const e of credentialEvaluations) {
      lines.push(credentialLine(e));
    }
  }

  lines.push('');
  lines.push('━ 휴장 후 첫 거래일 점검 ━');
  if (postHolidayState.lastFirstDayCheckedAt) {
    const failCount = (postHolidayState.lastChecks ?? []).filter((c) => c.status === 'FAIL').length;
    const warnCount = (postHolidayState.lastChecks ?? []).filter((c) => c.status === 'WARN').length;
    const dateStr = postHolidayState.lastFirstDayDate ?? '?';
    lines.push(`마지막: ${dateStr} (${toKstHm(postHolidayState.lastFirstDayCheckedAt)})`);
    lines.push(`결과: FAIL ${failCount}건 / WARN ${warnCount}건`);
  } else {
    lines.push('마지막 실행 기록 없음 (휴장 후 첫 거래일 미발생 또는 미배포)');
  }

  return lines.join('\n');
}

const healthLoopStatus: TelegramCommand = {
  name: '/health_loop_status',
  aliases: ['/hls'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '3티어 헬스 루프 + 인증키 + 휴장후 점검 통합 진단 (ADR-0131)',
  usage: '/health_loop_status (alias /hls) — 인자 없음',
  async execute({ reply }) {
    try {
      const loopState = loadHealthLoopState();
      const credentialState = loadCredentialExpiryState();
      const postHolidayState = loadPostHolidayState();
      const snapshot = collectHealthSnapshot();
      const now = new Date();
      const credentialEvaluations = KNOWN_CREDENTIALS.map((c) => evaluateCredential(c, now));
      const msg = formatHealthLoopStatusMessage({
        loopState,
        credentialState,
        credentialEvaluations,
        postHolidayState,
        snapshot,
      });
      await reply(msg);
    } catch (e) {
      console.error('[TelegramBot] /health_loop_status 실패:', e);
      await reply('❌ 헬스 루프 상태 조회 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(healthLoopStatus);

export default healthLoopStatus;
