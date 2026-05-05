/**
 * @responsibility 장 마감 후 Supply Health 학습 샘플의 미래 수익률(1d~60d)을 갱신하는 크론 작업
 */
import { updateLearningSampleFutureReturns, type LearningSample } from '../../learning/supplyHealthLearning.js';
import { fetchCurrentPrice } from '../../clients/kisClient.js';
import { addBusinessDaysFromKstDate } from '../../trading/trancheExecutor.js';
import { sendTelegramAlert } from '../../alerts/telegramClient.js';

// NOTE: 실제 프로젝트의 영속성 저장소 경로에 맞게 수정이 필요합니다.
// (아직 없다면 shadowLearningOnlySignalRepo.ts와 유사한 형태로 구현해야 합니다.)
import { loadLearningSamples, saveLearningSamples } from '../../persistence/learningSampleRepo.js';

/**
 * 오늘 KST 날짜 반환 (YYYY-MM-DD)
 */
function getTodayKst(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * 종가(현재가) 조회 헬퍼
 */
async function fetchClosePrice(symbol: string): Promise<number | undefined> {
  try {
    const price = await fetchCurrentPrice(symbol);
    return price ?? undefined;
  } catch (error) {
    console.warn(`[LearningUpdater] ${symbol} 종가 조회 실패:`, error instanceof Error ? error.message : error);
    return undefined;
  }
}

export async function runUpdateLearningSampleReturnsJob(): Promise<void> {
  const todayKst = getTodayKst();
  console.log(`[LearningUpdater] ${todayKst} 장 마감 후 학습 샘플 수익률 갱신 시작`);

  const samples = loadLearningSamples();
  let updatedCount = 0;

  // 동일 종목에 대한 중복 API 호출 방지 캐시
  const priceCache = new Map<string, number>();

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    
    // 이미 60일까지 추적이 모두 완료된 경우 스킵
    if (sample.futureReturn60d !== undefined) continue;

    // 각 목표 영업일 산출
    const target1d = addBusinessDaysFromKstDate(sample.date, 1);
    const target5d = addBusinessDaysFromKstDate(sample.date, 5);
    const target10d = addBusinessDaysFromKstDate(sample.date, 10);
    const target20d = addBusinessDaysFromKstDate(sample.date, 20);
    const target60d = addBusinessDaysFromKstDate(sample.date, 60);

    let price1d: number | undefined;
    let price5d: number | undefined;
    let price10d: number | undefined;
    let price20d: number | undefined;
    let price60d: number | undefined;
    let needPrice = false;

    // 도달한 날짜(휴일/장애로 밀린 경우 포함)에 대해 아직 값이 없으면 갱신 대상
    if (todayKst >= target1d && sample.futureReturn1d === undefined) needPrice = true;
    if (todayKst >= target5d && sample.futureReturn5d === undefined) needPrice = true;
    if (todayKst >= target10d && sample.futureReturn10d === undefined) needPrice = true;
    if (todayKst >= target20d && sample.futureReturn20d === undefined) needPrice = true;
    if (todayKst >= target60d && sample.futureReturn60d === undefined) needPrice = true;

    if (needPrice) {
      if (!priceCache.has(sample.symbol)) {
        const price = await fetchClosePrice(sample.symbol);
        if (price !== undefined) priceCache.set(sample.symbol, price);
      }
      
      const currentPrice = priceCache.get(sample.symbol);
      
      if (currentPrice !== undefined) {
        if (todayKst >= target1d && sample.futureReturn1d === undefined) price1d = currentPrice;
        if (todayKst >= target5d && sample.futureReturn5d === undefined) price5d = currentPrice;
        if (todayKst >= target10d && sample.futureReturn10d === undefined) price10d = currentPrice;
        if (todayKst >= target20d && sample.futureReturn20d === undefined) price20d = currentPrice;
        if (todayKst >= target60d && sample.futureReturn60d === undefined) price60d = currentPrice;

        samples[i] = updateLearningSampleFutureReturns({
          sample,
          price1d, price5d, price10d, price20d, price60d,
        });
        updatedCount++;
      }
    }
  }

  if (updatedCount > 0) {
    saveLearningSamples(samples);
    console.log(`[LearningUpdater] ${updatedCount}건의 학습 샘플 갱신 완료.`);
    await sendTelegramAlert(
      `📊 <b>[학습 데이터 갱신]</b>\n장 마감 후 ${updatedCount}건의 Supply Health 샘플 미래 수익률(1d~60d) 갱신이 완료되었습니다.`,
      { priority: 'LOW', category: 'learning' }
    ).catch(console.error);
  } else {
    console.log(`[LearningUpdater] 갱신 대상 샘플 없음.`);
  }
}