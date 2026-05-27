// @responsibility scanTriggerLock — 수동(텔레그램) 풀스캔 중복 트리거 방지 락 + 백그라운드 실행 래퍼.
//
// /scan·/scan_blockers 가 runAutoSignalScan 을 동기로 await 하면 장중 6단계 파이프라인이
// 텔레그램 응답을 수 초~수십 초 막는다. 본 모듈은 풀스캔을 백그라운드로 띄우고 in-progress
// 락으로 중복 누적을 막아 명령 응답을 즉시 반환하게 한다. Gate 로직·provider 호출·KIS quota
// 무변경 (byte-equivalent) — runAutoSignalScan 본체는 그대로 호출만 한다.
import { runAutoSignalScan } from '../trading/signalScanner.js';

let _scanInProgress = false;
let _scanStartedAt = 0;

export function isManualScanInProgress(): boolean {
  return _scanInProgress;
}

export function getManualScanStartedAt(): number {
  return _scanStartedAt;
}

export interface TriggerScanResult {
  /** 이번 호출이 새 스캔을 시작했는가. */
  started: boolean;
  /** 이미 진행 중이라 중복 시작을 생략했는가. */
  alreadyRunning: boolean;
}

/**
 * 풀스캔을 백그라운드로 트리거한다. 이미 진행 중이면 중복 시작하지 않는다.
 * onDone/onError 는 시작에 성공한 호출(started=true)에 한해 완료 시점에 실행된다
 * (텔레그램 결과 push 용). 진행 중이라 스킵된 호출에는 콜백이 붙지 않는다.
 */
export function triggerScanInBackground(opts?: {
  onDone?: () => void | Promise<void>;
  onError?: (err: unknown) => void | Promise<void>;
}): TriggerScanResult {
  if (_scanInProgress) {
    return { started: false, alreadyRunning: true };
  }
  _scanInProgress = true;
  _scanStartedAt = Date.now();
  void (async () => {
    try {
      await runAutoSignalScan();
      if (opts?.onDone) await opts.onDone();
    } catch (err) {
      console.error('[scanTriggerLock] background scan failed:', err);
      if (opts?.onError) await opts.onError(err);
    } finally {
      _scanInProgress = false;
    }
  })();
  return { started: true, alreadyRunning: false };
}
