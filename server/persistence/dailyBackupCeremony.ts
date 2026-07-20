// @responsibility dailyBackupCeremony 영속화 저장소 모듈
/**
 * dailyBackupCeremony.ts — Phase 2차 C1: 매일 KST 01:00 전체 스냅샷.
 *
 * 기존 runDailyBackup() 과의 역할 분담:
 *   - runDailyBackup()       : 03:00 KST, 선택적 파일 목록을 backups/YYYY-MM-DD/ 로 복사.
 *   - runBackupCeremony() (이 파일): 01:00 KST, DATA_DIR 의 모든 *.json 를
 *     snapshots/YYYY-MM-DD/ 로 복사. "어제 자정" 상태로의 빠른 복원 보장.
 *
 * 설계 원칙:
 *   - 동일 Railway Volume 내 격리 디렉토리 — 용량 부담 적음 (MB 단위).
 *   - snapshots 하위 7일치만 보관, 그 이전은 자동 pruning.
 *   - *.json 만 대상 (바이너리/로그 제외).
 *   - backups/ 폴더 자체는 제외 (재귀 방지).
 *   - flat *.json 외에 재생성 불가한 고가치 서브디렉토리(SNAPSHOT_SUBDIRS)도 추가 스냅샷.
 *     기존 flat-only 계약은 byte-identical 보존(서브디렉토리 처리는 순수 additive).
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR, ensureDataDir } from './paths.js';

/**
 * 스냅샷에 포함할 고가치 서브디렉토리 (DATA_DIR 기준 상대경로).
 * 두 백업 함수(runDailyBackup/runBackupCeremony)가 원래 top-level 파일만 복사해
 * 서브디렉토리 학습 데이터가 무방비였던 갭을 메운다. 화이트리스트만 추가(재귀 폭주 방지).
 *   - reflections/                : nightlyReflection 일별 회고 이력 — 재생성 불가.
 *   - attribution/evidence-ledger : attribution 증거 월별 ledger — F2W 입력·재생성 불가.
 * foreigner-ratio(KIS L1 재생성 가능)·replay·diagnostics·intraday-snapshots(휘발성)는 제외.
 */
const SNAPSHOT_SUBDIRS = ['reflections', path.join('attribution', 'evidence-ledger')];

function kstDateStr(): string {
  const kst = new Date(Date.now() + 9 * 3_600_000);
  return kst.toISOString().slice(0, 10);
}

export interface BackupCeremonyResult {
  snapshotDir: string;
  copied: string[];
  skipped: string[];       // 파일이 비었거나 디렉토리인 경우
  pruned: string[];
  totalBytes: number;
}

export function runBackupCeremony(retentionDays = 7): BackupCeremonyResult {
  ensureDataDir();
  const dateStr = kstDateStr();
  const snapshotsRoot = path.join(DATA_DIR, 'snapshots');
  const snapshotDir = path.join(snapshotsRoot, dateStr);
  fs.mkdirSync(snapshotDir, { recursive: true });

  const copied: string[] = [];
  const skipped: string[] = [];
  let totalBytes = 0;

  const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      // snapshots/ 와 backups/ 디렉토리는 스냅샷 대상 아님 (재귀 방지).
      continue;
    }
    const name = entry.name;
    // *.json 파일만 스냅샷 — jsonl 월별 롤링 로그는 이미 append-only 영속이므로 제외.
    if (!name.endsWith('.json')) {
      skipped.push(name);
      continue;
    }
    const src = path.join(DATA_DIR, name);
    const dst = path.join(snapshotDir, name);
    try {
      const stat = fs.statSync(src);
      if (stat.size === 0) { skipped.push(name); continue; }
      fs.copyFileSync(src, dst);
      copied.push(name);
      totalBytes += stat.size;
    } catch {
      skipped.push(name);
    }
  }

  // ─── 고가치 서브디렉토리 추가 스냅샷 (additive — flat 계약 무영향) ────────────
  for (const rel of SNAPSHOT_SUBDIRS) {
    const srcDir = path.join(DATA_DIR, rel);
    if (!fs.existsSync(srcDir)) continue;
    let subEntries: fs.Dirent[];
    try {
      subEntries = fs.readdirSync(srcDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sub of subEntries) {
      const relName = path.join(rel, sub.name);
      if (!sub.isFile() || !sub.name.endsWith('.json')) {
        if (sub.isFile()) skipped.push(relName);
        continue;
      }
      const src = path.join(srcDir, sub.name);
      try {
        const stat = fs.statSync(src);
        if (stat.size === 0) { skipped.push(relName); continue; }
        const dst = path.join(snapshotDir, relName);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        copied.push(relName);
        totalBytes += stat.size;
      } catch {
        skipped.push(relName);
      }
    }
  }

  const pruned = pruneSnapshots(snapshotsRoot, retentionDays);
  return { snapshotDir, copied, skipped, pruned, totalBytes };
}

function pruneSnapshots(snapshotsRoot: string, retentionDays: number): string[] {
  if (!fs.existsSync(snapshotsRoot)) return [];
  const pruned: string[] = [];
  const cutoff = Date.now() - retentionDays * 86_400_000;
  for (const entry of fs.readdirSync(snapshotsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
    const dirPath = path.join(snapshotsRoot, entry.name);
    const dirTime = new Date(entry.name).getTime();
    if (Number.isNaN(dirTime)) continue;
    if (dirTime < cutoff) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      pruned.push(entry.name);
    }
  }
  return pruned;
}
