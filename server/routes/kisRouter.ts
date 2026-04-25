// server/routes/kisRouter.ts
// KIS (한국투자증권) API 라우터 — server.ts에서 분리
import { Router } from 'express';
import { kisGet, kisPost, realDataKisGet, BUY_TR_ID, CCLD_TR_ID, getKisToken, getKisTokenRemainingHours, HAS_REAL_DATA_CLIENT, getRealDataTokenRemainingHours, isKisBalanceQueryAllowed } from '../clients/kisClient.js';
import { getRanking, type RankingType } from '../clients/kisRankingClient.js';
import { evaluateProxyPolicy } from './kisProxyPolicy.js';

const router = Router();

// [KIS-Ranking] 거래량/등락률/시가총액/기관순매수/공매도잔고/대량거래 상위 종목 조회
// 아이디어 5: googleSearch "지금 뜨는 종목" 질문을 순위 TR 6종으로 대체.
router.get('/ranking', async (req: any, res: any) => {
  const type = (req.query.type as string) ?? 'volume';
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 20));
  const ALLOWED: RankingType[] = [
    'volume', 'fluctuation', 'market-cap',
    'institutional-net-buy', 'short-balance', 'large-volume',
  ];
  if (!ALLOWED.includes(type as RankingType)) {
    return res.status(400).json({
      error: `type은 ${ALLOWED.join('|')} 중 하나`,
    });
  }
  try {
    const data = await getRanking(type as RankingType, { limit });
    res.json({ type, count: data.length, items: data });
  } catch (e: any) {
    console.error(`KIS ranking(${type}) error:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// [KIS-1] 외국인/기관 수급
router.get('/supply', async (req: any, res: any) => {
  const { code } = req.query;
  if (!process.env.KIS_APP_KEY) return res.status(500).json({ error: 'KIS_APP_KEY 미설정' });
  if (!code) return res.status(400).json({ error: 'code 파라미터 필요' });
  try {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0].replace(/-/g, '');
    const data = await realDataKisGet(
      'FHKST01010900',
      '/uapi/domestic-stock/v1/quotations/investor',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: code as string,
        FID_BEGIN_DATE: weekAgo,
        FID_END_DATE: today,
      }
    );
    res.json(data);
  } catch (e: any) {
    console.error('KIS supply error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// [KIS-2] 공매도 현황
router.get('/short-selling', async (req: any, res: any) => {
  const { code } = req.query;
  if (!process.env.KIS_APP_KEY) return res.status(500).json({ error: 'KIS_APP_KEY 미설정' });
  if (!code) return res.status(400).json({ error: 'code 파라미터 필요' });
  try {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0].replace(/-/g, '');
    const data = await realDataKisGet(
      'FHKST01010100',
      '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: code as string,
        FID_INPUT_DATE_1: monthAgo,
        FID_INPUT_DATE_2: today,
        FID_PERIOD_DIV_CODE: 'D',
        FID_ORG_ADJ_PRC: '0',
      }
    );
    res.json(data);
  } catch (e: any) {
    console.error('KIS short-selling error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// [KIS-3] 현재가 (Yahoo 폴백용)
router.get('/price', async (req: any, res: any) => {
  const { code } = req.query;
  if (!process.env.KIS_APP_KEY) return res.status(500).json({ error: 'KIS_APP_KEY 미설정' });
  if (!code) return res.status(400).json({ error: 'code 파라미터 필요' });
  try {
    const data = await realDataKisGet(
      'FHKST01010100',
      '/uapi/domestic-stock/v1/quotations/inquire-price',
      { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code as string }
    );
    res.json(data);
  } catch (e: any) {
    console.error('KIS price error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// [KIS-0] 토큰 상태 확인 (체크리스트 Step 1)
router.get('/token-status', async (_req: any, res: any) => {
  if (!process.env.KIS_APP_KEY) return res.json({ valid: false, reason: 'KIS_APP_KEY 미설정' });
  try {
    const token = await getKisToken();
    const remaining = getKisTokenRemainingHours();
    const result: Record<string, unknown> = {
      valid: !!token,
      expiresIn: `${remaining}h`,
    };
    // 실계좌 데이터 전용 토큰 상태 추가
    if (HAS_REAL_DATA_CLIENT) {
      result.realDataClient = {
        configured: true,
        tokenExpiresIn: `${getRealDataTokenRemainingHours()}h`,
      };
    } else {
      result.realDataClient = { configured: false };
    }
    res.json(result);
  } catch (e: any) {
    res.json({ valid: false, reason: e.message });
  }
});

// [KIS-Balance] 모의계좌 잔고 조회 (체크리스트 Step 3)
// KIS 서버 점검(KST 02:00~07:00) · 장외(16:00~) 시간대에는 실호출을 피하고
// 빈 응답을 돌려준다 — 프론트 폴링(60s)이 이 시간대에 500을 반복하지 않도록.
router.get('/balance', async (_req: any, res: any) => {
  if (!process.env.KIS_APP_KEY) return res.status(500).json({ error: 'KIS_APP_KEY 미설정' });
  if (!isKisBalanceQueryAllowed()) {
    return res.json({ rt_cd: '0', msg1: 'KIS 점검/장외 시간 — 실호출 스킵', output1: [], output2: [] });
  }
  try {
    const isReal = process.env.KIS_IS_REAL === 'true';
    const trId = isReal ? 'TTTC8434R' : 'VTTC8434R';
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
    });
    res.json(data);
  } catch (e: any) {
    console.error('KIS balance error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// [KIS-Holdings] 보유 종목 목록 조회 (잔고 inquire-balance output1)
// 점검/장외 시간대에는 빈 배열을 반환 (balance 라우트와 동일한 이유).
router.get('/holdings', async (_req: any, res: any) => {
  if (!process.env.KIS_APP_KEY) return res.status(500).json({ error: 'KIS_APP_KEY 미설정' });
  if (!isKisBalanceQueryAllowed()) {
    return res.json([]);
  }
  try {
    const isReal = process.env.KIS_IS_REAL === 'true';
    const trId = isReal ? 'TTTC8434R' : 'VTTC8434R';
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
    });
    const holdings = (data as any)?.output1 ?? [];
    const filtered = holdings.filter((h: any) => Number(h.hldg_qty ?? 0) > 0);
    res.json(filtered);
  } catch (e: any) {
    console.error('KIS holdings error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// [KIS-TestOrder] 소액 주문 테스트 — 서버 계좌 정보 사용 (체크리스트 Step 4)
router.post('/order/test', async (_req: any, res: any) => {
  if (!process.env.KIS_APP_KEY) return res.status(500).json({ error: 'KIS_APP_KEY 미설정' });
  if (!process.env.KIS_ACCOUNT_NO) return res.status(500).json({ error: 'KIS_ACCOUNT_NO 미설정' });
  try {
    const priceData = await kisGet(
      'FHKST01010100',
      '/uapi/domestic-stock/v1/quotations/inquire-price',
      { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: '005930' },
    );
    const currentPrice: string = (priceData as any)?.output?.stck_prpr ?? '0';

    const orderData = await kisPost(BUY_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
      CANO:            process.env.KIS_ACCOUNT_NO!,
      ACNT_PRDT_CD:    process.env.KIS_ACCOUNT_PROD ?? '01',
      PDNO:            '005930',
      ORD_DVSN:        '01',
      ORD_QTY:         '1',
      ORD_UNPR:        '0',
      SLL_BUY_DVSN_CD: '02',
      CTAC_TLNO:       '',
      MGCO_APTM_ODNO:  '',
      ORD_SVR_DVSN_CD: '0',
    });

    const rtCd = (orderData as any)?.rt_cd;
    if (rtCd !== '0') {
      const msg = (orderData as any)?.msg1 ?? '주문 실패';
      return res.status(400).json({ rt_cd: rtCd ?? '1', msg1: msg });
    }

    res.json({
      rt_cd: '0',
      output: { ORD_NO: (orderData as any)?.output?.ODNO ?? '' },
      currentPrice,
    });
  } catch (e: any) {
    console.error('KIS test order error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// [KIS-TodayFills] 당일 체결 내역 조회 — 서버 계좌 정보 사용 (체크리스트 Step 5)
router.get('/fills/today', async (req: any, res: any) => {
  if (!process.env.KIS_APP_KEY) return res.status(500).json({ error: 'KIS_APP_KEY 미설정' });
  const code = (req.query.code as string) ?? '';
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  try {
    const data = await kisGet(CCLD_TR_ID, '/uapi/domestic-stock/v1/trading/inquire-daily-ccld', {
      CANO:             process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD:     process.env.KIS_ACCOUNT_PROD ?? '01',
      INQR_STRT_DT:     today,
      INQR_END_DT:      today,
      SLL_BUY_DVSN_CD:  '00',
      INQR_DVSN:        '00',
      PDNO:             code,
      CCLD_DVSN:        '00',
      ORD_GNO_BRNO:     '',
      ODNO:             '',
      INQR_DVSN_3:      '00',
      INQR_DVSN_1:      '',
      CTX_AREA_FK100:   '',
      CTX_AREA_NK100:   '',
    });
    res.json((data as any)?.output1 ?? []);
  } catch (e: any) {
    console.error('KIS fills error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// [KIS-Generic] 범용 KIS API 프록시 — kisClient 단일 통로 강화 (PR-42 M2).
// 이전: raw fetch() 로 토큰만 사용해 KIS REST 직접 호출 → 회로차단기/24h 블랙리스트/
// jitter backoff/idempotency 가드 우회. 클라이언트가 임의 path/headers/body 로
// 주문 TR 호출 가능 (절대 규칙 #4 위배 위험).
//
// 현재: evaluateProxyPolicy 가 화이트리스트(read-only quote/balance) + 주문 TR
// 블랙리스트 검증 후 kisGet/kisPost 경유로 라우팅 → kisClient 의 모든 안전장치
// 자동 적용. 회로 OPEN 시 throw → 503 응답.
router.post('/proxy', async (req: any, res: any) => {
  if (!process.env.KIS_APP_KEY) return res.status(500).json({ error: 'KIS_APP_KEY 미설정' });

  const { path, method = 'GET', headers = {}, body, params } = req.body ?? {};
  const trId = typeof headers === 'object' && headers !== null
    ? (headers as Record<string, unknown>).tr_id ?? (headers as Record<string, unknown>).TR_ID
    : undefined;

  const policy = evaluateProxyPolicy({ method, path, trId });
  if (policy.action === 'reject') {
    return res.status(policy.httpStatus ?? 403).json({
      error: 'KIS proxy policy reject',
      reason: policy.reason,
    });
  }

  const upperMethod = String(method).toUpperCase() as 'GET' | 'POST';
  try {
    const result: unknown = upperMethod === 'GET'
      ? await kisGet(String(trId), String(path), (params ?? {}) as Record<string, string>, 'LOW')
      : await kisPost(String(trId), String(path), (body ?? {}) as Record<string, string>, 'LOW');
    res.json(result);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    // kisClient throw 의 회로 OPEN/블랙리스트는 503 으로 매핑 (호출자 재시도 힌트).
    if (typeof msg === 'string' && (msg.includes('회로') || msg.includes('블랙리스트') || msg.includes('Circuit'))) {
      return res.status(503).json({ error: 'KIS 회로 OPEN', reason: msg });
    }
    console.error('KIS proxy error:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
