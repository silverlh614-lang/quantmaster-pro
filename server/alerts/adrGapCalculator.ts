/**
 * @responsibility [DEPRECATED ADR-0004] Yahoo ADR 역산 비활성 stub - preMarketGapProbe 로 대체됨
 *
 * @deprecated ADR-0004 — Yahoo ADR 역산 폐기.
 *
 * 배경: Yahoo OTC 의 PKX/SSNLF/SKM 종가는 상장폐지·거래량 고갈·adrRatio 소수 오차로
 * 인해 한국 개장 전 이론시가를 -93.69% 같은 비현실적 괴리로 출력했다.
 * (ADR-0004 "Yahoo ADR 역산 폐기 · KIS 전일종가 기반 Overnight Gap Probe 도입" 참조)
 *
 * 대체: `server/trading/preMarketGapProbe.ts` — KIS 전일종가 기반 갭 계산.
 *
 * 본 파일은 호출처(engineRouter / alertJobs / GlobalSignalsPanel)가 일시적으로
 * 살아있기 때문에 시그니처만 유지한 채 내부 로직을 제거했다. 다음 PR 에서 호출처
 * 제거 후 파일 자체도 삭제한다.
 *
 * 모든 export 는 null / 빈 결과를 즉시 반환한다.
 */

// ── 타입 (호출처 하위호환 유지) ────────────────────────────────────────────────

export interface AdrTarget {
  krxSymbol: string;
  adrSymbol: string;
  koreanName: string;
  sector:     string;
  adrRatio:   number;
}

export interface AdrGapResult {
  krxSymbol:        string;
  adrSymbol:        string;
  koreanName:       string;
  sector:           string;
  krxClose:         number;
  adrClose:         number;
  usdKrw:           number;
  theoreticalOpen:  number;
  gapPct:           number;
  significance:     'HIGH' | 'MEDIUM' | 'LOW';
  direction:        'UP' | 'DOWN';
}

interface AdrGapState {
  lastSentAt: string;
  lastGaps:   Record<string, number>;
}

// 하위 호환 — 기존 import 경로에서 참조될 수 있으므로 빈 배열로 유지.
export const DEFAULT_ADR_TARGETS: AdrTarget[] = [];

/**
 * @deprecated ADR-0004. 항상 null 반환.
 * 호출처(engineRouter.ts `safe(getLatestAdrGapState)`)는 이미 null safe.
 */
export function getLatestAdrGapState(): AdrGapState | null {
  return null;
}

/**
 * @deprecated ADR-0004. 항상 빈 배열 반환하며 Telegram/DB 쓰기 없음.
 * 호출처(alertJobs.ts cron '35 23 * * 0-4')는 이 no-op 을 안전하게 흡수한다.
 */
export async function runAdrGapScan(
  _targets: AdrTarget[] = DEFAULT_ADR_TARGETS,
): Promise<AdrGapResult[]> {
  // ADR-0004: Yahoo ADR 역산 비활성. preMarketGapProbe.ts 로 대체됨.
  return [];
}
