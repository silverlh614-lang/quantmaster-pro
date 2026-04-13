// server/routes/kisRouter.ts
// KIS (한국투자증권) API 라우터 — server.ts에서 분리
import { Router } from 'express';
import { kisGet, kisPost, BUY_TR_ID, CCLD_TR_ID, getKisToken, getKisBase, getKisTokenRemainingHours } from '../clients/kisClient.js';

const router = Router();

// [KIS-1] 외국인/기관 수급
router.get('/supply', async (req: any, res: any) => {
  const { code } = req.query;
  if (!process.env.KIS_APP_KEY) return res.status(500).json({ error: 'KIS_APP_KEY 미설정' });
  if (!code) return res.status(400).json({ error: 'code 파라미터 필요' });
  try {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0].replace(/-/g, '');
    const data = await kisGet(
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
    const data = await kisGet(
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
    const data = await kisGet(
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
    res.json({ valid: !!token, expiresIn: `${remaining}h` });
  } catch (e: any) {
    res.json({ valid: false, reason: e.message });
  }
});

// [KIS-Balance] 모의계좌 잔고 조회 (체크리스트 Step 3)
router.get('/balance', async (_req: any, res: any) => {
  if (!process.env.KIS_APP_KEY) return res.status(500).json({ error: 'KIS_APP_KEY 미설정' });
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
router.get('/holdings', async (_req: any, res: any) => {
  if (!process.env.KIS_APP_KEY) return res.status(500).json({ error: 'KIS_APP_KEY 미설정' });
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

// [KIS-Generic] 범용 KIS API 프록시 — App Secret은 서버 메모리에서만 존재
router.post('/proxy', async (req: any, res: any) => {
  if (!process.env.KIS_APP_KEY) return res.status(500).json({ error: 'KIS_APP_KEY 미설정' });
  try {
    const token = await getKisToken();
    const base = getKisBase();
    const { path, method = 'GET', headers = {}, body, params } = req.body;

    let url = `${base}${path}`;
    if (params && Object.keys(params).length > 0) {
      url += `?${new URLSearchParams(params)}`;
    }

    const kisRes = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY!,
        appsecret: process.env.KIS_APP_SECRET!,
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await kisRes.text();
    if (!text || text.trim() === '') {
      return res.json({ rt_cd: '1', msg1: '빈 응답 (장 외 시간일 수 있음)' });
    }
    try {
      res.json(JSON.parse(text));
    } catch {
      res.status(502).json({ error: 'KIS 응답 파싱 실패', raw: text.substring(0, 200) });
    }
  } catch (e: any) {
    console.error('KIS proxy error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
