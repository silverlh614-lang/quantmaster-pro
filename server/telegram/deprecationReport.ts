/**
 * @responsibility ADR-0017 §Stage 3 — 30일 이상 미사용 명령어 폐기 후보 자동 리포트 빌더 (PR-48).
 *
 * commandRegistry.all() 의 unique 명령어 목록과 commandUsageRepo.getStaleCommands()
 * 를 결합해 운영자에게 주간 텔레그램 알림으로 발송될 리포트를 생성한다.
 * 본 모듈은 부수효과 없는 순수 함수만 노출 — 실제 cron / 텔레그램 송신은
 * server/scheduler/commandUsageJobs.ts 가 담당.
 */

import { commandRegistry } from './commandRegistry.js';
import { getStaleCommands, getTopUsage } from '../persistence/commandUsageRepo.js';

export interface DeprecationCandidate {
  name: string;
  category: string;
  daysSinceLastUse: number | null;
  lastUsedAt: string | null;
}

export interface DeprecationReportData {
  totalRegistered: number;
  totalCandidates: number;
  thresholdDays: number;
  candidates: DeprecationCandidate[];
  /** 정상 사용 중 Top 5 — 대비 표시. */
  topUsage: Array<{ name: string; count: number }>;
}

/**
 * 30일 이상 미사용된 명령어 + 한 번도 사용된 적 없는 명령어를 모은다.
 * commandRegistry.all() 의 unique cmd 객체 기준 — alias 별 중복 카운팅 없음.
 */
export function collectDeprecationCandidates(
  thresholdDays: number = 30,
  now: number = Date.now(),
): DeprecationReportData {
  const allCommands = commandRegistry.all();
  const registeredNames = allCommands.map(c => c.name);
  const stale = getStaleCommands(registeredNames, thresholdDays, now);

  const candidates: DeprecationCandidate[] = stale.map(s => {
    const cmd = allCommands.find(c => c.name === s.name);
    return {
      name: s.name,
      category: cmd?.category ?? 'UNKNOWN',
      daysSinceLastUse: s.daysSinceLastUse,
      lastUsedAt: s.lastUsedAt,
    };
  });

  return {
    totalRegistered: allCommands.length,
    totalCandidates: candidates.length,
    thresholdDays,
    candidates,
    topUsage: getTopUsage(5).map(t => ({ name: t.name, count: t.count })),
  };
}

/**
 * Telegram HTML 메시지 포맷. 후보가 0건이면 "전부 활발히 사용 중" 안내로 간단 요약.
 * 텔레그램 메시지 길이 제한(4096자) 내 안전하게 들어가도록 후보는 최대 30개까지만 표시.
 */
export function formatDeprecationReport(data: DeprecationReportData): string {
  const { totalRegistered, totalCandidates, thresholdDays, candidates, topUsage } = data;

  const header =
    `🗑 <b>[명령어 폐기 후보 주간 리포트]</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `등록: ${totalRegistered}개 | 후보: ${totalCandidates}개 (${thresholdDays}일 미사용)\n`;

  if (totalCandidates === 0) {
    return (
      header +
      `━━━━━━━━━━━━━━━━\n` +
      `✅ 모든 명령어가 ${thresholdDays}일 내 사용되었습니다.\n` +
      (topUsage.length > 0
        ? `\n<b>📊 Top ${topUsage.length}</b>\n` +
          topUsage.map((t, i) => `  ${i + 1}. ${t.name} — ${t.count}회`).join('\n')
        : '')
    );
  }

  // 카테고리별 그룹핑.
  const byCategory = new Map<string, DeprecationCandidate[]>();
  for (const c of candidates) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }

  const visible = candidates.slice(0, 30);
  const more = candidates.length > 30 ? `\n<i>...외 ${candidates.length - 30}건 (Top 30 만 표시)</i>` : '';

  const candidateLines = visible
    .map(c => {
      const ageLabel =
        c.daysSinceLastUse === null ? '⚫ 한 번도 사용 안 됨' : `🔴 ${c.daysSinceLastUse}일 미사용`;
      return `  ${ageLabel} <code>${escapeHtml(c.name)}</code> [${c.category}]`;
    })
    .join('\n');

  const categoryBreakdown = Array.from(byCategory.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([cat, list]) => `  ${cat}: ${list.length}개`)
    .join('\n');

  const topUsageBlock =
    topUsage.length > 0
      ? `\n\n<b>📊 정상 사용 중 Top ${topUsage.length}</b>\n` +
        topUsage.map((t, i) => `  ${i + 1}. ${t.name} — ${t.count}회`).join('\n')
      : '';

  return (
    header +
    `━━━━━━━━━━━━━━━━\n` +
    `<b>📂 카테고리별</b>\n` +
    categoryBreakdown +
    `\n\n<b>🗑 폐기 후보</b>\n` +
    candidateLines +
    more +
    topUsageBlock +
    `\n\n<i>본 리포트는 매주 월요일 09:00 KST 자동 발송됩니다. 0회 사용 명령어는 다음 PR 에서 제거 검토 가능합니다.</i>`
  );
}

// HTML 엔티티 이스케이프 — telegramClient.escapeHtml 과 동일 로직 (순환 차단 위해 로컬 사본).
function escapeHtml(text: string): string {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
