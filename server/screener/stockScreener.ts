import fs from 'fs';
import { SCREENER_FILE, ensureDataDir } from '../persistence/paths.js';
import { loadWatchlist, saveWatchlist } from '../persistence/watchlistRepo.js';
import { loadConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { evaluateServerGate } from '../quantFilter.js';
import { realDataKisGet, HAS_REAL_DATA_CLIENT, KIS_IS_REAL } from '../clients/kisClient.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { isPullbackSetup } from './pipelineHelpers.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

// ── 아이디어 5: 워치리스트 탈락 사유 추적 ─────────────────────────────────────
export interface RejectionEntry {
  code: string;
  name: string;
  reason: string;
}

/** 마지막 autoPopulateWatchlist 실행의 탈락 사유 로그 (메모리 캐시) */
let lastRejectionLog: RejectionEntry[] = [];

/** 탈락 로그 조회 (API·테스트용) */
export function getLastRejectionLog(): RejectionEntry[] {
  return lastRejectionLog;
}

export interface ScreenedStock {
  code: string;
  name: string;
  currentPrice: number;
  changeRate: number;     // 등락률 (%)
  volume: number;
  turnoverRate: number;   // 회전율 (%)
  per: number;
  foreignNetBuy: number;  // 외국인 순매수량 (당일)
  screenedAt: string;
}

// 아이디어 5: 확장된 Yahoo 시세 인터페이스 (MA/고가/ATR/RSI/MACD + 가속도 포함)
export interface YahooQuoteExtended {
  price: number;
  dayOpen: number;         // 당일 시가
  prevClose: number;       // 전일 종가
  changePercent: number;
  volume: number;
  avgVolume: number;
  ma5: number;             // 5일 이동평균
  ma20: number;            // 20일 이동평균
  ma60: number;            // 60일 이동평균
  high20d: number;         // 20일 최고가
  high60d: number;         // 60일 최고가 (눌림목 판단용)
  atr: number;             // 최근 14일 ATR (Average True Range)
  atr20avg: number;        // 20일 ATR 평균 (VCP 판단용)
  per: number;             // PER (Yahoo 제공 시)
  rsi14: number;           // RSI(14) — Wilder 평활화 실계산
  macd: number;            // MACD 라인 (EMA12 − EMA26)
  macdSignal: number;      // Signal 라인 (MACD의 EMA9)
  macdHistogram: number;   // MACD − Signal (양수 = 상승 압력)
  // Phase 2 컨플루언스 가속도 지표
  rsi5dAgo: number;        // RSI(14) 5일 전 값 (RSI 가속도 계산용)
  weeklyRSI: number;       // 주봉 RSI(9) — 5영업일 다운샘플
  ma60TrendUp: boolean;    // MA60 상승 추세 (현재 > 5일 전 MA60)
  macd5dHistAgo: number;   // MACD 히스토그램 5일 전 (MACD 가속도 계산용)
  // Regret Asymmetry Filter 용
  return5d: number;        // 직전 5거래일 수익률 (%) — FOMO 쿨다운 판단
  // Pre-Breakout Accumulation Detector 용 (최근 10일 OHLCV 원본 배열)
  recentCloses10d?: number[];   // 최근 10일 종가 배열
  recentHighs10d?: number[];    // 최근 10일 일중 고가 배열
  recentLows10d?: number[];     // 최근 10일 일중 저가 배열
  recentVolumes10d?: number[];  // 최근 10일 거래량 배열
  // Compression Score 구성 요소
  bbWidthCurrent: number;       // 현재 BB 폭 비율 (4σ/SMA)
  bbWidth20dAvg: number;        // 최근 20봉 BB 폭 이동평균
  vol5dAvg: number;             // 5일 평균 거래량
  vol20dAvg: number;            // 20일 평균 거래량
  atr5d: number;                // 5일 ATR
  // MTAS 구성 요소
  monthlyAboveEMA12: boolean;   // 월봉: 주가 > 12개월 EMA
  monthlyEMARising: boolean;    // 월봉: EMA12 우상향 중
  weeklyAboveCloud: boolean;    // 주봉: 일목균형표 구름대 위
  weeklyLaggingSpanUp: boolean; // 주봉: 후행스팬 상향
  dailyVolumeDrying: boolean;   // 일봉: 거래량 마름 (vol5d < vol20d × 0.7)
}

// ── 기술적 지표 계산 유틸 ─────────────────────────────────────────────────────

/** Wilder 평활화 RSI — period 파라미터화. */
function calcRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;
  const deltas: number[] = [];
  for (let i = 1; i < closes.length; i++) deltas.push(closes[i] - closes[i - 1]);
  let avgGain = deltas.slice(0, period).filter(d => d > 0).reduce((s, d) => s + d, 0) / period;
  let avgLoss = deltas.slice(0, period).filter(d => d < 0).reduce((s, d) => s - d, 0) / period;
  for (let i = period; i < deltas.length; i++) {
    const gain = deltas[i] > 0 ? deltas[i] : 0;
    const loss = deltas[i] < 0 ? -deltas[i] : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** RSI(14) — 하위 호환 래퍼. */
function calcRSI14(closes: number[]): number { return calcRSI(closes, 14); }

/** EMA 배열 반환. */
function calcEMAArr(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[out.length - 1] * (1 - k));
  return out;
}

/** MACD(12, 26, 9) — 최종 봉의 라인/신호/히스토그램. */
function calcMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
  const zero = { macd: 0, signal: 0, histogram: 0 };
  if (closes.length < 27) return zero;
  const ema12 = calcEMAArr(closes, 12);
  const ema26 = calcEMAArr(closes, 26);
  const macdLine = ema12.slice(25).map((v, i) => v - ema26[25 + i]);
  if (macdLine.length < 9) return zero;
  const signalLine = calcEMAArr(macdLine, 9);
  const last  = macdLine[macdLine.length - 1];
  const sig   = signalLine[signalLine.length - 1];
  return { macd: last, signal: sig, histogram: last - sig };
}

// KOSPI/KOSDAQ 주요 종목 풀 (~225개) — 조방원·전력기기·중소형 모멘텀 확장 + 추가 중소형 50개
export const STOCK_UNIVERSE: { symbol: string; code: string; name: string }[] = [
  // ── KOSPI 대형주 (시총 상위) ──
  { symbol: '005930.KS', code: '005930', name: '삼성전자' },
  { symbol: '000660.KS', code: '000660', name: 'SK하이닉스' },
  { symbol: '373220.KS', code: '373220', name: 'LG에너지솔루션' },
  { symbol: '207940.KS', code: '207940', name: '삼성바이오로직스' },
  { symbol: '005380.KS', code: '005380', name: '현대차' },
  { symbol: '000270.KS', code: '000270', name: '기아' },
  { symbol: '068270.KS', code: '068270', name: '셀트리온' },
  { symbol: '035420.KS', code: '035420', name: 'NAVER' },
  { symbol: '006400.KS', code: '006400', name: '삼성SDI' },
  { symbol: '051910.KS', code: '051910', name: 'LG화학' },
  { symbol: '035720.KS', code: '035720', name: '카카오' },
  { symbol: '105560.KS', code: '105560', name: 'KB금융' },
  { symbol: '055550.KS', code: '055550', name: '신한지주' },
  { symbol: '012330.KS', code: '012330', name: '현대모비스' },
  { symbol: '066570.KS', code: '066570', name: 'LG전자' },
  { symbol: '086790.KS', code: '086790', name: '하나금융지주' },
  { symbol: '003550.KS', code: '003550', name: 'LG' },
  { symbol: '034730.KS', code: '034730', name: 'SK' },
  { symbol: '028260.KS', code: '028260', name: '삼성물산' },
  { symbol: '032830.KS', code: '032830', name: '삼성생명' },
  { symbol: '009150.KS', code: '009150', name: '삼성전기' },
  { symbol: '000810.KS', code: '000810', name: '삼성화재' },
  { symbol: '017670.KS', code: '017670', name: 'SK텔레콤' },
  { symbol: '010130.KS', code: '010130', name: '고려아연' },
  { symbol: '047050.KS', code: '047050', name: '포스코인터내셔널' },
  { symbol: '003670.KS', code: '003670', name: '포스코퓨처엠' },
  // ── KOSPI 중형주 ──
  { symbol: '096770.KS', code: '096770', name: 'SK이노베이션' },
  { symbol: '015760.KS', code: '015760', name: '한국전력' },
  { symbol: '034020.KS', code: '034020', name: '두산에너빌리티' },
  { symbol: '011200.KS', code: '011200', name: 'HMM' },
  { symbol: '036570.KS', code: '036570', name: '엔씨소프트' },
  { symbol: '009540.KS', code: '009540', name: '한국조선해양' },
  { symbol: '010950.KS', code: '010950', name: 'S-Oil' },
  { symbol: '018260.KS', code: '018260', name: '삼성에스디에스' },
  { symbol: '011170.KS', code: '011170', name: '롯데케미칼' },
  { symbol: '030200.KS', code: '030200', name: 'KT' },
  { symbol: '033780.KS', code: '033780', name: 'KT&G' },
  { symbol: '000720.KS', code: '000720', name: '현대건설' },
  { symbol: '011070.KS', code: '011070', name: 'LG이노텍' },
  { symbol: '010620.KS', code: '010620', name: '현대미포조선' },
  { symbol: '042660.KS', code: '042660', name: '한화오션' },
  { symbol: '267260.KS', code: '267260', name: '현대일렉트릭' },
  { symbol: '352820.KS', code: '352820', name: '하이브' },
  { symbol: '009830.KS', code: '009830', name: '한화솔루션' },
  { symbol: '024110.KS', code: '024110', name: '기업은행' },
  { symbol: '316140.KS', code: '316140', name: '우리금융지주' },
  { symbol: '138930.KS', code: '138930', name: 'BNK금융지주' },
  { symbol: '139480.KS', code: '139480', name: '이마트' },
  { symbol: '004020.KS', code: '004020', name: '현대제철' },
  { symbol: '005490.KS', code: '005490', name: 'POSCO홀딩스' },
  { symbol: '000100.KS', code: '000100', name: '유한양행' },
  { symbol: '326030.KS', code: '326030', name: 'SK바이오팜' },
  { symbol: '161390.KS', code: '161390', name: '한국타이어앤테크놀로지' },
  { symbol: '036460.KS', code: '036460', name: '한국가스공사' },
  { symbol: '006800.KS', code: '006800', name: '미래에셋증권' },
  { symbol: '003490.KS', code: '003490', name: '대한항공' },
  { symbol: '180640.KS', code: '180640', name: '한진칼' },
  { symbol: '002790.KS', code: '002790', name: '아모레G' },
  { symbol: '090430.KS', code: '090430', name: '아모레퍼시픽' },
  { symbol: '251270.KS', code: '251270', name: '넷마블' },
  { symbol: '323410.KS', code: '323410', name: '카카오뱅크' },
  { symbol: '377300.KS', code: '377300', name: '카카오페이' },
  { symbol: '035250.KS', code: '035250', name: '강원랜드' },
  { symbol: '271560.KS', code: '271560', name: '오리온' },
  { symbol: '004170.KS', code: '004170', name: '신세계' },
  { symbol: '021240.KS', code: '021240', name: '코웨이' },
  { symbol: '006260.KS', code: '006260', name: 'LS' },
  { symbol: '078930.KS', code: '078930', name: 'GS' },
  { symbol: '069500.KS', code: '069500', name: 'KODEX 200' },
  { symbol: '003410.KS', code: '003410', name: '쌍용C&E' },
  { symbol: '051900.KS', code: '051900', name: 'LG생활건강' },
  { symbol: '259960.KS', code: '259960', name: '크래프톤' },
  { symbol: '402340.KS', code: '402340', name: 'SK스퀘어' },
  // ── KOSDAQ 주요 종목 ──
  { symbol: '247540.KS', code: '247540', name: '에코프로비엠' },
  { symbol: '086520.KS', code: '086520', name: '에코프로' },
  { symbol: '042700.KS', code: '042700', name: '한미반도체' },
  { symbol: '196170.KS', code: '196170', name: '알테오젠' },
  { symbol: '403870.KQ', code: '403870', name: 'HPSP' },
  { symbol: '328130.KQ', code: '328130', name: '루닛' },
  { symbol: '145020.KQ', code: '145020', name: '휴젤' },
  { symbol: '293490.KQ', code: '293490', name: '카카오게임즈' },
  { symbol: '263750.KQ', code: '263750', name: '펄어비스' },
  { symbol: '112040.KQ', code: '112040', name: '위메이드' },
  { symbol: '357780.KQ', code: '357780', name: '솔브레인' },
  { symbol: '035900.KQ', code: '035900', name: 'JYP Ent.' },
  { symbol: '041510.KQ', code: '041510', name: 'SM' },
  { symbol: '091990.KQ', code: '091990', name: '셀트리온헬스케어' },
  { symbol: '067630.KQ', code: '067630', name: 'HLB생명과학' },
  { symbol: '028300.KQ', code: '028300', name: 'HLB' },
  { symbol: '141080.KQ', code: '141080', name: '레고켐바이오' },
  { symbol: '039030.KQ', code: '039030', name: '이오테크닉스' },
  { symbol: '095340.KQ', code: '095340', name: 'ISC' },
  { symbol: '336260.KQ', code: '336260', name: '두산테스나' },
  { symbol: '240810.KQ', code: '240810', name: '원익IPS' },
  { symbol: '058470.KQ', code: '058470', name: '리노공업' },
  { symbol: '078600.KQ', code: '078600', name: '대주전자재료' },
  { symbol: '006580.KQ', code: '006580', name: '대양전기공업' },
  { symbol: '214150.KQ', code: '214150', name: '클래시스' },
  { symbol: '298380.KQ', code: '298380', name: '에이비엘바이오' },
  { symbol: '383310.KQ', code: '383310', name: '에코프로에이치엔' },
  { symbol: '222160.KQ', code: '222160', name: 'NPX반도체' },
  { symbol: '060310.KQ', code: '060310', name: '3S' },
  { symbol: '253450.KQ', code: '253450', name: '스튜디오드래곤' },
  { symbol: '036930.KQ', code: '036930', name: '주성엔지니어링' },
  { symbol: '067160.KQ', code: '067160', name: '아프리카TV' },
  { symbol: '298020.KQ', code: '298020', name: '효성티앤씨' },
  { symbol: '950160.KQ', code: '950160', name: '코오롱티슈진' },
  { symbol: '108860.KQ', code: '108860', name: '셀바스AI' },
  { symbol: '257720.KQ', code: '257720', name: '실리콘투' },
  { symbol: '039200.KQ', code: '039200', name: '오스코텍' },
  { symbol: '122870.KQ', code: '122870', name: '와이지엔터테인먼트' },
  { symbol: '041920.KQ', code: '041920', name: '메디아나' },
  { symbol: '099190.KQ', code: '099190', name: '아이센스' },
  // ── 작은 거인 (Hidden Champions) — 고성장 중소형주 ──
  { symbol: '025900.KQ', code: '025900', name: '동화기업' },
  { symbol: '211050.KQ', code: '211050', name: '인카금융서비스' },
  { symbol: '322510.KQ', code: '322510', name: '제이엘케이' },
  { symbol: '352480.KQ', code: '352480', name: '씨이랩' },
  { symbol: '443060.KQ', code: '443060', name: '유투바이오' },
  { symbol: '086900.KQ', code: '086900', name: '메디톡스' },
  { symbol: '099430.KQ', code: '099430', name: '바이오플러스' },
  { symbol: '348150.KQ', code: '348150', name: 'GRT' },
  { symbol: '039440.KQ', code: '039440', name: 'STX엔진' },
  { symbol: '454910.KQ', code: '454910', name: '파두' },
  { symbol: '226330.KQ', code: '226330', name: '신테카바이오' },
  // ── KOSPI 방산·원자력·전력기기 ──
  { symbol: '012450.KS', code: '012450', name: '한화에어로스페이스' },
  { symbol: '047810.KS', code: '047810', name: '한국항공우주' },
  { symbol: '064350.KS', code: '064350', name: '현대로템' },
  { symbol: '042670.KS', code: '042670', name: '두산인프라코어' },
  { symbol: '298040.KS', code: '298040', name: '효성중공업' },
  { symbol: '103590.KS', code: '103590', name: '일진전기' },
  // ── 로봇·AI 소프트웨어 ──
  { symbol: '278990.KQ', code: '278990', name: 'EMB' },
  { symbol: '272110.KQ', code: '272110', name: '케이엔제이' },
  { symbol: '080010.KQ', code: '080010', name: '이상네트웍스' },
  // ── 추가 바이오·헬스케어 ──
  { symbol: '195940.KQ', code: '195940', name: 'HK이노엔' },
  { symbol: '389030.KQ', code: '389030', name: '지누스' },
  // ── 조선·해양 확장 ──
  { symbol: '010140.KS', code: '010140', name: '삼성중공업' },
  { symbol: '267250.KS', code: '267250', name: 'HD현대' },
  { symbol: '082740.KS', code: '082740', name: 'HD현대마린엔진' },
  { symbol: '044490.KS', code: '044490', name: '태웅' },
  { symbol: '075580.KS', code: '075580', name: '세진중공업' },
  // ── 방산 확장 ──
  { symbol: '079550.KQ', code: '079550', name: 'LIG넥스원' },
  { symbol: '273640.KS', code: '273640', name: '한화시스템' },
  { symbol: '000880.KS', code: '000880', name: '한화' },
  { symbol: '067390.KQ', code: '067390', name: '아스트' },
  { symbol: '099320.KQ', code: '099320', name: '쎄트렉아이' },
  { symbol: '101930.KQ', code: '101930', name: '인화정공' },
  { symbol: '024740.KS', code: '024740', name: '한일단조' },
  { symbol: '003570.KS', code: '003570', name: 'SNT다이내믹스' },
  // ── 원자력·SMR 확장 ──
  { symbol: '052690.KS', code: '052690', name: '한전기술' },
  { symbol: '015750.KS', code: '015750', name: '한전KPS' },
  { symbol: '092200.KQ', code: '092200', name: '디아이씨' },
  { symbol: '064260.KQ', code: '064260', name: '다원시스' },
  { symbol: '023800.KQ', code: '023800', name: '인지컨트롤스' },
  // ── 전력기기 확장 ──
  { symbol: '033100.KQ', code: '033100', name: '제룡전기' },
  // ── 중소형 모멘텀 — 로봇 ──
  { symbol: '277810.KQ', code: '277810', name: '레인보우로보틱스' },
  // ── 중소형 모멘텀 — 반도체 장비·소재 ──
  { symbol: '089030.KQ', code: '089030', name: '테크윙' },
  { symbol: '131970.KQ', code: '131970', name: '테스나' },
  { symbol: '014680.KQ', code: '014680', name: '한솔케미칼' },
  // ── 중소형 모멘텀 — 2차전지 소재 ──
  { symbol: '278280.KQ', code: '278280', name: '천보' },
  { symbol: '121600.KQ', code: '121600', name: '나노신소재' },
  // ── 중소형 모멘텀 — 바이오·의료 ──
  { symbol: '950210.KQ', code: '950210', name: '프레스티지바이오파마' },
  { symbol: '237690.KS', code: '237690', name: '에스티팜' },
  { symbol: '335890.KQ', code: '335890', name: '비올' },
  { symbol: '340570.KQ', code: '340570', name: '티앤엘' },
  { symbol: '043150.KQ', code: '043150', name: '바텍' },
  // ── 중소형 모멘텀 — AI·소프트웨어 ──
  { symbol: '039980.KQ', code: '039980', name: '폴라리스오피스' },
  { symbol: '394280.KQ', code: '394280', name: '오픈엣지테크놀로지' },
  // ── 중소형 모멘텀 — 화장품·소비재 ──
  { symbol: '432720.KQ', code: '432720', name: '에이피알' },
  { symbol: '003230.KS', code: '003230', name: '삼양식품' },
  // ── 중소형 모멘텀 — 건설·인프라 ──
  { symbol: '375500.KS', code: '375500', name: 'DL이앤씨' },
  { symbol: '006360.KS', code: '006360', name: 'GS건설' },
  // ── 중소형 모멘텀 — 자동차IT ──
  { symbol: '307950.KS', code: '307950', name: '현대오토에버' },
  // ── 중소형 모멘텀 — 게임 ──
  { symbol: '078340.KQ', code: '078340', name: '컴투스' },
  { symbol: '194480.KQ', code: '194480', name: '데브시스터즈' },
  // ── 추가 중소형 모멘텀 — 반도체 장비·소재 2차 확장 ──
  { symbol: '033640.KQ', code: '033640', name: '네패스' },
  { symbol: '319660.KQ', code: '319660', name: '피에스케이' },
  { symbol: '067310.KQ', code: '067310', name: '하나마이크론' },
  { symbol: '064760.KQ', code: '064760', name: '티씨케이' },
  { symbol: '084370.KQ', code: '084370', name: '유진테크' },
  { symbol: '140860.KQ', code: '140860', name: '파크시스템스' },
  { symbol: '074600.KQ', code: '074600', name: '원익QnC' },
  { symbol: '183300.KQ', code: '183300', name: '코미코' },
  { symbol: '094360.KQ', code: '094360', name: '칩스앤미디어' },
  { symbol: '200710.KQ', code: '200710', name: '에이디테크놀로지' },
  { symbol: '045390.KQ', code: '045390', name: '태성' },
  // ── 추가 중소형 모멘텀 — 2차전지 2차 확장 ──
  { symbol: '066970.KQ', code: '066970', name: '엘앤에프' },
  { symbol: '005070.KQ', code: '005070', name: '코스모신소재' },
  { symbol: '336370.KQ', code: '336370', name: '솔루스첨단소재' },
  // ── 추가 중소형 모멘텀 — 바이오·제약 2차 확장 ──
  { symbol: '214450.KQ', code: '214450', name: '파마리서치' },
  { symbol: '293780.KQ', code: '293780', name: '압타바이오' },
  { symbol: '078160.KQ', code: '078160', name: '메디포스트' },
  { symbol: '009420.KS', code: '009420', name: '한올바이오파마' },
  { symbol: '128940.KS', code: '128940', name: '한미약품' },
  { symbol: '006280.KS', code: '006280', name: '녹십자' },
  { symbol: '084110.KQ', code: '084110', name: '휴온스글로벌' },
  // ── 추가 중소형 모멘텀 — 방산 2차 확장 ──
  { symbol: '082920.KQ', code: '082920', name: '비츠로셀' },
  { symbol: '357550.KQ', code: '357550', name: '석경에이티' },
  // ── 추가 중소형 모멘텀 — 전력기기·전자부품 ──
  { symbol: '010120.KS', code: '010120', name: 'LS일렉트릭' },
  { symbol: '353200.KQ', code: '353200', name: '대덕전자' },
  { symbol: '090460.KQ', code: '090460', name: '비에이치' },
  { symbol: '007660.KS', code: '007660', name: '이수페타시스' },
  { symbol: '222800.KQ', code: '222800', name: '심텍' },
  // ── 추가 중소형 모멘텀 — 로봇 2차 확장 ──
  { symbol: '090360.KQ', code: '090360', name: '로보스타' },
  { symbol: '348340.KQ', code: '348340', name: '뉴로메카' },
  // ── 추가 중소형 모멘텀 — AI·IT·보안 ──
  { symbol: '304100.KQ', code: '304100', name: '솔트룩스' },
  { symbol: '119860.KQ', code: '119860', name: '다나와' },
  { symbol: '053800.KQ', code: '053800', name: '안랩' },
  { symbol: '263860.KQ', code: '263860', name: '지니언스' },
  { symbol: '022100.KS', code: '022100', name: '포스코DX' },
  // ── 추가 중소형 모멘텀 — 조선기자재 2차 확장 ──
  { symbol: '014620.KQ', code: '014620', name: '성광벤드' },
  { symbol: '017960.KS', code: '017960', name: '한국카본' },
  { symbol: '238490.KQ', code: '238490', name: 'HRS' },
  // ── 추가 중소형 모멘텀 — 화장품·소비재 2차 확장 ──
  { symbol: '192820.KS', code: '192820', name: '코스맥스' },
  { symbol: '161890.KS', code: '161890', name: '한국콜마' },
  // ── 추가 중소형 모멘텀 — 게임 2차 확장 ──
  { symbol: '462870.KS', code: '462870', name: '시프트업' },
  // ── 추가 중소형 모멘텀 — 자동차부품 ──
  { symbol: '204320.KS', code: '204320', name: 'HL만도' },
  { symbol: '011210.KS', code: '011210', name: '현대위아' },
  { symbol: '064960.KS', code: '064960', name: 'SNT모티브' },
  { symbol: '005760.KS', code: '005760', name: '에스엘' },
  // ── 추가 중소형 모멘텀 — 디스플레이·자동화 ──
  { symbol: '213420.KQ', code: '213420', name: '덕산네오룩스' },
  { symbol: '056190.KQ', code: '056190', name: '에스에프에이' },
  // ── 추가 중소형 모멘텀 — 통신장비·원자력·철강 ──
  { symbol: '189300.KQ', code: '189300', name: '인텔리안테크' },
  { symbol: '105840.KQ', code: '105840', name: '우진' },
  { symbol: '001430.KS', code: '001430', name: '세아베스틸지주' },
];

export function getScreenerCache(): ScreenedStock[] {
  ensureDataDir();
  if (!fs.existsSync(SCREENER_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(SCREENER_FILE, 'utf-8')); } catch { return []; }
}

/**
 * 아이디어 4: 장 전 사전 스크리너
 *
 * 1단계: KIS 거래량 상위 종목 수집 (FHPST01710000)
 * 2단계: 정량 필터 — 가격·회전율·PER·외국인 순매수
 * 3단계: 상위 30개만 캐시 저장 → AI 분석 시 이 풀에서만 선택
 */
export async function preScreenStocks(): Promise<ScreenedStock[]> {
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return [];

  // FHPST01710000 (거래량 순위)은 실계좌 전용 TR — VTS에서 미지원
  // 단, 실계좌 데이터 키(KIS_REAL_DATA_APP_KEY) 설정 시 하이브리드 모드로 조회 가능
  if (!KIS_IS_REAL && !HAS_REAL_DATA_CLIENT) {
    console.warn(
      '[Screener] 모의투자(VTS) 모드 — 거래량 순위 TR(FHPST01710000) 미지원. ' +
      '캐시된 스크리너 결과를 반환합니다. 실계좌 데이터 키 또는 KIS_IS_REAL=true 설정 후 사용 가능.'
    );
    return getScreenerCache();
  }

  try {
    // 거래량 상위 종목 (최대 30개 반환)
    const volData = await realDataKisGet(
      'FHPST01710000',
      '/uapi/domestic-stock/v1/ranking/volume',
      {
        fid_cond_mrkt_div_code: 'J',
        fid_cond_scr_div_code:  '20171',
        fid_input_iscd:         '0000',   // 전체
        fid_div_cls_code:       '0',
        fid_blng_cls_code:      '0',
        fid_trgt_cls_code:      '111111111',
        fid_trgt_exls_cls_code: '000000',
        fid_input_price_1:      '5000',   // 5,000원 이상
        fid_input_price_2:      '500000', // 50만원 이하
        fid_vol_cnt:            '100000', // 거래량 10만 이상
        fid_input_date_1:       '',
      }
    ) as { output?: Record<string, string>[] } | null;

    const raw = volData?.output ?? [];
    const now = new Date().toISOString();

    const candidates: ScreenedStock[] = raw.map((s) => ({
      code:          s.stck_shrn_iscd ?? '',
      name:          s.hts_kor_isnm   ?? '',
      currentPrice:  parseInt(s.stck_prpr   ?? '0', 10),
      changeRate:    parseFloat(s.prdy_ctrt ?? '0'),
      volume:        parseInt(s.acml_vol    ?? '0', 10),
      turnoverRate:  parseFloat(s.acml_tr_pbmn ?? '0'),
      per:           parseFloat(s.per         ?? '999'),
      foreignNetBuy: parseInt(s.frgn_ntby_qty ?? '0', 10),
      screenedAt:    now,
    })).filter((s) =>
      s.code &&
      s.currentPrice > 0 &&
      s.per > 0 && s.per < 40 &&       // PER 0~40
      s.foreignNetBuy >= 0 &&           // 외국인 순매수 유지
      s.changeRate > -3                 // 급락 제외
    );

    // 거래량 기준 상위 30개
    const top30 = candidates
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 30);

    ensureDataDir();
    fs.writeFileSync(SCREENER_FILE, JSON.stringify(top30, null, 2));
    console.log(`[Screener] 사전 스크리닝 완료 — ${raw.length}개 → 필터 후 ${candidates.length}개 → 상위 ${top30.length}개`);
    return top30;
  } catch (e: unknown) {
    console.error('[Screener] 실패:', e instanceof Error ? e.message : e);
    return [];
  }
}

export async function fetchYahooQuote(symbol: string): Promise<YahooQuoteExtended | null> {
  try {
    // range=2y — MTAS(월봉/주봉) 계산에 충분한 데이터 확보 (MA60, 가속도 지표 포함)
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=2y&interval=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    const rawCloses: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const rawHighs: (number | null)[]  = result.indicators?.quote?.[0]?.high ?? [];
    const rawLows: (number | null)[]   = result.indicators?.quote?.[0]?.low ?? [];
    const rawVolumes: (number | null)[] = result.indicators?.quote?.[0]?.volume ?? [];

    // null 값 제거한 유효 데이터
    const closes  = rawCloses.filter((v): v is number => v != null && v > 0);
    const highs   = rawHighs.filter((v): v is number => v != null && v > 0);
    const lows    = rawLows.filter((v): v is number => v != null && v > 0);
    const volumes = rawVolumes.filter((v): v is number => v != null && v > 0);

    if (closes.length < 5) return null;

    const price = meta.regularMarketPrice ?? closes[closes.length - 1] ?? 0;
    const prevClose = meta.chartPreviousClose ?? closes[closes.length - 2] ?? price;
    const dayOpen = meta.regularMarketOpen ?? price;
    const changePercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
    const volume = volumes[volumes.length - 1] ?? 0;

    // 평균 거래량 (최근 60거래일, 당일 제외 — 2y 범위에서도 일관성 유지)
    const pastVolumes = volumes.slice(Math.max(0, volumes.length - 61), -1);
    const avgVolume = pastVolumes.length > 0
      ? pastVolumes.reduce((s, v) => s + v, 0) / pastVolumes.length
      : volume;

    // 이동평균 계산
    const avg = (arr: number[], n: number) => {
      const slice = arr.slice(-n);
      return slice.length >= n ? slice.reduce((a, b) => a + b, 0) / n : 0;
    };
    const ma5  = avg(closes, 5);
    const ma20 = avg(closes, 20);
    const ma60 = avg(closes, 60);

    // 20일 최고가
    const high20d = highs.length >= 20
      ? Math.max(...highs.slice(-20))
      : Math.max(...highs);

    // 60일 최고가 (눌림목 판단: 고점 대비 조정폭)
    const high60d = highs.length >= 60
      ? Math.max(...highs.slice(-60))
      : Math.max(...highs);

    // ATR (Average True Range) 계산 — 14일 기준
    const trueRanges: number[] = [];
    const minLen = Math.min(closes.length, highs.length, lows.length);
    for (let i = 1; i < minLen; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      );
      trueRanges.push(tr);
    }
    const atr = trueRanges.length >= 14
      ? trueRanges.slice(-14).reduce((a, b) => a + b, 0) / 14
      : trueRanges.length > 0
        ? trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length
        : 0;
    const atr20avg = trueRanges.length >= 20
      ? trueRanges.slice(-20).reduce((a, b) => a + b, 0) / 20
      : atr;

    // PER — Yahoo meta에서 제공 시 사용
    const per = parseFloat(meta.trailingPE ?? '999');

    // RSI14 + MACD — 실데이터 계산
    const rsi14 = calcRSI14(closes);
    const { macd, signal: macdSignal, histogram: macdHistogram } = calcMACD(closes);

    // ── Phase 2 가속도 지표 ──
    // RSI 5일 전 (현재에서 마지막 5봉 제거)
    const closes5dAgo   = closes.length > 5 ? closes.slice(0, -5) : closes;
    const rsi5dAgo      = parseFloat(calcRSI14(closes5dAgo).toFixed(1));

    // MACD 히스토그램 5일 전
    const macdPast      = calcMACD(closes5dAgo);
    const macd5dHistAgo = parseFloat(macdPast.histogram.toFixed(2));

    // MA60 상승 추세 (현재 MA60 > 5일 전 MA60)
    const avgFn = (arr: number[], n: number) => {
      const s = arr.slice(-n); return s.length >= n ? s.reduce((a, b) => a + b, 0) / n : 0;
    };
    const ma60Before  = avgFn(closes5dAgo, 60);
    const ma60TrendUp = ma60 > 0 && ma60Before > 0 && ma60 > ma60Before;

    // 주봉 RSI(9) — 5영업일마다 다운샘플
    const weeklyCloses: number[] = [];
    for (let i = 4; i < closes.length; i += 5) weeklyCloses.push(closes[i]);
    const weeklyRSI = parseFloat(calcRSI(weeklyCloses, 9).toFixed(1));

    // 직전 5거래일 수익률 — Regret Asymmetry Filter용
    const close5dAgo = closes.length > 5 ? closes[closes.length - 6] : closes[0];
    const return5d = close5dAgo > 0 ? ((price - close5dAgo) / close5dAgo) * 100 : 0;

    // ── Compression Score 구성 요소 ──────────────────────────────────────────────

    // BB 폭 계산: (4σ / SMA) at a given bar index
    const calcBBWidthAt = (cs: number[], endIdx: number): number => {
      if (endIdx < 19 || cs.length <= endIdx) return 0;
      const slice = cs.slice(endIdx - 19, endIdx + 1);
      const mean = slice.reduce((a, b) => a + b, 0) / 20;
      if (mean === 0) return 0;
      const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 20;
      return (4 * Math.sqrt(variance)) / mean;
    };
    const bbWidthCurrent = calcBBWidthAt(closes, closes.length - 1);
    let bbWidthSum = 0, bbWidthCount = 0;
    for (let i = 0; i < 20 && (closes.length - 1 - i) >= 19; i++) {
      bbWidthSum += calcBBWidthAt(closes, closes.length - 1 - i);
      bbWidthCount++;
    }
    const bbWidth20dAvg = bbWidthCount > 0 ? bbWidthSum / bbWidthCount : bbWidthCurrent;

    // 거래량 5일/20일 평균
    const vol5dAvg = volumes.length >= 5
      ? volumes.slice(-5).reduce((a, b) => a + b, 0) / 5 : volume;
    const vol20dAvg = volumes.length >= 20
      ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20 : avgVolume;

    // ATR 5일
    const atr5d = trueRanges.length >= 5
      ? trueRanges.slice(-5).reduce((a, b) => a + b, 0) / 5 : atr;

    // 거래량 마름 판단 (5일 평균 < 20일 평균의 70%)
    const dailyVolumeDrying = vol20dAvg > 0 && vol5dAvg < vol20dAvg * 0.7;

    // ── MTAS 구성 요소: 월봉/주봉 다운샘플링 ────────────────────────────────────

    // 주봉 다운샘플링 (5거래일 단위)
    const wCloses: number[] = [], wHighs: number[] = [], wLows: number[] = [];
    for (let i = 0; i < closes.length; i += 5) {
      const end = Math.min(i + 5, closes.length);
      wCloses.push(closes[end - 1]);
      wHighs.push(Math.max(...highs.slice(i, end)));
      wLows.push(Math.min(...lows.slice(i, end)));
    }

    // 월봉 다운샘플링 (~21거래일 단위)
    const mCloses: number[] = [];
    for (let i = 0; i < closes.length; i += 21) {
      const end = Math.min(i + 21, closes.length);
      mCloses.push(closes[end - 1]);
    }

    // 월봉: 주가 > 12개월 EMA이고 EMA 우상향
    let monthlyAboveEMA12 = false, monthlyEMARising = false;
    if (mCloses.length >= 13) {
      const mEma12 = calcEMAArr(mCloses, 12);
      const lastEma = mEma12[mEma12.length - 1];
      const prevEma = mEma12.length >= 2 ? mEma12[mEma12.length - 2] : lastEma;
      monthlyAboveEMA12 = price > lastEma;
      monthlyEMARising = lastEma > prevEma;
    }

    // 주봉: 일목균형표 구름대 위 + 후행스팬 상향
    // 52주(약 1년)로 완화 — Yahoo Finance 한국 종목 히스토리 부족 대응 (기존 78주)
    let weeklyAboveCloud = false, weeklyLaggingSpanUp = false;
    if (wCloses.length >= 52) {
      const wn = wCloses.length;
      const refBar = wn - 27; // 구름대는 26봉 전 데이터로 형성
      const midpoint = (h: number[], l: number[], s: number, e: number): number => {
        if (s < 0 || e > h.length) return 0;
        return (Math.max(...h.slice(s, e)) + Math.min(...l.slice(s, e))) / 2;
      };
      const tenkanRef = midpoint(wHighs, wLows, refBar - 8, refBar + 1);  // 9봉 중앙값
      const kijunRef  = midpoint(wHighs, wLows, refBar - 25, refBar + 1); // 26봉 중앙값
      const spanA = (tenkanRef + kijunRef) / 2;
      const spanB = midpoint(wHighs, wLows, refBar - 51, refBar + 1);     // 52봉 중앙값
      const cloudTop = Math.max(spanA, spanB);
      weeklyAboveCloud = cloudTop > 0 && wCloses[wn - 1] > cloudTop;
      // 후행스팬: 현재 종가 vs 26주 전 종가
      weeklyLaggingSpanUp = wCloses[wn - 1] > wCloses[wn - 27];
    }

    return {
      price: Math.round(price), changePercent, volume, avgVolume,
      dayOpen: Math.round(dayOpen),
      prevClose: Math.round(prevClose),
      ma5, ma20, ma60, high20d, high60d, atr, atr20avg, per,
      rsi14: parseFloat(rsi14.toFixed(1)),
      macd:  parseFloat(macd.toFixed(2)),
      macdSignal: parseFloat(macdSignal.toFixed(2)),
      macdHistogram: parseFloat(macdHistogram.toFixed(2)),
      rsi5dAgo, weeklyRSI, ma60TrendUp, macd5dHistAgo,
      return5d: parseFloat(return5d.toFixed(2)),
      recentCloses10d:  closes.slice(-10),
      recentHighs10d:   highs.slice(-10),
      recentLows10d:    lows.slice(-10),
      recentVolumes10d: volumes.slice(-10),
      // Compression Score 구성 요소
      bbWidthCurrent: parseFloat(bbWidthCurrent.toFixed(6)),
      bbWidth20dAvg:  parseFloat(bbWidth20dAvg.toFixed(6)),
      vol5dAvg: Math.round(vol5dAvg),
      vol20dAvg: Math.round(vol20dAvg),
      atr5d: parseFloat(atr5d.toFixed(2)),
      // MTAS 구성 요소
      monthlyAboveEMA12,
      monthlyEMARising,
      weeklyAboveCloud,
      weeklyLaggingSpanUp,
      dailyVolumeDrying,
    };
  } catch {
    return null;
  }
}

/**
 * Yahoo Finance 기반 자동 워치리스트 채우기
 *
 * - KIS 실계좌: preScreenStocks() 결과를 워치리스트로 승격
 * - VTS/모의계좌: Yahoo Finance로 KOSPI 주요 종목 스캔, 상승 모멘텀 종목 자동 추가
 *
 * 선정 기준: 전일 대비 +2% 이상 상승 + 거래량 50만주 이상
 * 손절: 현재가 -8%, 목표: 현재가 +15%
 */
export async function autoPopulateWatchlist(): Promise<number> {
  const watchlist = loadWatchlist();
  const existingCodes = new Set(watchlist.map(w => w.code));
  let added = 0;

  // 아이디어 5: 탈락 사유 추적 — 매 실행마다 초기화
  const rejectionLog: RejectionEntry[] = [];

  // 실계좌: preScreenStocks 결과 → 워치리스트 승격
  if (KIS_IS_REAL) {
    const screened = getScreenerCache();
    for (const s of screened) {
      if (existingCodes.has(s.code)) continue;
      if (s.changeRate < 0 || s.changeRate >= 8) {
        rejectionLog.push({ code: s.code, name: s.name, reason: s.changeRate < 0 ? `음봉 ${s.changeRate.toFixed(1)}%` : `과열 +${s.changeRate.toFixed(1)}%` });
        continue;
      }
      if (s.foreignNetBuy < 0) {
        rejectionLog.push({ code: s.code, name: s.name, reason: `외국인순매도 ${s.foreignNetBuy.toLocaleString()}주` });
        continue;
      }

      const sl = Math.round(s.currentPrice * 0.92);
      const tp = Math.round(s.currentPrice * 1.15);
      watchlist.push({
        code: s.code,
        name: s.name,
        entryPrice: s.currentPrice,
        stopLoss: sl,
        targetPrice: tp,
        addedAt: new Date().toISOString(),
        addedBy: 'AUTO',
        rrr: parseFloat(((tp - s.currentPrice) / (s.currentPrice - sl || 1)).toFixed(2)),
      });
      existingCodes.add(s.code);
      added++;
      console.log(`[AutoPopulate] 스크리너 → 워치리스트: ${s.name}(${s.code}) @${s.currentPrice.toLocaleString()}`);
    }
  }

  // VTS 및 공통: Yahoo Finance 기반 모멘텀 스캔 + 서버사이드 Gate 평가 (아이디어 2)
  // 아이디어 6: 동적 확장 유니버스 사용 (정적 + 주간 52주신고가/외국인순매수)
  const { getExpandedUniverse } = await import('./dynamicUniverseExpander.js');
  const scanUniverse = getExpandedUniverse();
  for (const stock of scanUniverse) {
    if (existingCodes.has(stock.code)) continue;

    const quote = await fetchYahooQuote(stock.symbol);
    if (!quote || quote.price <= 0) {
      rejectionLog.push({ code: stock.code, name: stock.name, reason: '시세조회실패' });
      continue;
    }

    // 필터: 과열 상단 차단 + VCP/거래량 조건 + 눌림목 허용
    const isVCP = quote.atr > 0 && quote.atr20avg > 0 && quote.atr < quote.atr20avg * 0.75;
    const pullback = isPullbackSetup(quote);
    if (quote.changePercent >= 5) {
      rejectionLog.push({ code: stock.code, name: stock.name, reason: `과열 +${quote.changePercent.toFixed(1)}%` });
      continue;
    }
    if (quote.changePercent < -2 && !pullback) {
      rejectionLog.push({ code: stock.code, name: stock.name, reason: `음봉 ${quote.changePercent.toFixed(1)}% (눌림목아님)` });
      continue;
    }
    if (quote.changePercent < -5) {
      rejectionLog.push({ code: stock.code, name: stock.name, reason: `급락 ${quote.changePercent.toFixed(1)}%` });
      continue;
    }
    if (quote.volume < quote.avgVolume * 1.2 && !isVCP && !pullback) {
      rejectionLog.push({ code: stock.code, name: stock.name, reason: `거래량부족 ${(quote.volume / quote.avgVolume).toFixed(1)}배` });
      continue;
    }
    if (quote.return5d > 15) {
      rejectionLog.push({ code: stock.code, name: stock.name, reason: `5일급등 +${quote.return5d.toFixed(1)}%` });
      continue;
    }

    // 아이디어 2: 서버사이드 Gate 평가 — SKIP 종목 제외
    const macroState = loadMacroState();
    const gate = evaluateServerGate(quote, loadConditionWeights(), macroState?.kospiDayReturn);
    if (gate.signalType === 'SKIP') {
      rejectionLog.push({ code: stock.code, name: stock.name, reason: `Gate SKIP (${gate.gateScore.toFixed(1)}/10)` });
      console.log(`[AutoPopulate] SKIP: ${stock.name}(${stock.code}) gateScore=${gate.gateScore}/10`);
      continue;
    }

    const sl = Math.round(quote.price * 0.92);
    const tp = Math.round(quote.price * 1.15);
    watchlist.push({
      code: stock.code,
      name: stock.name,
      entryPrice: quote.price,
      stopLoss: sl,
      targetPrice: tp,
      addedAt: new Date().toISOString(),
      gateScore: gate.gateScore,
      addedBy: 'AUTO',
      memo: `${gate.signalType} gate=${gate.gateScore.toFixed(1)}/10 ${gate.details.join(', ')}`,
      rrr: parseFloat(((tp - quote.price) / (quote.price - sl || 1)).toFixed(2)),
      conditionKeys: gate.conditionKeys,
    });
    existingCodes.add(stock.code);
    added++;
    console.log(
      `[AutoPopulate] Yahoo → 워치리스트: ${stock.name}(${stock.code}) ` +
      `@${quote.price.toLocaleString()} (+${quote.changePercent.toFixed(1)}% / ${(quote.volume / 10000).toFixed(0)}만주) ` +
      `gate=${gate.gateScore}/8 [${gate.signalType}] ${gate.details.join(', ')}`
    );

    // Yahoo rate limit 방지
    await new Promise(r => setTimeout(r, 300));
  }

  // 아이디어 5: 탈락 로그를 메모리 캐시에 저장 + 상세 JSON 로그 출력
  lastRejectionLog = rejectionLog;
  if (rejectionLog.length > 0) {
    console.log(`[AutoPopulate] 탈락 ${rejectionLog.length}건 — ${JSON.stringify(rejectionLog.slice(0, 10))}`);
  }

  if (added > 0) {
    saveWatchlist(watchlist);
    console.log(`[AutoPopulate] 워치리스트 자동 추가 완료 — ${added}개 신규 (총 ${watchlist.length}개)`);
  } else {
    console.log('[AutoPopulate] 조건 충족 종목 없음 — 워치리스트 변동 없음');
  }

  return added;
}

/**
 * 아이디어 5: 워치리스트 탈락 사유 텔레그램 요약 발송.
 * 하루 1회 스케줄러에서 호출 — 어느 종목이 어느 필터에서 탈락했는지 가시성 확보.
 */
export async function sendWatchlistRejectionReport(): Promise<void> {
  const log = lastRejectionLog;
  if (log.length === 0) {
    console.log('[RejectionReport] 탈락 로그 없음 — 리포트 스킵');
    return;
  }

  // 사유별 집계
  const reasonCounts = new Map<string, number>();
  for (const entry of log) {
    // 사유 카테고리 추출 (숫자 제거하여 그룹화)
    const category = entry.reason.replace(/[+-]?\d+(\.\d+)?[%주배]/g, '').trim() || entry.reason;
    reasonCounts.set(category, (reasonCounts.get(category) ?? 0) + 1);
  }

  const sortedReasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]);
  const reasonLines = sortedReasons.slice(0, 8).map(([r, c]) => `  ${r}: ${c}건`).join('\n');

  // 상위 탈락 종목 (최대 10개)
  const topRejections = log.slice(0, 10).map(e => `  ${e.name}(${e.code}): ${e.reason}`).join('\n');

  const msg =
    `📋 <b>[워치리스트 탈락 리포트]</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `스캔 종목: ${STOCK_UNIVERSE.length}개 | 탈락: ${log.length}건\n\n` +
    `<b>사유별 분포:</b>\n${reasonLines}\n\n` +
    `<b>탈락 종목 (상위 10):</b>\n${topRejections}\n` +
    `━━━━━━━━━━━━━━━━━━━━`;

  await sendTelegramAlert(msg, {
    priority: 'LOW',
    dedupeKey: 'watchlist-rejection-daily',
    cooldownMs: 20 * 60 * 60 * 1000,  // 20시간 쿨다운 (하루 1회)
  }).catch(console.error);

  console.log(`[RejectionReport] 텔레그램 발송 완료 — 탈락 ${log.length}건`);
}
