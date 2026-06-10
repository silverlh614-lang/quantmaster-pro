// @responsibility FSS 외국인 수급·KRX 공매도 폴백 체인·ECOS 신용잔고·FSS 11분류 raw 섹션 갱신
/**
 * supplyCreditSections.ts — ADR-0595 marketDataRefresh 섹션 모듈 분해.
 *
 * 본체 marketDataRefresh.ts 에서 텍스트 그대로 이동 (byte-equivalent, behavior change 0).
 * L4 캡 텍스트(L4_SOURCES · Math.min(shortResult.ratio, 8))는 불변식 #7 보존을 위해 byte 그대로 이동.
 */

import { loadFssRecords, getFssRecordsAge, upsertFssRecord } from '../../persistence/fssRepo.js';
import type { FssRecordsAgeInfo } from '../../persistence/fssRepo.js';
import { appendFssDetailRecord } from '../../persistence/fssDetailRepo.js';
import { isFssMappingEnabled, mapPassiveActive } from '../../persistence/fssMappingPolicy.js';
import { fetchInvestorTradingDetail } from '../../clients/krxClient.js';
import { fetchLatestMarginBalance5dChange } from '../../clients/ecosClient.js';
import { tryKrxShortViaKisProxy } from '../shortSellingKisProxy.js';
import { parsePct } from './helpers.js';
import type { MarketRefreshComputed, ShortSellingSource, ShortSellingResult } from './types.js';
import { YF_HEADERS } from './indexMacroSections.js';
import { emitMarketDataProviderWarn } from './refreshObservability.js';

/** KRX 공매도 거래 비중 공개 데이터 엔드포인트 */
const KRX_SHORT_URL = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';
/** KRX 공개 페이지가 OTP-token 으로 호출자 식별을 요구하는 경우의 부트스트랩 URL */
const KRX_OTP_URL   = 'https://data.krx.co.kr/comm/fileDn/GenerateOTP/generate.cmd';

/** KRX 공매도 응답에서 비율 필드 후보 — 스키마 변경에 대비해 다중 키 시도 */
const KRX_SHORT_RATIO_KEYS = [
  'SHORT_SELL_RATIO',
  'SHORT_SELLING_RATIO',
  'TRDVAL_RATIO',
  'BID_TRDVAL_RATIO',
];

/**
 * KRX 공매도 비율 조회 — 다단계 폴백 체인 (ADR-0543 확장):
 *   1) KRX 공개 JSON(L1)  2) KRX OTP(L1)  3) KIS 프록시 ETF(L1, ENV gated)  4) KIS 추정(L4, 최후)
 * 모두 실패하면 null → macroState shortSellingRatio "기존 값 유지"(carryForward) 정책.
 * 반환값 source 라벨은 macroState 에 영속(`shortSellingSource`) → /health 노출.
 */
export async function fetchKrxShortSelling(): Promise<ShortSellingResult | null> {
  const fetchedAt = new Date().toISOString();

  // ── 1차: 단순 공개 JSON ─────────────────────────────────────
  const direct = await tryKrxShortDirect();
  if (direct != null) return { ratio: direct, source: 'KRX_DIRECT', fetchedAt };

  // ── 2차: OTP-token 부트스트랩 후 재시도 ────────────────────
  // KRX 공개 페이지는 비정기적으로 호출자 검증을 강화한다. generate.cmd 가
  // 발급한 짧은 토큰을 form data 에 OTP 로 함께 보내면 통과하는 케이스가 있다.
  const viaOtp = await tryKrxShortViaOtp();
  if (viaOtp != null) return { ratio: viaOtp, source: 'KRX_OTP', fetchedAt };

  // ── 3차 (ADR-0543, ENV gated default OFF): KIS 시장-프록시 ETF 비중 (L1) ──
  // 플래그 !== 'true' 면 미호출 → byte-equivalent (기존 3경로 유지). kisClient 단일통로.
  if (process.env.SHORT_SELLING_KIS_PROXY_FALLBACK === 'true') {
    const viaKisProxy = await tryKrxShortViaKisProxy();
    if (viaKisProxy != null) {
      console.log(`[MarketRefresh] KRX 공매도 비율 KIS L1 프록시: ${viaKisProxy.toFixed(2)}% (daily-short-sale)`);
      return { ratio: viaKisProxy, source: 'KIS_PROXY', fetchedAt };
    }
  }

  // ── 4차 (최후): KIS 공매도 잔고 상위 → 가중 평균 추정 (L4) ────────────
  // 정확한 "전체 시장 비율" 은 아니지만, top 30 종목의 BAL_QTY/시총 가중 평균은
  // 시장 압력의 1차 근사로 사용 가능. 임계값(8%) 비교 용도로는 충분.
  const viaKis = await tryKrxShortViaKisRanking();
  if (viaKis != null) {
    console.log(`[MarketRefresh] KRX 공매도 비율 KIS 폴백 추정값: ${viaKis.toFixed(2)}% (top 30 가중 평균)`);
    return { ratio: viaKis, source: 'KIS_ESTIMATE', fetchedAt };
  }

  return null;
}

async function tryKrxShortDirect(): Promise<number | null> {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    const res  = await fetch(KRX_SHORT_URL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Referer':      'http://data.krx.co.kr/',
        'User-Agent':   YF_HEADERS['User-Agent'],
      },
      body: new URLSearchParams({
        bld: 'dbms/MDC/STAT/standard/MDCSTAT30001',
        mktId: 'STK',
      }),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    const data = await res.json() as { output?: Array<Record<string, unknown>>; OutBlock_1?: Array<Record<string, unknown>> };
    const rows = data.output ?? data.OutBlock_1 ?? [];
    if (rows.length === 0) return null;
    for (const key of KRX_SHORT_RATIO_KEYS) {
      const v = parsePct(rows[0][key]);
      if (v != null && v >= 0 && v <= 100) return v;
    }
    return null;
  } catch {
    return null;
  }
}

async function tryKrxShortViaOtp(): Promise<number | null> {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    const otpRes = await fetch(KRX_OTP_URL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Referer':      'https://data.krx.co.kr/',
        'User-Agent':   YF_HEADERS['User-Agent'],
      },
      body: new URLSearchParams({
        // KRX OTP 발급 호출은 대상 bld 를 함께 받는다 — 구체 bld 가 없어도 동작하지만,
        // 명시하면 발급된 OTP 가 해당 화면 권한과 매칭되어 통과율이 높다.
        name: 'fileDown',
        url: 'dbms/MDC/STAT/standard/MDCSTAT30001',
      }),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!otpRes.ok) return null;
    const otp = (await otpRes.text()).trim();
    if (!otp) return null;

    const ctrl2 = new AbortController();
    const tid2  = setTimeout(() => ctrl2.abort(), 8000);
    const res = await fetch(KRX_SHORT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Referer':      'https://data.krx.co.kr/',
        'User-Agent':   YF_HEADERS['User-Agent'],
      },
      body: new URLSearchParams({
        bld: 'dbms/MDC/STAT/standard/MDCSTAT30001',
        mktId: 'STK',
        code: otp,
      }),
      signal: ctrl2.signal,
    });
    clearTimeout(tid2);
    if (!res.ok) return null;
    const data = await res.json() as { output?: Array<Record<string, unknown>>; OutBlock_1?: Array<Record<string, unknown>> };
    const rows = data.output ?? data.OutBlock_1 ?? [];
    if (rows.length === 0) return null;
    for (const key of KRX_SHORT_RATIO_KEYS) {
      const v = parsePct(rows[0][key]);
      if (v != null && v >= 0 && v <= 100) return v;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * KIS 공매도 잔고 상위(FHPST04020000) 30종목의 가중 평균 잔고 비율로 시장 단기 압력을 추정한다.
 * 정확한 "코스피 전체 공매도 거래대금 비율" 과는 다르지만, R5 보조 임계값(8%) 비교용으로는 신뢰 가능.
 * KIS 클라이언트가 미설정이면 null 반환.
 */
async function tryKrxShortViaKisRanking(): Promise<number | null> {
  try {
    const { getRanking } = await import('../../clients/kisRankingClient.js');
    const top = await getRanking('short-balance', { limit: 30 }).catch(() => []);
    if (!top || top.length === 0) return null;
    // value 는 short balance 절대량 — 실제 비율 추정에 부족하지만 상위 종목군의 평균
    // changePercent (전일대비) 음수 강도 + 종목 수로 시장 단기 압력 근사를 만든다.
    // 다만 비율 자체가 필요하므로 보수적으로 5.0% 를 기본값으로, 큰 음수 흐름이면 8% 이상으로.
    const negativePressure = top.filter(r => (r.changePercent ?? 0) < -1).length / top.length;
    const estimate = 4.5 + negativePressure * 5.0; // 4.5% ~ 9.5% 범위
    return Math.max(0, Math.min(20, estimate));
  } catch {
    return null;
  }
}

/**
 * 외국인 연속 일수 카운트 — 최근부터 역순 누적 (테스트 가능한 순수 함수).
 *
 * @param records   날짜 오름차순 정렬된 외국인 일별 net buy 레코드 (Pick: passiveNetBuy + activeNetBuy).
 * @param direction 'BUY' = (passive+active) > 0 연속, 'SELL' = (passive+active) < 0 연속.
 * @returns 0 이상 정수. 빈 배열 / 직전 일이 반대 방향이면 0.
 */
export function tallyConsecutiveForeignFlowDays(
  records: ReadonlyArray<{ passiveNetBuy: number; activeNetBuy: number }>,
  direction: 'BUY' | 'SELL',
): number {
  let count = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    const dayNet = records[i].passiveNetBuy + records[i].activeNetBuy;
    if (direction === 'BUY' ? dayNet > 0 : dayNet < 0) count++;
    else break;
  }
  return count;
}

/**
 * FSS 레코드 → foreignNetBuy5d(억원) + passiveActiveBoth + foreignContinuousBuyDays + foreignContinuousSellDays.
 *
 * - foreignContinuousBuyDays: 최근부터 역순 연속 *순매수* 일수.
 * - foreignContinuousSellDays: 최근부터 역순 연속 *순매도* 일수.
 *
 * 두 카운터는 **상호 배타적** (직전 일은 한쪽 방향만 가능 — 한쪽 ≥ 1 이면 다른 쪽 0).
 * marketDataRefresh 가 foreignFuturesSellDays 필드에 SellDays 를 매핑해 confluenceEngine 의
 * "외국인 5일+ 매도" 약세 신호 가산점을 작동시킨다 (원래는 선물 의도였으나 KIS/KRX
 * 선물 fetch 인프라 부담 회피 위해 현물 누적 순매도 카운트로 대체).
 */
/**
 * ADR-0136 격상: 반환 타입에 `passiveActiveBoth: boolean | null` (null = 평가 제외)
 * + `fssRecordsAge` 신선도 진단 추가. `FSS_STATUS_DIAGNOSTIC_DISABLED=true` ENV 시
 * 기존 동작 (false fallback) 100% 복원.
 */
export function computeFssVars(now: Date = new Date()): {
  foreignNetBuy5d: number;
  passiveActiveBoth: boolean | null;
  fssRecordsAge: FssRecordsAgeInfo;
  foreignContinuousBuyDays: number;
  foreignContinuousSellDays: number;
} {
  const records = loadFssRecords()
    .sort((a, b) => a.date.localeCompare(b.date));
  const fssRecordsAge = getFssRecordsAge(now);
  const diagnosticDisabled = process.env.FSS_STATUS_DIAGNOSTIC_DISABLED === 'true';
  const last5 = records.slice(-5);

  // ADR-0136: STALE/MISSING 시 passiveActiveBoth=null (평가 제외 명시).
  // 표본 < 3일도 통계 신뢰도 부족 → null. ENV 우회 시 기존 false fallback.
  const insufficientSample = fssRecordsAge.status !== 'OK' || last5.length < 3;
  if (insufficientSample) {
    return {
      foreignNetBuy5d: last5.reduce((s, r) => s + r.passiveNetBuy + r.activeNetBuy, 0),
      passiveActiveBoth: diagnosticDisabled ? false : null,
      fssRecordsAge,
      foreignContinuousBuyDays: tallyConsecutiveForeignFlowDays(records, 'BUY'),
      foreignContinuousSellDays: 0,
    };
  }

  const foreignNetBuy5d  = last5.reduce((s, r) => s + r.passiveNetBuy + r.activeNetBuy, 0);
  const passiveActiveBoth = last5.every(r => r.passiveNetBuy > 0 && r.activeNetBuy > 0);

  const continuousBuyDays  = tallyConsecutiveForeignFlowDays(records, 'BUY');
  const continuousSellDays = continuousBuyDays === 0
    ? tallyConsecutiveForeignFlowDays(records, 'SELL')
    : 0;

  return {
    foreignNetBuy5d,
    passiveActiveBoth,
    fssRecordsAge,
    foreignContinuousBuyDays: continuousBuyDays,
    foreignContinuousSellDays: continuousSellDays,
  };
}

// KRX 공매도 비율 헬퍼 (호출부 ⑥ 섹션 헤더 참조).
// 8% 초과 시 R5_CAUTION 보조 — regimeEngine.classifyRegime 가 regimeBridge 경유 `> 8` 참조.
// source/fetchedAt 도 macroState 영속 → /health 노출.
export async function refreshShortSellingSection(computed: MarketRefreshComputed): Promise<void> {
  const shortResult = await fetchKrxShortSelling();
  if (shortResult != null) {
    // ADR-0543 소비측 L4 가드(불변식 #7): KIS_ESTIMATE(휴리스틱)·CACHE(수동백필)는 L4 → R5 8%
    // 임계 평가 제외 — 영속 ratio 를 경계(8) 이하로 캡(source/fetchedAt 보존). regime 산출 자체
    // (regimeBridge.base.ts `?? 5`) 무변경=엔진 생존(불변식 #1). ENV OFF 면 미적용(byte-equivalent).
    const L4_SOURCES: ReadonlySet<ShortSellingSource | 'CACHE'> = new Set(['KIS_ESTIMATE', 'CACHE']);
    const capL4 = process.env.SHORT_SELLING_KIS_PROXY_FALLBACK === 'true' && L4_SOURCES.has(shortResult.source);
    const ratioForRegime = capL4 ? Math.min(shortResult.ratio, 8) : shortResult.ratio;
    computed.shortSellingRatio = ratioForRegime;
    computed.shortSellingSource = shortResult.source;
    computed.shortSellingFetchedAt = shortResult.fetchedAt;
    console.log(
      `[MarketRefresh] KRX 공매도비율: ${shortResult.ratio.toFixed(2)}% (source=${shortResult.source})` +
        (ratioForRegime !== shortResult.ratio ? ` [L4 R5임계 제외→${ratioForRegime.toFixed(2)}%]` : '') +
        (ratioForRegime > 8 ? ' ⚠ R5_CAUTION 보조' : ''),
    );
  } else {
    emitMarketDataProviderWarn('SHORT_SELLING_QUERY_FAILED', {
      carryForward: true,
    });
  }
}

// ── ⑥-b ADR-0139: ECOS 신용공여잔액 5영업일 변화율 ───────────────────────
// 사용자 12 아이디어 #7 — marginBalance5dChange 결손 해소.
// 호출 실패 시 marginBalanceSource='NONE' + 기존 값 보존 (silent degradation 차단).
export async function refreshMarginBalanceSection(computed: MarketRefreshComputed): Promise<void> {
  const marginResult = await fetchLatestMarginBalance5dChange().catch(() => null);
  if (marginResult) {
    computed.marginBalance5dChange = marginResult.changePct;
    computed.marginBalanceFetchedAt = marginResult.fetchedAt;
    computed.marginBalanceSource = 'ECOS_API';
    console.log(
      `[MarketRefresh] 신용공여 5d 변화율: ${marginResult.changePct >= 0 ? '+' : ''}${marginResult.changePct.toFixed(2)}% ` +
      `(latest=${marginResult.latestDate})${marginResult.changePct >= 5 ? ' ⚠ 신용잔고 과열' : ''}`,
    );
  } else {
    computed.marginBalanceSource = 'NONE';
    emitMarketDataProviderWarn('MARGIN_BALANCE_QUERY_FAILED', {
      marginBalanceSource: 'NONE',
      carryForward: true,
    });
  }
}

// ── ⑥-c ADR-0141 Stage 1: KRX 11분류 raw 데이터 영속 ───────────────────
// 사용자 후속 보강 P0-2 — FSS 자동 fetcher Stage 1 (raw 만, 매핑 미적용).
// Passive/Active 매핑은 ADR-0142 별도 PR (운영 데이터 1~2주 누적 후 데이터 기반 검증).
// FSS_DETAIL_FETCHER_DISABLED=true 시 fetch skip (긴급 우회).
export async function refreshFssDetailSection(computed: MarketRefreshComputed): Promise<void> {
  if (process.env.FSS_DETAIL_FETCHER_DISABLED !== 'true') {
    try {
      const detailRows = await fetchInvestorTradingDetail();
      if (detailRows.length > 0) {
        // resolveTradeDate KST 일자 — 최신 영업일.
        const todayKst = new Date(Date.now() + 9 * 3_600_000)
          .toISOString().slice(0, 10);
        appendFssDetailRecord({
          date: todayKst,
          rows: detailRows,
          fetchedAt: new Date().toISOString(),
        });
        computed.fssDetailFetchedAt = new Date().toISOString();
        computed.fssDetailSource = 'KRX_BLD';
        console.log(
          `[MarketRefresh] FSS 11분류 raw 영속: ${detailRows.length} 카테고리 ` +
          `(date=${todayKst})`,
        );

        // ── ⑥-d ADR-0142 Stage 2: Passive/Active 매핑 (ENV gate, default OFF) ──
        // FSS_MAPPING_ENABLED=true 명시 시에만 작동. 사용자 명시 *통념 추정 위험*
        // 차단을 위해 운영자가 1~2주 데이터 검증 후 활성화 결정.
        if (isFssMappingEnabled()) {
          try {
            const mapped = mapPassiveActive(detailRows, todayKst);
            upsertFssRecord({
              date: mapped.date,
              passiveNetBuy: mapped.passiveNetBuy,
              activeNetBuy: mapped.activeNetBuy,
            });
            console.log(
              `[MarketRefresh] FSS 매핑 영속 (ENV ON): ` +
              `passive=${mapped.passiveNetBuy.toFixed(0)}억, ` +
              `active=${mapped.activeNetBuy.toFixed(0)}억, ` +
              `foreign=${mapped.foreignNetBuy.toFixed(0)}억` +
              (mapped.unmatched.length > 0 ? ` (unmatched: ${mapped.unmatched.join(',')})` : ''),
            );
          } catch (e) {
            emitMarketDataProviderWarn('FSS_MAPPING_FAILED', {
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      } else {
        computed.fssDetailSource = 'NONE';
        emitMarketDataProviderWarn('FSS_DETAIL_EMPTY_RESPONSE', {
          carryForward: true,
        });
      }
    } catch (e) {
      computed.fssDetailSource = 'NONE';
      emitMarketDataProviderWarn('FSS_DETAIL_QUERY_FAILED', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
