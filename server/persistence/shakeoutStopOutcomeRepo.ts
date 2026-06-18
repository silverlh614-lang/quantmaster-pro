// @responsibility ADR-0624 셰이크아웃 손절-후 N일 outcome 라벨 영속 repo — atomic write, RESOLVED 불변성, 주문/provider 호출 0.
/**
 * shakeoutStopOutcomeRepo.ts — ADR-0624 관측 전용 라벨 영속 SSOT.
 *
 * 실행 청산(HIT_STOP) 포지션의 손절-후 N일 수익률 라벨을 `shadow-trades.json`
 * 영속 본체와 *물리 분리*된 별도 ledger 에 영속 (ADR-0445 분리 원칙).
 *
 * 안전 invariant:
 *   - atomic write (tmp → rename) — race 안전, 손상 부분쓰기 차단.
 *   - load 시 손상 JSON → 빈 배열 `[]` fallback (시스템 무중단, 불변식 #1).
 *   - upsertLabel: tradeId 키 last-write-wins. 단 *이미 RESOLVED* 라벨은 재기입 skip
 *     (불변성 — ADR-0624 §3-6 RESOLVED 라벨 재방문 차단).
 *   - KIS 주문 함수 import 0건 — 학습 관측 전용 (정적 grep 가드).
 */

import fs from 'fs';
import { SHAKEOUT_STOP_OUTCOME_LEDGER_FILE, ensureDataDir } from './paths.js';
import type { ShakeoutStopOutcomeLabel } from '../learning/shakeoutStopForwardLabeler.js';

interface ShakeoutStopOutcomeLedgerFile {
  version: 1;
  labels: ShakeoutStopOutcomeLabel[];
}

// 일일 청산 포지션 수 대비 충분한 보관 — 10거래일(≈14달력일) 성숙 커버 + 여유.
const MAX_SHAKEOUT_OUTCOME_LABELS = 12_000;

function isLedgerFile(value: unknown): value is ShakeoutStopOutcomeLedgerFile {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Array.isArray((value as ShakeoutStopOutcomeLedgerFile).labels),
  );
}

function readLedger(filePath = SHAKEOUT_STOP_OUTCOME_LEDGER_FILE): ShakeoutStopOutcomeLedgerFile {
  ensureDataDir();
  if (!fs.existsSync(filePath)) return { version: 1, labels: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return isLedgerFile(parsed) ? parsed : { version: 1, labels: [] };
  } catch {
    // 손상 JSON → 빈 배열 fallback (시스템 무중단, 불변식 #1).
    return { version: 1, labels: [] };
  }
}

function writeLedger(
  file: ShakeoutStopOutcomeLedgerFile,
  filePath = SHAKEOUT_STOP_OUTCOME_LEDGER_FILE,
): void {
  ensureDataDir();
  // FIFO trim — 가장 오래된 라벨부터 evict (성숙 라벨 보존은 cron 빈도상 불필요).
  const labels =
    file.labels.length > MAX_SHAKEOUT_OUTCOME_LABELS
      ? file.labels.slice(file.labels.length - MAX_SHAKEOUT_OUTCOME_LABELS)
      : file.labels;
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1 as const, labels }));
  fs.renameSync(tmp, filePath);
}

/** 전체 라벨 read — 손상 시 `[]`. */
export function loadLabels(filePath = SHAKEOUT_STOP_OUTCOME_LEDGER_FILE): ShakeoutStopOutcomeLabel[] {
  return readLedger(filePath).labels;
}

export interface ShakeoutOutcomeUpsertResult {
  created: boolean;
  updated: boolean;
  /** 이미 RESOLVED 라벨 재기입 차단 (불변성). */
  resolvedSkipped: boolean;
  label: ShakeoutStopOutcomeLabel;
}

/**
 * tradeId 키 upsert — last-write-wins.
 *
 * 불변성: 기존 라벨이 `maturity==='RESOLVED'` 이면 재기입 skip (ADR-0624 §3-6).
 * 신규 라벨은 append, PENDING 기존 라벨은 교체.
 */
export function upsertLabel(
  label: ShakeoutStopOutcomeLabel,
  filePath = SHAKEOUT_STOP_OUTCOME_LEDGER_FILE,
): ShakeoutOutcomeUpsertResult {
  const file = readLedger(filePath);
  const index = file.labels.findIndex((l) => l.tradeId === label.tradeId);
  if (index < 0) {
    file.labels.push(label);
    writeLedger(file, filePath);
    return { created: true, updated: false, resolvedSkipped: false, label };
  }
  const existing = file.labels[index];
  if (existing.maturity === 'RESOLVED') {
    // 불변성 — RESOLVED 라벨은 절대 재기입하지 않는다.
    return { created: false, updated: false, resolvedSkipped: true, label: existing };
  }
  file.labels[index] = label;
  writeLedger(file, filePath);
  return { created: false, updated: true, resolvedSkipped: false, label };
}

/** 테스트 전용 — ledger 파일 삭제. */
export function __resetShakeoutStopOutcomeLedgerForTests(
  filePath = SHAKEOUT_STOP_OUTCOME_LEDGER_FILE,
): void {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
