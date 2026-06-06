// @responsibility dartRouter 서버 라우터 모듈
// server/routes/dartRouter.ts
// DART 공시 API 프록시 라우터 — server.ts에서 분리
// 공시 목록, 재무제표, 법인코드 검색
import { Router, Request, Response } from 'express';
import { getDartAlerts } from '../persistence/dartRepo.js';
import {
  resolveDartCorpCodeFromCache,
  ensureDartCorpCodeMasterCache,
} from '../trading/gate2/dartCorpCodeMasterCache.js';

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

// ─── DART 법인코드 검색 — stock_code → corp_code 해석 (corpCode.xml 마스터 캐시) ──────────
// DART company.json 은 corp_code(8자리) 필수라, stock_code 직결 시 status '100'
// "필수값(corp_code)이 누락" 을 반환했다(사용자 prod 보고). 클라 fetchCorpCode 는 status '000'+
// corp_code 를 기대하므로 항상 null → fetchDartFinancials 미호출 → DART 게이트 조건 전부 0 결함.
// 해결: corpCode 마스터(corpCode.xml, 72h 캐시, index.ts bootstrap)에서 stock_code→corp_code 해석.
router.get('/company', async (req: Request, res: Response) => {
  try {
    const raw = typeof req.query.stock_code === 'string' ? req.query.stock_code : '';
    if (raw.replace(/[^0-9]/g, '').length === 0) {
      return res.status(400).json({ status: '400', message: 'stock_code(숫자)가 필요합니다', corp_code: null });
    }
    let resolved = resolveDartCorpCodeFromCache(raw); // resolver 가 6자리 정규화
    if (resolved.status === 'CACHE_MISSING') {
      // 캐시 미적재(부트스트랩 전/실패) — 1회 적재 시도 후 재해석.
      await ensureDartCorpCodeMasterCache();
      resolved = resolveDartCorpCodeFromCache(raw);
    }
    if (resolved.status === 'FOUND' && resolved.corpCode) {
      return res.json({
        status: '000',
        corp_code: resolved.corpCode,
        corp_name: resolved.corpName ?? '',
        stock_code: resolved.stockCode ?? '',
        source: 'DART_CORPCODE_MASTER',
      });
    }
    // 미발견/캐시부재 — 클라가 status!=='000' 으로 null 처리. 진단용 reason 동봉.
    return res.json({
      status: resolved.status === 'NOT_FOUND' ? '013' : '900',
      message: resolved.reason,
      corp_code: null,
    });
  } catch (error: any) {
    console.error('DART Company Resolve Error:', error);
    res.status(500).json({ status: '900', error: 'Failed to resolve corp_code', details: error?.message, corp_code: null });
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
