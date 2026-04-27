// @responsibility sector 도메인 타입 정의
// ─── 섹터 · 과열 감지 도메인 타입 ────────────────────────────────────────────

// ─── 아이디어 7: 섹터 과열 감지 + 인버스 ETF 자동 매칭 ─────────────────────────

/** 섹터 과열 감지 입력 데이터 (섹터별) */
export interface SectorOverheatInput {
  /** 섹터명 (예: '반도체', '이차전지', '조선') */
  name: string;
  /** 섹터 RS 상위 % — 범위 0-100, 0=최상위, 100=최하위. 1 미만(상위 1%)이면 과열 */
  sectorRsRank: number;
  /** 뉴스 빈도 단계 */
  newsPhase: 'SILENT' | 'EARLY' | 'GROWING' | 'CROWDED' | 'OVERHYPED';
  /** 주봉 RSI (80 이상이면 과열) */
  weeklyRsi: number;
  /** 외국인 Active 매수 연속 주 수 (6주 이상이면 과잉) */
  foreignActiveBuyingWeeks: number;
}

/** 섹터 과열 개별 조건 평가 */
export interface SectorOverheatCondition {
  id: string;
  label: string;
  triggered: boolean;
  value: string;
}

/** 과열 감지된 섹터와 자동 매칭된 인버스 ETF 정보 */
export interface OverheatedSectorMatch {
  sectorName: string;
  inverseEtf: string;
  inverseEtfCode: string;
  conditions: SectorOverheatCondition[];
  triggeredCount: number;
  /** 4개 조건 모두 충족 여부 */
  isFullyOverheated: boolean;
  /** 과열 점수 0~100 (충족 조건 수 비율) */
  overheatScore: number;
  recommendation: string;
}

/** 섹터 과열 감지 + 인버스 ETF 자동 매칭 전체 결과 */
export interface SectorOverheatResult {
  /** 과열 감지된 섹터 목록 (조건 4개 모두 충족) */
  overheatedMatches: OverheatedSectorMatch[];
  /** 전체 평가 섹터 목록 */
  allSectors: OverheatedSectorMatch[];
  /** 과열 감지 섹터 수 */
  overheatedCount: number;
  /** 전체 행동 권고 메시지 */
  actionMessage: string;
  lastUpdated: string;
}
