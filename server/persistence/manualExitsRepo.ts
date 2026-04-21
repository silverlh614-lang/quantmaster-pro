/**
 * @responsibility 수동 청산(MANUAL_EXIT) 이벤트를 월별 JSONL 파일에 append-only 로 기록하고 조회한다.
 *
 * 기존의 shadow-log 와 달리 "왜 수동 청산했는가" 의 맥락(machineVerdict, biasAssessment)만
 * 구조화하여 저장한다. Nightly Reflection 이 이 로그를 읽어 "이번 달 수동 청산 경향"
 * (패닉 매도 빈도, 후회 회피 비율, 기계 의견과의 괴리 등)을 학습 신호로 사용한다.
 *
 * 파일: DATA_DIR/manual-exits-YYYYMM.jsonl (월 롤링, 한 줄 = 한 이벤트)
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR, ensureDataDir } from './paths.js';
import type { ManualExitContext } from './shadowTradeRepo.js';

export function manualExitsFile(yyyymm: string): string {
  return path.join(DATA_DIR, `manual-exits-${yyyymm}.jsonl`);
}

export interface ManualExitRecord {
  tradeId: string;
  stockCode: string;
  stockName: string;
  exitPrice: number;
  returnPct: number;
  context: ManualExitContext;
}

function currentYyyymmKst(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

/**
 * 수동 청산 이벤트 1건을 월별 JSONL 에 append.
 * I/O 실패는 throw 하지 않고 console.error 로만 남긴다 — /sell 의 주 경로를 막지 않는다.
 */
export function appendManualExit(record: ManualExitRecord, now = new Date()): void {
  try {
    ensureDataDir();
    const file = manualExitsFile(currentYyyymmKst(now));
    const line = JSON.stringify({ ...record, loggedAt: now.toISOString() }) + '\n';
    fs.appendFileSync(file, line, 'utf-8');
  } catch (e) {
    console.error('[ManualExitsRepo] append 실패:', e instanceof Error ? e.message : e);
  }
}

/**
 * 주어진 월의 수동 청산 레코드 전체를 읽는다. 파싱 실패 라인은 스킵.
 * 파일이 없으면 빈 배열.
 */
export function loadManualExitsMonth(yyyymm: string): ManualExitRecord[] {
  const file = manualExitsFile(yyyymm);
  if (!fs.existsSync(file)) return [];
  const out: ManualExitRecord[] = [];
  for (const raw of fs.readFileSync(file, 'utf-8').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as ManualExitRecord);
    } catch {
      // 손상 라인 스킵 — append-only 로그는 부분 손상을 허용
    }
  }
  return out;
}

/**
 * KST 기준 주어진 날짜(YYYY-MM-DD)에 해당하는 수동 청산만 필터.
 * Nightly Reflection 이 "오늘 수동 청산" 맥락을 뽑을 때 사용.
 */
export function loadManualExitsForDateKst(dateKst: string): ManualExitRecord[] {
  const yyyymm = dateKst.slice(0, 7).replace('-', '');
  return loadManualExitsMonth(yyyymm).filter((r) =>
    isoInKstDate(r.context.triggeredAt, dateKst),
  );
}

function isoInKstDate(iso: string | undefined, dateKst: string): boolean {
  if (!iso) return false;
  const kstMs = new Date(iso).getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().slice(0, 10) === dateKst;
}

export const __test = { currentYyyymmKst, isoInKstDate };
