// @responsibility lateWinEvaluator 학습 엔진 모듈
/**
 * lateWinEvaluator.ts — 아이디어 5 (Phase 3): EXPIRED 거래 지연 평가 루틴.
 *
 * 현재 시스템은 진입 후 30일 경과 시 단순히 현재가 기준으로 EXPIRED 처리한다.
 * 하지만 EXPIRED 는 "신호가 틀렸다"가 아니라 "타이밍이 맞지 않았다"일 수 있다.
 * 본 루틴은 이미 EXPIRED 로 결산된 추천 이력을 60일·90일 시점으로 추가 추적하여
 * targetPrice 달성 시 lateWin=true 로 재분류하고, 타이밍 조건의 평가 시
 * 별도 페널티(LATE_WIN_TIMING_PENALTY)가 적용되도록 한다.
 *
 * 알고리즘:
 *   1. EXPIRED 이면서 lateWin 미설정인 레코드를 스캔.
 *   2. 각 레코드마다 signalTime 으로부터 최대 90일 이후까지 Yahoo OHLCV 조회.
 *   3. 60일 시점 종가 수익률을 return60d 에 기록.
 *   4. 30~90일 구간 내 high ≥ targetPrice 발생 시 → status='WIN', lateWin=true.
 *   5. 달성 실패 & 90일 경과 → lateEvalCheckedAt 만 갱신 (재시도 억제).
 */

import fs from 'fs';
import { RECOMMENDATIONS_FILE, ensureDataDir } from '../persistence/paths.js';
import type { RecommendationRecord } from './recommendationTracker.js';
import { guardedFetch } from '../utils/egressGuard.js';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

const DAY_MS = 86_400_000;
const EXPIRE_DAYS = 30;
const LATE_CHECKPOINT_60D = 60;
const LATE_CHECKPOINT_90D = 90;

interface OHLCVDay { date: string; high: number; low: number; close: number }

function loadRecommendations(): RecommendationRecord[] {
  ensureDataDir();
  if (!fs.existsSync(RECOMMENDATIONS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(RECOMMENDATIONS_FILE, 'utf-8')) as RecommendationRecord[];
  } catch {
    return [];
  }
}

function saveRecommendations(recs: RecommendationRecord[]): void {
  ensureDataDir();
  fs.writeFileSync(RECOMMENDATIONS_FILE, JSON.stringify(recs.slice(-1000), null, 2));
}

async function fetchOHLCV(code: string, from: Date, to: Date): Promise<OHLCVDay[]> {
  const p1 = Math.floor(from.getTime() / 1000);
  const p2 = Math.floor(to.getTime()   / 1000);
  const symbols = [`${code}.KS`, `${code}.KQ`];

  for (const sym of symbols) {
    const urls = [
      `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?period1=${p1}&period2=${p2}&interval=1d`,
      `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?period1=${p1}&period2=${p2}&interval=1d`,
    ];
    for (const url of urls) {
      try {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 12_000);
        const res  = await guardedFetch(url, { headers: YF_HEADERS, signal: ctrl.signal });
        clearTimeout(tid);
        if (!res.ok) continue;
        const data = await res.json();
        const result = data?.chart?.result?.[0];
        if (!result) continue;
        const ts: number[] = result.timestamps ?? [];
        const q = result.indicators?.quote?.[0] ?? {};
        const highs  = q.high  as (number | null)[];
        const lows   = q.low   as (number | null)[];
        const closes = q.close as (number | null)[];
        const days: OHLCVDay[] = [];
        for (let i = 0; i < ts.length; i++) {
          if (highs[i] == null || lows[i] == null || closes[i] == null) continue;
          days.push({
            date:  new Date(ts[i] * 1000).toISOString().slice(0, 10),
            high:  highs[i]!,
            low:   lows[i]!,
            close: closes[i]!,
          });
        }
        if (days.length > 0) return days;
      } catch { /* try next */ }
    }
  }
  return [];
}

/**
 * EXPIRED 레코드를 60/90일 관점으로 재평가한다.
 *
 * @returns lateWin 으로 전환된 레코드 수
 */
export async function reEvaluateExpired(): Promise<number> {
  const recs = loadRecommendations();
  const now = Date.now();

  const targets = recs.filter((rec) => {
    if (rec.status !== 'EXPIRED') return false;
    if (rec.lateWin) return false; // 이미 전환됨
    const ageDays = (now - new Date(rec.signalTime).getTime()) / DAY_MS;
    if (ageDays < EXPIRE_DAYS + 10) return false; // 만료 직후는 대기
    // 마지막 점검 후 7일 미만이면 스킵 (주간 cron 가정)
    if (rec.lateEvalCheckedAt) {
      const since = (now - new Date(rec.lateEvalCheckedAt).getTime()) / DAY_MS;
      if (since < 7) return false;
    }
    // 90일 이상 경과 & return90d 이미 기록된 레코드는 재시도 불필요
    if (ageDays > LATE_CHECKPOINT_90D + 10 && rec.return90d !== undefined) return false;
    return true;
  });

  if (targets.length === 0) {
    console.log('[LateWinEval] 재평가 대상 없음 — 건너뜀');
    return 0;
  }

  console.log(`[LateWinEval] EXPIRED 재평가 시작 — ${targets.length}건`);
  let converted = 0;
  let snapshotted = 0;

  for (const rec of targets) {
    try {
      const entry = new Date(rec.signalTime);
      const fetchTo = new Date(Math.min(now, entry.getTime() + (LATE_CHECKPOINT_90D + 5) * DAY_MS));
      const ohlcv = await fetchOHLCV(rec.stockCode, entry, fetchTo);
      if (ohlcv.length === 0) continue;

      const priceRef = rec.priceAtRecommend;
      let hitDay: OHLCVDay | null = null;
      let hitDayIdx = -1;

      for (let i = 0; i < ohlcv.length; i++) {
        const day = ohlcv[i];
        if (i < EXPIRE_DAYS) continue; // 30일 이전은 기존 평가 범위
        if (day.high >= rec.targetPrice) {
          hitDay = day;
          hitDayIdx = i;
          break;
        }
      }

      // 60일 / 90일 종가 수익률 스냅샷
      if (ohlcv[LATE_CHECKPOINT_60D - 1] && rec.return60d === undefined) {
        const c = ohlcv[LATE_CHECKPOINT_60D - 1].close;
        rec.return60d = parseFloat((((c - priceRef) / priceRef) * 100).toFixed(2));
        snapshotted++;
      }
      if (ohlcv[LATE_CHECKPOINT_90D - 1] && rec.return90d === undefined) {
        const c = ohlcv[LATE_CHECKPOINT_90D - 1].close;
        rec.return90d = parseFloat((((c - priceRef) / priceRef) * 100).toFixed(2));
      }

      // LATE_WIN 전환
      if (hitDay && hitDayIdx < LATE_CHECKPOINT_90D) {
        rec.expiredAt = rec.resolvedAt ?? rec.expiredAt; // EXPIRED 시각 보존
        rec.status = 'WIN';
        rec.lateWin = true;
        rec.actualReturn = parseFloat((((rec.targetPrice - priceRef) / priceRef) * 100).toFixed(2));
        rec.resolvedAt = new Date(Date.parse(hitDay.date)).toISOString();
        converted++;
        console.log(
          `[LateWinEval] 🕰  LATE_WIN ${rec.stockName}(${rec.stockCode}) ` +
          `+${rec.actualReturn}% @ D+${hitDayIdx + 1}`,
        );
      }

      rec.lateEvalCheckedAt = new Date().toISOString();

      // Rate limit
      await new Promise((r) => setTimeout(r, 150));
    } catch (e) {
      console.error(`[LateWinEval] ${rec.stockCode} 재평가 실패:`, e instanceof Error ? e.message : e);
    }
  }

  saveRecommendations(recs);
  console.log(
    `[LateWinEval] 완료 — LATE_WIN 전환 ${converted}건, 스냅샷 ${snapshotted}건`,
  );
  return converted;
}
