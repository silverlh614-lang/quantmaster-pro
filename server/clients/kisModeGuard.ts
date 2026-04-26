// @responsibility kisModeGuard 외부 클라이언트 모듈
/**
 * kisModeGuard.ts — KIS TR_ID 와 계좌 모드(VTS vs LIVE) 호환성 검증.
 *
 * KIS 는 같은 기능이라도 실계좌 (TTTC*) / 모의계좌 (VTTC*) TR_ID 가
 * 별도다. 모의계좌 키로 실계좌 전용 TR_ID 를 호출하면 runtime 에서 조용히
 * 실패하거나 이상한 응답이 내려와 디버깅이 극히 어렵다. 이 가드는
 * **호출 시점에 즉시 throw** 하여 블라인드 실패를 선제 차단한다.
 *
 * 메모리 참조: "VTS 모의모드가 preScreenStocks TR과 비호환" 으로 기록된
 * 치명적 Blocker 버그의 원인 분류가 이 가드로 수렴한다.
 */

export class ModeIncompatibleError extends Error {
  constructor(public readonly trId: string, public readonly mode: 'LIVE' | 'VTS') {
    super(`[KIS Mode Guard] TR_ID '${trId}' 는 ${mode} 모드와 호환되지 않습니다.`);
    this.name = 'ModeIncompatibleError';
  }
}

/**
 * TR_ID 접두어로 실계좌/모의계좌 요구사항을 추론.
 *   - `TTT*` / `CTP*` → 실계좌 전용
 *   - `VTT*` / `VCP*` → 모의계좌 전용
 *   - 그 외 시장 데이터 TR (FHK*, HHD* 등) → 모드 무관
 */
function inferRequiredMode(trId: string): 'LIVE' | 'VTS' | 'ANY' {
  if (!trId) return 'ANY';
  const upper = trId.toUpperCase();
  if (upper.startsWith('VTT') || upper.startsWith('VCP')) return 'VTS';
  if (upper.startsWith('TTT') || upper.startsWith('CTP')) return 'LIVE';
  return 'ANY';
}

/**
 * 현재 프로세스 모드와 TR_ID 호환성을 검증. 불일치 시 throw.
 *
 * @param trId  호출할 KIS TR 식별자
 * @param mode  현재 계좌 모드 (KIS_IS_REAL 로부터 유도)
 */
export function assertModeCompatible(trId: string, mode: 'LIVE' | 'VTS'): void {
  const required = inferRequiredMode(trId);
  if (required === 'ANY') return;
  if (required !== mode) {
    throw new ModeIncompatibleError(trId, mode);
  }
}

/**
 * Express 요청 핸들러를 감싸는 옵션 래퍼. 라우트 레벨에서 쿼리/바디의 trId 를
 * 뽑아 검증한다. 오용 감지 시 400 + 설명 반환.
 */
export function modeGuardMiddleware(getTrId: (req: unknown) => string | undefined) {
  return (req: any, res: any, next: any) => {
    const trId = getTrId(req);
    if (!trId) return next();
    const mode: 'LIVE' | 'VTS' = process.env.KIS_IS_REAL === 'true' ? 'LIVE' : 'VTS';
    try {
      assertModeCompatible(trId, mode);
      next();
    } catch (err) {
      const e = err as ModeIncompatibleError;
      res.status(400).json({
        error: 'MODE_INCOMPATIBLE',
        trId: e.trId,
        mode: e.mode,
        message: e.message,
      });
    }
  };
}
