// @responsibility stock dartDataFetcher 서비스 모듈
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

/**
 * DART 재무제표에서 당기(thstrm_amount) + 전기(frmtrm_amount) 값을 함께 추출한다.
 * frmtrm_amount 는 사업보고서/분기보고서 공통으로 전년 동기 금액이 들어있으므로
 * 이것으로 netIncome 성장률을 근사한다 (주식수 큰 변동이 없다는 가정하에 EPS 성장률과 유사).
 */
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
        const findItem = (nm: string) => data.list.find((i: any) =>
          i.account_nm.replace(/\s/g, '').includes(nm.replace(/\s/g, '')) ||
          (i.account_id && i.account_id.includes(nm))
        );
        const toNum = (s?: string) => s ? parseFloat(s.replace(/,/g, '')) || 0 : 0;
        const findValue = (nm: string) => toNum(findItem(nm)?.thstrm_amount);
        const findPrior = (nm: string) => toNum(findItem(nm)?.frmtrm_amount);

        const netIncome = findValue('당기순이익');
        const priorNetIncome = findPrior('당기순이익');
        const operatingIncome = findValue('영업이익');
        const priorOperatingIncome = findPrior('영업이익');
        const revenue = findValue('매출액') || findValue('수익(매출액)') || findValue('영업수익');
        const priorRevenue = findPrior('매출액') || findPrior('수익(매출액)') || findPrior('영업수익');
        const equity = findValue('자본총계');
        const assets = findValue('자산총계');
        const liabilities = findValue('부채총계');
        const interestExpense = findValue('이자비용') || findValue('금융비용');
        const ocf = findValue('영업활동현금흐름') || findValue('영업활동으로인한현금흐름');

        const roe = equity > 0 ? (netIncome / equity) * 100 : 0;
        const debtRatio = equity > 0 ? (liabilities / equity) * 100 : 0;
        const interestCoverageRatio = interestExpense > 0 ? operatingIncome / interestExpense : (operatingIncome > 0 ? 99.9 : 0);
        const netProfitMargin = assets > 0 ? (netIncome / assets) * 100 : 0;
        // 전기 대비 당기순이익 성장률 — 주식수 변동이 작다는 가정하에 EPS 성장률의 프록시.
        const epsGrowth = priorNetIncome !== 0
          ? ((netIncome - priorNetIncome) / Math.abs(priorNetIncome)) * 100
          : 0;
        // ADR-0582: 영업이익률(영업이익/매출액) 당기·전기 — 마진 가속(#22) 객관 검증 입력.
        // 매출/전기 영업이익 부재 시 null (호출측에서 AI 값 보존).
        const operatingMargin = revenue > 0 ? (operatingIncome / revenue) * 100 : null;
        const operatingMarginPrior = priorRevenue > 0 ? (priorOperatingIncome / priorRevenue) * 100 : null;

        const result = {
          roe,
          debtRatio,
          interestCoverageRatio,
          netProfitMargin,
          epsGrowth,
          operatingMargin,
          operatingMarginPrior,
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
