// @responsibility krxClient ENV/URL/BLD 상수 SSOT + KIS 모드 분기 헬퍼
/**
 * krxClient/constants.ts — ADR-0502c 도메인 SSOT.
 *
 * process.env 직접 접근을 한 파일로 격리. 다른 모듈은 함수/상수 import 만 사용.
 *
 * 환경변수 계약:
 *   KRX_PUBLIC_API_BASE  — 공개 엔드포인트 (default `http://data.krx.co.kr`)
 *   KRX_API_BASE         — 레거시 호환 (data.krx.co.kr 호스트면 수용)
 *   KRX_API_DISABLED     — true 면 호출 없이 즉시 빈 배열
 *   KRX_BLD_INVESTOR_TRADING / KRX_BLD_PER_PBR / KRX_BLD_SHORT_BALANCE /
 *   KRX_BLD_INVESTOR_DETAIL — bld 식별자 override (KRX 리뉴얼 대비)
 *   KIS_FIRST_REBUILD_MODE / KIS_ONLY_REBUILD_MODE / KRX_AUTO_FETCH_DISABLED
 *     — KIS 우선 모드. KRX 자동 fetch suppression.
 */

// ── URL/Path 상수 ────────────────────────────────────────────────────────────
// KRX_PUBLIC_API_BASE 가 우선. 블루프린트에서 KRX_API_BASE 는 인증 OpenAPI 를 가리키므로,
// 동일한 변수로 두 엔드포인트를 함께 오버라이드할 수 없다. 과거 배포에서 KRX_API_BASE 가
// data.krx.co.kr(공개) 호스트를 담고 있던 경우에만 레거시 호환으로 수용한다.
const _legacyKrxBase = (process.env.KRX_API_BASE ?? '').trim();
const _legacyPublic =
  /data\.krx\.co\.kr(?!.*\/svc\/apis)/.test(_legacyKrxBase) ? _legacyKrxBase : '';

export const KRX_BASE =
  (process.env.KRX_PUBLIC_API_BASE ?? _legacyPublic) || 'http://data.krx.co.kr';
export const KRX_JSON_PATH = '/comm/bldAttendant/getJsonData.cmd';
export const KRX_OTP_PATH = '/comm/fileDn/GenerateOTP/generate.cmd';
export const KRX_DOWNLOAD_CSV_PATH = '/comm/fileDn/download_csv/download.cmd';
export const KRX_DISABLED = process.env.KRX_API_DISABLED === 'true';

// ── 타임아웃·캐시 TTL ────────────────────────────────────────────────────────
export const REQUEST_TIMEOUT_MS = 8_000;
export const CACHE_TTL_MS = 10 * 60 * 1000;

// ── bld 식별자 ───────────────────────────────────────────────────────────────
// KRX 정보데이터시스템 페이지 내부 키. KRX 리뉴얼 시 바뀔 수 있어 환경변수로 오버라이드 가능.
export const BLD_INVESTOR_TRADING =
  process.env.KRX_BLD_INVESTOR_TRADING ?? 'dbms/MDC/STAT/standard/MDCSTAT02203';
export const BLD_PER_PBR =
  process.env.KRX_BLD_PER_PBR ?? 'dbms/MDC/STAT/standard/MDCSTAT03501';
export const BLD_SHORT_BALANCE =
  process.env.KRX_BLD_SHORT_BALANCE ?? 'dbms/MDC/STAT/srt/MDCSTAT30001';

/**
 * ADR-0141 Stage 1: KRX 11분류 투자자별 매매 BLD.
 * default `MDCSTAT02301` 추정 — 운영 환경 첫 호출 시 검증 필수.
 * 미작동 시 `KRX_BLD_INVESTOR_DETAIL` ENV 즉시 override.
 */
export const BLD_INVESTOR_DETAIL =
  process.env.KRX_BLD_INVESTOR_DETAIL ?? 'dbms/MDC/STAT/standard/MDCSTAT02301';

// ── User-Agent ───────────────────────────────────────────────────────────────
export const KRX_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ── KIS 모드 분기 헬퍼 ───────────────────────────────────────────────────────

export function isKrxAutoFetchDisabled(): boolean {
  return process.env.KIS_ONLY_REBUILD_MODE === 'true' || process.env.KIS_FIRST_REBUILD_MODE === 'true' || process.env.KRX_AUTO_FETCH_DISABLED === 'true';
}

export function krxAutoFetchDisabledReason(): string {
  return process.env.KIS_ONLY_REBUILD_MODE === 'true'
    ? 'KIS_ONLY_REBUILD'
    : process.env.KIS_FIRST_REBUILD_MODE === 'true'
      ? 'KIS_FIRST_REBUILD_MODE'
      : 'KRX_AUTO_FETCH_DISABLED';
}

export function isKrxAutomaticFetchDisabled(): boolean {
  return isKrxAutoFetchDisabled();
}

export function isKisFirstRebuildMode(): boolean {
  return process.env.KIS_FIRST_REBUILD_MODE === 'true';
}

function isKisOnlyRebuildMode(): boolean {
  return process.env.KIS_ONLY_REBUILD_MODE === 'true';
}

export function krxDisabledStatus(): 'DISABLED_BY_KIS_FIRST_MODE' | 'DISABLED_BY_KIS_ONLY_MODE' {
  return isKisOnlyRebuildMode() ? 'DISABLED_BY_KIS_ONLY_MODE' : 'DISABLED_BY_KIS_FIRST_MODE';
}

export function krxDisabledReasonMessage(): string {
  return isKisOnlyRebuildMode()
    ? 'KIS_ONLY_REBUILD disables KRX fallback'
    : 'KIS-first mode; KRX retained for manual validation only';
}

// ── ADR-0009 / ADR-0259 회로 임계 ────────────────────────────────────────────
export const BLD_FAILURE_THRESHOLD = 5;
export const BLD_KIS_FIRST_QUARANTINE_THRESHOLD = 2;
export const BLD_COOLDOWN_MS = 60 * 60 * 1000; // 1시간
export const RECOVERY_PROBE_WINDOW_MS = 30 * 60 * 1000; // 30분
