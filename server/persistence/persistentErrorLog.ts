/**
 * persistentErrorLog.ts — 기억 보완 회로: 월별 영속 에러 로그.
 *
 * 목적:
 *   Railway 등 호스팅에서 컨테이너가 재시작되면 in-memory 로그가 전부 소실되고,
 *   `globalErrorHandlers.ts` 가 보내던 Telegram 알림 역시 발송 실패·봇 정지 시
 *   원인 단서가 완전히 사라진다. 본 모듈은 `DATA_DIR/error-log-YYYYMM.jsonl` 에
 *   append-only 로 기록하여 재부팅 후에도 최근 에러를 그대로 조회하게 한다.
 *
 * 설계 원칙:
 *   1. 스스로는 절대 던지지 않는다 — 에러 로그를 쓰다 실패하면 더 할 말이 없다.
 *   2. JSONL(한 줄당 한 건)로 append — 부분 쓰기 실패가 다른 라인을 오염시키지 않음.
 *   3. 월별 롤링 — 단일 파일이 무한 팽창하지 않도록.
 *   4. 부모(Volume 미마운트) 상태는 `paths.ensureDataDir()` 가 담당.
 */

import fs from 'fs';
import { ensureDataDir, errorLogFile } from './paths.js';

export type ErrorSeverity = 'FATAL' | 'ERROR' | 'WARN';

export interface PersistentErrorEntry {
  /** ISO timestamp — UTC */
  at:       string;
  severity: ErrorSeverity;
  /** 발생 소스 식별자 (uncaughtException·orchestrator·scheduler 등) */
  source:   string;
  /** 에러 원문 메시지 */
  message:  string;
  /** 스택 트레이스 앞머리 — 전량은 저장 공간 낭비 */
  stack?:   string;
  /** 재시작 식별 — 같은 프로세스 세션에서 난 에러끼리 묶는 용도 */
  bootId?:  string;
  /** 선택 컨텍스트 (종목코드·요청 id 등) */
  context?: Record<string, string | number | boolean>;
}

const STACK_HEAD_LINES = 8;

function currentYyyymm(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

function truncateStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  return stack.split('\n').slice(0, STACK_HEAD_LINES).join('\n');
}

/**
 * 에러를 영속 로그에 기록. 내부에서 예외 발생 시 조용히 삼킨다.
 * 반환: 방금 기록된 엔트리 (timestamp 포함). 기록 자체가 실패해도 객체는 반환.
 */
export function recordPersistentError(
  source: string,
  err: unknown,
  severity: ErrorSeverity = 'ERROR',
  extra?: { bootId?: string; context?: Record<string, string | number | boolean> },
): PersistentErrorEntry {
  const e = err instanceof Error ? err : new Error(String(err));
  const entry: PersistentErrorEntry = {
    at: new Date().toISOString(),
    severity,
    source,
    message: e.message || String(err),
    ...(e.stack ? { stack: truncateStack(e.stack) } : {}),
    ...(extra?.bootId ? { bootId: extra.bootId } : {}),
    ...(extra?.context ? { context: extra.context } : {}),
  };

  try {
    ensureDataDir();
    const file = errorLogFile(currentYyyymm());
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch (writeErr) {
    try { console.error('[PersistentErrorLog] append 실패:', writeErr); } catch { /* noop */ }
  }

  return entry;
}

/**
 * 최근 N건 조회 — 기본값 50. 현재 달 파일부터 읽고, 부족하면 이전 달 파일도 읽는다.
 * 파일이 없거나 파싱 실패한 라인은 건너뛴다.
 */
export function listRecentErrors(limit = 50, now: Date = new Date()): PersistentErrorEntry[] {
  const entries: PersistentErrorEntry[] = [];
  let probe = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  // 최대 12개월 과거까지 스캔 (비정상적으로 큰 limit 방지)
  for (let i = 0; i < 12 && entries.length < limit; i++) {
    const yyyymm = currentYyyymm(probe);
    const file = errorLogFile(yyyymm);
    if (fs.existsSync(file)) {
      let raw: string;
      try { raw = fs.readFileSync(file, 'utf-8'); } catch { raw = ''; }
      const lines = raw.split('\n').filter(Boolean);
      // 최근 것부터 쌓는다
      for (let j = lines.length - 1; j >= 0 && entries.length < limit; j--) {
        try {
          entries.push(JSON.parse(lines[j]) as PersistentErrorEntry);
        } catch { /* 잘린 라인 무시 */ }
      }
    }
    probe = new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth() - 1, 1));
  }
  return entries;
}

/** 특정 bootId 이후에 기록된 에러만 조회 — 이전 세션 크래시 원인 파악용. */
export function errorsSince(boundaryIso: string, limit = 200): PersistentErrorEntry[] {
  return listRecentErrors(limit).filter(e => e.at >= boundaryIso);
}

/** 모니터링/진단 API 에서 소비할 경량 요약. */
export function summarizeErrors(now: Date = new Date()): {
  recent24h: number;
  fatal24h:  number;
  bySource:  Record<string, number>;
  lastAt:    string | null;
} {
  const entries = listRecentErrors(500, now);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let recent24h = 0, fatal24h = 0;
  const bySource: Record<string, number> = {};
  let lastAt: string | null = null;
  for (const e of entries) {
    if (!lastAt || e.at > lastAt) lastAt = e.at;
    const t = Date.parse(e.at);
    if (Number.isFinite(t) && t >= cutoff) {
      recent24h++;
      if (e.severity === 'FATAL') fatal24h++;
      bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    }
  }
  return { recent24h, fatal24h, bySource, lastAt };
}
