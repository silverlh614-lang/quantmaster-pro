// @responsibility ADR-0173 §2 ShadowLearningOnlyScan 신호 영속 SSOT — atomic write 가상 매수 판단 영속
/**
 * shadowLearningOnlySignalRepo.ts (ADR-0173 §2) — Phase 1 영속 SSOT.
 *
 * 매매 금지일 (FOMC/VIX/R0/R1/Liquidity/Manual/KRX_HOLIDAY_REPLAY/RISK_OFF) 에
 * 생성된 가상 매수 판단 샘플 (15+ 필드) 영속. atomic write tmp→rename + 손상 JSON
 * 빈 배열 fallback + FIFO 5000 trim.
 *
 * 절대 규칙 — KIS 주문 함수 import 절대 금지 (학습 전용, LIVE 주문 경로 결합 영구 차단).
 *
 * 1/3/5/20일 후 future return resolve 결과 (Phase 2 cron) 가 동일 entry 에 갱신.
 *
 * 비즈니스 로직 (`runShadowLearningOnlyScan` 등) 은 `server/trading/shadowLearningOnlyScan.ts`
 * 에 격리. 본 모듈은 read/write SSOT 만.
 */

import fs from 'fs';
import { SHADOW_LEARNING_ONLY_SIGNAL_FILE, ensureDataDir } from './paths.js';
import type { ShadowLearningOnlySignal } from '../trading/shadowLearningOnlyScan.js';

/** FIFO trim — 메모리/디스크 폭주 차단. */
export const SHADOW_LEARNING_ONLY_SIGNAL_TRIM_LIMIT = 5000;

/**
 * 영속 파일 로드.
 * - 부재 → 빈 배열
 * - 손상 JSON → 빈 배열 (운영 무중단)
 * - non-array → 빈 배열
 * - 잘못된 entry (symbol/signalDate/blockedReason 부재) 자동 제외
 */
export function loadShadowLearningOnlySignals(): ShadowLearningOnlySignal[] {
  ensureDataDir();
  if (!fs.existsSync(SHADOW_LEARNING_ONLY_SIGNAL_FILE)) return [];
  try {
    const raw = fs.readFileSync(SHADOW_LEARNING_ONLY_SIGNAL_FILE, 'utf-8');
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as unknown[]).filter((sig): sig is ShadowLearningOnlySignal => {
      if (!sig || typeof sig !== 'object') return false;
      const s = sig as Partial<ShadowLearningOnlySignal>;
      return (
        typeof s.symbol === 'string' &&
        s.symbol.length > 0 &&
        typeof s.signalDate === 'string' &&
        s.signalDate.length > 0 &&
        typeof s.blockedReason === 'string' &&
        s.blockedReason.length > 0
      );
    });
  } catch {
    return [];
  }
}

/**
 * 신호 영속 저장 — atomic write tmp → rename.
 * FIFO trim 5000 적용 (signalDate 오름차순 후 후미 N개).
 */
export function saveShadowLearningOnlySignals(
  signals: ShadowLearningOnlySignal[],
): void {
  ensureDataDir();
  let toSave = signals;
  if (signals.length > SHADOW_LEARNING_ONLY_SIGNAL_TRIM_LIMIT) {
    const sorted = [...signals].sort((a, b) => {
      // signalDate ISO 또는 YYYY-MM-DD — string 비교로 충분
      if (a.signalDate < b.signalDate) return -1;
      if (a.signalDate > b.signalDate) return 1;
      return 0;
    });
    toSave = sorted.slice(sorted.length - SHADOW_LEARNING_ONLY_SIGNAL_TRIM_LIMIT);
  }
  const tmp = `${SHADOW_LEARNING_ONLY_SIGNAL_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(toSave, null, 2), 'utf-8');
  fs.renameSync(tmp, SHADOW_LEARNING_ONLY_SIGNAL_FILE);
}

/**
 * 단일 신호 append. 동시 호출 race 방지 위해 load → push → save (FIFO trim 자동).
 */
export function appendShadowLearningOnlySignal(
  signal: ShadowLearningOnlySignal,
): void {
  const all = loadShadowLearningOnlySignals();
  all.push(signal);
  saveShadowLearningOnlySignals(all);
}

/**
 * 테스트 전용 — 영속 파일 + tmp 잔존 파일 청소.
 */
export function __resetShadowLearningOnlySignalsForTests(): void {
  try {
    if (fs.existsSync(SHADOW_LEARNING_ONLY_SIGNAL_FILE)) {
      fs.unlinkSync(SHADOW_LEARNING_ONLY_SIGNAL_FILE);
    }
    const tmp = `${SHADOW_LEARNING_ONLY_SIGNAL_FILE}.tmp`;
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  } catch {
    // ignore — 테스트 격리
  }
}
