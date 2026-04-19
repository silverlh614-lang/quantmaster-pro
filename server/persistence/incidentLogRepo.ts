/**
 * incidentLogRepo.ts — Phase 2차 C5: 치명 버그 감지 타임스탬프 저장소.
 *
 * 역할:
 *   - recordIncident() : 치명 오류 발생 시각·원인·소스 기록.
 *   - getLatestIncidentAt() : Shadow 샘플 incidentFlag 자동 부착 기준.
 *   - listIncidents() : 오염 반경 계산기/주간 리포트에서 소비.
 *
 * 저장 위치: DATA_DIR/incident-log.json (Railway Volume 영속화).
 * 보관 한도: 최근 200건 (초과 시 오래된 순 트리밍).
 */

import fs from 'fs';
import { INCIDENT_LOG_FILE, ensureDataDir } from './paths.js';

export type IncidentSeverity = 'CRITICAL' | 'HIGH' | 'WARN';

export interface IncidentEntry {
  /** ISO timestamp — UTC */
  at:       string;
  severity: IncidentSeverity;
  /** 발생 소스 식별자 (killSwitch·preOrderGuard·mutationCanary 등) */
  source:   string;
  reason:   string;
  /** 선택: 관련 종목코드·주문번호 등 추가 식별자 */
  context?: Record<string, string | number | boolean>;
}

const MAX_ENTRIES = 200;

function loadInternal(): IncidentEntry[] {
  ensureDataDir();
  if (!fs.existsSync(INCIDENT_LOG_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(INCIDENT_LOG_FILE, 'utf-8')) as IncidentEntry[];
  } catch {
    return [];
  }
}

function save(entries: IncidentEntry[]): void {
  ensureDataDir();
  const trimmed = entries.slice(-MAX_ENTRIES);
  fs.writeFileSync(INCIDENT_LOG_FILE, JSON.stringify(trimmed, null, 2));
}

/**
 * 새 incident 를 기록. 타임스탬프는 함수 내부에서 설정.
 * 반환: 방금 기록된 엔트리 (타임스탬프 포함) — Shadow 샘플 태깅에 사용.
 */
export function recordIncident(
  source: string,
  reason: string,
  severity: IncidentSeverity = 'CRITICAL',
  context?: Record<string, string | number | boolean>,
): IncidentEntry {
  const entry: IncidentEntry = {
    at: new Date().toISOString(),
    severity, source, reason,
    ...(context ? { context } : {}),
  };
  const all = loadInternal();
  all.push(entry);
  save(all);
  console.error(`[Incident:${severity}] ${source} — ${reason}`);
  return entry;
}

export function listIncidents(limit = 50): IncidentEntry[] {
  const all = loadInternal();
  return all.slice(-limit);
}

/** 현재까지 기록된 마지막 CRITICAL/HIGH incident 의 타임스탬프. 없으면 null. */
export function getLatestIncidentAt(): string | null {
  const all = loadInternal();
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].severity !== 'WARN') return all[i].at;
  }
  return null;
}

/** 특정 시간 범위 안의 incident 목록 — 오염 반경 계산기 전용. */
export function incidentsBetween(fromIso: string, toIso: string): IncidentEntry[] {
  return loadInternal().filter(e => e.at >= fromIso && e.at <= toIso);
}
