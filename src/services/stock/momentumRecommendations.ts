/**
 * momentumRecommendations.ts — MOMENTUM / EARLY_DETECT / SMALL_MID_CAP 모드 AI 추천 로직
 *
 * 사전 수집(KIS 랭킹 + Yahoo + ECOS) 데이터에 100% 의존.
 * googleSearch grounding 제거 — 호출당 $0.035 절감.
 * AI 역할: 수치 검색이 아니라 "사전 수집된 후보군에서 선정 + 사유 작성".
 */

import { AI_MODELS } from "../../constants/aiConfig";
import { getAI, lsGet, withRetry, safeJsonParse, getCachedAIResponse } from './aiClient';
import { enrichStockWithRealData } from './enrichment';
import { fetchMarketIndicators } from './marketOverview';
import { fetchKisRanking, type KisRankingItem } from './kisDataFetcher';
import { debugLog } from '../../utils/debug';
import { fetchSectorEnergy, formatSectorEnergySummary } from '../quant/sectorEnergyProvider';
import type { StockFilters, RecommendationResponse } from './types';

// ── 후보 종목 PER/PBR 사전조회 ──────────────────────────────────────────────
// `/api/krx/valuation` 은 enrichment.ts 가 AI 응답 후 호출하지만, 여기서 AI
// 프롬프트에도 같은 소스를 주입해 Gemini 가 PER 을 추정하거나 학습지식으로
// 대체할 여지를 제거한다. 요청은 동시 6건으로 제한해 KIS TR 쿼터를 보호한다.

interface PrefetchedValuation {
  per: number;
  pbr: number;
  marketCapDisplay: string;
}

async function prefetchValuations(codes: string[]): Promise<Map<string, PrefetchedValuation>> {
  const out = new Map<string, PrefetchedValuation>();
  const queue = codes.filter(c => /^\d{6}$/.test(c));
  const CONCURRENCY = 6;
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const code = queue.shift();
      if (!code) return;
      try {
        const res = await fetch(`/api/krx/valuation?code=${code}`);
        if (!res.ok) continue;
        const data = await res.json();
        const per = Number(data?.per) || 0;
        const pbr = Number(data?.pbr) || 0;
        const marketCapDisplay = typeof data?.marketCapDisplay === 'string' ? data.marketCapDisplay : '';
        if (per > 0 || pbr > 0 || marketCapDisplay) {
          out.set(code, { per, pbr, marketCapDisplay });
        }
      } catch {
        // per-code 실패는 무시 — 해당 종목만 추정 없이 진행
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return out;
}

export async function getMomentumRecommendations(filters?: StockFilters): Promise<RecommendationResponse | null> {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const mode = filters?.mode || 'MOMENTUM';

  // ── 사전 수집 실데이터: Yahoo + ECOS + KIS 랭킹 ──
  // mode별로 적절한 KIS 랭킹을 병렬 수집하여 후보군을 사전 확정한다.
  // EARLY_DETECT는 거래량 마름이 핵심이라 등락률 하단도 별도 수집.
  const rankingTasks: Promise<KisRankingItem[]>[] = [
    fetchKisRanking('volume', 25),
    fetchKisRanking('fluctuation', 25),
  ];
  if (mode === 'SMALL_MID_CAP') {
    rankingTasks.push(fetchKisRanking('market-cap', 50));
  }
  // 섹터 에너지는 랭킹 배열 인덱싱과 얽히지 않도록 별도 Promise 로 분리.
  const sectorEnergyPromise = fetchSectorEnergy();
  const [yahooCached, volRankR, flucRankR, mcapRankR] = await Promise.allSettled([
    fetchMarketIndicators(),
    ...rankingTasks,
  ]);
  const sectorEnergy = await sectorEnergyPromise;
  const yahoo = yahooCached.status === 'fulfilled' ? yahooCached.value : null;
  const volRanking  = volRankR?.status  === 'fulfilled' ? volRankR.value  : [];
  const flucRanking = flucRankR?.status === 'fulfilled' ? flucRankR.value : [];
  const mcapRanking = mcapRankR?.status === 'fulfilled' ? mcapRankR.value : [];

  const macroCached = lsGet(`macro-environment-${todayDate}`)?.data as Record<string, unknown> | undefined;
  const cachedVkospi     = yahoo?.vkospi     ?? null;
  const cachedUs10y      = yahoo?.us10yYield ?? null;
  const cachedUsdKrw     = (macroCached?.usdKrw as number | undefined) ?? null;
  const cachedKospi      = yahoo?.kospi  ?? null;
  const cachedKosdaq     = yahoo?.kosdaq ?? null;

  // ── 후보군 빌드: mode별 필터링 ──
  // 같은 종목이 volume/fluctuation 양쪽에 등장하면 한 번만.
  const candidatePool = new Map<string, KisRankingItem & { source: string }>();
  const addPool = (items: KisRankingItem[], source: string) => {
    for (const it of items) {
      if (!it.code || candidatePool.has(it.code)) continue;
      candidatePool.set(it.code, { ...it, source });
    }
  };
  if (mode === 'EARLY_DETECT') {
    // 급등 전 종목: 등락률 0~3% 구간 + 거래량 상위 (마름 후보)
    addPool(volRanking.filter(r => r.changePercent >= -1 && r.changePercent <= 3), 'volume(저변동)');
    addPool(flucRanking.filter(r => r.changePercent >= 0 && r.changePercent <= 3), 'fluctuation(소폭상승)');
  } else if (mode === 'SMALL_MID_CAP') {
    // 중소형주: 시총 50위 밖 우선, 초대형주 제외
    const megaCapCodes = new Set(mcapRanking.slice(0, 10).map(r => r.code));
    addPool(volRanking.filter(r => !megaCapCodes.has(r.code)), 'volume(중소형)');
    addPool(flucRanking.filter(r => !megaCapCodes.has(r.code)), 'fluctuation(중소형)');
  } else {
    // MOMENTUM: 기본 — 거래량 + 등락률 양쪽 전부
    addPool(volRanking, 'volume');
    addPool(flucRanking, 'fluctuation');
  }
  const candidates = Array.from(candidatePool.values()).slice(0, 30);
  debugLog(`[momentumRecommendations] mode=${mode} 후보군 ${candidates.length}개 (vol=${volRanking.length}, fluc=${flucRanking.length})`);

  // 후보 PER/PBR/시총 사전조회 — Gemini 가 학습지식으로 밸류에이션을 추정하지 않도록
  // 프롬프트에 직접 주입한다. enrichment 가 동일 소스를 AI 응답 후에도 재조회해 덮어쓴다.
  const valuationMap = await prefetchValuations(candidates.map(c => c.code));
  debugLog(`[momentumRecommendations] 밸류에이션 프리페치 ${valuationMap.size}/${candidates.length}건`);

  const candidateBlock = candidates.length > 0
    ? candidates.map(c => {
        const v = valuationMap.get(c.code);
        const valStr = v
          ? ` | PER ${v.per > 0 ? v.per.toFixed(2) : 'N/A'} · PBR ${v.pbr > 0 ? v.pbr.toFixed(2) : 'N/A'}${v.marketCapDisplay ? ` · 시총 ${v.marketCapDisplay}` : ''}`
          : '';
        return `  - ${c.name}(${c.code}) ${c.market} | 등락 ${c.changePercent >= 0 ? '+' : ''}${c.changePercent.toFixed(2)}% | rank#${c.rank} (${c.source})${valStr}`;
      }).join('\n')
    : '(KIS 랭킹 수집 실패 — AI 자체 판단 필요)';

  const indexLine = (cachedKospi || cachedKosdaq)
    ? [
        cachedKospi  ? `KOSPI ${cachedKospi.price.toFixed(2)} (${cachedKospi.changePct >= 0 ? '+' : ''}${cachedKospi.changePct.toFixed(2)}%)` : '',
        cachedKosdaq ? `KOSDAQ ${cachedKosdaq.price.toFixed(2)} (${cachedKosdaq.changePct >= 0 ? '+' : ''}${cachedKosdaq.changePct.toFixed(2)}%)` : '',
      ].filter(Boolean).join(' | ')
    : '';

  const sectorEnergyLine = formatSectorEnergySummary(sectorEnergy);
  const preFilledBlock = [
    indexLine        ? `- 한국 지수: ${indexLine} (Yahoo 실데이터)` : '',
    cachedVkospi  !== null ? `- VKOSPI: ${cachedVkospi.toFixed(2)} (Yahoo 실데이터)` : '',
    cachedUs10y   !== null ? `- 미국 10년물 국채 금리: ${cachedUs10y.toFixed(2)}% (Yahoo ^TNX)` : '',
    cachedUsdKrw  !== null ? `- USD/KRW 환율: ${cachedUsdKrw.toFixed(0)}원 (ECOS)` : '',
    sectorEnergyLine ? `- 섹터 에너지 (KRX 12섹터 실데이터): ${sectorEnergyLine}` : '',
  ].filter(Boolean).join('\n');

  // ── Gate-0: 유니버스 제한 프롬프트 ──
  const universe = filters?.universe;
  let universePrompt = '';
  if (universe) {
    const parts: string[] = [];
    const marketLabel = universe.market === 'J' ? '코스피(KOSPI)' : universe.market === 'Q' ? '코스닥(KOSDAQ)' : '코스피+코스닥 전체';
    if (universe.preset === 'KOSPI200') parts.push('- 탐색 범위를 KOSPI 200 구성종목으로 한정하라');
    else if (universe.preset === 'KOSDAQ150') parts.push('- 탐색 범위를 KOSDAQ 150 구성종목으로 한정하라');
    else parts.push(`- 탐색 범위: ${marketLabel} 상장 종목`);
    if (universe.filters.minMarketCapBillion) parts.push(`- 시가총액 ${universe.filters.minMarketCapBillion.toLocaleString()}억원 이상`);
    if (universe.filters.volumeTopPercent) parts.push(`- 거래량 상위 ${universe.filters.volumeTopPercent}% 이내 종목만`);
    if (universe.filters.foreignOwned) parts.push('- 외국인 투자 가능 종목(외국인 편입 종목)만');
    if (parts.length > 0) universePrompt = `\n      [Gate-0: 유니버스 제한]\n      ${parts.join('\n      ')}\n      위 유니버스 조건을 반드시 먼저 적용하라.\n`;
  }

  const filterPrompt = filters ? `
      ${universePrompt}
      [사용자 정의 정량 필터]
      - ROE > ${filters.minRoe || 0}%
      - PER < ${filters.maxPer || 999}
      - 부채비율 < ${filters.maxDebtRatio || 999}%
      - 시가총액 > ${filters.minMarketCap || 0}억
      이 조건을 만족하는 종목들 중에서만 추천하라.
  ` : '';

  const modePrompt = mode === 'EARLY_DETECT' ? `
      [선행 신호 우선 탐색 - 급등 전 종목 포착 모드]
      다음 조건을 모두 또는 대부분 충족하는 종목을 최우선으로 선정하라:
      1. 주가 상승률: 최근 1개월 기준 KOSPI/KOSDAQ 대비 아웃퍼폼하되, 단기(5일) 상승률은 3% 미만인 종목 (이미 급등한 종목 제외)
      2. 거래량 조건: 최근 3~5일 거래량이 20일 평균의 50% 이하로 마른 상태 (매도 물량 소진 신호, VCP 패턴)
      3. 기술적 위치: 52주 신고가 대비 -5% 이내 근접, 볼린저밴드 폭(BBWidth)이 최근 3개월 내 최저 수준, 주가가 주요 이평선(20일, 60일) 위에서 횡보 중
      4. 수급 조건: 기관이 최근 3~7일간 조용히 소량 순매수 중, 외국인 매수는 아직 본격화되지 않은 상태
      5. 섹터 조건: 해당 섹터 대장주가 이미 신고가를 경신했으나, 해당 종목은 아직 대장주 대비 상승률이 30% 이상 뒤처진 상태

      위 조건을 충족할수록 높은 confidenceScore를 부여하고, 이미 단기 급등(5일 기준 +15% 이상)한 종목은 추천에서 제외하라.
  ` : mode === 'SMALL_MID_CAP' ? `
      [중소형주 주도주 포착 모드 - 시가총액 1,000억~3조원 범위 확장]
      대형주 위주의 주도주 탐색을 중소형주까지 확대한다. 다음 조건에 집중하라:
      1. 시가총액: 코스피/코스닥 중형주 (1,000억~3조원) 또는 소형주 (300억~1,000억원) 우선
         - 대형주(시총 3조 이상)는 기본 MOMENTUM 모드에서 다루므로 이 모드에서는 비중을 줄인다.
      2. 주도 테마 후발주: 현재 대형주 주도 테마(반도체, 방산, 조선, 바이오 등)에서 아직 급등하지 않은 중소형 연관 종목
         - 대장주가 이미 신고가 경신 → 해당 섹터 중소형주 중 아직 상승률이 30% 이상 뒤처진 종목
      3. 코스닥 집중: 코스닥 시장의 중소형 성장주를 우선 탐색한다.
         - 영업이익 턴어라운드, 신사업 진입, 정부 정책 수혜 등 실체적 성장 촉매 보유 종목
      4. 수급 이상 신호: 시총 대비 이례적으로 많은 거래량 발생(거래량 20일 평균 대비 200% 이상)
      5. 기술적 조건: 장기 하락 후 첫 상승 구간 진입(골든크로스 발생 이내 10거래일)
      6. 중소형주 특성상 변동성이 크므로 손절선을 타이트하게(-5~-7%) 설정하라.

      [중요] 코스닥 상장 종목, 코스피 중소형주를 반드시 포함시켜라. 삼성전자, SK하이닉스 등 초대형주는 이 모드에서 제외하라.
      위 조건을 충족할수록 높은 confidenceScore를 부여하고, 이미 단기 급등(5일 기준 +20% 이상)한 종목은 추천에서 제외하라.
  ` : `
      [모멘텀 추종 - 현재 주도주 포착 모드]
      현재 시장에서 가장 강력한 상승 모멘텀을 가진 주도주를 선정하라.
      기관과 외국인의 동반 대량 매수가 확인되고, 신고가를 경신하며 추세가 강화되는 종목을 우선한다.
  `;

  const prompt = `
      [절대 원칙: 사전 수집 실데이터 100% 의존 — 외부 검색 금지]
      현재 한국 시각은 ${now}입니다. (오늘 날짜: ${todayDate})
      추천 모드: ${mode === 'EARLY_DETECT' ? '미리 볼 종목 (Early Detect)' : mode === 'SMALL_MID_CAP' ? '중소형주 주도주 (Small/Mid-Cap)' : '지금 살 종목 (Momentum)'}

      [후보군 — KIS 실데이터 랭킹에서 사전 추출, 이 목록 외 종목은 추천 금지]
${candidateBlock}

      [사전 수집 거시지표]
${preFilledBlock || '      (사전 수집 데이터 없음)'}

      ${filterPrompt}
      ${modePrompt}

      [중요 알림: 기술적 지표 실계산 시스템 도입]
      당신이 반환한 JSON은 이후 enrichStockWithRealData()가 Yahoo OHLCV로 RSI/MACD/볼린저/VCP/이치모쿠를 정확히 재계산하고,
      DART corpCode 자동 매핑, KIS 수급/공매도 실데이터 주입까지 자동 수행합니다.
      따라서 당신의 역할은 후보군에서 5개 이내를 선정하고 정성적 사유(reason, sectorAnalysis 등)를 작성하는 것입니다.
      현재가·기술지표·재무수치는 0으로 두어도 됩니다 — Enrichment가 실데이터로 덮어씁니다.
      시가총액·PER·PBR 은 [후보군] 라인에 이미 KRX 실데이터가 주입돼 있으니 그 값을 그대로 필드에 옮기고 추정하지 마라.

      [선정 절차 — 외부 검색 없이 위 후보군과 거시지표만으로]
      1. 위 [후보군] 목록과 거시지표·모드 조건을 종합하여 시장 상황(BULL/BEAR/SIDEWAYS)을 1차 진단하라.
      2. 후보군에서 모드 조건(MOMENTUM/EARLY_DETECT/SMALL_MID_CAP)에 가장 부합하는 3~5개를 선정하라.
      3. **[코드/이름 정확성]** 반드시 위 후보군에 등장한 6자리 종목코드와 한글명을 그대로 사용하라. 임의 생성 금지.
      4. **[corpCode]** 알려진 8자리 DART 고유번호를 'corpCode' 필드에 포함하라. 미상이면 빈 문자열 ""로 두면 enrichment에서 자동 매핑된다.
      5. **[차트 패턴 분석]** 학습된 지식 + 후보군 등락률 데이터로 패턴을 추정하라:
         - 상승 패턴: 상승삼각형, 상승플래그, 상승패넌트, 컵 앤 핸들, 삼각수렴
         - 상승 반전: 쌍바닥(Double Bottom), 3중바닥, 하락쐐기, 역 헤드 앤 숄더(Inverse H&S), 라운드 바텀
         - 하락 패턴: 하락삼각형, 하락플래그, 하락패넌트, 상승쐐기
         - 하락 반전: 브로드닝 탑, 더블 탑(쌍봉), 트리플 탑, 헤드 앤 숄더(H&S), 라운드 탑, 다이아몬드 탑
      6. **[뉴스 데이터]** 'latestNews' 필드는 빈 배열 []로 두라. 별도 뉴스 파이프라인이 채운다.
      7. **[판단 기준 - STRONG_BUY, BUY, STRONG_SELL, SELL]**
         - ${mode === 'EARLY_DETECT' ? 'EARLY_DETECT 모드에서는 거래량 마름과 횡보 후 돌파 직전 신호를 가장 높게 평가하라.' : mode === 'SMALL_MID_CAP' ? 'SMALL_MID_CAP 모드에서는 코스닥 중소형주의 거래량 급증과 섹터 후발주 특성을 가장 높게 평가하라.' : 'MOMENTUM 모드에서는 강력한 수급과 추세 강도를 가장 높게 평가하라.'}
         [BUY/STRONG_BUY 발동 전 필수 선결 조건 - 하나라도 미충족 시 즉시 HOLD]
        ① Gate 1 전부 통과 필수: cycleVerified, roeType3, riskOnEnvironment, mechanicalStop, notPreviousLeader 중 하나라도 False이면 HOLD.
        ② RRR 최소 기준 필수: BUY 2.0 이상, STRONG_BUY 3.0 이상. 미충족 시 HOLD.
        ③ 일목균형표 구름대 위치 필수: ichimokuStatus가 ABOVE_CLOUD 상태여야만 BUY 허용.
        ④ 다이버전스 부재 필수: divergenceCheck가 False이면 STRONG_BUY 발동 금지 (BUY로 강등).

        [BUY 수치 임계값 — 반드시 모두 충족]
        - 기술적 조건: RSI 40~70, 이격도(20일) 97~105%, 볼린저밴드 LOWER_TOUCH 또는 CENTER_REVERSION, MACD 히스토그램 전환/확대 중.
        - 수급 조건: 외인+기관 동반 순매수(BUY 3일, STRONG_BUY 5일), 거래량 20일 평균 150% 이상.
        - 펀더멘털 조건: OCF > 당기순이익, 부채비율 100% 미만, 이자보상배율 3배 초과.
        - 시장 환경 조건: VKOSPI 25 미만, BEAR/RISK_OFF 시 STRONG_BUY 금지 및 BUY 비중 축소.

         - **STRONG_BUY**: 압도적인 상승 모멘텀(RS 상위 5% 이내), 주도주 사이클 초입(신고가 경신), 기관/외인 5거래일 연속 순매수 필수, 모든 기술적 지표가 완벽한 정배열 및 상향 돌파를 가리키며, 27개 체크리스트 중 25개 이상을 만족하는 경우.
         - **BUY**: 명확한 상승 추세, 주도 섹터 1~2순위 부합, 안정적인 수급 유입(최근 5일 중 3일 이상 순매수), 주요 지지선에서의 반등이 확인되었으며, 27개 체크리스트 중 22개 이상을 만족하는 경우.
         - **STRONG_SELL**: 추세 붕괴, 재료 소멸, 극심한 고평가, 대규모 수급 이탈이 명확하며 하락 압력이 매우 강한 경우.
         - **SELL**: 추세 약화, 모멘텀 둔화, 수급 이탈 조짐, 기술적 저항에 부딪힌 경우.
      8. **[엄격한 평가 원칙]** 단순히 '좋아 보인다'는 이유로 BUY를 주지 마라. 위 기준을 '보수적'으로 적용하여 데이터가 확실할 때만 긍정적 의견을 제시하라.
      9. **[수치 필드 처리]** currentPrice 는 0으로 두라(enrichment가 실시간 시세로 덮어쓴다). 다만 valuation.per/pbr 및 시가총액은 위 [후보군] 라인에 주입된 KRX 실데이터 값(PER/PBR/시총)을 그대로 사용하라. PER/PBR 이 N/A 또는 부재한 종목만 0으로 두며, 학습지식 기반 추정은 금지한다.
      10. **[트레이딩 전략 수립]** 각 종목에 대해 현재가 기준 최적의 '진입가(entryPrice)', '손절가(stopLoss)', '1차 목표가(targetPrice)', '2차 목표가(targetPrice2)'를 기술적 분석(지지/저항, 피보나치 등)을 통해 비율 기반으로 산출하라. 절대치 추정 어려우면 0으로 두면 enrichment가 보정한다.
      11. **[데이터 출처 명시]** 'dataSource' 필드는 "KIS 랭킹 + Gemini 사전수집데이터" 등으로 명시하라.
      12. **[글로벌 ETF 모니터링]** 'globalEtfMonitoring' 필드는 빈 배열 []로 두라. (별도 ETF 모니터링 파이프라인이 채운다)
      12-1. **[환율/국채 데이터]** 위 [사전 수집 거시지표]의 USD/KRW 환율과 10년물 금리를 그대로 사용하라. 'exchangeRate': { "value": 환율숫자, "change": 0 }, 'bondYield': { "value": 금리숫자, "change": 0 } 형식.
      13. **[장세 전환 감지]** 현재 시장의 주도 섹터가 바뀌고 있는지(Regime Shift)를 판단하여 'regimeShiftDetector' 필드에 반영하라.
      14. **[다중 시계열 분석]** 월봉, 주봉, 일봉의 추세가 일치하는지 확인하여 'multiTimeframe' 필드에 반영하라.
      15. **[눌림목 성격 판단 (Pullback Analysis)]** 주가가 조정(눌림목)을 받을 때 거래량이 감소하는지(건전한 조정) 또는 증가하는지(매도 압력)를 반드시 확인하여 'technicalSignals'의 'volumeSurge' 및 'reason' 필드에 반영하라. 거래량이 줄어들며 지지받는 눌림목을 최우선으로 추천하라.
      16. **[섹터 에너지 반영]** 위 [사전 수집 거시지표] 의 "섹터 에너지" 항목이 KRX 실데이터 기반 주도/소외 섹터를 제공한다. 해당 종목의 섹터가 주도 섹터(Top 3)에 포함되면 'isLeadingSector' = true 및 'isSectorTopPick' 우대, 소외 섹터에 속하면 포지션 사이즈 축소 및 BUY 기준 상향. 섹터 에너지 라인이 없을 때만 학습지식 기반으로 대장주 신고가 선행 여부를 추정하라.
      17. **[AI 공시 감성 분석]** 'disclosureSentiment'는 학습 지식 기반의 일반론으로 채우거나 score 0/summary "데이터 없음"으로 두라. 별도 DART 공시 파이프라인이 채운다.
      18. **[공매도/대차잔고 분석]** 'shortSelling' 필드는 ratio 0, trend "STABLE"로 두라. KIS API enrichment가 실데이터로 덮어쓴다.
      19. **[텐배거 DNA 패턴 매칭]** 다음 과거 대장주들의 급등 직전 DNA와 현재 종목을 비교하여 'tenbaggerDNA' 필드에 유사도(similarity, 0-100)와 매칭 패턴명, 이유를 기술하라.
          - **에코프로(2023)**: RSI 45-55(과열 전), 거래량 마름(VCP), 대장주 신고가 선행, ROE 유형 3, 전 사이클 비주도주.
          - **씨젠(2020)**: 폭발적 실적 가속도(OPM 급증), 강력한 외부 촉매제(팬데믹), 이평선 정배열 초입.
          - **HD현대중공업(2024)**: 장기 바닥권 탈출, 섹터 전체 수주 잔고 폭증, 기관/외인 역대급 쌍끌이 매수.
      20. **[적의 체크리스트 (Enemy's Checklist)]** 해당 종목의 하락 시나리오(Bear Case), 주요 리스크 요인, 그리고 매수 논거에 대한 반박(Counter Arguments)을 분석하여 'enemyChecklist' 필드에 반영하라.
      21. **[계절성 레이어 (Seasonality Layer)]** 현재 월(${todayDate.split('-')[1]}월)의 해당 종목 또는 섹터의 역사적 수익률, 승률, 성수기 여부를 분석하여 'seasonality' 필드에 반영하라.
      22. **[수익률 귀인 분석 (Attribution Analysis)]** 해당 종목의 추천 강도를 섹터 기여도, 모멘텀 기여도, 밸류 기여도, 그리고 알파(개별 종목 특성)로 세분화하여 'attribution' 필드에 반영하라.
      23. **[8시간 비동기 해소 (Timezone Sync)]** 한국 시장(KST)과 미국 시장(EST)의 시차를 고려하여, 미국 지수는 전일 종가가 아닌 '현재 실시간 선물 지수' 또는 '가장 최근 마감 지수'를 정확히 구분하여 반영하라.
      24. **[3-Gate Triage 분류]** 각 종목을 다음 기준에 따라 Gate 1, 2, 3으로 분류하라:
          - **Gate 1 (Survival Filter)**: 주도주 사이클, ROE 유형 3, 시장 환경 Risk-On, 기계적 손절 설정, 신규 주도주 여부 등 5대 생존 조건 충족 여부. (최소 조건)
          - **Gate 2 (Growth Verification)**: 수급 질, 일목균형표, 경제적 해자, 기술적 정배열, 거래량, 기관/외인 수급, 목표가 여력, 실적 서프라이즈, 실체적 펀더멘털, 정책/매크로, 이익의 질 OCF, 상대강도 RS 등 12개 항목 중 9개 이상 충족.
          - **Gate 3 (Precision Timing)**: 심리적 객관성, 터틀 돌파, 피보나치, 엘리엇 파동, 마크 미너비니 VCP, 변동성 축적 등 10개 정밀 타이밍 조건 분석.
          - 가장 높은 단계를 'gate' 필드(1, 2, 3)에 숫자로 기록하라.

      [AI 기반 동적 가중치 (Dynamic Weighting) 적용]
      현재 판단된 장세(BULL, BEAR, SIDEWAYS, TRANSITION)에 따라 27개 체크리스트 항목의 배점을 정밀 조절하여 'Confidence Score'를 계산하라.
      - 약세장(BEAR/RISK_OFF)일수록 재무방어력과 이익의 질에 높은 가중치를 두어라.
      - 강세장(BULL/RISK_ON)일수록 모멘텀과 기술적 돌파에 높은 가중치를 두어라.

      [시장 상황에 따른 추천 전략]
      1. 시황이 좋지 않은 경우(BEAR, VKOSPI 25 이상 등)에는 종목 추천을 최소화(0~3개)하라.
      2. 시황이 극도로 악화된 경우 "현재는 현금 비중 확대 및 관망이 필요한 시점입니다"라는 메시지와 함께 추천 종목을 반드시 빈 배열([])로 반환하라.
      3. 추천 종목이 있다면 최대 5개까지만 추천하여 응답의 완성도를 높여라.
      4. **[필수]** 'reason' 필드는 해당 종목의 점수나 등급에 가장 큰 영향을 미친 구체적인 기술적 지표나 펀더멘털 요인을 반드시 포함하여 2~3문장으로 핵심만 상세히 작성하라.
      5. **[필수]** 'sectorAnalysis' 필드는 해당 종목이 속한 산업 섹터에 대한 AI 분석을 제공하라. 다음 내용을 반드시 포함해야 한다:
         - sectorName: 산업 명칭
         - currentTrends: 주요 트렌드 2~3가지
         - leadingStocks: 주도 상위 3개 종목 (종목명, 코드, 시가총액)
         - catalysts: 주가 견인 촉매제 2~3가지
         - riskFactors: 리스크 요인 2~3가지
      6. 각 필드의 설명(description 등)은 핵심 위주로 매우 간결하게 작성하라.
      7. 불필요한 수식어나 중복된 정보는 배제하라.
      8. 반드시 유효한 JSON 형식으로 닫는 중괄호까지 완벽하게 작성하라.
      9. 종목은 최대 5개까지만 추천하라.

    응답은 반드시 다음 JSON 형식으로만 하며, 절대 중간에 끊기지 않도록 끝까지 완성하라:
    {
      "marketContext": {
        "kospi": { "index": 0, "change": 0, "changePercent": 0, "status": "NEUTRAL", "analysis": "...", "ma200": 2650.5 },
        "kosdaq": { "index": 0, "change": 0, "changePercent": 0, "status": "NEUTRAL", "analysis": "..." },
        "globalIndices": { "nasdaq": { "index": 0, "changePercent": 0 }, "snp500": { "index": 0, "changePercent": 0 }, "dow": { "index": 0, "changePercent": 0 }, "sox": { "index": 0, "changePercent": 0 } },
        "globalMacro": { "us10yYield": 0, "brentOil": 0, "gold": 0, "dollarIndex": 0 },
        "fearAndGreed": { "value": 0, "status": "..." },
        "iri": 0, "vkospi": 0,
        "globalEtfMonitoring": [
          { "symbol": "069500", "name": "KODEX 200", "price": 35000, "change": 0.8, "flow": "INFLOW", "implication": "외국인 순매수 유입" },
          { "symbol": "360750", "name": "TIGER 미국S&P500", "price": 18500, "change": -0.3, "flow": "OUTFLOW", "implication": "미국 증시 조정 반영" }
        ],
        "regimeShiftDetector": {
          "currentRegime": "...",
          "nextRegimeProbability": 0,
          "leadingIndicator": "..."
        },
        "volumeTrend": "STABLE",
        "exchangeRate": { "value": 0, "change": 0 },
        "bondYield": { "value": 0, "change": 0 },
        "overallSentiment": "...",
        "marketPhase": "BULL",
        "activeStrategy": "...",
        "dataSource": "..."
      },
      "recommendations": [
        {
          "name": "종목명", "code": "종목코드", "corpCode": "00123456", "reason": "...", "type": "STRONG_BUY/BUY/STRONG_SELL/SELL",
          "targetPrice": 0, "targetPrice2": 0, "entryPrice": 0, "entryPrice2": 0, "stopLoss": 0,
          "gate": 3, "patterns": ["..."], "hotness": 9, "roeType": "...",
          "isLeadingSector": true, "isSectorTopPick": true, "momentumRank": 1, "confidenceScore": 85,
          "supplyQuality": { "passive": true, "active": true }, "peakPrice": 0, "currentPrice": 0, "priceUpdatedAt": "...", "dataSource": "...",
          "isPreviousLeader": false, "ichimokuStatus": "ABOVE_CLOUD", "relatedSectors": ["..."],
          "valuation": { "per": 0, "pbr": 0, "epsGrowth": 0, "debtRatio": 0 },
          "technicalSignals": {
            "maAlignment": "BULLISH", "rsi": 0, "macdStatus": "GOLDEN_CROSS", "bollingerStatus": "NEUTRAL", "stochasticStatus": "NEUTRAL", "volumeSurge": true, "disparity20": 0, "macdHistogram": 0, "bbWidth": 0, "stochRsi": 0,
            "macdHistogramDetail": { "status": "BULLISH", "implication": "..." },
            "bbWidthDetail": { "status": "SQUEEZE", "implication": "..." },
            "stochRsiDetail": { "status": "OVERSOLD", "implication": "..." }
          },
          "economicMoat": { "type": "BRAND", "description": "..." },
          "scores": { "value": 0, "momentum": 0 },
          "shortSelling": { "ratio": 0, "trend": "DECREASING", "implication": "..." },
          "tenbaggerDNA": { "similarity": 0, "matchPattern": "에코프로2023", "reason": "..." },
          "checklist": { "cycleVerified": true, "momentumRanking": true, "roeType3": true, "supplyInflow": true, "riskOnEnvironment": true, "ichimokuBreakout": true, "mechanicalStop": true, "economicMoatVerified": true, "notPreviousLeader": true, "technicalGoldenCross": true, "volumeSurgeVerified": true, "institutionalBuying": true, "consensusTarget": true, "earningsSurprise": true, "performanceReality": true, "policyAlignment": true, "psychologicalObjectivity": true, "turtleBreakout": true, "fibonacciLevel": true, "elliottWaveVerified": true, "ocfQuality": true, "marginAcceleration": true, "interestCoverage": true, "relativeStrength": true, "vcpPattern": true, "divergenceCheck": true, "catalystAnalysis": true },
          "catalystDetail": { "description": "...", "score": 15, "upcomingEvents": ["..."] },
          "catalystSummary": "촉매제 분석 통과 이유(예: 실적 발표 예정, 정부 정책 수혜 등)를 20자 이내로 요약",
          "visualReport": { "financial": 1, "technical": 1, "supply": 1, "summary": "..." },
          "elliottWaveStatus": { "wave": "WAVE_3", "description": "..." },
          "analystRatings": { "strongBuy": 0, "buy": 0, "strongSell": 0, "sell": 0, "consensus": "...", "targetPriceAvg": 0, "targetPriceHigh": 0, "targetPriceLow": 0, "sources": ["..."] },
          "newsSentiment": { "score": 0, "status": "POSITIVE", "summary": "..." },
          "chartPattern": { "name": "역 헤드 앤 숄더", "type": "REVERSAL_BULLISH", "description": "강력한 바닥 다지기 후 추세 반전 신호", "reliability": 85 },
          "roeAnalysis": { "drivers": ["..."], "historicalTrend": "...", "strategy": "...", "metrics": { "netProfitMargin": 0, "assetTurnover": 0, "equityMultiplier": 0 } },
          "strategicInsight": { "cyclePosition": "NEW_LEADER", "earningsQuality": "...", "policyContext": "..." },
          "marketCap": 0, "marketCapCategory": "LARGE", "correlationGroup": "...",
          "aiConvictionScore": { "totalScore": 0, "factors": [{ "name": "...", "score": 0, "weight": 0 }], "marketPhase": "BULL", "description": "..." },
          "disclosureSentiment": { "score": 0, "summary": "..." },
          "isPullbackVolumeLow": true,
          "sectorLeaderNewHigh": true,
          "multiTimeframe": { "monthly": "BULLISH", "weekly": "BULLISH", "daily": "BULLISH", "consistency": true },
          "enemyChecklist": { "bearCase": "...", "riskFactors": ["..."], "counterArguments": ["..."] },
          "seasonality": { "month": 0, "historicalPerformance": 0, "winRate": 0, "isPeakSeason": true },
          "attribution": { "sectorContribution": 0, "momentumContribution": 0, "valueContribution": 0, "alpha": 0 },
          "tranchePlan": {
            "tranche1": { "size": 0, "trigger": "...", "status": "PENDING" },
            "tranche2": { "size": 0, "trigger": "...", "status": "PENDING" },
            "tranche3": { "size": 0, "trigger": "...", "status": "PENDING" }
          },
          "correlationScore": 0,
          "historicalAnalogy": { "stockName": "...", "period": "...", "similarity": 0, "reason": "..." },
          "latestNews": [],
          "anomalyDetection": { "type": "FUNDAMENTAL_DIVERGENCE", "score": 0, "description": "..." },
          "semanticMapping": { "theme": "...", "keywords": ["..."], "relevanceScore": 0, "description": "..." },
          "gateEvaluation": { "gate1Passed": true, "gate2Passed": true, "gate3Passed": true, "finalScore": 0, "recommendation": "...", "positionSize": 0 },
          "sectorAnalysis": { "sectorName": "...", "currentTrends": ["..."], "leadingStocks": [{ "name": "...", "code": "...", "marketCap": "..." }], "catalysts": ["..."], "riskFactors": ["..."] },
          "dataSource": "...",
          "riskFactors": ["..."]
        }
      ]
    }

    [주의: JSON 응답 외에 어떤 텍스트도 포함하지 마라. 반드시 유효한 JSON 형식으로 닫는 중괄호까지 완벽하게 작성하라.]
  `;

  const cacheKey = `recommendations-${JSON.stringify(filters)}-${todayDate}`;

  return getCachedAIResponse(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            // googleSearch grounding 제거 — 사전 수집 KIS+Yahoo+ECOS 실데이터에 100% 의존
            // 호출당 약 $0.035 grounding 비용 절감
            maxOutputTokens: 12000,
            temperature: 0.1,
          },
        });
      }, 2, 2000);

      const text = response.text;
      if (!text) {
        console.error("Full AI Response:", JSON.stringify(response, null, 2));
        throw new Error("No response from AI");
      }
      const parsed = safeJsonParse(text);

      if (parsed && !parsed.recommendations) {
        parsed.recommendations = [];
      }

      if (parsed && parsed.recommendations.length > 0) {
        debugLog(`Enriching ${parsed.recommendations.length} recommendations with real data (sequentially)`);
        const enrichedRecommendations = [];
        for (const stock of parsed.recommendations) {
          try {
            const enriched = await enrichStockWithRealData(stock);
            enrichedRecommendations.push(enriched);
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (err) {
            console.error(`Failed to enrich ${stock.name}:`, err);
            enrichedRecommendations.push(stock);
          }
        }
        parsed.recommendations = enrichedRecommendations;
      }

      return parsed;
    } catch (error) {
      console.error("Error in getMomentumRecommendations:", error);
      throw error;
    }
  });
}
