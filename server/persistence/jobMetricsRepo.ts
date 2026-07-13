// @responsibility JobMetrics 영속화 — scheduleCatalog runCount/lastRun 디스크 저장 + 부팅 복원
import fs from 'fs';
import { JOB_METRICS_FILE, ensureDataDir } from './paths.js';

/**
 * 영속 JobMetrics 스키마 — `Record<jobName, JobMetricsEntry>`. scheduleCatalog 의
 * `JobMetrics` 인터페이스와 byte-equivalent 유지 (필드 순서 무관, 옵셔널 보존).
 *
 * 재할당 의무: scheduleCatalog.ts 의 JobMetrics 변경 시 본 인터페이스도 동기화.
 */
interface JobMetricsEntry {
  jobName: string;
  runCount: number;
  successCount: number;
  failCount: number;
  skippedCount: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastErrorMessage?: string;
  lastSkipReason?: string;
}

export type JobMetricsMap = Record<string, JobMetricsEntry>;

/**
 * 디스크에서 JobMetrics 로드. 파일 부재/손상 JSON/타입 불일치 모두 빈 객체로 graceful fallback.
 * 부팅 시 한 번 호출 → scheduleCatalog 가 _metricsByJob Map 으로 복원.
 */
export function loadJobMetrics(): JobMetricsMap {
  ensureDataDir();
  if (!fs.existsSync(JOB_METRICS_FILE)) return {};
  try {
    const raw = fs.readFileSync(JOB_METRICS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: JobMetricsMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const e = v as Partial<JobMetricsEntry>;
      if (typeof e.jobName !== 'string') continue;
      out[k] = {
        jobName: e.jobName,
        runCount: typeof e.runCount === 'number' && Number.isFinite(e.runCount) ? e.runCount : 0,
        successCount:
          typeof e.successCount === 'number' && Number.isFinite(e.successCount) ? e.successCount : 0,
        failCount: typeof e.failCount === 'number' && Number.isFinite(e.failCount) ? e.failCount : 0,
        skippedCount:
          typeof e.skippedCount === 'number' && Number.isFinite(e.skippedCount) ? e.skippedCount : 0,
        lastSuccessAt: typeof e.lastSuccessAt === 'string' ? e.lastSuccessAt : undefined,
        lastFailureAt: typeof e.lastFailureAt === 'string' ? e.lastFailureAt : undefined,
        lastErrorMessage: typeof e.lastErrorMessage === 'string' ? e.lastErrorMessage : undefined,
        lastSkipReason: typeof e.lastSkipReason === 'string' ? e.lastSkipReason : undefined,
      };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 디스크에 JobMetrics 저장 (atomic write tmp→rename — race 시 이전 정상 본 보존).
 * 호출자(scheduleCatalog)가 throttle 책임. 본 함수는 매번 동기 write.
 */
export function saveJobMetrics(metrics: JobMetricsMap): void {
  ensureDataDir();
  const tmp = `${JOB_METRICS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(metrics, null, 2));
  fs.renameSync(tmp, JOB_METRICS_FILE);
}

/** 테스트 전용 — 영속 파일 삭제 */
export function __resetJobMetricsFileForTests(): void {
  if (fs.existsSync(JOB_METRICS_FILE)) {
    try {
      fs.unlinkSync(JOB_METRICS_FILE);
    } catch {
      /* noop */
    }
  }
}
