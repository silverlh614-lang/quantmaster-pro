// @responsibility KIS_ONLY_REBUILD health invariants
export interface KisPriceProbeCounts {
  currentOk: number;
  currentTotal: number;
  prevCloseOk: number;
  prevCloseTotal: number;
  chartOk: number;
  chartTotal: number;
}

export function summarizeKisPriceHealth(counts: KisPriceProbeCounts): {
  status: 'OK' | 'DEGRADED';
  current: string;
  prevClose: string;
  chart: string;
} {
  const ok = counts.currentOk === counts.currentTotal
    && counts.prevCloseOk === counts.prevCloseTotal
    && counts.chartOk === counts.chartTotal
    && counts.currentTotal > 0
    && counts.prevCloseTotal > 0
    && counts.chartTotal > 0;
  return {
    status: ok ? 'OK' : 'DEGRADED',
    current: `${counts.currentOk}/${counts.currentTotal}`,
    prevClose: `${counts.prevCloseOk}/${counts.prevCloseTotal}`,
    chart: `${counts.chartOk}/${counts.chartTotal}`,
  };
}
