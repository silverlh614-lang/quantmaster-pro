// @responsibility autoTrading 서비스 모듈
/**
 * autoTrading.ts — 클라이언트사이드 수동 트리거 전용 (메인 오케스트레이터)
 *
 * ⚠️  역할 분리: 이 모듈은 UI에서 사용자가 직접 트리거하는 수동 매매 전용입니다.
 *     24시간 자동매매는 서버사이드 autoTradeEngine.ts가 단독으로 담당합니다.
 *     서버 자동매매(AUTO_TRADE_ENABLED=true)가 활성화되면
 *     이 모듈의 실주문 함수는 중복 방지를 위해 실행을 차단합니다.
 *
 * 세부 로직은 다음 서브모듈로 분리됨:
 *   kisProxy.ts          — KIS API 공통 클라이언트 헬퍼
 *   orderExecution.ts    — 아이디어 2+4+6: 신호-주문 변환, 체결확인, OCO 등록
 *   shadowTrading.ts     — 아이디어 5: Shadow Trading 모드
 *   tradeSafety.ts       — 상시 가동 안전장치 (손실한도, 최대종목수, DEFENSE 모드)
 *   timeFilter.ts        — 아이디어 7: 장중 타임 필터 + 주문 큐
 *   slippageEngine.ts    — 아이디어 8: 슬리피지 측정 & 보정 Kelly
 *   trancheEngine.ts     — 아이디어 11: 분할매수 트랜치 플랜
 *   attributionEngine.ts — 아이디어 9: Gate별 수익 귀인 분석
 *   macroSync.ts         — 레짐 파이프라인 동기화
 */

export * from './autoTrading/kisProxy';
export * from './autoTrading/orderExecution';
export * from './autoTrading/shadowTrading';
export * from './autoTrading/tradeSafety';
export * from './autoTrading/timeFilter';
export * from './autoTrading/slippageEngine';
export * from './autoTrading/trancheEngine';
export * from './autoTrading/attributionEngine';
export * from './autoTrading/macroSync';
