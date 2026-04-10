import {
  SectorOverheatInput,
  SectorOverheatCondition,
  OverheatedSectorMatch,
  SectorOverheatResult,
} from '../../types/quant';

// ─── 아이디어 7: 섹터 과열 감지 + 인버스 ETF 자동 매칭 ──────────────────────────

/**
 * 섹터별 과열 인버스 ETF 자동 매핑 테이블
 * 반도체 과열 → KODEX 반도체 인버스
 * 이차전지 과열 → TIGER 2차전지TOP10 인버스
 * 조선 과열 → KODEX 조선 관련 인버스
 */
const SECTOR_INVERSE_ETF_MAP: Record<string, { etf: string; code: string }> = {
  '반도체': { etf: 'KODEX 반도체 인버스 (091160)', code: '091160' },
  '이차전지': { etf: 'TIGER 2차전지TOP10 인버스 (400810)', code: '400810' },
  '조선': { etf: 'KODEX 조선 관련 인버스 (229720)', code: '229720' },
};

/**
 * 아이디어 7: 섹터 과열 감지 + 인버스 ETF 자동 매칭
 *
 * 섹터 과열 4개 조건:
 *   1. 섹터 RS 상위 1% 진입 (sectorRsRank < 1)
 *   2. 뉴스 빈도 CROWDED 또는 OVERHYPED 단계
 *   3. 주봉 RSI 80 이상
 *   4. 외국인 Active 매수 6주 연속 과잉
 *
 * 4개 조건을 모두 충족할 때 과열(overheated)로 판정하고, 해당 섹터의 인버스 ETF를 자동 매칭한다.
 */
export function evaluateSectorOverheat(
  sectors: SectorOverheatInput[],
): SectorOverheatResult {
  const now = new Date().toISOString();

  const allSectors: OverheatedSectorMatch[] = sectors.map(sector => {
    const conditions: SectorOverheatCondition[] = [
      {
        id: 'rs_rank',
        label: '섹터 RS 상위 1% 진입 (과열)',
        triggered: sector.sectorRsRank < 1,
        value: `RS ${sector.sectorRsRank.toFixed(1)}%`,
      },
      {
        id: 'news_phase',
        label: '뉴스 빈도 CROWDED/OVERHYPED',
        triggered: sector.newsPhase === 'CROWDED' || sector.newsPhase === 'OVERHYPED',
        value: sector.newsPhase,
      },
      {
        id: 'weekly_rsi',
        label: '주봉 RSI 80 이상',
        triggered: sector.weeklyRsi >= 80,
        value: `RSI ${sector.weeklyRsi.toFixed(1)}`,
      },
      {
        id: 'foreign_buying',
        label: '외국인 Active 매수 6주 연속 과잉',
        triggered: sector.foreignActiveBuyingWeeks >= 6,
        value: `${sector.foreignActiveBuyingWeeks}주 연속`,
      },
    ];

    const triggeredCount = conditions.filter(c => c.triggered).length;
    const isFullyOverheated = triggeredCount === 4;
    const overheatScore = Math.round((triggeredCount / 4) * 100);

    const etfInfo = SECTOR_INVERSE_ETF_MAP[sector.name];
    if (!etfInfo) {
      console.warn(`[SectorOverheat] ETF 매핑 없음: ${sector.name} — 인버스 ETF 수동 확인 필요`);
    }
    const inverseEtf = etfInfo?.etf ?? `${sector.name} 인버스 ETF (수동 확인 필요)`;
    const inverseEtfCode = etfInfo?.code ?? '-';

    let recommendation: string;
    if (isFullyOverheated) {
      recommendation = `🔴 완전 과열 (4/4) — ${inverseEtf} 즉시 진입 권고. 신규 롱 포지션 중단.`;
    } else if (triggeredCount >= 3) {
      recommendation = `🟠 과열 임계치 근접 (${triggeredCount}/4) — 과열 확정 전 단계. ${inverseEtf}는 관찰 목록에 유지.`;
    } else if (triggeredCount >= 2) {
      recommendation = `🟡 과열 주의 (${triggeredCount}/4) — 과열 조건 미충족. 경보 모니터링 강화.`;
    } else {
      recommendation = `🟢 정상 사이클 (${triggeredCount}/4) — 과열 신호 미충족. 관망 유지.`;
    }

    return {
      sectorName: sector.name,
      inverseEtf,
      inverseEtfCode,
      conditions,
      triggeredCount,
      isFullyOverheated,
      overheatScore,
      recommendation,
    };
  });

  const overheatedMatches = allSectors.filter(s => s.isFullyOverheated);
  const overheatedCount = overheatedMatches.length;

  let actionMessage: string;
  if (overheatedCount === 0) {
    actionMessage = '🟢 현재 과열 감지 섹터 없음 — 전체 섹터 정상 사이클 운용 중. 롱 포지션 유지 가능.';
  } else if (overheatedCount === 1) {
    actionMessage = `🟡 1개 섹터 과열 감지 — ${overheatedMatches[0].sectorName} 섹터 과열. ${overheatedMatches[0].inverseEtf} 인버스 ETF 진입 검토. 해당 섹터 롱 포지션 비중 축소 권고.`;
  } else {
    const names = overheatedMatches.map(m => m.sectorName).join(', ');
    actionMessage = `🔴 ${overheatedCount}개 섹터 동시 과열 — ${names}. 각 섹터 인버스 ETF 즉시 진입 권고. 과열 섹터 롱 포지션 전면 축소.`;
  }

  return {
    overheatedMatches,
    allSectors,
    overheatedCount,
    actionMessage,
    lastUpdated: now,
  };
}
