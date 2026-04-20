/**
 * leadershipBridge.ts — Phase 4-④ 주도주 분석 → MOMENTUM 다이내믹 레이어 브릿지.
 *
 * 장중 오케스트레이터의 "오전 주도주" 스캔 결과가 watchlist 에 자동 반영되는
 * 경로가 약해, MOMENTUM=18 슬롯이 정적 리스트에 머물던 문제를 해소한다.
 *
 * 정책:
 *   1) 후보 필터: gateScore ≥ 4.5 && MTAS ≥ 6 && sector RS ≥ KOSPI 수익률
 *   2) 승격 시 section='MOMENTUM' + leadershipBridge=true
 *   3) 4h TTL (expiresAt) — 재평가 실패 시 cleanupWatchlist 가 자동 만료
 *   4) 기존 MOMENTUM base layer 와 구분해 과부하·중복 진입 방지
 *   5) 동일 코드가 이미 SWING/CATALYST 이면 건드리지 않음 (우선순위 존중)
 */

import {
  loadWatchlist, saveWatchlist, type WatchlistEntry,
} from '../persistence/watchlistRepo.js';
import { MOMENTUM_MAX_SIZE } from './watchlistManager.js';

export const LEADERSHIP_BRIDGE_TTL_HOURS = 4;
export const LEADERSHIP_MIN_GATE = 4.5;
export const LEADERSHIP_MIN_MTAS = 6;

export interface LeaderCandidate {
  code: string;
  name: string;
  /** 실시간 gateScore (재평가 결과) — 4.5 미만이면 탈락 */
  gateScore: number;
  /** MTAS (0~10) — 6 미만이면 탈락 */
  mtas: number;
  /** 섹터 RS 또는 당일 변화율 (%) */
  sectorRelativeStrength: number;
  /** 현재가 — entryPrice/stopLoss/targetPrice 파생 기준 */
  currentPrice: number;
  sector?: string;
}

export interface LeaderQualificationContext {
  /** KOSPI 당일 수익률 (%) — 미제공 시 0 */
  kospiDayReturn?: number;
}

/**
 * 후보가 주도주 편입 자격을 갖추는지 평가 (순수 함수, 테스트 용이).
 */
export function qualifiesAsLeader(
  c: LeaderCandidate,
  ctx: LeaderQualificationContext = {},
): boolean {
  if (!Number.isFinite(c.gateScore) || c.gateScore < LEADERSHIP_MIN_GATE) return false;
  if (!Number.isFinite(c.mtas) || c.mtas < LEADERSHIP_MIN_MTAS) return false;
  const kospi = ctx.kospiDayReturn ?? 0;
  if (c.sectorRelativeStrength < kospi) return false;
  if (!Number.isFinite(c.currentPrice) || c.currentPrice <= 0) return false;
  return true;
}

export interface BridgeResult {
  added: number;
  refreshed: number;
  skippedTotal: number;
  skippedByReason: Record<string, number>;
}

function buildEntryFromLeader(c: LeaderCandidate): WatchlistEntry {
  const entryPrice  = c.currentPrice;
  const stopLoss    = Math.round(entryPrice * 0.95); // 기본 -5% (다이내믹 레이어 보수적)
  const targetPrice = Math.round(entryPrice * 1.08); // 기본 +8%
  const expiresAt = new Date(Date.now() + LEADERSHIP_BRIDGE_TTL_HOURS * 3_600_000).toISOString();
  return {
    code: c.code.padStart(6, '0'),
    name: c.name,
    entryPrice,
    stopLoss,
    targetPrice,
    addedAt: new Date().toISOString(),
    addedBy: 'AUTO',
    section: 'MOMENTUM',
    gateScore: c.gateScore,
    sector: c.sector,
    expiresAt,
    leadershipBridge: true,
    memo: 'LeadershipBridge 자동편입 (4h TTL)',
    rrr: (targetPrice - entryPrice) / Math.max(1, entryPrice - stopLoss),
  };
}

/**
 * 후보 목록을 MOMENTUM 다이내믹 레이어에 편입.
 *
 *  - 이미 SWING/CATALYST 에 있으면 건드리지 않음
 *  - 이미 MOMENTUM+leadershipBridge 인 기존 엔트리는 TTL 만 갱신 (refreshed)
 *  - base MOMENTUM (leadershipBridge 미부착) 에 이미 있으면 skip
 *  - 전체 MOMENTUM 수가 MOMENTUM_MAX_SIZE 초과하지 않도록 cap
 */
export function bridgeLeadersToMomentum(
  candidates: LeaderCandidate[],
  ctx: LeaderQualificationContext = {},
): BridgeResult {
  const result: BridgeResult = {
    added: 0, refreshed: 0, skippedTotal: 0,
    skippedByReason: {},
  };
  const bump = (reason: string) => {
    result.skippedByReason[reason] = (result.skippedByReason[reason] ?? 0) + 1;
    result.skippedTotal++;
  };

  const list = loadWatchlist();
  const byCode = new Map(list.map((w) => [w.code, w]));
  let momentumCount = list.filter((w) => w.section === 'MOMENTUM').length;

  for (const raw of candidates) {
    if (!qualifiesAsLeader(raw, ctx)) { bump('not_qualified'); continue; }
    const code = raw.code.padStart(6, '0');
    const existing = byCode.get(code);
    if (existing) {
      if (existing.section === 'SWING' || existing.section === 'CATALYST') {
        bump('already_higher_tier'); continue;
      }
      if (existing.leadershipBridge) {
        // 재평가 통과 — TTL 과 gateScore 만 갱신
        existing.expiresAt = new Date(Date.now() + LEADERSHIP_BRIDGE_TTL_HOURS * 3_600_000).toISOString();
        existing.gateScore = raw.gateScore;
        result.refreshed++;
        continue;
      }
      // base MOMENTUM 에 이미 있음 — 브릿지가 건드리지 않음 (중복 편입 방지)
      bump('base_momentum_exists'); continue;
    }

    if (momentumCount >= MOMENTUM_MAX_SIZE) {
      bump('momentum_full'); continue;
    }
    const entry = buildEntryFromLeader(raw);
    list.push(entry);
    byCode.set(code, entry);
    momentumCount++;
    result.added++;
  }

  if (result.added > 0 || result.refreshed > 0) {
    saveWatchlist(list);
    console.log(
      `[LeadershipBridge] MOMENTUM 다이내믹 편입 — 신규 ${result.added} / 갱신 ${result.refreshed} / 스킵 ${result.skippedTotal}`,
    );
  }
  return result;
}

/**
 * TTL 만료된 LeadershipBridge 엔트리 제거 — cleanupWatchlist 의 보조 경로.
 * 기존 expiresAt 기반 정리로도 충분하지만, 다이내믹 레이어를 명시적으로 끊어내고
 * 싶을 때 호출한다.
 */
export function expireBridgeEntries(): { removed: number } {
  const list = loadWatchlist();
  const now = Date.now();
  const next = list.filter((w) => {
    if (!w.leadershipBridge) return true;
    const expiry = w.expiresAt ? new Date(w.expiresAt).getTime() : 0;
    return expiry > now;
  });
  const removed = list.length - next.length;
  if (removed > 0) {
    saveWatchlist(next);
    console.log(`[LeadershipBridge] TTL 만료 ${removed}건 제거`);
  }
  return { removed };
}
