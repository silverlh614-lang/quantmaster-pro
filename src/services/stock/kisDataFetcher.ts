const kisCache = new Map<string, { data: any; timestamp: number }>();
const KIS_CACHE_TTL = 1000 * 60 * 60; // 1시간

export async function fetchKisSupply(code: string) {
  const key = `kis_supply_${code}`;
  const hit = kisCache.get(key);
  if (hit && Date.now() - hit.timestamp < KIS_CACHE_TTL) return hit.data;
  try {
    const res = await fetch(`/api/kis/supply?code=${code}`);
    const data = await res.json();
    if (data.rt_cd !== '0' || !data.output) return null;
    const rows: any[] = Array.isArray(data.output) ? data.output.slice(0, 5) : [];
    const foreignNet     = rows.reduce((s, r) => s + parseInt(r.frgn_ntby_qty    || '0'), 0);
    const institutionNet = rows.reduce((s, r) => s + parseInt(r.orgn_ntby_qty    || '0'), 0);
    const individualNet  = rows.reduce((s, r) => s + parseInt(r.indvdl_ntby_qty  || '0'), 0);
    let foreignConsecutive = 0;
    for (const r of rows) {
      if (parseInt(r.frgn_ntby_qty || '0') > 0) foreignConsecutive++;
      else break;
    }
    // 기관 일별 순매수 수량 시계열 (최신→과거 → reverse로 과거→최신)
    const institutionalDailyAmounts = rows.map(r => parseInt(r.orgn_ntby_qty || '0')).reverse();
    const result = {
      foreignNet, institutionNet, individualNet, foreignConsecutive,
      institutionalDailyAmounts,
      isPassiveAndActive: foreignNet > 0 && institutionNet > 0,
      dataSource: 'KIS',
    };
    kisCache.set(key, { data: result, timestamp: Date.now() });
    return result;
  } catch (e) {
    console.error(`KIS supply error (${code}):`, e);
    return null;
  }
}

export async function fetchKisShortSelling(code: string) {
  const key = `kis_short_${code}`;
  const hit = kisCache.get(key);
  if (hit && Date.now() - hit.timestamp < KIS_CACHE_TTL) return hit.data;
  try {
    const res = await fetch(`/api/kis/short-selling?code=${code}`);
    const data = await res.json();
    if (data.rt_cd !== '0' || !data.output2) return null;

    const rows = data.output2;
    if (rows.length === 0) return null;

    const recentRows = rows.slice(0, 5);
    const avgShortRatio = recentRows.reduce((s: number, r: any) => s + parseFloat(r.shrt_vol_rate || '0'), 0) / recentRows.length;

    const currentRatio = parseFloat(rows[0].shrt_vol_rate || '0');
    const prevRatio = parseFloat(rows[1]?.shrt_vol_rate || '0');
    const trend = currentRatio < prevRatio ? 'DECREASING' : (currentRatio > prevRatio ? 'INCREASING' : 'STABLE');

    const result = {
      ratio: avgShortRatio,
      trend,
      implication: avgShortRatio > 15 ? '공매도 비중 높음 (주의)' : '공매도 비중 안정적',
      dataSource: 'KIS'
    };

    kisCache.set(key, { data: result, timestamp: Date.now() });
    return result;
  } catch (e) {
    console.error(`KIS short-selling error (${code}):`, e);
    return null;
  }
}
