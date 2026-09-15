// @responsibility Fetch paginated listed-company disclosure records from OpenDART.
export interface DartDisclosureRow {
  receiptNo: string; corpCode: string; corpName: string; stockCode: string;
  market: 'Y' | 'K'; title: string; filedDate: string; firstSeenAt: string;
}
export interface DartDisclosureResult {
  rows: DartDisclosureRow[]; pages: number; complete: boolean; issue: string | null;
}
const dateKey = (value: string) => value.replace(/-/g, '');
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export async function fetchListedDartDisclosures(fromDate: string, toDate: string): Promise<DartDisclosureResult> {
  const result: DartDisclosureResult = { rows: [], pages: 0, complete: false, issue: null };
  if (!validDate(fromDate) || !validDate(toDate) || fromDate > toDate) return { ...result, issue: '조회 기간 오류' };
  const key = process.env.DART_API_KEY;
  if (!key) return { ...result, issue: 'DART 인증키 미설정' };
  const deadline = Date.now() + 20_000;
  const ids = new Set<string>();
  let invalid = 0;
  for (const market of ['Y', 'K'] as const) {
    for (let page = 1; ; page++) {
      if (page > 50 || Date.now() >= deadline) return { ...result, issue: '공시 조회 한도 도달 · 일부 페이지 미확인' };
      const params = new URLSearchParams({ crtfc_key: key, bgn_de: dateKey(fromDate), end_de: dateKey(toDate),
        corp_cls: market, last_reprt_at: 'N', sort: 'date', sort_mth: 'asc', page_count: '100', page_no: String(page) });
      try {
        const response = await fetch(`https://opendart.fss.or.kr/api/list.json?${params}`, { signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))) });
        if (!response.ok) return { ...result, issue: `DART HTTP ${response.status}` };
        const data = await response.json() as { status?: string; total_page?: number; list?: Array<Record<string, string>> };
        result.pages++;
        if (data.status === '013' && page === 1) break;
        if (data.status !== '000') return { ...result, issue: `DART 응답 오류 ${/^\d{3}$/.test(data.status ?? '') ? data.status : '형식 오류'}` };
        if (!Number.isSafeInteger(data.total_page) || data.total_page! < page || !Array.isArray(data.list) || !data.list.length) {
          return { ...result, issue: 'DART 페이지 정보 미확인' };
        }
        const seenAt = new Date().toISOString();
        for (const row of data.list) {
          const filedDate = typeof row?.rcept_dt === 'string' ? row.rcept_dt.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') : '';
          if (!row || !/^\d{14}$/.test(row.rcept_no ?? '') || !/^\d{8}$/.test(row.corp_code ?? '')
            || row.corp_cls !== market || !row.report_nm?.trim() || !row.corp_name?.trim()
            || !validDate(filedDate) || filedDate < fromDate || filedDate > toDate) { invalid++; continue; }
          if (ids.has(row.rcept_no)) continue;
          ids.add(row.rcept_no);
          result.rows.push({ receiptNo: row.rcept_no, corpCode: row.corp_code, corpName: row.corp_name.trim(),
            stockCode: row.stock_code?.trim() ?? '', market, title: row.report_nm.trim(), filedDate, firstSeenAt: seenAt });
        }
        if (page >= data.total_page!) break;
      } catch {
        // Never log an upstream URL or error message that might include the authentication key.
        return { ...result, issue: 'DART 통신 실패 또는 응답 형식 오류' };
      }
    }
  }
  return { ...result, complete: invalid === 0, issue: invalid ? `공시 필수 정보 미확인 ${invalid}건` : null };
}
