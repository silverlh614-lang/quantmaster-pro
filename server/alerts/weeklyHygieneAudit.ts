/**
 * weeklyHygieneAudit.ts — 주간 알림 감사 리포트.
 *
 * 참뮌 스펙 #12. 일요일 10:00 KST 자동 발송:
 *   - 지난 주 알림을 티어(T1/T2/T3) + 카테고리 + dedupeKey 로 집계
 *   - 가장 빈발한 카테고리 감지 → 쿨다운 조정 권고
 *   - 비정상적 폭증 (지난 주 평균 대비 3배 이상) 알림
 *
 * "알림 자체를 자기학습" — 시스템이 스스로 시끄러운 소스를 제안한다.
 */
import { readAlertAuditRange, type AlertAuditEntry } from './alertAuditLog.js';
import { sendTelegramAlert } from './telegramClient.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface HygieneReport {
  windowStart: string;
  windowEnd: string;
  total: number;
  byTier: { T1_ALARM: number; T2_REPORT: number; T3_DIGEST: number };
  byCategory: Array<{ category: string; count: number }>;
  surgingCategories: Array<{ category: string; count: number; priorCount: number; multiplier: number }>;
  recommendations: string[];
}

export function computeWeeklyHygiene(now: number = Date.now()): HygieneReport {
  const weekEnd = now;
  const weekStart = now - WEEK_MS;
  const priorStart = weekStart - WEEK_MS;

  const thisWeek  = readAlertAuditRange(weekStart, weekEnd);
  const priorWeek = readAlertAuditRange(priorStart, weekStart);

  const byTier = {
    T1_ALARM:  thisWeek.filter(e => e.tier === 'T1_ALARM').length,
    T2_REPORT: thisWeek.filter(e => e.tier === 'T2_REPORT').length,
    T3_DIGEST: thisWeek.filter(e => e.tier === 'T3_DIGEST').length,
  };

  const tally = (list: AlertAuditEntry[]) => {
    const m = new Map<string, number>();
    for (const e of list) m.set(e.category, (m.get(e.category) ?? 0) + 1);
    return m;
  };
  const thisCat  = tally(thisWeek);
  const priorCat = tally(priorWeek);

  const byCategory = [...thisCat.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }));

  // 폭증 감지: 이번 주 ≥ 5건 AND (지난 주 < 2건 이거나 3배 이상 증가)
  const surgingCategories: HygieneReport['surgingCategories'] = [];
  for (const { category, count } of byCategory) {
    if (count < 5) continue;
    const priorCount = priorCat.get(category) ?? 0;
    const denom = Math.max(priorCount, 1);
    const multiplier = count / denom;
    if (priorCount < 2 || multiplier >= 3) {
      surgingCategories.push({ category, count, priorCount, multiplier });
    }
  }

  const recommendations: string[] = [];
  for (const s of surgingCategories.slice(0, 3)) {
    if (s.priorCount === 0) {
      recommendations.push(`${s.category}: 신규 빈발 카테고리 (${s.count}건) — 발생 원인 리뷰`);
    } else {
      const factor = s.multiplier.toFixed(1);
      recommendations.push(`${s.category}: 지난 주 대비 ${factor}배 증가 — 쿨다운 상향 검토`);
    }
  }
  if (byTier.T1_ALARM >= 15) {
    recommendations.push(`T1 ${byTier.T1_ALARM}건 — 일반적으로 주간 10건 이하 권장. 오검출 여부 점검.`);
  }

  return {
    windowStart: new Date(weekStart).toISOString(),
    windowEnd:   new Date(weekEnd).toISOString(),
    total:       thisWeek.length,
    byTier,
    byCategory,
    surgingCategories,
    recommendations,
  };
}

/** 주간 리포트를 Telegram으로 발송. */
export async function sendWeeklyHygieneAudit(): Promise<void> {
  const report = computeWeeklyHygiene();
  const weekLabel = weekIsoLabel(new Date(report.windowEnd));

  const topCats = report.byCategory.slice(0, 5);
  const catLines = topCats.length > 0
    ? topCats.map(c => `  • ${c.category}: ${c.count}건`).join('\n')
    : '  (없음)';

  const surgingLines = report.surgingCategories.length > 0
    ? report.surgingCategories.slice(0, 3).map(s =>
        s.priorCount === 0
          ? `  🆕 ${s.category}: ${s.count}건 (신규)`
          : `  📈 ${s.category}: ${s.count}건 (지난주 ${s.priorCount}건 → ${s.multiplier.toFixed(1)}배)`
      ).join('\n')
    : '  (없음)';

  const recLines = report.recommendations.length > 0
    ? report.recommendations.map(r => `  ⚠️ ${r}`).join('\n')
    : '  (조정 권고 없음)';

  const msg =
    `<b>[알림 감사 ${weekLabel}]</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `이번 주 알림: 총 ${report.total}건\n` +
    `├─ 🚨 T1 ALARM: ${report.byTier.T1_ALARM}건\n` +
    `├─ 📊 T2 REPORT: ${report.byTier.T2_REPORT}건\n` +
    `└─ 📋 T3 DIGEST: ${report.byTier.T3_DIGEST}건\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `<b>카테고리 Top ${topCats.length}:</b>\n${catLines}\n` +
    `\n<b>폭증 감지:</b>\n${surgingLines}\n` +
    `\n<b>조정 권고:</b>\n${recLines}`;

  await sendTelegramAlert(msg, { tier: 'T2_REPORT', category: 'hygiene_audit' })
    .catch((e: unknown) => console.error('[HygieneAudit] 발송 실패:', e instanceof Error ? e.message : e));
}

/** ISO-week 레이블: 2026-W16 */
function weekIsoLabel(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${t.getUTCFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}
