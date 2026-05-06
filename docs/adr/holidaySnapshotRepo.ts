import fs from 'fs/promises';
import path from 'path';
import { MarketCode } from '../context/tradingContext';
import { DataDomain } from '../context/freshnessPolicy';
// 실제 경로에 맞춰 수정이 필요할 수 있습니다.
import { MetricValue } from '../types/metricValue'; 

const SNAPSHOT_BASE_DIR = path.join(process.cwd(), 'snapshots');

/**
 * 스냅샷 파일의 절대 경로를 반환합니다.
 * 예: snapshots/KRX/2026-05-04/price.json
 */
function getSnapshotPath(market: MarketCode, date: string, domain: DataDomain): string {
  return path.join(SNAPSHOT_BASE_DIR, market, date, `${domain.toLowerCase()}.json`);
}

export const holidaySnapshotRepo = {
  /**
   * EOD (End of Day) 시점에 데이터를 스냅샷으로 저장합니다.
   * 주로 평일 장 마감 후 실행되는 스케줄러(Backfill, EOD Job)에서 호출됩니다.
   * 
   * @param market 시장 코드 (예: 'KRX')
   * @param date effectiveTradingDate (예: '2026-05-04')
   * @param domain 데이터 도메인 (예: 'PRICE', 'SECTOR')
   * @param data 저장할 실제 데이터 객체 또는 배열
   */
  async saveSnapshot(
    market: MarketCode,
    date: string,
    domain: DataDomain,
    data: any
  ): Promise<void> {
    const filePath = getSnapshotPath(market, date, domain);
    const dirPath = path.dirname(filePath);

    // 디렉토리가 없으면 생성 (recursive: true)
    await fs.mkdir(dirPath, { recursive: true });

    const snapshotData = {
      savedAt: new Date().toISOString(),
      market,
      date,
      domain,
      data,
    };

    await fs.writeFile(filePath, JSON.stringify(snapshotData, null, 2), 'utf-8');
  },

  /**
   * 휴장일에 특정 기준일의 스냅샷 데이터를 불러옵니다.
   * 
   * @param market 시장 코드
   * @param date effectiveTradingDate (휴장일 컨텍스트가 가리키는 마지막 확정 거래일)
   * @param domain 데이터 도메인
   * @returns MetricValue 규격에 맞춘 스냅샷 데이터
   */
  async loadSnapshot<T>(
    market: MarketCode,
    date: string,
    domain: DataDomain
  ): Promise<MetricValue<T>> {
    const filePath = getSnapshotPath(market, date, domain);

    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(fileContent);

      return {
        status: 'OK',
        value: parsed.data as T,
        asOfDate: date,
        source: 'HOLIDAY_SNAPSHOT',
        quality: 'HIGH', // 확정된 EOD 스냅샷이므로 HIGH 신뢰도 부여
      };
    } catch (error: any) {
      return {
        status: 'MISSING',
        value: null,
        reason: error.code === 'ENOENT' ? 'HOLIDAY_NO_DATA' : 'SOURCE_UNAVAILABLE',
        source: 'HOLIDAY_SNAPSHOT',
      };
    }
  }
};