export interface RoeTypeDetail {
  title: string;
  desc: string;
  metrics: string;
  trend: string;
  strategy: string;
  detailedStrategy: string;
  color: string;
}

export const ROE_TYPE_DETAILS: Record<string, RoeTypeDetail> = {
  '유형 1': {
    title: '유형 1 (ROE 개선)',
    desc: 'ROE가 전년 대비 개선되는 기업. 턴어라운드 초기 단계.',
    metrics: '순이익률 개선, 비용 절감, 자산 효율화',
    trend: '하락 추세 멈춤 → 횡보 → 상승 반전의 초기 국면',
    strategy: '추세 전환 확인 후 분할 매수, 손절가 엄격 준수',
    detailedStrategy: '1차 매수는 비중의 30%로 시작, 20일 이평선 안착 시 추가 매수. 실적 턴어라운드 확인 필수.',
    color: 'text-blue-400',
  },
  '유형 2': {
    title: '유형 2 (ROE 고성장)',
    desc: 'ROE가 15% 이상 유지되는 고성장 기업. 안정적 수익성.',
    metrics: '높은 시장 점유율, 독점적 지위, 꾸준한 현금 흐름',
    trend: '장기 우상향 추세, 일시적 조정 후 재상승 반복',
    strategy: '눌림목 매수, 장기 보유, 실적 발표 주기 확인',
    detailedStrategy: '주요 지지선(60일/120일 이평선) 터치 시 비중 확대. 배당 성향 및 자사주 매입 여부 체크.',
    color: 'text-green-400',
  },
  '유형 3': {
    title: '유형 3 (최우선 매수)',
    desc: '매출과 이익이 함께 증가하며 ROE가 개선되는 최우선 매수 대상.',
    metrics: '매출 성장률 > 이익 성장률, 자산 회전율 급증',
    trend: '가파른 상승 각도, 거래량 동반한 전고점 돌파',
    strategy: '공격적 비중 확대, 전고점 돌파 시 추가 매수',
    detailedStrategy: '추세 추종(Trend Following) 전략 적용. 익절가를 높여가며(Trailing Stop) 수익 극대화.',
    color: 'text-orange-400',
  },
};

export function getRoeDetail(roeType: string): RoeTypeDetail | null {
  if (roeType.includes('유형 3')) return ROE_TYPE_DETAILS['유형 3'];
  if (roeType.includes('유형 2')) return ROE_TYPE_DETAILS['유형 2'];
  if (roeType.includes('유형 1')) return ROE_TYPE_DETAILS['유형 1'];
  return null;
}
