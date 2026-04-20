/**
 * weeklyReflectionAudit.ts — Reflection Integrity 주간 품질 감사 (#14 연장).
 *
 * 참뮌이 일요일에 "지난 주 반성 품질" 을 원클릭으로 평가할 수 있도록
 * 숫자·핵심 claim 목록을 반환한다. Telegram UI 는 Phase 별도.
 *
 * 산출:
 *   - 리포트 총 개수 / mode 분포
 *   - 전체 claimsIn / claimsOut / removed 수 (Integrity Guard 활성도)
 *   - parseFailed 리포트 수 (JSON 스키마 실패율)
 *   - 5-Why YELLOW 발견 수 (새 insight 기여도)
 *   - 주간 대표 교훈 Top 5 (keyLessons 빈도 합산)
 */

import { loadRecentReflections } from '../../persistence/reflectionRepo.js';
import type { ReflectionMode, ReflectionReport } from '../reflectionTypes.js';

export interface WeeklyAudit {
  windowDays: number;
  totalReports: number;
  modeDistribution: Record<ReflectionMode, number>;
  totalClaimsIn: number;
  totalClaimsOut: number;
  totalClaimsRemoved: number;
  removalRatePct: number;
  parseFailedCount: number;
  fiveWhyYellowCount: number;
  fiveWhyGreenCount:  number;
  topLessons: Array<{ text: string; count: number }>;
}

export function auditLastWeek(windowDays = 7): WeeklyAudit {
  const reports = loadRecentReflections(windowDays);
  return auditReports(reports, windowDays);
}

export function auditReports(reports: ReflectionReport[], windowDays: number): WeeklyAudit {
  const modeDist: Record<ReflectionMode, number> = {
    FULL: 0, REDUCED_EOD: 0, REDUCED_MWF: 0, TEMPLATE_ONLY: 0, SILENCE_MONDAY: 0,
  };
  let claimsIn = 0, claimsOut = 0, removed = 0, parseFailed = 0;
  let yellow = 0, green = 0;
  const lessonCounts = new Map<string, number>();

  for (const r of reports) {
    if (r.mode) modeDist[r.mode] = (modeDist[r.mode] ?? 0) + 1;
    if (r.integrity) {
      claimsIn += r.integrity.claimsIn;
      claimsOut += r.integrity.claimsOut;
      removed += r.integrity.removed.length;
      if (r.integrity.parseFailed) parseFailed++;
    }
    for (const fw of r.fiveWhy ?? []) {
      if (fw.tag === 'YELLOW_NEW_INSIGHT') yellow++;
      else green++;
    }
    for (const lesson of r.keyLessons ?? []) {
      lessonCounts.set(lesson.text, (lessonCounts.get(lesson.text) ?? 0) + 1);
    }
  }

  const topLessons = [...lessonCounts.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([text, count]) => ({ text, count }));

  return {
    windowDays,
    totalReports: reports.length,
    modeDistribution: modeDist,
    totalClaimsIn: claimsIn,
    totalClaimsOut: claimsOut,
    totalClaimsRemoved: removed,
    removalRatePct: claimsIn > 0 ? Number(((removed / claimsIn) * 100).toFixed(1)) : 0,
    parseFailedCount: parseFailed,
    fiveWhyYellowCount: yellow,
    fiveWhyGreenCount:  green,
    topLessons,
  };
}
