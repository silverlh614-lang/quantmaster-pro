// @responsibility 자기학습 루프 stateless 진단 7 지표를 영속 데이터만 read 해 산출한다
/**
 * learningLoopHealth.ts — Self-Learning Loop Health Diagnostic (ADR-0130 PR-Diag)
 *
 * 사용자 4/30 진단 후속 — 자기학습 루프가 *stateless* 임이 코드 + 시각 양쪽에서 확정된 후
 * 본 모듈이 그 정도를 7 지표로 정량화한다. PR-Fix-1/2 (recentReflections + activeFailurePatterns
 * 입력 채널) 적용 후 *실제로 누적 학습이 되는가* 검증하는 도구.
 *
 * 외부 의존성 0 — 모든 입력은 영속 read (loadRecentReflections / loadBiasHeatmap /
 * loadFailurePatterns / loadReflection). Gemini/KIS/KRX 호출 0건. 본 모듈 자체는
 * read-only 진단 — LIVE 매매 본체 무수정.
 */

import {
  loadRecentReflections,
  loadBiasHeatmap,
} from '../persistence/reflectionRepo.js';
import { loadFailurePatterns } from '../persistence/failurePatternRepo.js';
import type { BiasType, ReflectionReport } from './reflectionTypes.js';

// ── 타입 ───────────────────────────────────────────────────────────────────────

export type LearningLoopVerdict = 'HEALTHY' | 'DEGRADED' | 'STATELESS' | 'INSUFFICIENT_DATA';

export interface LearningLoopHealthSnapshot {
  capturedAt: string;
  narrativeSimilarity7d: {
    samples: number;
    avgSimilarity: number;
    verdict: 'STATELESS' | 'EVOLVING' | 'INSUFFICIENT';
  };
  biasScoreVariance7d: {
    samples: number;
    avgVariancePerBias: Partial<Record<BiasType, number>>;
    statelessCount: number;
    verdict: 'STATELESS' | 'STATEFUL' | 'INSUFFICIENT';
  };
  failurePatternIngestion: {
    activePatterns: number;
    ingestedToReflection: boolean;
    lastIngestionAt?: string;
  };
  reflectionImpactPhase: {
    phase1Active: boolean;
    phase2Active: boolean;
    reason: string;
  };
  tomorrowVsNarrativeOverlap7d: {
    samples: number;
    identicalCount: number;
    ratio: number;
    verdict: 'COPY_PASTE' | 'DERIVED' | 'INSUFFICIENT';
  };
  signalScannerWeightLastUpdate: {
    hasReflectionDriven: boolean;
    reason: string;
  };
  silentVerdictRatio7d: {
    totalReflections: number;
    silentCount: number;
    ratio: number;
  };
  overallVerdict: LearningLoopVerdict;
  warnings: string[];
}

// ── 임계 SSOT ──────────────────────────────────────────────────────────────────

const CONSTANTS = {
  /** narrativeSimilarity 평균이 이 이상이면 STATELESS */
  NARRATIVE_SIMILARITY_STATELESS_THRESHOLD: 0.7,
  /** statelessCount (variance == 0 인 BiasType 수) 이 이상이면 STATELESS */
  BIAS_VARIANCE_STATELESS_COUNT_THRESHOLD: 5,
  /** tomorrow ↔ narrative 첫 문장 Jaccard 유사도 이 이상이면 identical */
  TOMORROW_OVERLAP_IDENTICAL_THRESHOLD: 0.85,
  /** identical 비율 이 이상이면 COPY_PASTE */
  TOMORROW_OVERLAP_RATIO_THRESHOLD: 0.7,
  /** Reflection 수가 이 미만이면 INSUFFICIENT_DATA */
  MIN_SAMPLES_FOR_VERDICT: 3,
  /** 진단 윈도우 (일) */
  WINDOW_DAYS: 7,
} as const;

export const LEARNING_LOOP_HEALTH_CONSTANTS = CONSTANTS;

// ── Jaccard 유사도 ─────────────────────────────────────────────────────────────

/**
 * Jaccard 유사도 — 단어 토큰 집합 기반. 외부 라이브러리 0.
 * 둘 다 빈 집합이면 1.0 (degenerate match), 한쪽만 빈 집합이면 0.
 *
 * 한국어/영어/숫자만 추출 후 공백 split — 특수문자/이모지/구두점 자동 제거.
 */
export function computeJaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string): Set<string> => {
    if (!s || typeof s !== 'string') return new Set();
    const normalized = s
      .toLowerCase()
      .replace(/[^ㄱ-ㆎ가-힣a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0);
    return new Set(normalized);
  };
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

/** Sample variance — N=1 시 0 반환, NaN/Infinity 안전 fallback */
export function computeVariance(values: number[]): number {
  if (!Array.isArray(values) || values.length <= 1) return 0;
  const safe = values.filter((v) => Number.isFinite(v));
  if (safe.length <= 1) return 0;
  const mean = safe.reduce((s, v) => s + v, 0) / safe.length;
  const sumSq = safe.reduce((s, v) => s + (v - mean) ** 2, 0);
  return sumSq / (safe.length - 1);
}

// ── 7 지표 산출 ────────────────────────────────────────────────────────────────

function computeNarrativeSimilarity7d(
  reports: ReflectionReport[],
): LearningLoopHealthSnapshot['narrativeSimilarity7d'] {
  const narratives = reports
    .map((r) => r.narrative ?? '')
    .filter((n) => n.trim().length > 0);
  if (narratives.length < CONSTANTS.MIN_SAMPLES_FOR_VERDICT) {
    return { samples: narratives.length, avgSimilarity: 0, verdict: 'INSUFFICIENT' };
  }
  const pairs: number[] = [];
  for (let i = 0; i < narratives.length - 1; i++) {
    pairs.push(computeJaccardSimilarity(narratives[i], narratives[i + 1]));
  }
  const avg = pairs.length > 0 ? pairs.reduce((s, v) => s + v, 0) / pairs.length : 0;
  const verdict =
    avg >= CONSTANTS.NARRATIVE_SIMILARITY_STATELESS_THRESHOLD ? 'STATELESS' : 'EVOLVING';
  return { samples: narratives.length, avgSimilarity: avg, verdict };
}

function computeBiasScoreVariance7d(
  now: Date,
): LearningLoopHealthSnapshot['biasScoreVariance7d'] {
  const cutoffMs = now.getTime() - CONSTANTS.WINDOW_DAYS * 24 * 3600 * 1000;
  const entries = loadBiasHeatmap().filter((e) => {
    const t = new Date(e.date + 'T00:00:00Z').getTime();
    return Number.isFinite(t) && t >= cutoffMs;
  });
  if (entries.length < CONSTANTS.MIN_SAMPLES_FOR_VERDICT) {
    return {
      samples: entries.length,
      avgVariancePerBias: {},
      statelessCount: 0,
      verdict: 'INSUFFICIENT',
    };
  }
  const byBias = new Map<BiasType, number[]>();
  for (const e of entries) {
    for (const s of e.scores) {
      if (!byBias.has(s.bias)) byBias.set(s.bias, []);
      byBias.get(s.bias)!.push(s.score);
    }
  }
  const avgVariancePerBias: Partial<Record<BiasType, number>> = {};
  let statelessCount = 0;
  for (const [bias, values] of byBias) {
    const variance = computeVariance(values);
    avgVariancePerBias[bias] = variance;
    if (variance === 0) statelessCount++;
  }
  const verdict =
    statelessCount >= CONSTANTS.BIAS_VARIANCE_STATELESS_COUNT_THRESHOLD
      ? 'STATELESS'
      : 'STATEFUL';
  return { samples: entries.length, avgVariancePerBias, statelessCount, verdict };
}

function computeFailurePatternIngestion(): LearningLoopHealthSnapshot['failurePatternIngestion'] {
  const activePatterns = loadFailurePatterns().length;
  // 본 PR scope 에서는 항상 false — 후속 PR 에서 nightlyReflectionEngine 가
  // ingestion 이력 영속하면 여기서 read.
  // ADR-0130 PR-Fix-2 wiring 후 ingestedToReflection=true 로 격상 (헬퍼가 호출되면 true).
  const ingestedToReflection =
    process.env.LEARNING_FAILURE_PATTERN_INPUT_DISABLED !== 'true' && activePatterns > 0;
  return { activePatterns, ingestedToReflection };
}

function computeReflectionImpactPhase(): LearningLoopHealthSnapshot['reflectionImpactPhase'] {
  return {
    phase1Active: true,
    phase2Active: false,
    reason:
      'reflectionImpactRecorder.ts:9-10 — Phase 1 측정만 작동 / Phase 2 (silent/deprecated 가드 wiring) 후속 PR-Fix-3 예정.',
  };
}

function computeTomorrowVsNarrativeOverlap7d(
  reports: ReflectionReport[],
): LearningLoopHealthSnapshot['tomorrowVsNarrativeOverlap7d'] {
  if (reports.length < CONSTANTS.MIN_SAMPLES_FOR_VERDICT + 1) {
    return { samples: 0, identicalCount: 0, ratio: 0, verdict: 'INSUFFICIENT' };
  }
  // (어제 narrative 첫 문장) vs (오늘 tomorrowAdjustments[0].text) 페어
  let samples = 0;
  let identical = 0;
  for (let i = 0; i < reports.length - 1; i++) {
    const yesterday = reports[i];
    const today = reports[i + 1];
    const yNarrative = yesterday.narrative?.split(/[.。\n]/)[0]?.trim() ?? '';
    const tomorrowText = today.tomorrowAdjustments[0]?.text ?? '';
    if (yNarrative.length === 0 || tomorrowText.length === 0) continue;
    samples++;
    const sim = computeJaccardSimilarity(yNarrative, tomorrowText);
    if (sim >= CONSTANTS.TOMORROW_OVERLAP_IDENTICAL_THRESHOLD) identical++;
  }
  if (samples < CONSTANTS.MIN_SAMPLES_FOR_VERDICT) {
    return { samples, identicalCount: identical, ratio: 0, verdict: 'INSUFFICIENT' };
  }
  const ratio = identical / samples;
  const verdict = ratio >= CONSTANTS.TOMORROW_OVERLAP_RATIO_THRESHOLD ? 'COPY_PASTE' : 'DERIVED';
  return { samples, identicalCount: identical, ratio, verdict };
}

function computeSignalScannerWeightLastUpdate(): LearningLoopHealthSnapshot['signalScannerWeightLastUpdate'] {
  return {
    hasReflectionDriven: false,
    reason:
      'saveEvolutionWeights 가 클라이언트 측 (src/services/quant/) 에 위치 — nightlyReflectionEngine 직접 호출 채널 부재. Phase 2 후속 PR-Fix-3/4 에서 행동 변경 채널 도입 예정.',
  };
}

function computeSilentVerdictRatio7d(
  reports: ReflectionReport[],
): LearningLoopHealthSnapshot['silentVerdictRatio7d'] {
  const total = reports.length;
  if (total === 0) return { totalReflections: 0, silentCount: 0, ratio: 0 };
  const silentCount = reports.filter((r) => r.dailyVerdict === 'SILENT').length;
  return { totalReflections: total, silentCount, ratio: silentCount / total };
}

// ── 종합 verdict + warnings ────────────────────────────────────────────────────

function composeOverallVerdict(
  partial: Omit<LearningLoopHealthSnapshot, 'overallVerdict' | 'warnings' | 'capturedAt'>,
): { verdict: LearningLoopVerdict; warnings: string[] } {
  const warnings: string[] = [];
  const totalReflections = partial.silentVerdictRatio7d.totalReflections;
  if (totalReflections < CONSTANTS.MIN_SAMPLES_FOR_VERDICT) {
    return {
      verdict: 'INSUFFICIENT_DATA',
      warnings: [`최근 ${CONSTANTS.WINDOW_DAYS}일 reflection 부족 (${totalReflections}건 < ${CONSTANTS.MIN_SAMPLES_FOR_VERDICT})`],
    };
  }
  const narrativeStateless = partial.narrativeSimilarity7d.verdict === 'STATELESS';
  const tomorrowCopyPaste = partial.tomorrowVsNarrativeOverlap7d.verdict === 'COPY_PASTE';
  const biasStateless = partial.biasScoreVariance7d.verdict === 'STATELESS';
  if (narrativeStateless) {
    warnings.push(`narrativeSimilarity ${(partial.narrativeSimilarity7d.avgSimilarity * 100).toFixed(0)}% — 7일 narrative 가 거의 동일 (stateless 의심)`);
  }
  if (tomorrowCopyPaste) {
    warnings.push(`tomorrow ↔ narrative 첫 문장 일치율 ${(partial.tomorrowVsNarrativeOverlap7d.ratio * 100).toFixed(0)}% — 어제 narrative 그대로 복사`);
  }
  if (biasStateless) {
    warnings.push(`biasHeatmap ${partial.biasScoreVariance7d.statelessCount}개 BiasType variance=0 — 매일 동일 점수 (stateless)`);
  }
  if (!partial.reflectionImpactPhase.phase2Active) {
    warnings.push('reflectionImpactRecorder Phase 2 비활성 — 학습 결과가 시스템 행동에 자동 반영되지 않음');
  }
  if (!partial.signalScannerWeightLastUpdate.hasReflectionDriven) {
    warnings.push('signalScanner 가중치가 reflection 에 의해 변경된 이력 없음 — Phase 2 후속 PR 대기');
  }
  if (partial.silentVerdictRatio7d.ratio >= 0.5) {
    warnings.push(`SILENT 평결 비율 ${(partial.silentVerdictRatio7d.ratio * 100).toFixed(0)}% — signalScanner ↔ autoTradeEngine 단절 의심`);
  }
  // 강한 stateless 신호 2종 충족
  if (narrativeStateless && tomorrowCopyPaste) {
    return { verdict: 'STATELESS', warnings };
  }
  // 약한 stateless 신호
  if (biasStateless || tomorrowCopyPaste || narrativeStateless) {
    return { verdict: 'DEGRADED', warnings };
  }
  return { verdict: 'HEALTHY', warnings };
}

// ── 진입점 ──────────────────────────────────────────────────────────────────────

export function collectLearningLoopHealth(now: Date = new Date()): LearningLoopHealthSnapshot {
  const reports = loadRecentReflections(CONSTANTS.WINDOW_DAYS);
  const narrativeSimilarity7d = computeNarrativeSimilarity7d(reports);
  const biasScoreVariance7d = computeBiasScoreVariance7d(now);
  const failurePatternIngestion = computeFailurePatternIngestion();
  const reflectionImpactPhase = computeReflectionImpactPhase();
  const tomorrowVsNarrativeOverlap7d = computeTomorrowVsNarrativeOverlap7d(reports);
  const signalScannerWeightLastUpdate = computeSignalScannerWeightLastUpdate();
  const silentVerdictRatio7d = computeSilentVerdictRatio7d(reports);
  const partial = {
    narrativeSimilarity7d,
    biasScoreVariance7d,
    failurePatternIngestion,
    reflectionImpactPhase,
    tomorrowVsNarrativeOverlap7d,
    signalScannerWeightLastUpdate,
    silentVerdictRatio7d,
  };
  const { verdict, warnings } = composeOverallVerdict(partial);
  return {
    capturedAt: now.toISOString(),
    ...partial,
    overallVerdict: verdict,
    warnings,
  };
}

// ── 텔레그램 메시지 포맷터 ─────────────────────────────────────────────────────

const VERDICT_EMOJI: Record<LearningLoopVerdict, string> = {
  HEALTHY: '🟢',
  DEGRADED: '🟡',
  STATELESS: '🔴',
  INSUFFICIENT_DATA: '⚪',
};

export function formatLearningLoopHealthMessage(snap: LearningLoopHealthSnapshot): string {
  const emoji = VERDICT_EMOJI[snap.overallVerdict];
  const lines: string[] = [
    `🩺 <b>자기학습 루프 헬스</b> ${emoji} ${snap.overallVerdict}`,
    '',
    `📝 narrative 유사도 7d: ${(snap.narrativeSimilarity7d.avgSimilarity * 100).toFixed(0)}% (${snap.narrativeSimilarity7d.verdict}, ${snap.narrativeSimilarity7d.samples}건)`,
    `📊 biasHeatmap variance 7d: ${snap.biasScoreVariance7d.statelessCount}개 BiasType variance=0 (${snap.biasScoreVariance7d.verdict}, ${snap.biasScoreVariance7d.samples}일)`,
    `🚨 failurePattern: 활성 ${snap.failurePatternIngestion.activePatterns}건 / reflection 주입: ${snap.failurePatternIngestion.ingestedToReflection ? '✅' : '❌'}`,
    `🔁 reflectionImpact Phase: 1=${snap.reflectionImpactPhase.phase1Active ? '✅' : '❌'} 2=${snap.reflectionImpactPhase.phase2Active ? '✅' : '❌'}`,
    `📋 tomorrow ↔ narrative 첫 문장 일치 7d: ${(snap.tomorrowVsNarrativeOverlap7d.ratio * 100).toFixed(0)}% (${snap.tomorrowVsNarrativeOverlap7d.verdict}, ${snap.tomorrowVsNarrativeOverlap7d.identicalCount}/${snap.tomorrowVsNarrativeOverlap7d.samples}건)`,
    `⚙️ signalScanner 가중치 reflection-driven: ${snap.signalScannerWeightLastUpdate.hasReflectionDriven ? '✅' : '❌'}`,
    `🌙 SILENT 평결 7d: ${(snap.silentVerdictRatio7d.ratio * 100).toFixed(0)}% (${snap.silentVerdictRatio7d.silentCount}/${snap.silentVerdictRatio7d.totalReflections}일)`,
  ];
  if (snap.warnings.length > 0) {
    lines.push('', '⚠️ <b>경고</b>:');
    for (const w of snap.warnings) lines.push(`  • ${w}`);
  }
  lines.push('', `<i>capturedAt: ${snap.capturedAt}</i>`);
  return lines.join('\n');
}
