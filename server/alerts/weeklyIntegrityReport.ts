/**
 * @responsibility 일요일 10:00 KST 주간 무결성 리포트 — trade 단위 + fill SSOT 병행
 *
 * 월말 캘리브레이션 전에 "건강하게 성장 중" vs "뭔가 이상하게 정체 중" 을 조기 판별한다.
 *
 * 리포트 섹션:
 *   1. 주간 신호 발생 패턴 (요일별, 시간대별)
 *   2. Shadow 체결 vs 실패 비율
 *   3. 조건별 활성화 빈도 (과열 / 과소활용 조건 식별)
 *   4. 판단 로직 해시값 — 핵심 quant 파일의 SHA256 변동 여부
 *   5. 표본 속도 + 최근 7일 이상 감지 건수
 *
 * 로직 해시는 우발적 로직 변경을 조기에 가시화한다. 해시 변경이 의도적이라면
 * 주간 리포트로 "알고 있음" 을 남기고, 의도치 않았다면 배포 경로 점검 신호.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { loadShadowTrades, aggregateFillStats, type ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import { isOpenShadowStatus } from '../trading/entryEngine.js';
import { loadGateAudit } from '../persistence/gateAuditRepo.js';
import { sendTelegramAlert } from './telegramClient.js';
import { detectSampleStall } from './shadowProgressBriefing.js';

// ── 판단 로직 핵심 파일 (해시 추적 대상) ──────────────────────────────────────

const REPO_ROOT = path.resolve(process.cwd());

const JUDGMENT_LOGIC_FILES = [
  'server/quant/conditions/evaluators.ts',
  'server/quant/conditions/registry.ts',
  'server/quantFilter.ts',
  'server/learning/signalCalibrator.ts',
  'server/learning/failurePatternDB.ts',
];

function hashFile(relPath: string): string {
  const abs = path.join(REPO_ROOT, relPath);
  try {
    const content = fs.readFileSync(abs);
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
  } catch {
    return 'missing';
  }
}

/** 핵심 로직 파일들의 짧은 해시를 계산. Shadow 기간 중 누적 변경 여부 판별용. */
export function computeJudgmentLogicHashes(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const f of JUDGMENT_LOGIC_FILES) result[f] = hashFile(f);
  return result;
}

// ── 주간 통계 ────────────────────────────────────────────────────────────────

export interface WeeklyIntegrityStats {
  weekRange: { fromIso: string; toIso: string };
  totalThisWeek: number;
  byDow: Record<number, number>;   // 0=일, 6=토
  byHour: Record<number, number>;  // 9~15
  activeCount: number;
  winCount: number;
  lossCount: number;
  winRatePct: number;
  /** PR-18: fill SSOT — 이번 주 실현 이벤트(부분매도 포함) 기준 승/손/가중 P&L */
  fillWins: number;
  fillLosses: number;
  fillWeightedReturnPct: number;
  fillRealizedKrw: number;
  partialOnlyCount: number;
  topPassingConditions: Array<{ key: string; passed: number; failed: number; passRate: number }>;
  logicHashes: Record<string, string>;
  stallReason: string;
}

export function computeWeeklyIntegrityStats(now: Date = new Date()): WeeklyIntegrityStats {
  const shadows = loadShadowTrades();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const weekly = shadows.filter(s => new Date(s.signalTime) >= sevenDaysAgo);

  const byDow: Record<number, number> = {};
  const byHour: Record<number, number> = {};
  for (const s of weekly) {
    // KST 기준 요일·시간대
    const kst = new Date(new Date(s.signalTime).getTime() + 9 * 3_600_000);
    const dow = kst.getUTCDay();
    const hour = kst.getUTCHours();
    byDow[dow] = (byDow[dow] ?? 0) + 1;
    byHour[hour] = (byHour[hour] ?? 0) + 1;
  }

  const activeCount = weekly.filter(s => isOpenShadowStatus(s.status)).length;
  const winCount   = weekly.filter(s => s.status === 'HIT_TARGET').length;
  const lossCount  = weekly.filter(s => s.status === 'HIT_STOP').length;
  const closed = winCount + lossCount;
  const winRatePct = closed > 0 ? (winCount / closed) * 100 : 0;

  // PR-18: fill SSOT 기반 주간 실현 집계 — signalTime 필터가 아닌 fill.timestamp 기준.
  // 이전 주 signaled 지만 이번 주에 부분매도로 실현된 익절 fill 도 포함된다.
  const fillAgg = aggregateFillStats(shadows, {
    fromIso: sevenDaysAgo.toISOString(),
    toIso: now.toISOString(),
  });

  // 조건별 통과 / 실패
  const audit = loadGateAudit();
  const topPassingConditions = Object.entries(audit)
    .map(([key, v]) => {
      const total = v.passed + v.failed;
      const passRate = total > 0 ? (v.passed / total) * 100 : 0;
      return { key, passed: v.passed, failed: v.failed, passRate };
    })
    .sort((a, b) => b.passed - a.passed)
    .slice(0, 6);

  const stall = detectSampleStall(now);
  return {
    weekRange: { fromIso: sevenDaysAgo.toISOString(), toIso: now.toISOString() },
    totalThisWeek: weekly.length,
    byDow, byHour,
    activeCount, winCount, lossCount, winRatePct,
    fillWins: fillAgg.winFills,
    fillLosses: fillAgg.lossFills,
    fillWeightedReturnPct: fillAgg.weightedReturnPct,
    fillRealizedKrw: fillAgg.totalRealizedKrw,
    partialOnlyCount: fillAgg.partialOnlyCount,
    topPassingConditions,
    logicHashes: computeJudgmentLogicHashes(),
    stallReason: stall.reason,
  };
}

export function formatWeeklyIntegrityReport(stats: WeeklyIntegrityStats): string {
  const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

  const dowLines = Object.entries(stats.byDow)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([d, n]) => `  ${DOW_LABELS[Number(d)]}: ${n}건`)
    .join('\n') || '  (데이터 없음)';

  const hourLines = Object.entries(stats.byHour)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([h, n]) => `  ${String(h).padStart(2, '0')}시: ${n}건`)
    .join('\n') || '  (데이터 없음)';

  const condLines = stats.topPassingConditions
    .map(c => `  ${c.key}: ${c.passRate.toFixed(1)}% (${c.passed}/${c.passed + c.failed})`)
    .join('\n') || '  (누적 데이터 없음)';

  const hashLines = Object.entries(stats.logicHashes)
    .map(([f, h]) => `  ${path.basename(f)}: ${h}`)
    .join('\n');

  return [
    `🗓️ <b>[주간 무결성 리포트]</b>`,
    `기간: ${stats.weekRange.fromIso.slice(0, 10)} ~ ${stats.weekRange.toIso.slice(0, 10)}`,
    `━━━━━━━━━━━━━━━━━━`,
    `<b>신호 발생 (${stats.totalThisWeek}건)</b>`,
    `요일별:`,
    dowLines,
    `시간대별:`,
    hourLines,
    ``,
    `<b>Shadow 결과 (trade 단위)</b>`,
    `  ✅ WIN: ${stats.winCount}건`,
    `  ❌ LOSS: ${stats.lossCount}건`,
    `  ⏳ ACTIVE: ${stats.activeCount}건`,
    `  승률: ${stats.winRatePct.toFixed(1)}%`,
    ``,
    `<b>실현 이벤트 (부분매도 포함, fill 단위)</b>`,
    `  익 fill: ${stats.fillWins}건 / 손 fill: ${stats.fillLosses}건` +
      (stats.partialOnlyCount > 0 ? ` · 부분매도만 ${stats.partialOnlyCount}건` : ''),
    `  가중 P&L: ${stats.fillWeightedReturnPct >= 0 ? '+' : ''}${stats.fillWeightedReturnPct.toFixed(2)}%` +
      ` · 실현 ${Math.round(stats.fillRealizedKrw).toLocaleString()}원`,
    ``,
    `<b>조건 활성화 (상위 6)</b>`,
    condLines,
    ``,
    `<b>표본 속도</b>`,
    `  ${stats.stallReason}`,
    ``,
    `<b>판단 로직 해시</b>`,
    hashLines,
    `━━━━━━━━━━━━━━━━━━`,
  ].join('\n');
}

export async function sendWeeklyIntegrityReport(): Promise<void> {
  const stats = computeWeeklyIntegrityStats();
  const msg = formatWeeklyIntegrityReport(stats);
  await sendTelegramAlert(msg, {
    priority: 'NORMAL',
    dedupeKey: `weekly-integrity-${stats.weekRange.toIso.slice(0, 10)}`,
  }).catch(console.error);
}

// ── 테스트 편의 ───────────────────────────────────────────────────────────────

export function _computeFromShadows(shadows: ServerShadowTrade[], now: Date): WeeklyIntegrityStats {
  // computeWeeklyIntegrityStats 를 shadows 주입으로 재구성한 경량 버전 (테스트용).
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const weekly = shadows.filter(s => new Date(s.signalTime) >= sevenDaysAgo);

  const byDow: Record<number, number> = {};
  const byHour: Record<number, number> = {};
  for (const s of weekly) {
    const kst = new Date(new Date(s.signalTime).getTime() + 9 * 3_600_000);
    byDow[kst.getUTCDay()] = (byDow[kst.getUTCDay()] ?? 0) + 1;
    byHour[kst.getUTCHours()] = (byHour[kst.getUTCHours()] ?? 0) + 1;
  }
  const winCount  = weekly.filter(s => s.status === 'HIT_TARGET').length;
  const lossCount = weekly.filter(s => s.status === 'HIT_STOP').length;
  const closed = winCount + lossCount;
  const fillAgg = aggregateFillStats(shadows, {
    fromIso: sevenDaysAgo.toISOString(),
    toIso: now.toISOString(),
  });

  return {
    weekRange: { fromIso: sevenDaysAgo.toISOString(), toIso: now.toISOString() },
    totalThisWeek: weekly.length,
    byDow, byHour,
    activeCount: weekly.filter(s => isOpenShadowStatus(s.status)).length,
    winCount, lossCount,
    winRatePct: closed > 0 ? (winCount / closed) * 100 : 0,
    fillWins: fillAgg.winFills,
    fillLosses: fillAgg.lossFills,
    fillWeightedReturnPct: fillAgg.weightedReturnPct,
    fillRealizedKrw: fillAgg.totalRealizedKrw,
    partialOnlyCount: fillAgg.partialOnlyCount,
    topPassingConditions: [],
    logicHashes: {},
    stallReason: '(테스트)',
  };
}
