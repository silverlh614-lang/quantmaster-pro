/**
 * bootManifest.ts — 기억 보완 회로: 부팅/종료 매니페스트.
 *
 * 목적:
 *   "서버가 언제 켜졌고, 지난번엔 깨끗하게 내려갔는가, 아니면 크래시였는가?"
 *   Railway 배포 롤오버·OOM·uncaughtException 으로 컨테이너가 강제 재시작되면
 *   기존엔 아무 흔적도 남지 않았다. 본 모듈은 startBoot() 가 먼저 엔트리를
 *   `bootedAt` 과 `unknown` 상태로 적고, markCleanShutdown() 이 SIGTERM/SIGINT
 *   시점에 `clean`으로 마감한다. 다음 부팅에서 마지막 엔트리가 아직 `unknown`
 *   상태면 → 지난번은 크래시였음을 단정할 수 있다.
 *
 * 저장 위치: DATA_DIR/boot-manifest.json (최근 100건 유지)
 */

import fs from 'fs';
import os from 'os';
import { randomUUID } from 'crypto';
import { BOOT_MANIFEST_FILE, ensureDataDir } from './paths.js';

export type BootStatus = 'unknown' | 'clean' | 'crashed';

export interface BootEntry {
  /** 이 부팅을 고유 식별. persistentErrorLog 엔트리 bootId 와 연결. */
  bootId:        string;
  bootedAt:      string;           // ISO UTC
  shutdownAt?:   string;
  /** `unknown` 이면 아직 진행 중 혹은 강제 종료로 마감 실패. */
  status:        BootStatus;
  /** SIGTERM·SIGINT 수신한 경우 여기에 기록 */
  shutdownSignal?: string;
  /** 프로세스 PID — 재배포 전/후 비교 */
  pid:           number;
  /** 호스트명 — Railway 컨테이너 식별 */
  hostname:      string;
  /** NODE_ENV / AUTO_TRADE_MODE 스냅샷 */
  nodeEnv:       string;
  tradeMode:     string;
  /** 이 부팅이 정상 시작까지 걸린 ms */
  startupMs?:    number;
}

const MAX_ENTRIES = 100;

function loadAll(): BootEntry[] {
  try {
    ensureDataDir();
    if (!fs.existsSync(BOOT_MANIFEST_FILE)) return [];
    const raw = fs.readFileSync(BOOT_MANIFEST_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BootEntry[]) : [];
  } catch {
    return [];
  }
}

function save(entries: BootEntry[]): void {
  try {
    ensureDataDir();
    const trimmed = entries.slice(-MAX_ENTRIES);
    fs.writeFileSync(BOOT_MANIFEST_FILE, JSON.stringify(trimmed, null, 2));
  } catch (err) {
    try { console.error('[BootManifest] save 실패:', err); } catch { /* noop */ }
  }
}

/**
 * 부팅 엔트리를 기록한다. 이전 엔트리가 `unknown` 상태이면 `crashed` 로 마감한다.
 * 반환값에는 방금 기록된 엔트리와 "지난번 부팅이 크래시였는지" 여부가 포함된다.
 */
export function startBoot(): { current: BootEntry; previous: BootEntry | null; previousCrashed: boolean } {
  const all = loadAll();
  const prev = all.length > 0 ? all[all.length - 1] : null;
  let previousCrashed = false;

  if (prev && prev.status === 'unknown') {
    prev.status = 'crashed';
    previousCrashed = true;
  }

  const bootId = randomUUID();
  const current: BootEntry = {
    bootId,
    bootedAt: new Date().toISOString(),
    status: 'unknown',
    pid: process.pid,
    hostname: os.hostname(),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    tradeMode: process.env.AUTO_TRADE_MODE ?? 'UNSET',
  };

  all.push(current);
  save(all);
  return { current, previous: prev, previousCrashed };
}

/**
 * 특정 bootId 엔트리를 clean 상태로 마감.
 * SIGTERM/SIGINT 핸들러에서 호출된다. 실패해도 던지지 않는다.
 */
export function markCleanShutdown(bootId: string, signal: string = 'SIGTERM'): void {
  try {
    const all = loadAll();
    const idx = all.findIndex(e => e.bootId === bootId);
    if (idx === -1) return;
    all[idx].status = 'clean';
    all[idx].shutdownAt = new Date().toISOString();
    all[idx].shutdownSignal = signal;
    save(all);
  } catch { /* noop */ }
}

/** 부팅 완료 시점을 기록 (startup 시간 측정용). */
export function markBootReady(bootId: string, startupMs: number): void {
  try {
    const all = loadAll();
    const idx = all.findIndex(e => e.bootId === bootId);
    if (idx === -1) return;
    all[idx].startupMs = Math.round(startupMs);
    save(all);
  } catch { /* noop */ }
}

/** 최근 N개 부팅 엔트리 — 진단 API. */
export function listRecentBoots(limit = 10): BootEntry[] {
  const all = loadAll();
  return all.slice(-limit).reverse();
}

/** 마지막으로 기록된 부팅 (현재 세션 포함). */
export function getLastBoot(): BootEntry | null {
  const all = loadAll();
  return all.length > 0 ? all[all.length - 1] : null;
}
