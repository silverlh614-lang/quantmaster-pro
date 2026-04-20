/**
 * @responsibility 9개 자동매매 서브라우터를 단일 마운트 포인트로 결합한 barrel 라우터
 *
 * server/index.ts 에서 `app.use('/api', autoTradeRouter)` 한 줄로 9개 도메인을
 * 일괄 등록한다. 각 서브라우터는 `./autoTrade/*Router.ts` 에 도메인별로 분리되어 있다.
 *
 * 도메인 구성:
 *   engine     — 엔진 상태/토글/SSE/비상정지 + alerts/feed
 *   macro      — Macro state·refresh + FSS records/score
 *   watchlist  — 자동매매 + 장중 워치리스트 CRUD
 *   shadow     — Shadow trades + 성과/계좌/현재가/재조정
 *   screener   — 스캔/드라이런/스크리너/populate/DART
 *   learning   — 추천/실거래 준비/귀인/조건가중치/스캔피드백
 *   tranches   — 분할 매수 + OCO 주문
 *   positions  — fills 기반 포지션 집계 + Reconciliation
 *   settings   — 트레이딩 설정 + 세션 상태
 *
 * 마운트 경로는 모두 `/api` 직속(상대 경로 `/auto-trade/*`, `/macro/*`, `/shadow/*`,
 * `/fss/*`, `/real-trade/*`, `/attribution/*`, `/alerts/*`, `/session-state`).
 * 사이드 이펙트(엔진 5초 브로드캐스트, 시작 시 shadow 재조정)는 각 서브라우터의
 * 모듈 로드 시점에 1회 실행된다.
 */
import { Router } from 'express';
import engineRouter from './autoTrade/engineRouter.js';
import macroRouter from './autoTrade/macroRouter.js';
import watchlistRouter from './autoTrade/watchlistRouter.js';
import shadowRouter from './autoTrade/shadowRouter.js';
import screenerRouter from './autoTrade/screenerRouter.js';
import learningRouter from './autoTrade/learningRouter.js';
import tranchesRouter from './autoTrade/tranchesRouter.js';
import positionsRouter from './autoTrade/positionsRouter.js';
import settingsRouter from './autoTrade/settingsRouter.js';
import signalsRouter from './autoTrade/signalsRouter.js';

const router = Router();

router.use(engineRouter);
router.use(macroRouter);
router.use(watchlistRouter);
router.use(shadowRouter);
router.use(screenerRouter);
router.use(learningRouter);
router.use(tranchesRouter);
router.use(positionsRouter);
router.use(settingsRouter);
router.use(signalsRouter);

export default router;
