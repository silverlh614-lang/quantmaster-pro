// @responsibility experimentalConditionTester 학습 엔진 모듈
/**
 * experimentalConditionTester.ts — 아이디어 6 (Phase 3): 제안 조건 A/B 백테스트.
 *
 * conditionAuditor.proposeNewConditions() 가 PROPOSED 로 등록한 후보에 대해
 * Gemini 가 제시한 passingWinCodes / passingLossCodes 를 기준으로 lift 를
 * 계산한다.
 *
 *   TP = |passingWinCodes ∩ 실제 WIN set|
 *   FP = |passingLossCodes ∩ 실제 LOSS/EXPIRED set|
 *   precision = TP / (TP + FP)
 *   baselineWR = 실제 WIN / (WIN + LOSS + EXPIRED)
 *   lift = precision / baselineWR
 *
 * 기준:
 *   - lift ≥ 1.15 AND (TP + FP) ≥ 10  → BACKTESTED_PASSED
 *   - 그 외 → BACKTESTED_FAILED
 *
 * 승격 이후 "ACTIVE" 전환은 수동 승인(텔레그램 webhook 등)에서만 가능하도록
 * 분리 — 자동화된 조건 편입은 과최적화 위험이 크기 때문.
 */

import {
  loadExperimentalConditions,
  updateExperimentalCondition,
  type ExperimentalCondition,
} from '../persistence/experimentalConditionRepo.js';
import { getRecommendations } from './recommendationTracker.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

const LIFT_THRESHOLD = 1.15;
const MIN_SAMPLE = 10;

interface TestOutcome {
  tp: number;
  fp: number;
  precision: number;
  baselineWR: number;
  lift: number;
  sampleSize: number;
}

function evaluate(cand: ExperimentalCondition): TestOutcome {
  const recs = getRecommendations().filter((r) => r.status !== 'PENDING');
  const winCodes  = new Set(
    recs.filter((r) => r.status === 'WIN').map((r) => r.stockCode),
  );
  const lossCodes = new Set(
    recs
      .filter((r) => r.status === 'LOSS' || r.status === 'EXPIRED')
      .map((r) => r.stockCode),
  );

  const proposedWins  = new Set(cand.passingWinCodes  ?? []);
  const proposedLoss  = new Set(cand.passingLossCodes ?? []);

  let tp = 0;
  let fp = 0;
  for (const code of proposedWins)  if (winCodes.has(code))  tp++;
  for (const code of proposedLoss)  if (lossCodes.has(code)) fp++;

  const total = winCodes.size + lossCodes.size;
  const baselineWR = total > 0 ? winCodes.size / total : 0;
  const sampleSize = tp + fp;
  const precision  = sampleSize > 0 ? tp / sampleSize : 0;
  const lift       = baselineWR > 0 ? precision / baselineWR : 0;

  return { tp, fp, precision, baselineWR, lift, sampleSize };
}

/**
 * PROPOSED 상태의 실험 조건들을 평가하여 상태 전이.
 * @returns [passed, failed] 건수
 */
export async function runExperimentalConditionBacktest(): Promise<[number, number]> {
  const candidates = loadExperimentalConditions().filter((c) => c.status === 'PROPOSED');
  if (candidates.length === 0) {
    console.log('[ExpCondTester] PROPOSED 후보 없음 — 건너뜀');
    return [0, 0];
  }

  let passed = 0;
  let failed = 0;
  const passedLines: string[] = [];
  const failedLines: string[] = [];

  for (const cand of candidates) {
    const out = evaluate(cand);
    const decidedAt = new Date().toISOString();

    const nextStatus: 'BACKTESTED_PASSED' | 'BACKTESTED_FAILED' =
      out.lift >= LIFT_THRESHOLD && out.sampleSize >= MIN_SAMPLE
        ? 'BACKTESTED_PASSED'
        : 'BACKTESTED_FAILED';

    updateExperimentalCondition(cand.id, {
      status: nextStatus,
      backtestResult: {
        precision:  parseFloat(out.precision.toFixed(3)),
        lift:       parseFloat(out.lift.toFixed(3)),
        sampleSize: out.sampleSize,
        baselineWR: parseFloat(out.baselineWR.toFixed(3)),
        decidedAt,
      },
    });

    const line =
      `${cand.name} — lift ${out.lift.toFixed(2)} × n=${out.sampleSize} ` +
      `(TP=${out.tp}/FP=${out.fp}, 기준 ${out.baselineWR.toFixed(2)})`;

    if (nextStatus === 'BACKTESTED_PASSED') {
      passed++;
      passedLines.push(line);
    } else {
      failed++;
      failedLines.push(line);
    }
  }

  console.log(`[ExpCondTester] 완료 — PASSED ${passed}건, FAILED ${failed}건`);

  if (passed > 0 || failed > 0) {
    await sendTelegramAlert(
      `🧪 <b>[Experimental Condition Backtest]</b>\n\n` +
      (passedLines.length > 0
        ? `✅ <b>PASSED ${passed}건 (lift ≥ ${LIFT_THRESHOLD}, n ≥ ${MIN_SAMPLE})</b>\n` +
          passedLines.map((l) => `  • ${l}`).join('\n') + '\n\n'
        : '') +
      (failedLines.length > 0
        ? `❌ <b>FAILED ${failed}건</b>\n` +
          failedLines.slice(0, 5).map((l) => `  • ${l}`).join('\n')
        : '') +
      `\n\n<i>PASSED 항목은 수동 승인 후 ACTIVE 로 전환 가능.</i>`,
    ).catch(console.error);
  }

  return [passed, failed];
}
