// @responsibility nightlyReflection 결과를 13개 모듈별 meaningful boolean 으로 추론·기록 (ADR-0047 PR-Y2)
/**
 * reflectionImpactRecorder.ts — Reflection Module 영향률 측정 wiring 헬퍼
 *
 * nightlyReflectionEngine 의 report 가 완성된 후 1회 호출되어, 13개 모듈 각각이
 * meaningful 한 결과를 생성했는지 boolean 으로 추론한 뒤 reflectionImpactRepo 에
 * 일괄 영속한다.
 *
 * 본 PR (Phase 1) 은 *측정만* — 실제 silent/deprecated 가드 wiring (실행 스킵 /
 * 출력 억제) 은 데이터 누적 후 후속 PR (Phase 2) 에서 도입.
 */

import type { ReflectionReport } from './reflectionTypes.js';
import {
  recordReflectionImpact,
  type ReflectionImpactRecord,
} from '../persistence/reflectionImpactRepo.js';
import {
  KNOWN_REFLECTION_MODULES,
  type KnownReflectionModule,
} from './reflectionImpactPolicy.js';

/**
 * 추가 메타 인자 — report 만으로는 추론 못 하는 모듈 (biasHeatmap 등) 을 명시적으로 전달.
 */
export interface ReflectionImpactExtras {
  /** biasHeatmap: 가장 큰 bias score (≥ 0.5 면 meaningful) */
  biasMaxScore?: number;
  /** experimentProposal: 본 사이클 생성된 proposal 수 (>0 면 meaningful) */
  experimentProposalCount?: number;
  /** metaDecisionJournal: 본 사이클 메타 결정 로그 entries 수 */
  metaJournalEntries?: number;
  /** weeklyReflectionAudit: 주간 리포트 실행 여부 */
  weeklyAuditExecuted?: boolean;
  /** reflectionGemini: Gemini 호출이 성공해 mainReflection 결과로 환원됐는지 */
  geminiCallSucceeded?: boolean;
}

/**
 * report + extras 로부터 13개 모듈의 meaningful boolean 추론.
 *
 * 핵심 규칙:
 *   - integrity.parseFailed=true → mainReflection / reflectionGemini 자동 false
 *   - 빈 배열 / null / undefined / 임계 미달 → false
 *   - report 에 직접 보이지 않는 모듈은 extras 인자 사용 (없으면 보수적 false)
 */
export function inferModuleImpacts(
  report: ReflectionReport,
  extras: ReflectionImpactExtras = {},
): Record<KnownReflectionModule, boolean> {
  const parseFailed = report.integrity?.parseFailed === true;
  const mainMeaningful =
    !parseFailed &&
    ((report.keyLessons?.length ?? 0) > 0 ||
      (report.questionableDecisions?.length ?? 0) > 0 ||
      (report.tomorrowAdjustments?.length ?? 0) > 0);

  // followUpActions 의 sourceIds prefix 로 일부 모듈 영향 추론
  // (예: 'exp:' = experimentProposal, 'bias:' = biasHeatmap, 'cond:' = conditionConfession chronic)
  const followUpSourceIds = (report.followUpActions ?? []).flatMap(
    a => a.sourceIds ?? [],
  );
  const hasExpSource = followUpSourceIds.some(s => s.startsWith('exp:'));
  const hasBiasSource = followUpSourceIds.some(s => s.startsWith('bias:'));

  return {
    mainReflection: mainMeaningful,
    personaRoundTable: report.personaReview != null,
    fiveWhy: (report.fiveWhy?.length ?? 0) > 0,
    counterfactual:
      report.counterfactual != null &&
      (report.counterfactual.sampleCount ?? 0) > 0,
    conditionConfession: (report.conditionConfession?.length ?? 0) > 0,
    regretQuantifier: report.regret != null,
    biasHeatmap:
      // extras 우선 — 명시 점수가 ≥ 0.5 거나, 또는 followUpActions 에 bias: 등장
      (typeof extras.biasMaxScore === 'number' && extras.biasMaxScore >= 0.5) ||
      hasBiasSource,
    experimentProposal:
      (extras.experimentProposalCount ?? 0) > 0 || hasExpSource,
    narrativeGenerator:
      typeof report.narrative === 'string' && report.narrative.trim().length > 0,
    manualExitReview:
      report.manualExitReview != null &&
      (report.manualExitReview.count > 0 ||
        report.manualExitReview.rolling7dCount > 0),
    metaDecisionJournal: (extras.metaJournalEntries ?? 0) > 0,
    weeklyReflectionAudit: extras.weeklyAuditExecuted === true,
    reflectionGemini:
      // mainReflection 이 의미 있고 parseFailed 아닐 때 + Gemini 호출이 성공했을 때
      mainMeaningful && extras.geminiCallSucceeded !== false,
  };
}

/**
 * 13개 모듈의 meaningful boolean 을 일괄 영속.
 *
 * 호출 위치: `nightlyReflectionEngine.runNightlyReflection` 의 saveReflection 직전.
 * 실패는 호출자에게 throw 하지 않음 (학습 사이클 보호) — try/catch 로 흡수 권장.
 */
export function recordReflectionImpactsFromReport(
  report: ReflectionReport,
  date: string,
  now: Date = new Date(),
  extras: ReflectionImpactExtras = {},
): ReflectionImpactRecord[] {
  const impacts = inferModuleImpacts(report, extras);
  const written: ReflectionImpactRecord[] = [];

  for (const moduleName of KNOWN_REFLECTION_MODULES) {
    try {
      const meaningful = impacts[moduleName];
      const entry = recordReflectionImpact(moduleName, date, meaningful, now);
      written.push(entry);
    } catch (e: unknown) {
      console.warn(
        `[ReflectionImpact] ${moduleName} 기록 실패:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  return written;
}
