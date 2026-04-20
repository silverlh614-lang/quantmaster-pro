/**
 * ghostPortfolioTracker.ts — Ghost Portfolio Tracker (#9).
 *
 * 매일 Watch/BUY 신호가 나왔으나 매수 안 한 종목 전체를 별도 ghost-portfolio.json 에 등록.
 * 30일 수익률 추적. 고스트 수익률 > 실제 수익률이면 "필터가 너무 보수적" 경보.
 *
 * 저장: data/ghost-portfolio.json (reflectionRepo.loadGhostPortfolio/appendGhostPositions)
 *
 * 호출:
 *   - enqueueMissedSignals() : 매일 반성 엔진 직후 — 오늘 놓친 신호 신규 등록.
 *   - refreshGhostPortfolio(): 매일 장마감 후 — 현재가 조회 + 30일 초과 종결.
 *   - compareGhostVsReal()   : 월 1회 또는 주간 — 고스트 vs 실제 수익률 비교 경보.
 */

import { fetchCurrentPrice } from '../clients/kisClient.js';
import {
  loadGhostPortfolio,
  saveGhostPortfolio,
  appendGhostPositions,
} from '../persistence/reflectionRepo.js';
import type { GhostPosition } from './reflectionTypes.js';

const TRACK_DAYS = 30;

function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function addDays(yyyymmdd: string, days: number): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export interface MissedSignalInput {
  stockCode: string;
  stockName: string;
  signalDate: string;           // YYYY-MM-DD KST
  signalPriceKrw: number;
  rejectionReason: string;
}

/** 오늘 놓친 신호를 Ghost Portfolio 에 신규 등록. 중복 (code+signalDate) 은 skip. */
export function enqueueMissedSignals(missed: MissedSignalInput[]): number {
  if (missed.length === 0) return 0;
  const newOnes: GhostPosition[] = missed.map((m) => ({
    stockCode:      m.stockCode,
    stockName:      m.stockName,
    signalPriceKrw: m.signalPriceKrw,
    signalDate:     m.signalDate,
    rejectionReason: m.rejectionReason,
    trackUntil:     addDays(m.signalDate, TRACK_DAYS),
  }));
  const before = loadGhostPortfolio().length;
  appendGhostPositions(newOnes);
  const after = loadGhostPortfolio().length;
  return after - before;
}

export interface RefreshOptions {
  /** 기준 시각 (테스트 주입용). 기본값: now. */
  now?: Date;
  /** 가격 조회 — 기본 KIS fetchCurrentPrice */
  priceFetcher?: (code: string) => Promise<number | null>;
}

/**
 * 활성 Ghost 포지션의 currentReturnPct 갱신 + trackUntil 초과 종결.
 * @returns { updated, closed, skipped }
 */
export async function refreshGhostPortfolio(
  opts: RefreshOptions = {},
): Promise<{ updated: number; closed: number; skipped: number }> {
  const now = opts.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const fetcher = opts.priceFetcher ?? fetchCurrentPrice;

  const all = loadGhostPortfolio();
  let updated = 0, closed = 0, skipped = 0;

  for (const p of all) {
    if (p.closed) continue;
    // 추적 기간 만료 → 마지막 갱신 후 closed
    if (p.trackUntil && today > p.trackUntil) {
      p.closed = true;
      closed++;
      continue;
    }
    try {
      const price = await fetcher(p.stockCode);
      if (price == null || price <= 0 || p.signalPriceKrw <= 0) {
        skipped++;
        continue;
      }
      p.currentReturnPct = Number(((price - p.signalPriceKrw) / p.signalPriceKrw * 100).toFixed(2));
      p.lastUpdatedAt = now.toISOString();
      updated++;
    } catch {
      skipped++;
    }
  }

  saveGhostPortfolio(all);
  return { updated, closed, skipped };
}

export interface GhostComparison {
  ghostAvgReturnPct: number;
  ghostCount:        number;
  /** 비교 대상 실제 포지션 평균 수익률 (주입 필요) */
  realAvgReturnPct:  number;
  /** ghost − real (>0 = 시스템이 너무 보수적) */
  divergencePct:     number;
  verdict:           'FILTER_TOO_CONSERVATIVE' | 'FILTER_OK' | 'FILTER_TOO_AGGRESSIVE' | 'INSUFFICIENT_DATA';
}

/** 활성 Ghost 의 평균 수익률 vs 실제 수익률 비교. 최소 표본 5건 요구. */
export function compareGhostVsReal(realAvgReturnPct: number): GhostComparison {
  const all = loadGhostPortfolio();
  const active = all.filter((p) => !p.closed && p.currentReturnPct != null);
  const ghostAvg = active.length > 0
    ? active.reduce((s, p) => s + (p.currentReturnPct ?? 0), 0) / active.length
    : 0;
  const ghostAvgReturnPct = Number(ghostAvg.toFixed(2));
  const divergencePct = Number((ghostAvgReturnPct - realAvgReturnPct).toFixed(2));

  let verdict: GhostComparison['verdict'];
  if (active.length < 5) {
    verdict = 'INSUFFICIENT_DATA';
  } else if (divergencePct > 2) {
    verdict = 'FILTER_TOO_CONSERVATIVE';
  } else if (divergencePct < -2) {
    verdict = 'FILTER_TOO_AGGRESSIVE';
  } else {
    verdict = 'FILTER_OK';
  }

  return {
    ghostAvgReturnPct,
    ghostCount: active.length,
    realAvgReturnPct: Number(realAvgReturnPct.toFixed(2)),
    divergencePct,
    verdict,
  };
}
