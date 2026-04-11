const dartCache = new Map<string, { data: any; timestamp: number }>();
const DART_CACHE_TTL = 1000 * 60 * 60 * 6; // 6 hours

export async function fetchCorpCode(stockCode: string): Promise<string | null> {
  const cacheKey = `corp_${stockCode}`;
  const cached = dartCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < DART_CACHE_TTL) {
    return cached.data;
  }

  try {
    const res = await fetch(`/api/dart/company?stock_code=${stockCode}`);
    const data = await res.json();
    if (data.status === '000') {
      dartCache.set(cacheKey, { data: data.corp_code, timestamp: Date.now() });
      return data.corp_code;
    }
    return null;
  } catch (error) {
    console.error('Error fetching corpCode:', error);
    return null;
  }
}

export async function fetchDartFinancials(corpCode: string) {
  const cacheKey = `fin_${corpCode}`;
  const cached = dartCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < DART_CACHE_TTL) {
    return cached.data;
  }

  try {
    const year = new Date().getFullYear();
    const lastYear = year - 1;
    // Try current year Q3 first, then last year annual
    const reportCodes = ['11014', '11011'];

    for (const reportCode of reportCodes) {
      const bsnsYear = reportCode === '11011' ? lastYear : year;
      // Using /api/dart proxy for more comprehensive data (OCF, Interest Expense)
      const url = `/api/dart?corp_code=${corpCode}&bsns_year=${bsnsYear}&reprt_code=${reportCode}&fs_div=CFS`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.status === '000' && data.list) {
        const findValue = (nm: string) => {
          const item = data.list.find((i: any) =>
            i.account_nm.replace(/\s/g, '').includes(nm.replace(/\s/g, '')) ||
            (i.account_id && i.account_id.includes(nm))
          );
          return item ? parseFloat(item.thstrm_amount.replace(/,/g, '')) : 0;
        };

        const netIncome = findValue('당기순이익');
        const operatingIncome = findValue('영업이익');
        const equity = findValue('자본총계');
        const assets = findValue('자산총계');
        const liabilities = findValue('부채총계');
        const interestExpense = findValue('이자비용') || findValue('금융비용');
        const ocf = findValue('영업활동현금흐름') || findValue('영업활동으로인한현금흐름');

        const roe = equity > 0 ? (netIncome / equity) * 100 : 0;
        const debtRatio = equity > 0 ? (liabilities / equity) * 100 : 0;
        const interestCoverageRatio = interestExpense > 0 ? operatingIncome / interestExpense : (operatingIncome > 0 ? 99.9 : 0);
        const netProfitMargin = assets > 0 ? (netIncome / assets) * 100 : 0;

        const result = {
          roe,
          debtRatio,
          interestCoverageRatio,
          netProfitMargin,
          ocfGreaterThanNetIncome: ocf > netIncome,
          updatedAt: `${bsnsYear} ${reportCode === '11011' ? '사업보고서' : '3분기보고서'}`
        };

        dartCache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
      }
    }
    return null;
  } catch (error) {
    console.error('DART API Error:', error);
    return null;
  }
}
