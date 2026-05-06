import React from 'react';
// 프론트엔드 타입 경로
import { MetricValue } from '../../server/types/metricValue';

interface DataQualityBadgeProps {
  domainName: string;
  metric: MetricValue<any>;
}

export const DataQualityBadge: React.FC<DataQualityBadgeProps> = ({ domainName, metric }) => {
  if (metric.status === 'MISSING') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 px-2 py-1 rounded w-fit">
        <span className="font-bold">{domainName}:</span>
        <span>데이터 없음 ({metric.reason})</span>
      </div>
    );
  }

  // 신뢰도에 따른 색상 매핑
  const qualityColors = {
    HIGH: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    MEDIUM: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    LOW: 'bg-orange-50 border-orange-200 text-orange-700',
  };

  const colorClass = qualityColors[metric.quality] || qualityColors.MEDIUM;

  return (
    <div className={`flex items-center gap-1.5 text-[11px] border px-2 py-0.5 rounded w-fit ${colorClass}`}>
      <span className="font-bold">{domainName}</span>
      <span className="opacity-40">|</span>
      <span className="font-medium">{metric.quality}</span>
      <span className="opacity-40">|</span>
      <span>{metric.source}</span>
      <span className="opacity-40">|</span>
      <span>{metric.asOfDate}</span>
      
      {/* 데이터가 현재 기준일과 다를 경우 경고 아이콘 표시 (프론트엔드에서 판단 로직 추가 가능) */}
      {metric.quality === 'MEDIUM' && (
        <span title="최신 거래일 데이터가 아닐 수 있습니다." className="ml-1 cursor-help">
          ⚠️
        </span>
      )}
    </div>
  );
};

export default DataQualityBadge;