/**
 * scanTracer.ts — 파이프라인 트레이서 (아이디어 10)
 *
 * 매 스캔에서 종목별 의사결정 단계를 구조화된 JSON 파일로 영속화.
 * Railway 72시간 로그 삭제 문제를 우회하여 사후 분석을 가능하게 한다.
 */
import fs from 'fs';
import { DATA_DIR, scanTraceFile, ensureDataDir } from '../persistence/paths.js';

export interface ScanTrace {
  /** "HH:MM:SS" KST */
  ts: string;
  /** 종목코드 */
  stock: string;
  /** 종목명 */
  name: string;
  /**
   * 단계별 통과/실패 결과.
   * 값 형식: "PASS" | "FAIL(reason)" | "N/A" | "SHADOW" | "LIVE"
   */
  stages: Record<string, string>;
}

function todayKst(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, '');
}

const MAX_TRACES_PER_DAY = 1000;

/** 스캔 트레이스 배치를 일별 파일에 추가한다. */
export function appendScanTraces(traces: ScanTrace[]): void {
  if (traces.length === 0) return;
  ensureDataDir();
  const file = scanTraceFile(todayKst());
  let existing: ScanTrace[] = [];
  try {
    if (fs.existsSync(file)) {
      existing = JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
  } catch { /* 최초 생성 */ }
  const merged = [...existing, ...traces];
  const trimmed = merged.length > MAX_TRACES_PER_DAY
    ? merged.slice(-MAX_TRACES_PER_DAY)
    : merged;
  fs.writeFileSync(file, JSON.stringify(trimmed, null, 2));
}

/** 오늘 KST 기준 스캔 트레이스 전체를 반환한다. */
export function loadTodayScanTraces(): ScanTrace[] {
  const file = scanTraceFile(todayKst());
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return []; }
}

/** 특정 날짜(YYYYMMDD)의 스캔 트레이스를 반환한다. */
export function loadScanTraces(yyyymmdd: string): ScanTrace[] {
  const file = scanTraceFile(yyyymmdd);
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return []; }
}

export interface ScanTraceSummary {
  totalCandidates: number;
  priceFail:  number;
  rrrFail:    number;
  gateFail:   number;
  yahooFail:  number;
  otherBlock: number;
  buyExecuted: number;
  lastScanTime: string | null;
}

/**
 * 하루치 트레이스 배열을 집계해 요약을 반환한다.
 * reportGenerator.ts가 장마감 리포트에 삽입할 때 사용.
 */
export function summarizeScanTraces(traces: ScanTrace[]): ScanTraceSummary {
  const summary: ScanTraceSummary = {
    totalCandidates: traces.length,
    priceFail: 0, rrrFail: 0, gateFail: 0,
    yahooFail: 0, otherBlock: 0, buyExecuted: 0,
    lastScanTime: null,
  };
  for (const t of traces) {
    summary.lastScanTime = t.ts;
    if (t.stages.buy === 'SHADOW' || t.stages.buy === 'LIVE') { summary.buyExecuted++; continue; }
    if (t.stages.price?.startsWith('FAIL'))    { summary.priceFail++;  continue; }
    if (t.stages.rrr?.startsWith('FAIL'))      { summary.rrrFail++;    continue; }
    if (t.stages.gate?.startsWith('FAIL(yahoo')) { summary.yahooFail++; continue; }
    if (t.stages.gate?.startsWith('FAIL'))     { summary.gateFail++;   continue; }
    summary.otherBlock++;
  }
  return summary;
}

/** 요약 구조를 사람이 읽기 쉬운 Telegram 문자열로 변환한다. */
export function formatScanTraceSummary(s: ScanTraceSummary): string {
  return (
    `<b>📊 오늘 스캔 의사결정 요약</b>\n` +
    `총 후보: ${s.totalCandidates}개\n` +
    `- 가격 조회 실패: ${s.priceFail}개\n` +
    `- RRR 미달: ${s.rrrFail}개\n` +
    `- Yahoo 불가: ${s.yahooFail}개\n` +
    `- Gate 미달: ${s.gateFail}개\n` +
    `- 기타 차단: ${s.otherBlock}개\n` +
    `- 매수 실행: ${s.buyExecuted}개 ✅`
  );
}

/** 과거 trace 파일 정리 — 7일 이상 된 파일 삭제 */
export function cleanupOldTraceFiles(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) return;
    const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('scan_trace_') && f.endsWith('.json'));
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    for (const f of files) {
      const fullPath = `${DATA_DIR}/${f}`;
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs < cutoff) { fs.unlinkSync(fullPath); }
    }
  } catch { /* 정리 실패는 무시 */ }
}
