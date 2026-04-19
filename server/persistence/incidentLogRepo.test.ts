import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('incidentLogRepo — incident 기록/조회', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'incident-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('recordIncident → 파일에 누적 저장, getLatestIncidentAt 가 최신 반환', async () => {
    const { recordIncident, getLatestIncidentAt, listIncidents } =
      await import('./incidentLogRepo.js');
    const e1 = recordIncident('testSource', '첫 사건', 'HIGH');
    const e2 = recordIncident('testSource', '두번째 사건', 'CRITICAL');
    expect(listIncidents().length).toBe(2);
    expect(getLatestIncidentAt()).toBe(e2.at);
    expect(e1.at < e2.at || e1.at === e2.at).toBe(true);
  });

  it('WARN 심각도는 getLatestIncidentAt 에서 제외된다', async () => {
    const { recordIncident, getLatestIncidentAt } = await import('./incidentLogRepo.js');
    const critical = recordIncident('a', 'crit', 'CRITICAL');
    recordIncident('a', 'warn-only', 'WARN');
    expect(getLatestIncidentAt()).toBe(critical.at);
  });

  it('200건 초과 시 오래된 엔트리 자동 트리밍', async () => {
    const { recordIncident, listIncidents } = await import('./incidentLogRepo.js');
    for (let i = 0; i < 220; i++) {
      recordIncident('bulk', `#${i}`, 'WARN');
    }
    expect(listIncidents(500).length).toBe(200);
  });
});
