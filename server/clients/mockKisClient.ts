/**
 * mockKisClient.ts — VTS 모드 전용 가상 KIS 클라이언트
 *
 * AUTO_TRADE_MODE === 'VTS'일 때 kisClient의 데이터 조회 함수를 대체하여
 * 실 API 호출 없이 전체 파이프라인(signalScanner→confluenceEngine→quantFilter→entryEngine)을
 * 로컬에서 비용 없이 테스트할 수 있게 한다.
 *
 * 사용법: server/index.ts에서 setKisClientOverrides(createMockKisOverrides())
 */

import type { KisClientOverrides, KisInvestorFlow } from './kisClient.js';

// ─── 가상 시세 생성 유틸 ─────────────────────────────────────────────────────

/** 종목코드를 시드로 사용하여 결정론적 가격을 생성한다 (재현 가능한 테스트) */
function seedFromCode(code: string): number {
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = ((hash << 5) - hash + code.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** 장 시간대 기반 미세 변동 (09:00~15:30 KST) — 정적 가격 방지 */
function intraday변동(): number {
  const now = new Date();
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  // sin 기반 일중 변동: ±2% 범위
  return Math.sin(minutes / 30) * 0.02;
}

/**
 * 종목코드 기반 가상 현재가를 생성한다.
 * - 결정론적 기반가격: 5,000 ~ 200,000원 (종목코드 해시 기반)
 * - 장중 미세 변동: ±2% (sin 기반, 실 장중 가격 움직임 모사)
 */
function generateMockPrice(code: string): number {
  const seed = seedFromCode(code);
  const basePrice = 5000 + (seed % 195000); // 5,000 ~ 200,000원
  const variation = intraday변동();
  return Math.round(basePrice * (1 + variation));
}

/** 종목코드 기반 가상 종목명 (6자리 코드 → 'Mock_XXXXXX') */
function generateMockName(code: string): string {
  const paddedCode = code.padStart(6, '0');
  // 실제 한국 주식처럼 보이는 가상 이름
  const names: Record<string, string> = {
    '005930': '삼성전자(Mock)',
    '000660': 'SK하이닉스(Mock)',
    '035420': 'NAVER(Mock)',
    '035720': '카카오(Mock)',
    '051910': 'LG화학(Mock)',
    '006400': '삼성SDI(Mock)',
    '068270': '셀트리온(Mock)',
    '105560': 'KB금융(Mock)',
    '055550': '신한지주(Mock)',
    '003670': '포스코퓨처엠(Mock)',
  };
  return names[paddedCode] ?? `VTS종목_${paddedCode}`;
}

// ─── 가상 투자자 수급 생성 ───────────────────────────────────────────────────

function generateMockInvestorFlow(code: string): KisInvestorFlow {
  const seed = seedFromCode(code);
  // 외국인·기관은 대체로 순매수, 개인은 역방향 (실제 시장 패턴 모사)
  const foreignNet = ((seed % 200000) - 50000);
  const institutionalNet = ((seed % 100000) - 30000);
  const individualNet = -(foreignNet + institutionalNet); // 제로섬 근사
  return {
    foreignNetBuy: foreignNet,
    institutionalNetBuy: institutionalNet,
    individualNetBuy: individualNet,
    source: 'KIS_API',
  };
}

// ─── 가상 순위 TR 응답 생성 ──────────────────────────────────────────────────

/** preScreenStocks()가 사용하는 4개 순위 TR의 가상 응답 */
function generateMockRankingResponse(trId: string): unknown {
  // 20개 가상 종목 목록
  const mockCodes = [
    '005930', '000660', '035420', '035720', '051910',
    '006400', '068270', '105560', '055550', '003670',
    '373220', '207940', '000270', '005380', '012330',
    '066570', '028260', '096770', '034730', '086790',
  ];

  const items = mockCodes.map((code) => {
    const price = generateMockPrice(code);
    const name = generateMockName(code);
    return {
      stck_shrn_iscd: code,
      hts_kor_isnm: name,
      stck_prpr: price.toString(),
      prdy_vrss: Math.round(price * 0.02).toString(),
      prdy_vrss_sign: '2', // 상승
      prdy_ctrt: '2.00',
      acml_vol: (100000 + seedFromCode(code) % 900000).toString(),
      acml_tr_pbmn: (price * 100000).toString(),
    };
  });

  return { output: items, rt_cd: '0', msg_cd: 'MCA00000', msg1: 'Mock 정상' };
}

// ─── Mock 오버라이드 팩토리 ──────────────────────────────────────────────────

/**
 * VTS 모드용 KIS 클라이언트 오버라이드를 생성한다.
 * 모든 데이터 조회 함수가 가상 데이터를 반환하므로 실 API 호출이 발생하지 않는다.
 */
export function createMockKisOverrides(): KisClientOverrides {
  console.log('[MockKIS] 가상 KIS 클라이언트 초기화 — 실 API 호출 없음');

  return {
    fetchCurrentPrice: async (code: string) => {
      const price = generateMockPrice(code);
      console.log(`[MockKIS] fetchCurrentPrice(${code}) → ${price.toLocaleString()}원`);
      return price;
    },

    fetchStockName: async (code: string) => {
      const name = generateMockName(code);
      return name;
    },

    fetchAccountBalance: async () => {
      // VTS 가상 잔고: 3천만원 (기본 AUTO_TRADE_ASSETS와 동일)
      const balance = 30_000_000;
      console.log(`[MockKIS] fetchAccountBalance() → ${balance.toLocaleString()}원`);
      return balance;
    },

    fetchKisInvestorFlow: async (code: string) => {
      return generateMockInvestorFlow(code);
    },

    realDataKisGet: async (trId: string, _apiPath: string, params: Record<string, string>) => {
      // 현재가 조회 (FHKST01010100)
      if (trId === 'FHKST01010100') {
        const code = params.FID_INPUT_ISCD ?? params.fid_input_iscd ?? '005930';
        const price = generateMockPrice(code);
        const name = generateMockName(code);
        return {
          output: {
            stck_prpr: price.toString(),
            hts_kor_isnm: name,
            stck_oprc: Math.round(price * 0.99).toString(),
            stck_hgpr: Math.round(price * 1.03).toString(),
            stck_lwpr: Math.round(price * 0.97).toString(),
            acml_vol: (100000 + seedFromCode(code) % 900000).toString(),
            prdy_vrss: Math.round(price * 0.02).toString(),
            prdy_vrss_sign: '2',
            prdy_ctrt: '2.00',
            per: '15.00',
            pbr: '1.50',
            w52_hgpr: Math.round(price * 1.2).toString(),
            w52_lwpr: Math.round(price * 0.7).toString(),
          },
          rt_cd: '0',
        };
      }

      // 투자자별 순매수 (FHKST01010300)
      if (trId === 'FHKST01010300') {
        const code = params.FID_INPUT_ISCD ?? params.fid_input_iscd ?? '005930';
        const flow = generateMockInvestorFlow(code);
        return {
          output: {
            frgn_ntby_qty: flow.foreignNetBuy.toString(),
            orgn_ntby_qty: flow.institutionalNetBuy.toString(),
            prsn_ntby_qty: flow.individualNetBuy.toString(),
          },
          rt_cd: '0',
        };
      }

      // 순위 TR (거래량/상승률/신고가/외국인)
      if (['FHPST01710000', 'FHPST01700000', 'FHPST01760000', 'FHPST01600000'].includes(trId)) {
        return generateMockRankingResponse(trId);
      }

      // 기타 TR — 빈 응답
      console.log(`[MockKIS] 미지원 TR: ${trId} — null 반환`);
      return null;
    },
  };
}
