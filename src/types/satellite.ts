// @responsibility satellite 도메인 타입 정의
// ─── 위성 종목 연쇄 추적 시스템 (Satellite Stock Cascader) 타입 ─────────────────

/** 개별 위성 종목 */
export interface SatelliteStock {
  /** 종목 코드 */
  code: string;
  /** 종목명 */
  name: string;
  /** 섹터명 */
  sector: string;
  /** 현재 RS 점수 (0~100) */
  rsScore: number;
  /** 주도주 RS 대비 차이 (음수 = 주도주보다 낮음) */
  rsDelta: number;
  /** 최근 7일간 RS 변화 추이 (양수 = 따라잡기 시작) */
  rsTrend: number;
  /** 주도주 본격 상승 이후 경과 주 수 */
  weeksAfterLeader: number;
  /** 지연 진입 신호 여부 (RS 20% 이상 낮은 상태에서 따라잡기 시작) */
  laggardSignal: boolean;
  /** 예상 추격 진입 시기 (weeksAfterLeader 4~8주 구간) */
  expectedEntryWindow: 'TOO_EARLY' | 'ENTRY_WINDOW' | 'LATE';
  /** 최근 거래량 배율 (20일 평균 대비) */
  volumeMultiple: number;
}

/** 위성 목록 등록 입력 (주도주 1종목 + 동일 섹터 후보 목록) */
export interface SatelliteCascaderInput {
  /** 주도주 종목 코드 */
  leaderCode: string;
  /** 주도주 종목명 */
  leaderName: string;
  /** 주도주 섹터 */
  leaderSector: string;
  /** 주도주 RS 점수 */
  leaderRsScore: number;
  /** 주도주 Gate 3 통과·매수 진입일 (ISO 날짜) */
  leaderEntryDate: string;
  /** 동일 섹터 위성 후보 종목 목록 */
  satellites: SatelliteStockInput[];
}

/** 위성 후보 종목 입력 */
export interface SatelliteStockInput {
  code: string;
  name: string;
  /** 현재 RS 점수 */
  rsScore: number;
  /** 최근 7일 RS 변화 (양수 = 상승 중) */
  rsTrend: number;
  /** 최근 20일 평균 대비 현재 거래량 배율 */
  volumeMultiple: number;
}

/** 위성 종목 연쇄 추적 전체 결과 */
export interface SatelliteCascaderResult {
  /** 주도주 정보 */
  leader: {
    code: string;
    name: string;
    sector: string;
    rsScore: number;
    entryDate: string;
    weeksElapsed: number;
  };
  /** 평가된 위성 종목 목록 (laggardSignal 우선, RS 점수 내림차순) */
  satellites: SatelliteStock[];
  /** 지연 진입 신호가 활성화된 종목 수 */
  activeSignalCount: number;
  /** 진입 윈도우(4~8주) 내 종목 수 */
  entryWindowCount: number;
  /** 요약 메시지 */
  summary: string;
  /** 계산 시각 */
  calculatedAt: string;
}
