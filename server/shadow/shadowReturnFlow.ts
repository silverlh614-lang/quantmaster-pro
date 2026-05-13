// @responsibility Shadow 사후 가격 조회 품질 추적 — provider 장애와 시장 신호 분리
import type { ReturnFlowCheck, SourceConfidence } from './shadowTypes.js';

export interface ReturnFlowMetrics {
  lookups: number;
  hits: number;
  misses: number;
  stale: number;
  pending: number;
  providerFallbackUsed: number;
  hitRate: number;
  staleRate: number;
  unresolvedCount: number;
}

export class ShadowReturnFlow {
  private readonly checks: ReturnFlowCheck[] = [];

  record(check: ReturnFlowCheck): ReturnFlowCheck {
    const sourceConfidence: SourceConfidence = check.providerFallbackUsed ? 'FALLBACK' : check.sourceConfidence;
    const normalized: ReturnFlowCheck = { ...check, sourceConfidence, marketRiskInferred: false };
    this.checks.push(normalized);
    return normalized;
  }

  safeLookup<T>(fn: () => T, fallbackCheck: Omit<ReturnFlowCheck, 'hit' | 'stale' | 'pending' | 'marketRiskInferred'>): T | undefined {
    try { return fn(); }
    catch (e) {
      this.record({ ...fallbackCheck, hit: false, stale: false, pending: true, marketRiskInferred: false, error: e instanceof Error ? e.message : String(e) });
      return undefined;
    }
  }

  metrics(): ReturnFlowMetrics {
    const lookups = this.checks.length;
    const hits = this.checks.filter((c) => c.hit).length;
    const stale = this.checks.filter((c) => c.stale).length;
    const pending = this.checks.filter((c) => c.pending).length;
    const providerFallbackUsed = this.checks.filter((c) => c.providerFallbackUsed).length;
    const misses = lookups - hits;
    return {
      lookups, hits, misses, stale, pending, providerFallbackUsed,
      hitRate: lookups === 0 ? 1 : hits / lookups,
      staleRate: lookups === 0 ? 0 : stale / lookups,
      unresolvedCount: pending + stale,
    };
  }

  list(): ReturnFlowCheck[] { return [...this.checks]; }
}

export const shadowReturnFlow = new ShadowReturnFlow();
