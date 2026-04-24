/**
 * failureToWeight.ts — F2W (Failure-to-Weight Reverse Feedback Loop)
 *
 * @responsibility 실패/성공 패턴과 상관이 높은 조건의 가중치를 자동 조정한다.
 *
 * 규칙:
 *   - 조건 점수 × isWin(0/1) 점 양상관 r ≥ +0.7  → 1.05× 가중 (성공 기여)
 *   - 조건 점수 × isWin 점 양상관 r ≤ -0.7          → 0.9× 감쇠 (실패 기여)
 *   - 180일 누적 기여 수익률이 음수인 조건            → 0.2× 일몰(sunset) 고정
 *
 * 읽기-쓰기 폐쇄 루프: failurePatternDB 는 경고만 했지만 이 모듈이 실제
 * `condition-weights.json` 을 갱신하여 자기진화 구조를 완성한다.
 *
 * 가중치 범위: 0.1 ~ 2.0 (quantFilter.ts 의 기존 클램프와 동일).
 * sunset 된 조건은 매 실행 시 0.2 로 강제 고정된다.
 */

import fs from 'fs';
import {
  loadAttributionRecords,
  type ServerAttributionRecord,
} from '../persistence/attributionRepo.js';
import {
  loadConditionWeights,
  saveConditionWeights,
  type ConditionWeights,
} from '../persistence/conditionWeightsRepo.js';
import { serverConditionKey, CONDITION_NAMES } from './attributionAnalyzer.js';
import { type ConditionKey } from '../quantFilter.js';
import { F2W_AUDIT_FILE, ensureDataDir } from '../persistence/paths.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

// ─── 상수 ─────────────────────────────────────────────────────────────────

/** 상관계수 임계 — 이 이상이면 가중치 자동 조정 */
export const CORRELATION_THRESHOLD = 0.7;
/** 실패 상관 조건 감쇠 배수 */
export const FAILURE_DECAY_FACTOR = 0.9;
/** 성공 상관 조건 증가 배수 */
export const SUCCESS_BOOST_FACTOR = 1.05;
/** 일몰(sunset) 대상 누적 기간 */
export const SUNSET_WINDOW_DAYS = 180;
/** 일몰 시 고정 가중치 */
export const SUNSET_WEIGHT = 0.2;
/** 최소 표본 수 — 이 이하면 상관 신뢰 불가로 판단해 건너뜀 */
export const MIN_SAMPLE_SIZE = 10;
/** 가중치 클램프 범위 */
export const WEIGHT_FLOOR = 0.1;
export const WEIGHT_CAP = 2.0;

// ─── 수학 유틸 ────────────────────────────────────────────────────────────

function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]; sy += ys[i];
    sxx += xs[i] * xs[i]; syy += ys[i] * ys[i];
    sxy += xs[i] * ys[i];
  }
  const mx = sx / n, my = sy / n;
  const num = sxy - n * mx * my;
  const dx = sxx - n * mx * mx;
  const dy = syy - n * my * my;
  const denom = Math.sqrt(dx * dy);
  if (denom === 0) return 0;
  return num / denom;
}

// ─── 타입 ────────────────────────────────────────────────────────────────

export interface F2WAdjustment {
  conditionId: number;
  conditionName: string;
  serverKey: ConditionKey;
  samples: number;
  correlation: number;
  /** 직전 가중치 */
  prevWeight: number;
  /** 조정 후 가중치 */
  nextWeight: number;
  /** 'BOOST' | 'DECAY' | 'SUNSET' | 'NONE' */
  action: 'BOOST' | 'DECAY' | 'SUNSET' | 'NONE';
  /** 180일 누적 기여 수익률 (sunset 판정용) */
  contribution180d: number;
  reason: string;
}

export interface F2WRunResult {
  ranAt: string;
  totalRecords: number;
  adjustments: F2WAdjustment[];
  weightsBefore: ConditionWeights;
  weightsAfter: ConditionWeights;
  sunsetCount: number;
  boostCount: number;
  decayCount: number;
}

// ─── 핵심 계산 ────────────────────────────────────────────────────────────

/**
 * 한 조건에 대해:
 *   - Pearson(score, isWin) 을 계산 (점 양상관)
 *   - 180일 누적 "기여 수익률" 계산: Σ (score - avgScore) × returnPct
 *     (score 가 평균보다 높을 때 수익률이 낮으면 음수 기여)
 */
function analyzeCondition(
  conditionId: number,
  records: ServerAttributionRecord[],
): { correlation: number; samples: number; contribution180d: number } {
  const now = Date.now();
  const windowMs = SUNSET_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const xs: number[] = [];
  const ys: number[] = [];
  const recentPairs: Array<{ score: number; ret: number }> = [];

  for (const rec of records) {
    const score = rec.conditionScores[conditionId];
    if (score === undefined) continue;
    xs.push(score);
    ys.push(rec.isWin ? 1 : 0);

    const closedAt = new Date(rec.closedAt).getTime();
    if (now - closedAt <= windowMs) {
      recentPairs.push({ score, ret: rec.returnPct });
    }
  }

  const correlation = pearson(xs, ys);

  let contribution180d = 0;
  if (recentPairs.length >= MIN_SAMPLE_SIZE) {
    const avgScore = recentPairs.reduce((s, p) => s + p.score, 0) / recentPairs.length;
    contribution180d = recentPairs.reduce((s, p) => s + (p.score - avgScore) * p.ret, 0);
  }

  return { correlation, samples: xs.length, contribution180d };
}

function clamp(w: number): number {
  return Math.max(WEIGHT_FLOOR, Math.min(WEIGHT_CAP, w));
}

function decideAdjustment(
  conditionId: number,
  serverKey: ConditionKey,
  prevWeight: number,
  analysis: { correlation: number; samples: number; contribution180d: number },
): F2WAdjustment {
  const conditionName = CONDITION_NAMES[conditionId] ?? `조건 ${conditionId}`;
  const base: Omit<F2WAdjustment, 'action' | 'nextWeight' | 'reason'> = {
    conditionId,
    conditionName,
    serverKey,
    samples: analysis.samples,
    correlation: +analysis.correlation.toFixed(3),
    prevWeight,
    contribution180d: +analysis.contribution180d.toFixed(2),
  };

  // Sunset 우선: 180일 기여 수익률 음수 + 충분한 표본
  if (analysis.samples >= MIN_SAMPLE_SIZE && analysis.contribution180d < 0) {
    return {
      ...base,
      action: 'SUNSET',
      nextWeight: SUNSET_WEIGHT,
      reason: `180일 기여 수익률 ${analysis.contribution180d.toFixed(2)} — 음수 일몰 고정`,
    };
  }

  if (analysis.samples < MIN_SAMPLE_SIZE) {
    return { ...base, action: 'NONE', nextWeight: prevWeight, reason: `표본 ${analysis.samples}건 < ${MIN_SAMPLE_SIZE} — 건너뜀` };
  }

  if (analysis.correlation >= CORRELATION_THRESHOLD) {
    return {
      ...base,
      action: 'BOOST',
      nextWeight: clamp(prevWeight * SUCCESS_BOOST_FACTOR),
      reason: `승패 점양상관 ${analysis.correlation.toFixed(2)} ≥ ${CORRELATION_THRESHOLD} — 성공 기여`,
    };
  }

  if (analysis.correlation <= -CORRELATION_THRESHOLD) {
    return {
      ...base,
      action: 'DECAY',
      nextWeight: clamp(prevWeight * FAILURE_DECAY_FACTOR),
      reason: `승패 점양상관 ${analysis.correlation.toFixed(2)} ≤ -${CORRELATION_THRESHOLD} — 실패 기여`,
    };
  }

  return { ...base, action: 'NONE', nextWeight: prevWeight, reason: `|r|=${Math.abs(analysis.correlation).toFixed(2)} — 임계 미달` };
}

// ─── 감사 로그 ────────────────────────────────────────────────────────────

function appendAuditLog(result: F2WRunResult): void {
  ensureDataDir();
  let log: F2WRunResult[] = [];
  if (fs.existsSync(F2W_AUDIT_FILE)) {
    try { log = JSON.parse(fs.readFileSync(F2W_AUDIT_FILE, 'utf-8')); } catch { log = []; }
  }
  log.push(result);
  fs.writeFileSync(F2W_AUDIT_FILE, JSON.stringify(log.slice(-120), null, 2)); // 최근 120회 유지
}

// ─── 공개 API ──────────────────────────────────────────────────────────────

export interface F2WRunOptions {
  /** true 면 가중치 파일에 쓰지 않고 dry run — CI/테스트용 */
  dryRun?: boolean;
  /** true 면 요약 텔레그램 알림 발송 */
  notifyTelegram?: boolean;
}

export async function runF2WReverseLoop(options: F2WRunOptions = {}): Promise<F2WRunResult> {
  const records = loadAttributionRecords();
  const weightsBefore = loadConditionWeights();
  const weightsAfter: ConditionWeights = { ...weightsBefore };

  const adjustments: F2WAdjustment[] = [];
  for (let conditionId = 1; conditionId <= 27; conditionId++) {
    const serverKey = serverConditionKey(conditionId);
    if (!serverKey) continue; // 서버 자동평가 대상만 가중치 조정
    const prev = weightsBefore[serverKey] ?? 1.0;
    const analysis = analyzeCondition(conditionId, records);
    const adj = decideAdjustment(conditionId, serverKey, prev, analysis);
    adjustments.push(adj);
    if (adj.action !== 'NONE') weightsAfter[serverKey] = adj.nextWeight;
  }

  const sunsetCount = adjustments.filter((a) => a.action === 'SUNSET').length;
  const boostCount  = adjustments.filter((a) => a.action === 'BOOST').length;
  const decayCount  = adjustments.filter((a) => a.action === 'DECAY').length;

  const result: F2WRunResult = {
    ranAt: new Date().toISOString(),
    totalRecords: records.length,
    adjustments,
    weightsBefore,
    weightsAfter,
    sunsetCount,
    boostCount,
    decayCount,
  };

  if (!options.dryRun) {
    saveConditionWeights(weightsAfter);
    appendAuditLog(result);
  }

  if (options.notifyTelegram && (sunsetCount + boostCount + decayCount) > 0) {
    const lines = adjustments
      .filter((a) => a.action !== 'NONE')
      .map((a) => {
        const icon = a.action === 'SUNSET' ? '🌅' : a.action === 'BOOST' ? '📈' : '📉';
        return `${icon} ${a.conditionName}: ${a.prevWeight.toFixed(2)} → ${a.nextWeight.toFixed(2)}  (r=${a.correlation})`;
      })
      .join('\n');
    await sendTelegramAlert(
      `🔁 <b>[F2W 가중치 피드백]</b> 총 ${records.length}건 기반\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `${lines}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `부스트 ${boostCount} · 감쇠 ${decayCount} · 일몰 ${sunsetCount}`,
      { priority: sunsetCount > 0 ? 'HIGH' : 'NORMAL', dedupeKey: `f2w:${result.ranAt.slice(0, 10)}` },
    ).catch(console.error);
  }

  console.log(
    `[F2W] 완료 — 기록 ${records.length}건, 부스트 ${boostCount}/감쇠 ${decayCount}/일몰 ${sunsetCount}${options.dryRun ? ' (dry)' : ''}`,
  );

  return result;
}
