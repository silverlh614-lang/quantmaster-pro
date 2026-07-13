/**
 * @responsibility 익절(TAKE_PROFIT/EUPHORIA) 전량 청산 이벤트를 월별 JSONL 에 append-only 로 기록·조회한다.
 *
 * ADR-0569 조건부 재진입 가드의 barrier 데이터 SSOT. buyPipeline 이 재매수 직전
 * "이 종목을 최근에 익절 전량청산했는가 + 그때 청산가/진입 게이트점수" 를 조회해
 * (청산가 +5% 재돌파) OR (게이트 +1 상향) 조건 충족 시에만 재진입을 허용한다.
 *
 * manualExitsRepo 와 동일한 월 롤링 JSONL 패턴. 손실 청산(STOP_LOSS)은 기록하지 않는다
 * — 그쪽은 cascade 180일 재진입 금지 등 별도 로직 소관.
 *
 * 파일: DATA_DIR/take-profit-exits-YYYYMM.jsonl (월 롤링, 한 줄 = 한 이벤트)
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR, ensureDataDir } from './paths.js';

export interface TakeProfitExitRecord {
  stockCode: string;
  stockName: string;
  /** 전량 청산 체결가 (재진입 가격 조건의 기준). */
  exitPrice: number;
  /** 청산된 포지션의 진입 시점 게이트 점수. 레거시(미stamp) 포지션이면 null. */
  exitGateScore: number | null;
  /** 청산 실현 수익률(%) — 진단/표시용. */
  exitReturnPct: number | null;
  /** 'TAKE_PROFIT' | 'EUPHORIA'. */
  exitReason: string;
  /** 청산 시각 ISO. */
  exitAt: string;
}

function takeProfitExitsFile(yyyymm: string): string {
  return path.join(DATA_DIR, `take-profit-exits-${yyyymm}.jsonl`);
}

function currentYyyymmKst(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

/**
 * 익절 전량 청산 1건을 월별 JSONL 에 append.
 * I/O 실패는 throw 하지 않고 console.error 로만 남긴다 — 매도 주 경로를 막지 않는다.
 */
export function appendTakeProfitExit(record: TakeProfitExitRecord, now = new Date()): void {
  try {
    ensureDataDir();
    const file = takeProfitExitsFile(currentYyyymmKst(now));
    const line = JSON.stringify({ ...record, loggedAt: now.toISOString() }) + '\n';
    fs.appendFileSync(file, line, 'utf-8');
  } catch (e) {
    console.error('[TakeProfitExitsRepo] append 실패:', e instanceof Error ? e.message : e);
  }
}

/** 주어진 월의 레코드 전체를 읽는다. 파싱 실패 라인은 스킵. 파일 없으면 빈 배열. */
function loadTakeProfitExitsMonth(yyyymm: string): TakeProfitExitRecord[] {
  const file = takeProfitExitsFile(yyyymm);
  if (!fs.existsSync(file)) return [];
  const out: TakeProfitExitRecord[] = [];
  for (const raw of fs.readFileSync(file, 'utf-8').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as TakeProfitExitRecord);
    } catch {
      // 손상 라인 스킵 — append-only 로그는 부분 손상을 허용
    }
  }
  return out;
}

/**
 * 특정 종목의 최근 days 일 이내 가장 최근 익절 전량 청산 레코드. 없으면 null.
 * days 는 실무적 backstop(기본 90일) — 그 이전 barrier 는 사실상 만료로 간주한다.
 * buyPipeline 의 조건부 재진입 가드 판정에 쓰인다.
 */
export function lastTakeProfitExitForCode(
  stockCode: string,
  days = 90,
  now = new Date(),
): TakeProfitExitRecord | null {
  if (days <= 0) return null;
  const cutoffMs = now.getTime() - days * 24 * 60 * 60 * 1000;
  const months = new Set<string>();
  // 경계 월 포함을 위해 days 만큼 과거까지 월 키 수집
  for (let i = 0; i <= days; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    months.add(currentYyyymmKst(d));
  }
  let latest: TakeProfitExitRecord | null = null;
  for (const m of months) {
    for (const rec of loadTakeProfitExitsMonth(m)) {
      if (rec.stockCode !== stockCode) continue;
      const t = new Date(rec.exitAt).getTime();
      if (!Number.isFinite(t) || t < cutoffMs) continue;
      if (latest == null || rec.exitAt.localeCompare(latest.exitAt) > 0) latest = rec;
    }
  }
  return latest;
}
