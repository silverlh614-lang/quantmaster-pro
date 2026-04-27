// @responsibility dartRouter 서버 라우터 모듈
// server/routes/dartRouter.ts
// DART 공시 API 프록시 라우터 — server.ts에서 분리
// 공시 목록, 재무제표, 법인코드 검색
import { Router, Request, Response } from 'express';
import { getDartAlerts } from '../persistence/dartRepo.js';

const router = Router();

const getDartKey = () => {
  if (!process.env.DART_API_KEY) throw new Error('DART_API_KEY 미설정');
  return process.env.DART_API_KEY;
};

// ─── DART 공시 목록 Proxy (최근 공시 리스트, Search 대체) ──────────────────────
router.get('/list', async (req: Request, res: Response) => {
  try {
    const key = getDartKey();
    const { bgn_de, end_de, pblntf_ty = 'B001' } = req.query;
    if (!bgn_de || !end_de) return res.status(400).json({ error: 'bgn_de, end_de required' });
    const url = `https://opendart.fss.or.kr/api/list.json` +
      `?crtfc_key=${key}` +
      `&bgn_de=${bgn_de}&end_de=${end_de}` +
      `&pblntf_ty=${pblntf_ty}&sort=rcp_dt&sort_mth=desc&page_count=40`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await r.json();
    res.json(data);
  } catch (error: any) {
    const status = error.message === 'DART_API_KEY 미설정' ? 500 : 500;
    res.status(status).json({ error: error.message === 'DART_API_KEY 미설정' ? 'DART_API_KEY is not set' : 'DART list fetch failed', details: error.message });
  }
});

// ─── DART 재무제표 Proxy ────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const key = getDartKey();
    const { corp_code, bsns_year, reprt_code, fs_div } = req.query;
    const url = `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json` +
      `?crtfc_key=${key}` +
      `&corp_code=${corp_code}&bsns_year=${bsns_year}` +
      `&reprt_code=${reprt_code}&fs_div=${fs_div}`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    console.error("DART Proxy Error:", error);
    res.status(500).json({ error: error.message === 'DART_API_KEY 미설정' ? 'DART_API_KEY is not set' : 'Failed to fetch from DART', details: error.message });
  }
});

// ─── DART 법인코드 검색 프록시 ──────────────────────────────────────────────
router.get('/company', async (req: Request, res: Response) => {
  try {
    const key = getDartKey();
    const { stock_code } = req.query;
    const url = `https://opendart.fss.or.kr/api/company.json` +
      `?crtfc_key=${key}&stock_code=${stock_code}`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    console.error("DART Company Proxy Error:", error);
    res.status(500).json({ error: error.message === 'DART_API_KEY 미설정' ? 'DART_API_KEY is not set' : 'Failed to fetch company info from DART', details: error.message });
  }
});

// ─── DART LLM 인텔리전스 결과 조회 ──────────────────────────────────────────
// LLM 임팩트 분류, 내부자 매수 감지, 악재 소화 완료 포함한 최근 공시 반환
router.get('/intel', (_req: Request, res: Response) => {
  try {
    const alerts = getDartAlerts();
    res.json(alerts);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load DART intel', details: error.message });
  }
});

export default router;
