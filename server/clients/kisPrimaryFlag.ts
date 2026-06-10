// @responsibility KIS_OHLCV_PRIMARY_ENABLED ENV 비교 단일 SSOT — 미설정=ON(KIS-first), 'false' 명시 시에만 OFF.
/**
 * kisPrimaryFlag.ts — `KIS_OHLCV_PRIMARY_ENABLED` 플래그 해석 SSOT (ADR-0561 KIS Primary 정합 정정, patch).
 *
 * 배경: 동일 플래그를 technicalQuoteRouter 는 `!== 'false'`(미설정=ON), 나머지 5 소비처
 * (prefetchedContext·closeSeriesProvider·koreanQuoteBridge·lateWinEvaluator·newsSupplyLogger)는
 * `=== 'true'`(미설정=OFF)로 반대 해석하던 불일치를 본 함수 1곳으로 통일한다.
 *
 * 통일 의미론: **미설정=ON(KIS-first)** — `.env.example` 문서 의미론 및 ADR-0561 절대불변식
 * (KIS 가능 레이어에서 Yahoo-first 금지)과 정합. 롤백은 `KIS_OHLCV_PRIMARY_ENABLED=false` 명시 1줄.
 * ADR-0157 정확 비교: 리터럴 'false' 만 OFF — 'true'/기타 문자열/미설정 전부 ON.
 *
 * 직접 `process.env.KIS_OHLCV_PRIMARY_ENABLED` 비교는 본 파일에만 허용
 * (kisPrimaryFlag.test.ts 정적 grep 가드로 고정). 의존성 0 모듈 — koreanQuoteBridge 등의
 * lazy import 그래프(flag OFF 시 screener 그래프 미로드)를 훼손하지 않는다(순환 import 불가능).
 */

/**
 * ENV 글로벌 토글 — **default ON(KIS-first)**. 'false' 일 때만 비활성(Yahoo-first 롤백).
 * KIS 실패/봉수부족 시 각 소비처의 기존 Yahoo fallback 경로는 그대로 보존된다(불변식 #6).
 */
export function isKisOhlcvPrimaryEnabled(): boolean {
  return process.env.KIS_OHLCV_PRIMARY_ENABLED !== 'false';
}
