// @responsibility ghostForceRun.cmd 텔레그램 모듈
// @responsibility: /ghost_force_run — refreshGhostPortfolio() 강제 실행 진단. SYS ADMIN.
//
// ghost cron (15:40 KST) 누적 실패 시 운영자가 즉시 실패 사유 분포를 확인할 수 있는
// 강제 트리거. silent catch 수정 후 함께 도입되어 188건 100% 실패 시나리오 같은
// 진짜 결함 사유 (KIS timeout / Token expired / PRICE_NULL 등) 를 5초 안에 노출.
//
// 안전 가드:
//   - 60s rate-limit (모듈 로컬 _lastRunAt) — KIS 호출 폭주 차단 (회로/블랙리스트 부담)
//   - AUTO_TRADE_ENABLED 가드 *불필요* — 진단 read-only, 매매 비활성에서도 유효
//   - emergencyStop 가드 *불필요* — 비상 시에도 진단 데이터 수집은 안전
//   - scheduleCatalog.recordScheduleRun 호출 — 수동 실행도 JobMetrics 영속에 기록

import { refreshGhostPortfolio } from '../../../learning/ghostPortfolioTracker.js';
import { recordScheduleRun } from '../../../scheduler/scheduleCatalog.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const FORCE_RUN_RATE_LIMIT_MS = 60_000;
const GHOST_JOB_NAME = 'ghost_portfolio';
let _lastRunAt = 0;

/**
 * 실패 사유 별 권장 액션 매핑 — 첫 30자 prefix 매칭.
 * silent catch 수정으로 사유가 분류되어 도착하면 운영자 의사결정이 즉시 가능.
 */
function buildFailureRecommendation(reason: string): string | null {
  if (/timeout|시간 초과|ETIMEDOUT/i.test(reason)) {
    return 'KIS API 응답 지연 → 직렬→병렬 batch 변경 검토';
  }
  if (/token|expired|401|403/i.test(reason)) {
    return '토큰 만료 → 호출 직전 토큰 갱신 추가 검토';
  }
  if (reason === 'PRICE_NULL') {
    return '종목 코드 형식 검증 또는 KIS 응답 본문 누락 확인';
  }
  if (reason === 'PRICE_NON_POSITIVE') {
    return '거래정지/상장폐지 종목 의심 — close 처리 정책 검토';
  }
  if (reason === 'SIGNAL_PRICE_INVALID') {
    return 'enqueueMissedSignals 시점 signalPriceKrw 검증 누락 — 입력 정합성 확인';
  }
  if (/circuit|블랙리스트|blacklist/i.test(reason)) {
    return 'KIS 회로/블랙리스트 활성 — `/circuits` 명령으로 상태 확인';
  }
  if (/rate|429/i.test(reason)) {
    return 'KIS rate limit 누적 — backoff 정책 검토';
  }
  return null;
}

interface GhostForceRunMessageInputs {
  durationMs: number;
  updated: number;
  closed: number;
  skipped: number;
  failureReasons?: Record<string, number>;
}

function formatGhostForceRunMessage(r: GhostForceRunMessageInputs): string {
  const lines: string[] = [
    '🔄 Ghost Portfolio 강제 실행',
    '',
    `소요 시간: ${r.durationMs.toLocaleString('en-US')}ms`,
    `갱신: ${r.updated}건`,
    `종료: ${r.closed}건`,
    `스킵: ${r.skipped}건`,
  ];

  const reasons = r.failureReasons ?? {};
  const reasonEntries = Object.entries(reasons).sort((a, b) => b[1] - a[1]);

  if (reasonEntries.length > 0) {
    lines.push('', '⚠️ 실패 사유 분포:');
    for (const [reason, count] of reasonEntries) {
      lines.push(`  - "${reason}": ${count}건`);
    }
    const recs: string[] = [];
    for (const [reason] of reasonEntries) {
      const rec = buildFailureRecommendation(reason);
      if (rec) recs.push(`- ${reason} → ${rec}`);
    }
    if (recs.length > 0) {
      lines.push('', '권장 액션:');
      for (const rec of recs) lines.push(rec);
    }
  } else if (r.skipped === 0 && r.updated + r.closed > 0) {
    lines.push('', '✅ 모든 활성 ghost 정상 처리 — 실패 0건');
  } else if (r.updated + r.closed + r.skipped === 0) {
    lines.push('', 'ℹ️ 활성 ghost 0건 — 처리 대상 없음');
  }

  return lines.join('\n');
}

const ghostForceRun: TelegramCommand = {
  name: '/ghost_force_run',
  aliases: ['/gfr'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 1,
  description:
    'Ghost Portfolio 강제 실행 진단 — refreshGhostPortfolio() 즉시 호출 + 실패 사유 분포 + 권장 액션 노출 (60s rate-limit)',
  usage: '/ghost_force_run',
  async execute({ reply }) {
    const now = Date.now();
    if (now - _lastRunAt < FORCE_RUN_RATE_LIMIT_MS) {
      const wait = Math.ceil((FORCE_RUN_RATE_LIMIT_MS - (now - _lastRunAt)) / 1000);
      await reply(`⏱️ 60초 이내 재호출 차단 — ${wait}초 후 다시 시도`);
      return;
    }

    _lastRunAt = now;
    await reply('🔄 Ghost Portfolio 강제 실행 시작 — KIS 가격 조회 중...');

    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    try {
      const result = await refreshGhostPortfolio();
      const durationMs = Date.now() - t0;
      const finishedAt = new Date().toISOString();

      const reasonNote = result.failureReasons && Object.keys(result.failureReasons).length > 0
        ? ` | reasons=${JSON.stringify(result.failureReasons)}`
        : '';
      recordScheduleRun({
        jobName: GHOST_JOB_NAME,
        startedAt,
        finishedAt,
        durationMs,
        status: 'success',
        note: `manual force_run updated=${result.updated} closed=${result.closed} skipped=${result.skipped}${reasonNote}`,
      });

      await reply(formatGhostForceRunMessage({
        durationMs,
        updated: result.updated,
        closed: result.closed,
        skipped: result.skipped,
        failureReasons: result.failureReasons,
      }));
    } catch (e) {
      const durationMs = Date.now() - t0;
      const finishedAt = new Date().toISOString();
      const msg = e instanceof Error ? e.message : String(e);
      recordScheduleRun({
        jobName: GHOST_JOB_NAME,
        startedAt,
        finishedAt,
        durationMs,
        status: 'failure',
        note: `manual force_run throw: ${msg}`,
      });
      await reply(`❌ Ghost 강제 실행 실패 (${durationMs}ms): ${msg}`);
    }
  },
};

commandRegistry.register(ghostForceRun);
