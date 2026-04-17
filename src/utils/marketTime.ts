/**
 * 한국 정규장 판정 유틸.
 *
 * 서버·클라이언트 공용으로 쓸 수 있게 Date 객체만 입력받는 순수 함수로 작성.
 * 타임존 변환은 UTC + 9h 오프셋으로 처리 (브라우저 로컬타임 의존 제거).
 */

/** 한국 정규장(평일 09:00 ~ 15:30 KST) 여부 */
export function isMarketOpen(now: Date = new Date()): boolean {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  const day = kst.getUTCDay(); // 0=일, 6=토
  if (day === 0 || day === 6) return false;
  const mins = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return mins >= 9 * 60 && mins < 15 * 60 + 30;
}
