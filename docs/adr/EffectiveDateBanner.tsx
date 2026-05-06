import React from 'react';
// 프론트엔드에서 사용하는 타입 정의 경로에 맞게 조정
import { TradingContext } from '../../server/context/tradingContext';

interface EffectiveDateBannerProps {
  context: TradingContext | null;
}

export const EffectiveDateBanner: React.FC<EffectiveDateBannerProps> = ({ context }) => {
  if (!context) return null;

  const isHolidaySnapshot = context.dataMode === 'HOLIDAY_SNAPSHOT';

  return (
    <div className={`p-4 mb-6 rounded-md flex items-start sm:items-center justify-between flex-col sm:flex-row gap-4
      ${isHolidaySnapshot ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-blue-50 border border-blue-200 text-blue-800'}
    `}>
      <div>
        <h3 className="font-bold text-sm sm:text-base">
          현재 분석 기준일: {context.effectiveTradingDate} EOD
        </h3>
        <p className="text-xs sm:text-sm mt-1">
          {isHolidaySnapshot
            ? `오늘은 휴장일(${context.calendarDate})입니다. 신규 매수 신호는 생성하지 않고 마지막 확정 스냅샷을 표시합니다.`
            : '현재 실시간 거래일 기준으로 데이터를 분석 중입니다.'}
        </p>
      </div>
      
      <div className="flex items-center gap-2">
        <span className={`px-2 py-1 text-xs font-bold rounded 
          ${context.sessionState === 'OPEN' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'}
        `}>
          {context.sessionState}
        </span>
      </div>
    </div>
  );
};