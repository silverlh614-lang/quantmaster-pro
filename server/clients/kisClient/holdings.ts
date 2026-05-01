/**
 * @responsibility KIS 실계좌 잔고 조회 — 점검시간 가드 + 주문가능현금·보유 종목
 *
 * ADR-0135 (PR-Refactor-3) — kisClient.ts 분해 시 잔고 조회 격리.
 * KIS 서버 정기 점검(KST 02~07)·장외(16~) 시간대 호출 차단으로 5xx 폭주 방지.
 */

import { KIS_IS_REAL } from './constants.js';
import { kisGet } from './http.js';
import { getKisOverrides } from './overrides.js';
import type { KisHolding } from './types.js';

// ─── 계좌 잔고 조회 ─────────────────────────────────────────────────────────

// KIS 실계좌 서버는 평일 KST 02:00~07:00 에 정기 점검을 돌려 이 시간대 잔고 API
// (TTTC8434R / VTTC8434R) 호출은 HTTP 500 으로 반환된다. 또한 장마감 이후(16:00~)
// 에도 장외 조회라 잔고가 불안정해 재시도 스팸이 무의미하다.
// 따라서 KST 07:00~16:00 구간에서만 실호출하고, 그 외엔 최근 캐시값을 반환한다.
let _cachedBalance: number | null = null;

/**
 * 잔고 API 를 실제로 호출해도 되는 시각인지 — KST 07:00~15:59 만 true.
 * - 02:00~06:59: KIS 서버 정기 점검 (→ 500 반복)
 * - 16:00~: 장마감 이후 (→ 장외 조회, 불안정)
 *
 * KIS_ACCOUNT_BALANCE_DISABLE=true 이면 시간대와 무관하게 항상 false — KIS 서버가
 * 영업시간에도 TTTC8434R 을 계속 500 으로 반환하는 장애 상황에서 재시도 폭주와
 * 회로차단 로그 스팸을 막기 위한 Kill-switch.
 */
export function isKisBalanceQueryAllowed(now: Date = new Date()): boolean {
  if (process.env.KIS_ACCOUNT_BALANCE_DISABLE === 'true') return false;
  const kstHour = (now.getUTCHours() + 9) % 24;
  return kstHour >= 7 && kstHour < 16;
}

export async function fetchAccountBalance(): Promise<number | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchAccountBalance) return overrides.fetchAccountBalance();

  if (!isKisBalanceQueryAllowed()) return _cachedBalance;

  const trId = KIS_IS_REAL ? 'TTTC8434R' : 'VTTC8434R';
  const data = await kisGet(trId, '/uapi/domestic-stock/v1/trading/inquire-balance', {
    CANO: process.env.KIS_ACCOUNT_NO ?? '',
    ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
    AFHR_FLPR_YN: 'N',
    OFL_YN: '',
    INQR_DVSN: '02',
    UNPR_DVSN: '01',
    FUND_STTL_ICLD_YN: 'N',
    FNCG_AMT_AUTO_RDPT_YN: 'N',
    PRCS_DVSN: '01',
    CTX_AREA_FK100: '',
    CTX_AREA_NK100: '',
  }, 'LOW');
  const cash = Number(data?.output2?.[0]?.dnca_tot_amt ?? 0);
  const balance = cash > 0 ? cash : null;
  if (balance !== null) _cachedBalance = balance;
  return balance;
}

// ─── KIS 보유 포지션 조회 (ADR-0015 — /reconcile live SSOT) ────────────────

/**
 * KIS 실잔고에서 모든 보유 포지션을 가져온다.
 *
 * 페이지네이션 대응: KIS 는 100건 초과 시 CTX_AREA_FK100/NK100 으로 분할 응답한다.
 * 본 PR 범위에서는 1페이지(100건) 만 처리 — 자동매매 동시 보유 한도가 통상 한 자리수라
 * 페이지 누락이 실무 위험이 되지 않는다. 100건 초과 시 후속 PR 에서 페이지네이션 추가.
 *
 * 반환:
 *   - `null`  : KIS 미설정·점검시간(02~07)·회로차단·5xx 등으로 조회 불가
 *   - `[]`    : 조회 성공 + 보유 포지션 없음
 *   - 배열   : 보유 포지션 정규화 결과 (hldgQty>0 만 필터)
 */
export async function fetchKisHoldings(): Promise<KisHolding[] | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchKisHoldings) return overrides.fetchKisHoldings();

  if (!isKisBalanceQueryAllowed()) return null;
  if (!process.env.KIS_APP_KEY) return null;

  const trId = KIS_IS_REAL ? 'TTTC8434R' : 'VTTC8434R';
  const data = await kisGet(trId, '/uapi/domestic-stock/v1/trading/inquire-balance', {
    CANO: process.env.KIS_ACCOUNT_NO ?? '',
    ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
    AFHR_FLPR_YN: 'N',
    OFL_YN: '',
    INQR_DVSN: '02',
    UNPR_DVSN: '01',
    FUND_STTL_ICLD_YN: 'N',
    FNCG_AMT_AUTO_RDPT_YN: 'N',
    PRCS_DVSN: '01',
    CTX_AREA_FK100: '',
    CTX_AREA_NK100: '',
  }, 'LOW');

  const output1 = (data as { output1?: Record<string, string>[] } | null)?.output1;
  if (!Array.isArray(output1)) return null;

  return output1
    .map((row): KisHolding => {
      const hldgQty = Number(row.hldg_qty ?? 0);
      const pchsAvgPric = Number(row.pchs_avg_pric ?? 0);
      const prprRaw = Number(row.prpr ?? 0);
      const evluRaw = Number(row.evlu_pfls_amt ?? 0);
      return {
        pdno: String(row.pdno ?? '').padStart(6, '0'),
        prdtName: String(row.prdt_name ?? '').trim(),
        hldgQty,
        pchsAvgPric,
        prpr: Number.isFinite(prprRaw) && prprRaw > 0 ? prprRaw : null,
        evluPflsAmt: Number.isFinite(evluRaw) ? evluRaw : null,
      };
    })
    .filter((h) => h.pdno.length === 6 && h.hldgQty > 0);
}
