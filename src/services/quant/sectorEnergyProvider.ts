// @responsibility quant sectorEnergyProvider 엔진 모듈
/**
 * sectorEnergyProvider.ts (client) — /api/krx/sector-energy 프록시 + 세션 캐시.
 *
 * sectorEnergyEngine 를 연료 없이 두지 않기 위해, 서버의 KRX 집계 결과를
 * 단일 진입점에서 받아 momentumRecommendations 등 추천 경로에 공급한다.
 * 실패 시 null 반환 — 상위 경로는 "섹터 정보 없음" 으로 그대로 진행.
 */

import type { SectorEnergyInput, SectorEnergyResult } from '../../types/sectorEnergy';

export interface SectorEnergyPayload {
  inputs: SectorEnergyInput[];
  result: SectorEnergyResult;
}

interface CacheEntry {
  data: SectorEnergyPayload;
  expiresAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
let _cache: CacheEntry | null = null;
let _inflight: Promise<SectorEnergyPayload | null> | null = null;

export async function fetchSectorEnergy(): Promise<SectorEnergyPayload | null> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.data;
  if (_inflight) return _inflight;
  _inflight = (async (): Promise<SectorEnergyPayload | null> => {
    try {
      const res = await fetch('/api/krx/sector-energy');
      if (!res.ok) return null;
      const json = await res.json();
      if (!json || !Array.isArray(json.inputs) || !json.result) return null;
      const payload = json as SectorEnergyPayload;
      if (payload.inputs.length > 0) {
        _cache = { data: payload, expiresAt: Date.now() + CACHE_TTL_MS };
      }
      return payload;
    } catch {
      return null;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

export function resetSectorEnergyClientCache(): void {
  _cache = null;
  _inflight = null;
}

/**
 * 프롬프트 주입용 한 줄 요약. 결과가 없거나 입력이 빈 상태면 빈 문자열.
 * 예: "주도 섹터: 반도체(72.1), 이차전지(65.4), 방산(61.8) | 소외 섹터: 건설/부동산, 통신/유틸리티, 유통/소비재 | 계절: OCT_NOV"
 */
export function formatSectorEnergySummary(payload: SectorEnergyPayload | null): string {
  if (!payload || payload.inputs.length === 0) return '';
  const r = payload.result;
  const leading = r.leadingSectors.length > 0
    ? r.leadingSectors.map(s => `${s.name}(${s.energyScore.toFixed(1)})`).join(', ')
    : '없음';
  const lagging = r.laggingSectors.length > 0
    ? r.laggingSectors.map(s => s.name).join(', ')
    : '없음';
  return `주도 섹터: ${leading} | 소외 섹터: ${lagging} | 계절: ${r.currentSeason}`;
}
