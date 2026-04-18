/**
 * miniEvaluate.ts — 단일 종목 PENDING 추천 즉시 평가 (아이디어 1 L1 훅).
 *
 * Shadow 청산(HIT_TARGET/HIT_STOP) 직후 동일 stockCode의 PENDING 추천을
 * 즉시 WIN/LOSS/EXPIRED로 평가하여 학습 지연을 7시간 → 5분으로 단축한다.
 *
 * evaluateRecommendations()의 per-stock 경량 버전.
 */

import fs from 'fs';
import { RECOMMENDATIONS_FILE, ensureDataDir } from '../persistence/paths.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import type { RecommendationRecord } from './recommendationTracker.js';

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

/**
 * 단일 종목의 PENDING 추천을 현재가 기준으로 즉시 평가한다.
 * @returns 상태가 변경된 레코드 수
 */
export async function miniEvaluateSingle(stockCode: string): Promise<number> {
  const recs = loadRecommendations();
  const targets = recs.filter((r) => r.stockCode === stockCode && r.status === 'PENDING');
  if (targets.length === 0) return 0;

  const currentPrice = await fetchCurrentPrice(stockCode).catch(() => null);
  if (!currentPrice) return 0;

  let changed = 0;
  const EXPIRE_MS = 30 * 24 * 60 * 60 * 1000;

  for (const rec of targets) {
    const returnPct = ((currentPrice - rec.priceAtRecommend) / rec.priceAtRecommend) * 100;
    const ageMs     = Date.now() - new Date(rec.signalTime).getTime();

    if (currentPrice <= rec.stopLoss) {
      rec.status       = 'LOSS';
      rec.actualReturn = parseFloat((((rec.stopLoss - rec.priceAtRecommend) / rec.priceAtRecommend) * 100).toFixed(2));
      rec.resolvedAt   = new Date().toISOString();
      changed++;
      console.log(`[MiniEval] ❌ LOSS ${rec.stockName} ${rec.actualReturn}% (즉시 평가)`);
    } else if (currentPrice >= rec.targetPrice) {
      rec.status       = 'WIN';
      rec.actualReturn = parseFloat((((rec.targetPrice - rec.priceAtRecommend) / rec.priceAtRecommend) * 100).toFixed(2));
      rec.resolvedAt   = new Date().toISOString();
      changed++;
      console.log(`[MiniEval] ✅ WIN ${rec.stockName} +${rec.actualReturn}% (즉시 평가)`);
    } else if (ageMs > EXPIRE_MS) {
      rec.status       = 'EXPIRED';
      rec.actualReturn = parseFloat(returnPct.toFixed(2));
      rec.resolvedAt   = new Date().toISOString();
      changed++;
      console.log(`[MiniEval] ⏱ EXPIRED ${rec.stockName} ${rec.actualReturn}%`);
    }
  }

  if (changed > 0) saveRecommendations(recs);
  return changed;
}
