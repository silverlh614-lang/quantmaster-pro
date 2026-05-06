import { adjustSignalWithBaselineAlignment } from '../baselineAlignment';
import { TradingContext } from '../../context/tradingContext';
import { MetricValue } from '../../types/metricValue';

describe('BaselineAlignment: adjustSignalWithBaselineAlignment', () => {
  const mockContext = {
    effectiveTradingDate: '2026-05-04',
  } as TradingContext;

  it('모든 데이터의 기준일이 완벽히 일치하면 신호를 유지해야 한다', () => {
    const metrics = {
      PRICE: { status: 'OK', value: 100, asOfDate: '2026-05-04', source: 'KIS', quality: 'HIGH' } as MetricValue<number>,
      SECTOR: { status: 'OK', value: 50, asOfDate: '2026-05-04', source: 'KRX', quality: 'HIGH' } as MetricValue<number>,
    };

    const result = adjustSignalWithBaselineAlignment('STRONG_BUY', metrics, mockContext);
    
    expect(result.decision).toBe('STRONG_BUY');
    expect(result.downgraded).toBeFalsy();
  });

  it('가격 데이터가 누락되었거나 상태가 MISSING일 경우 NO_DECISION을 반환해야 한다', () => {
    const metrics = {
      PRICE: { status: 'MISSING', value: null, reason: 'API_EMPTY' } as MetricValue<number>,
    };

    const result = adjustSignalWithBaselineAlignment('BUY', metrics, mockContext);
    
    expect(result.decision).toBe('NO_DECISION');
    expect(result.reason).toContain('DATA_BASELINE_MISMATCH');
    expect(result.reason).toContain('PRICE data is missing');
  });

  it('수급(SUPPLY) 데이터가 지연된 경우 정책에 따라 STRONG_BUY를 BUY로 강등해야 한다', () => {
    const metrics = {
      PRICE: { status: 'OK', value: 100, asOfDate: '2026-05-04', source: 'KIS', quality: 'HIGH' } as MetricValue<number>,
      // SUPPLY는 당일 일치가 필수는 아니지만, 지연 시 downgradeIfStale 정책 적용
      SUPPLY: { status: 'OK', value: 5000, asOfDate: '2026-05-03', source: 'KIS', quality: 'MEDIUM' } as MetricValue<number>,
    };

    const result = adjustSignalWithBaselineAlignment('STRONG_BUY', metrics, mockContext);
    
    expect(result.decision).toBe('BUY');
    expect(result.downgraded).toBe(true);
    expect(result.reason).toContain('SUPPLY is delayed');
  });

  it('엄격한 기준일 일치를 요구하는 섹터(SECTOR) 데이터가 오래된 경우 NO_DECISION으로 차단해야 한다', () => {
    const metrics = {
      PRICE: { status: 'OK', value: 100, asOfDate: '2026-05-04', source: 'KIS', quality: 'HIGH' } as MetricValue<number>,
      SECTOR: { status: 'OK', value: 50, asOfDate: '2026-05-02', source: 'KRX', quality: 'HIGH' } as MetricValue<number>,
    };

    const result = adjustSignalWithBaselineAlignment('STRONG_BUY', metrics, mockContext);
    
    expect(result.decision).toBe('NO_DECISION');
    expect(result.reason).toContain('SECTOR requires exact trading date');
  });

  it('재무제표(FUNDAMENTAL) 등 장기 지연이 허용된 지표는 과거 데이터라도 패널티를 주지 않아야 한다', () => {
    const metrics = {
      PRICE: { status: 'OK', value: 100, asOfDate: '2026-05-04', source: 'KIS', quality: 'HIGH' } as MetricValue<number>,
      // FUNDAMENTAL은 downgradeIfStale 정책이 false이므로 영향을 주지 않음
      FUNDAMENTAL: { status: 'OK', value: 10, asOfDate: '2026-03-31', source: 'DART', quality: 'HIGH' } as MetricValue<number>,
    };

    const result = adjustSignalWithBaselineAlignment('STRONG_BUY', metrics, mockContext);
    
    expect(result.decision).toBe('STRONG_BUY');
  });
});