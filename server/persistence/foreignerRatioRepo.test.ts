// @responsibility foreignerRatioRepo 회귀 테스트 — ADR-0140.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

async function loadModule() {
  return import('./foreignerRatioRepo.js');
}

describe('foreignerRatioRepo (ADR-0140)', () => {
  let tmpDir: string;
  const originalDataDir = process.env.PERSIST_DATA_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreigner-ratio-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.PERSIST_DATA_DIR;
    } else {
      process.env.PERSIST_DATA_DIR = originalDataDir;
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('loadForeignerRatioSeries', () => {
    it('파일 부재 시 빈 배열', async () => {
      const { loadForeignerRatioSeries } = await loadModule();
      const series = loadForeignerRatioSeries('005930');
      expect(series).toEqual([]);
    });

    it('손상 JSON 시 빈 배열 fallback', async () => {
      const { loadForeignerRatioSeries } = await loadModule();
      const { foreignerRatioFile, FOREIGNER_RATIO_DIR } = await import('./paths.js');
      fs.mkdirSync(FOREIGNER_RATIO_DIR, { recursive: true });
      fs.writeFileSync(foreignerRatioFile('005930'), 'INVALID_JSON{');
      const series = loadForeignerRatioSeries('005930');
      expect(series).toEqual([]);
    });

    it('잘못된 row (date 형식 / ratio NaN) silent filter', async () => {
      const { loadForeignerRatioSeries } = await loadModule();
      const { foreignerRatioFile, FOREIGNER_RATIO_DIR } = await import('./paths.js');
      fs.mkdirSync(FOREIGNER_RATIO_DIR, { recursive: true });
      fs.writeFileSync(foreignerRatioFile('005930'), JSON.stringify([
        { date: '2026-04-01', ratio: 51.0 },     // OK
        { date: 'invalid', ratio: 52.0 },        // skip
        { date: '2026-04-02', ratio: 'NaN' },    // skip
        { date: '2026-04-03', ratio: 53.0 },     // OK
      ]));
      const series = loadForeignerRatioSeries('005930');
      expect(series).toHaveLength(2);
      expect(series[0].date).toBe('2026-04-01');
      expect(series[1].date).toBe('2026-04-03');
    });

    it('date 오름차순 정렬 보장', async () => {
      const { appendForeignerRatio, loadForeignerRatioSeries } = await loadModule();
      appendForeignerRatio('005930', { date: '2026-04-03', ratio: 53.0 });
      appendForeignerRatio('005930', { date: '2026-04-01', ratio: 51.0 });
      appendForeignerRatio('005930', { date: '2026-04-02', ratio: 52.0 });
      const series = loadForeignerRatioSeries('005930');
      expect(series.map((r) => r.date)).toEqual(['2026-04-01', '2026-04-02', '2026-04-03']);
    });
  });

  describe('appendForeignerRatio', () => {
    it('정상 row 영속 + round-trip', async () => {
      const { appendForeignerRatio, loadForeignerRatioSeries } = await loadModule();
      appendForeignerRatio('005930', { date: '2026-04-01', ratio: 51.23 });
      const series = loadForeignerRatioSeries('005930');
      expect(series).toEqual([{ date: '2026-04-01', ratio: 51.23 }]);
    });

    it('같은 날짜 중복 → 마지막 값 덮어쓰기', async () => {
      const { appendForeignerRatio, loadForeignerRatioSeries } = await loadModule();
      appendForeignerRatio('005930', { date: '2026-04-01', ratio: 51.0 });
      appendForeignerRatio('005930', { date: '2026-04-01', ratio: 51.5 });
      const series = loadForeignerRatioSeries('005930');
      expect(series).toHaveLength(1);
      expect(series[0].ratio).toBe(51.5);
    });

    it('잘못된 date 형식 silent skip', async () => {
      const { appendForeignerRatio, loadForeignerRatioSeries } = await loadModule();
      appendForeignerRatio('005930', { date: 'invalid', ratio: 51.0 });
      expect(loadForeignerRatioSeries('005930')).toEqual([]);
    });

    it('NaN ratio silent skip', async () => {
      const { appendForeignerRatio, loadForeignerRatioSeries } = await loadModule();
      appendForeignerRatio('005930', { date: '2026-04-01', ratio: Number.NaN });
      expect(loadForeignerRatioSeries('005930')).toEqual([]);
    });

    it('30 row 초과 → FIFO trim (이전 day 제거)', async () => {
      const { appendForeignerRatio, loadForeignerRatioSeries } = await loadModule();
      // 35 row 영속 → 최근 30 row 만 보관
      for (let i = 1; i <= 35; i++) {
        const dd = String(i).padStart(2, '0');
        appendForeignerRatio('005930', { date: `2026-03-${dd}`, ratio: 50 + i });
      }
      const series = loadForeignerRatioSeries('005930');
      expect(series).toHaveLength(30);
      // 가장 오래된 5 row 제거됨 (2026-03-01 ~ 03-05)
      expect(series[0].date).toBe('2026-03-06');
      expect(series[29].date).toBe('2026-03-35');  // 03-35 (논리적, 실제는 04-04)
    });

    it('atomic write — tmp 파일 잔존 안 함', async () => {
      const { appendForeignerRatio } = await loadModule();
      const { foreignerRatioFile } = await import('./paths.js');
      appendForeignerRatio('005930', { date: '2026-04-01', ratio: 51.0 });
      const dir = path.dirname(foreignerRatioFile('005930'));
      const files = fs.readdirSync(dir);
      const tmpFiles = files.filter((f) => f.includes('.tmp.'));
      expect(tmpFiles).toEqual([]);
    });

    it('서로 다른 종목 코드 — 파일 격리', async () => {
      const { appendForeignerRatio, loadForeignerRatioSeries } = await loadModule();
      appendForeignerRatio('005930', { date: '2026-04-01', ratio: 51.0 });
      appendForeignerRatio('035420', { date: '2026-04-01', ratio: 60.0 });
      expect(loadForeignerRatioSeries('005930')[0].ratio).toBe(51.0);
      expect(loadForeignerRatioSeries('035420')[0].ratio).toBe(60.0);
    });
  });

  describe('computeForeignerRatioTrend', () => {
    it('빈 series → null', async () => {
      const { computeForeignerRatioTrend } = await loadModule();
      expect(computeForeignerRatioTrend('005930')).toBeNull();
    });

    it('단일 row → current 만 + 5d/20d=null', async () => {
      const { appendForeignerRatio, computeForeignerRatioTrend } = await loadModule();
      appendForeignerRatio('005930', { date: '2026-04-01', ratio: 51.0 });
      const trend = computeForeignerRatioTrend('005930');
      expect(trend?.current).toBe(51.0);
      expect(trend?.changePct5d).toBeNull();
      expect(trend?.changePct20d).toBeNull();
      expect(trend?.sampleSize).toBe(1);
      expect(trend?.latestDate).toBe('2026-04-01');
    });

    it('표본 5 → 5d=null (표본 < 6)', async () => {
      const { appendForeignerRatio, computeForeignerRatioTrend } = await loadModule();
      for (let i = 1; i <= 5; i++) {
        appendForeignerRatio('005930', { date: `2026-04-0${i}`, ratio: 50 + i });
      }
      const trend = computeForeignerRatioTrend('005930');
      expect(trend?.changePct5d).toBeNull();
      expect(trend?.sampleSize).toBe(5);
    });

    it('표본 6 → 5d 활성 + 20d=null', async () => {
      const { appendForeignerRatio, computeForeignerRatioTrend } = await loadModule();
      // 6 rows: 51.0 → 56.0 → 5d 변화 = 56.0 - 51.0 = +5.0%p
      for (let i = 1; i <= 6; i++) {
        appendForeignerRatio('005930', { date: `2026-04-0${i}`, ratio: 50 + i });
      }
      const trend = computeForeignerRatioTrend('005930');
      expect(trend?.changePct5d).toBe(5);
      expect(trend?.changePct20d).toBeNull();
    });

    it('표본 21 → 5d + 20d 둘 다 활성', async () => {
      const { appendForeignerRatio, computeForeignerRatioTrend } = await loadModule();
      // 21 rows: 50.0 → 70.0
      for (let i = 0; i < 21; i++) {
        const day = String(i + 1).padStart(2, '0');
        appendForeignerRatio('005930', { date: `2026-04-${day}`, ratio: 50 + i });
      }
      const trend = computeForeignerRatioTrend('005930');
      expect(trend?.current).toBe(70);
      expect(trend?.changePct5d).toBe(5);   // 70 - 65 (5일 전, 인덱스 15)
      expect(trend?.changePct20d).toBe(20); // 70 - 50 (20일 전, 인덱스 0)
      expect(trend?.sampleSize).toBe(21);
    });

    it('음수 변화 보존 (외인 이탈)', async () => {
      const { appendForeignerRatio, computeForeignerRatioTrend } = await loadModule();
      // 6 rows: 60.0 → 55.0 → 5d 변화 = -5.0%p
      for (let i = 0; i < 6; i++) {
        const day = String(i + 1).padStart(2, '0');
        appendForeignerRatio('005930', { date: `2026-04-${day}`, ratio: 60 - i });
      }
      const trend = computeForeignerRatioTrend('005930');
      expect(trend?.changePct5d).toBe(-5);
    });

    it('소수점 2자리 절삭', async () => {
      const { appendForeignerRatio, computeForeignerRatioTrend } = await loadModule();
      const ratios = [50.123, 50.456, 50.789, 51.012, 51.345, 51.678];
      for (let i = 0; i < ratios.length; i++) {
        const day = String(i + 1).padStart(2, '0');
        appendForeignerRatio('005930', { date: `2026-04-${day}`, ratio: ratios[i] });
      }
      const trend = computeForeignerRatioTrend('005930');
      // 51.678 - 50.123 = 1.5549999...(IEEE 754) → toFixed(2) = '1.55'
      expect(trend?.changePct5d).toBe(1.55);
    });
  });

  describe('상수 SSOT', () => {
    it('FOREIGNER_RATIO_MAX_ROWS = 30', async () => {
      const { FOREIGNER_RATIO_MAX_ROWS } = await loadModule();
      expect(FOREIGNER_RATIO_MAX_ROWS).toBe(30);
    });

    it('FOREIGNER_RATIO_5D_SAMPLE = 6 / 20D = 21', async () => {
      const { FOREIGNER_RATIO_5D_SAMPLE, FOREIGNER_RATIO_20D_SAMPLE } = await loadModule();
      expect(FOREIGNER_RATIO_5D_SAMPLE).toBe(6);
      expect(FOREIGNER_RATIO_20D_SAMPLE).toBe(21);
    });
  });
});
