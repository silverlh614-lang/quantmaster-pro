/**
 * @responsibility 서버 측 한국 정규장·통계확정 SSOT — ADR-0009 호출 예산 게이트
 *
 * 클라이언트의 `src/utils/marketTime.ts` 와 쌍을 이루는 서버 전용 모듈.
 * 외부 데이터 호출 앞단 게이트에서만 사용하며, 매매 엔진 자체의 스케줄은
 * 기존 scheduler 가 담당하므로 중복 확장 금지.
 *
 * env override:
 *   DATA_FETCH_FORCE_MARKET=true  — 강제 장중 (e2e/리그레션 테스트)
 *   DATA_FETCH_FORCE_OFF=true     — 강제 장외 (런북·복구 드릴)
 */

const KST_OFFSET_MS = 9 * 3_600_000;

function kstDate(now: Date): Date {
  return new Date(now.getTime() + KST_OFFSET_MS);
}

function isWeekend(kst: Date): boolean {
  const day = kst.getUTCDay();
  return day === 0 || day === 6;
}

/** KST 기준 주말(토·일) 여부 — 주말 단락·로그 분기 등 외부 사용자용 얇은 래퍼. */
export function isKstWeekend(now: Date = new Date()): boolean {
  return isWeekend(kstDate(now));
}

function toKstMinutes(kst: Date): number {
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

/** 한국 정규장(평일 09:00~15:30 KST) 여부. */
export function isMarketOpen(now: Date = new Date()): boolean {
  if (process.env.DATA_FETCH_FORCE_OFF === 'true') return false;
  if (process.env.DATA_FETCH_FORCE_MARKET === 'true') return true;
  const kst = kstDate(now);
  if (isWeekend(kst)) return false;
  const mins = toKstMinutes(kst);
  return mins >= 9 * 60 && mins < 15 * 60 + 30;
}

/**
 * KRX 일간 통계(MDCSTAT 류)가 당일 날짜로 확정되어 있는지.
 * KRX 공개 통계는 통상 15:30 마감 후 ~18:00 KST 까지 확정되므로, 그 이전에는
 * 전일 영업일 기준으로 조회해야 HTTP 400 을 피할 수 있다.
 */
export function isMarketDataPublished(now: Date = new Date()): boolean {
  if (process.env.DATA_FETCH_FORCE_OFF === 'true') return false;
  const kst = kstDate(now);
  if (isWeekend(kst)) return true; // 주말은 직전 영업일 데이터가 확정 상태로 존재
  const mins = toKstMinutes(kst);
  return mins >= 18 * 60;
}

/** 평일 장 마감 ~ 당일 통계 확정 사이 (15:30 ~ 18:00) — 통계는 아직 미확정. */
export function isPostClosePendingPublish(now: Date = new Date()): boolean {
  const kst = kstDate(now);
  if (isWeekend(kst)) return false;
  const mins = toKstMinutes(kst);
  return mins >= 15 * 60 + 30 && mins < 18 * 60;
}

/** 디버깅용 — 현재 KST 시각 요약 (로그 prefix 에 사용). */
export function describeMarketPhase(now: Date = new Date()): string {
  if (isMarketOpen(now)) return 'OPEN';
  const kst = kstDate(now);
  if (isWeekend(kst)) return 'WEEKEND';
  if (isPostClosePendingPublish(now)) return 'POST_CLOSE_PENDING';
  return 'OFF_HOURS';
}
