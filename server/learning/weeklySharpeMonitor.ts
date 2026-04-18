/**
 * weeklySharpeMonitor.ts — Sharpe 급락 조기 경보 주간 체크.
 *
 * 기존 detectPerformanceAnomaly()는 7일 vs 30일 WR 비교다. Sharpe Ratio의 급락은
 * WR 변화보다 더 빠르게 위험을 선행하므로, 매주 수요일 16:30 KST에 각 조건의
 * 이번 주 Sharpe가 이전 4주 평균 대비 50% 이하로 떨어지면 즉시 경보 발송.
 *
 * 데이터: AttributionRecord의 conditionScore ≥ 6 거래를 조건 "기여" 거래로 간주.
 */

import { loadAttributionRecords, type ServerAttributionRecord } from '../persistence/attributionRepo.js';
import { serverConditionKey } from './attributionAnalyzer.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { calcConditionSharpe } from './signalCalibrator.js';

/** 조건 기여로 볼 conditionScore 임계값 (1~10 스케일) */
const CONTRIBUTION_SCORE_THRESHOLD = 6;
/** 급락 판정 배수 — 이번 주 Sharpe < 4주평균 × HALF_FACTOR */
const HALF_FACTOR = 0.5;
/** 경보 최소 표본 — 이번 주 혹은 과거 주에 이 미만이면 스킵 */
const MIN_SAMPLES_PER_WEEK = 3;

/** offset 주 전의 월요일 00:00 KST 타임스탬프 (ms) 반환. offset=0이면 이번 주 월요일. */
function getWeekStartMs(offsetWeeks: number): number {
  const KST_OFFSET = 9 * 3_600_000;
  const kstNow = new Date(Date.now() + KST_OFFSET);
  const dow    = kstNow.getUTCDay(); // 0=일, 1=월, ... 6=토
  const daysSinceMonday = (dow + 6) % 7;
  const thisWeekMondayKst = new Date(kstNow);
  thisWeekMondayKst.setUTCHours(0, 0, 0, 0);
  thisWeekMondayKst.setUTCDate(kstNow.getUTCDate() - daysSinceMonday);
  // offsetWeeks 이전 월요일로 이동
  const weekStartKstMs = thisWeekMondayKst.getTime() - offsetWeeks * 7 * 86_400_000;
  return weekStartKstMs - KST_OFFSET; // UTC ms 기준으로 변환
}

/** 주어진 [fromMs, toMs) 구간의 레코드에서 conditionKey별 Sharpe 집계. */
function sharpePerKey(records: ServerAttributionRecord[], fromMs: number, toMs: number): Record<string, { sharpe: number; count: number }> {
  const returns: Record<string, number[]> = {};
  for (const rec of records) {
    const closed = new Date(rec.closedAt).getTime();
    if (closed < fromMs || closed >= toMs) continue;
    for (const [condIdStr, score] of Object.entries(rec.conditionScores ?? {})) {
      if (Number(score) < CONTRIBUTION_SCORE_THRESHOLD) continue;
      const key = serverConditionKey(Number(condIdStr));
      if (!key) continue;
      if (!returns[key]) returns[key] = [];
      returns[key].push(rec.returnPct);
    }
  }
  const out: Record<string, { sharpe: number; count: number }> = {};
  for (const [key, rs] of Object.entries(returns)) {
    out[key] = { sharpe: calcConditionSharpe(rs), count: rs.length };
  }
  return out;
}

/**
 * 이번 주 Sharpe가 이전 4주 평균 대비 HALF_FACTOR(0.5) 이하로 급락한
 * conditionKey 를 모두 탐지하여 Telegram 경보를 발송한다.
 *
 * 매주 수요일 16:30 KST (UTC 07:30 수요일) cron 에서 호출.
 */
export async function checkWeeklySharpeAlert(): Promise<void> {
  const records = loadAttributionRecords();
  if (records.length === 0) {
    console.log('[SharpeWeekly] AttributionRecord 없음 — 스킵');
    return;
  }

  const thisWeekStart = getWeekStartMs(0);
  const nowMs         = Date.now();
  const thisWeek      = sharpePerKey(records, thisWeekStart, nowMs);

  // 이전 4주: offset 1~4주 각각 집계 후 키별 평균
  const prevBuckets = [1, 2, 3, 4].map((offset) => {
    const from = getWeekStartMs(offset);
    const to   = getWeekStartMs(offset - 1);
    return sharpePerKey(records, from, to);
  });

  const alerts: string[] = [];
  for (const [key, { sharpe: curr, count }] of Object.entries(thisWeek)) {
    if (count < MIN_SAMPLES_PER_WEEK) continue;
    const prior = prevBuckets
      .map((b) => b[key])
      .filter((x): x is { sharpe: number; count: number } => !!x && x.count >= MIN_SAMPLES_PER_WEEK);
    if (prior.length < 2) continue; // 최소 2주치 과거 데이터 필요
    const prevAvg = prior.reduce((s, x) => s + x.sharpe, 0) / prior.length;
    if (prevAvg <= 0) continue; // 과거가 이미 저조하면 의미 없음

    if (curr < prevAvg * HALF_FACTOR) {
      alerts.push(`${key}: 이번주 ${curr.toFixed(2)} vs 4주평균 ${prevAvg.toFixed(2)} (${count}건)`);
    }
  }

  if (alerts.length === 0) {
    console.log('[SharpeWeekly] Sharpe 급락 조건 없음 — 정상');
    return;
  }

  console.log(`[SharpeWeekly] 🚨 Sharpe 급락 ${alerts.length}개 조건 감지`);
  await sendTelegramAlert(
    `⚠️ <b>[Sharpe 급락 조기 경보] 수요일 중간 점검</b>\n\n` +
    alerts.map((l) => `• ${l}`).join('\n') +
    `\n\n→ 월말 전 조기 캘리브레이션 검토 필요`,
    { priority: 'HIGH', dedupeKey: 'weekly_sharpe_alert' },
  ).catch(console.error);
}
