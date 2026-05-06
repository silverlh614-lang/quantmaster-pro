import fs from 'fs/promises';
import path from 'path';
import { holidaySnapshotRepo } from '../holidaySnapshotRepo';

describe('HolidaySnapshotRepo', () => {
  const TEST_MARKET = 'KRX';
  const TEST_DATE = '2026-05-04';
  
  beforeAll(async () => {
    // 테스트용 디렉토리 정리 (선택 사항)
    const testDirPath = path.join(process.cwd(), 'snapshots', TEST_MARKET, TEST_DATE);
    try {
      await fs.rm(testDirPath, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  it('스냅샷 데이터를 파일 시스템에 성공적으로 저장하고 다시 로드해야 한다 (MetricValue 반환)', async () => {
    const mockPriceData = [{ stockCode: '005930', close: 75000 }];
    
    // 1. 저장 (Save)
    await holidaySnapshotRepo.saveSnapshot(TEST_MARKET, TEST_DATE, 'PRICE', mockPriceData);
    
    // 2. 로드 (Load)
    const result = await holidaySnapshotRepo.loadSnapshot<typeof mockPriceData>(
      TEST_MARKET,
      TEST_DATE,
      'PRICE'
    );

    // 3. 검증 (Validation)
    expect(result.status).toBe('OK');
    if (result.status === 'OK') {
      expect(result.value).toEqual(mockPriceData);
      expect(result.asOfDate).toBe(TEST_DATE);
      expect(result.source).toBe('HOLIDAY_SNAPSHOT');
      expect(result.quality).toBe('HIGH');
    }
  });

  it('저장되지 않은 스냅샷을 로드 시도할 경우, MISSING 상태와 HOLIDAY_NO_DATA 사유를 반환해야 한다', async () => {
    const result = await holidaySnapshotRepo.loadSnapshot(TEST_MARKET, TEST_DATE, 'SECTOR');

    expect(result.status).toBe('MISSING');
    if (result.status === 'MISSING') {
      expect(result.value).toBeNull();
      expect(result.reason).toBe('HOLIDAY_NO_DATA');
      expect(result.source).toBe('HOLIDAY_SNAPSHOT');
    }
  });
});