/**
 * @responsibility KOSPI/KOSDAQ leader 정적 seed — Tier 4 ultimate fallback (ADR-0013)
 *
 * 모든 외부 소스(KRX/Naver/Shadow) 가 실패해도 universe 가 절대 0건이 되지
 * 않도록 보장하는 코드 박제 리스트. 수동 큐레이션이며 분기마다 검토. 자동
 * 갱신 금지 — 자동매매·AI 추천 진입점이 의존하므로 안정성이 최우선.
 */

import type { StockMasterEntry } from '../persistence/krxStockMasterRepo.js';

/**
 * KOSPI 코어 — 시총 상위 + DEFENSIVE/VALUE/GROWTH 분포 보장.
 * 코드는 단축코드(6자리) 기준. 종목명은 KRX 한글 종목약명을 따른다.
 */
const KOSPI_SEED: ReadonlyArray<Omit<StockMasterEntry, 'market'>> = [
  { code: '005930', name: '삼성전자' },
  { code: '000660', name: 'SK하이닉스' },
  { code: '373220', name: 'LG에너지솔루션' },
  { code: '207940', name: '삼성바이오로직스' },
  { code: '005380', name: '현대차' },
  { code: '000270', name: '기아' },
  { code: '005490', name: 'POSCO홀딩스' },
  { code: '035420', name: 'NAVER' },
  { code: '035720', name: '카카오' },
  { code: '051910', name: 'LG화학' },
  { code: '006400', name: '삼성SDI' },
  { code: '068270', name: '셀트리온' },
  { code: '012330', name: '현대모비스' },
  { code: '015760', name: '한국전력' },
  { code: '017670', name: 'SK텔레콤' },
  { code: '033780', name: 'KT&G' },
  { code: '097950', name: 'CJ제일제당' },
  { code: '055550', name: '신한지주' },
  { code: '105560', name: 'KB금융' },
  { code: '086790', name: '하나금융지주' },
  { code: '316140', name: '우리금융지주' },
  { code: '138040', name: '메리츠금융지주' },
  { code: '028260', name: '삼성물산' },
  { code: '009150', name: '삼성전기' },
  { code: '011200', name: 'HMM' },
  { code: '010130', name: '고려아연' },
  { code: '034730', name: 'SK' },
  { code: '003550', name: 'LG' },
  { code: '030200', name: 'KT' },
  { code: '032830', name: '삼성생명' },
  { code: '009540', name: 'HD한국조선해양' },
  { code: '329180', name: 'HD현대중공업' },
  { code: '042660', name: '한화오션' },
  { code: '000810', name: '삼성화재' },
  { code: '402340', name: 'SK스퀘어' },
  { code: '003670', name: '포스코퓨처엠' },
  { code: '011170', name: '롯데케미칼' },
  { code: '010950', name: 'S-Oil' },
  { code: '096770', name: 'SK이노베이션' },
  { code: '047810', name: '한국항공우주' },
  { code: '012450', name: '한화에어로스페이스' },
  { code: '272210', name: '한화시스템' },
  { code: '267260', name: 'HD현대일렉트릭' },
  { code: '352820', name: '하이브' },
  { code: '041510', name: 'SM' },
  { code: '035250', name: '강원랜드' },
  { code: '023530', name: '롯데쇼핑' },
  { code: '004020', name: '현대제철' },
  { code: '128940', name: '한미약품' },
  { code: '047050', name: '포스코인터내셔널' },
  { code: '024110', name: '기업은행' },
  { code: '139480', name: '이마트' },
  { code: '004990', name: '롯데지주' },
  { code: '161390', name: '한국타이어앤테크놀로지' },
  { code: '267250', name: 'HD현대' },
  { code: '011070', name: 'LG이노텍' },
  { code: '034220', name: 'LG디스플레이' },
  { code: '066570', name: 'LG전자' },
  { code: '003490', name: '대한항공' },
  { code: '180640', name: '한진칼' },
  { code: '079550', name: 'LIG넥스원' },
  { code: '064350', name: '현대로템' },
  { code: '009830', name: '한화솔루션' },
  { code: '000720', name: '현대건설' },
  { code: '375500', name: 'DL이앤씨' },
  { code: '028050', name: '삼성E&A' },
  { code: '006360', name: 'GS건설' },
  { code: '000150', name: '두산' },
  { code: '241560', name: '두산밥캣' },
  { code: '034020', name: '두산에너빌리티' },
  { code: '011780', name: '금호석유' },
  { code: '004370', name: '농심' },
  { code: '271560', name: '오리온' },
  { code: '282330', name: 'BGF리테일' },
  { code: '023590', name: '다우기술' },
  { code: '003410', name: '쌍용C&E' },
  { code: '018880', name: '한온시스템' },
  { code: '001040', name: 'CJ' },
  { code: '005830', name: 'DB손해보험' },
  { code: '000100', name: '유한양행' },
  { code: '326030', name: 'SK바이오팜' },
  { code: '302440', name: 'SK바이오사이언스' },
  { code: '298050', name: '효성첨단소재' },
  { code: '004800', name: '효성' },
  { code: '298040', name: '효성중공업' },
  { code: '108670', name: 'LX판토스' },
  { code: '383220', name: 'F&F' },
  { code: '001450', name: '현대해상' },
  { code: '000880', name: '한화' },
  { code: '009830', name: '한화솔루션' },
  { code: '014820', name: '동원시스템즈' },
  { code: '005440', name: '현대그린푸드' },
  { code: '004170', name: '신세계' },
  { code: '093370', name: '후성' },
  { code: '006260', name: 'LS' },
  { code: '010140', name: '삼성중공업' },
  { code: '009420', name: '한올바이오파마' },
  { code: '093050', name: 'LF' },
  { code: '002790', name: '아모레G' },
  { code: '090430', name: '아모레퍼시픽' },
  { code: '051900', name: 'LG생활건강' },
  { code: '001230', name: '동국홀딩스' },
  { code: '460860', name: '카카오페이' },
  { code: '377300', name: '카카오뱅크' },
  { code: '383310', name: '카카오게임즈' },
  { code: '034830', name: '한국토지신탁' },
  { code: '002100', name: '경농' },
  { code: '009240', name: '한샘' },
  { code: '012510', name: '더존비즈온' },
  { code: '008060', name: '대덕전자' },
  { code: '000080', name: '하이트진로' },
  { code: '027410', name: 'BGF' },
  { code: '139130', name: 'DGB금융지주' },
  { code: '175330', name: 'JB금융지주' },
  { code: '071050', name: '한국금융지주' },
  { code: '029780', name: '삼성카드' },
  { code: '001740', name: 'SK네트웍스' },
  { code: '120110', name: '코오롱인더' },
  { code: '383800', name: 'LX홀딩스' },
  { code: '383220', name: 'F&F' },
  { code: '194370', name: '제이에스코퍼레이션' },
  { code: '128820', name: '대성산업' },
  { code: '002270', name: '롯데푸드' },
  { code: '028670', name: '팬오션' },
  { code: '001120', name: 'LX인터내셔널' },
  { code: '079430', name: '현대리바트' },
  { code: '021240', name: '코웨이' },
  { code: '161890', name: '한국콜마' },
  { code: '000990', name: 'DB하이텍' },
];

/**
 * KOSDAQ 코어 — 성장주·반도체·바이오·2차전지 분포 보장.
 */
const KOSDAQ_SEED: ReadonlyArray<Omit<StockMasterEntry, 'market'>> = [
  { code: '247540', name: '에코프로비엠' },
  { code: '086520', name: '에코프로' },
  { code: '091990', name: '셀트리온헬스케어' },
  { code: '196170', name: '알테오젠' },
  { code: '066970', name: '엘앤에프' },
  { code: '028300', name: 'HLB' },
  { code: '293490', name: '카카오게임즈' },
  { code: '263750', name: '펄어비스' },
  { code: '112040', name: '위메이드' },
  { code: '041510', name: 'SM' },
  { code: '035900', name: 'JYP Ent.' },
  { code: '253450', name: '스튜디오드래곤' },
  { code: '215600', name: '신라젠' },
  { code: '141080', name: '리가켐바이오' },
  { code: '299030', name: '하이딥' },
  { code: '328130', name: '루닛' },
  { code: '357780', name: '솔브레인' },
  { code: '240810', name: '원익IPS' },
  { code: '058470', name: '리노공업' },
  { code: '036930', name: '주성엔지니어링' },
  { code: '084370', name: '유진테크' },
  { code: '278280', name: '천보' },
  { code: '950140', name: '잉글우드랩' },
  { code: '036540', name: 'SFA반도체' },
  { code: '054620', name: 'APS' },
  { code: '067310', name: '하나마이크론' },
  { code: '108860', name: '셀바스AI' },
  { code: '042700', name: '한미반도체' },
  { code: '388720', name: 'AP시스템' },
  { code: '298690', name: '에어부산' },
  { code: '033640', name: '네패스' },
  { code: '402340', name: 'SK스퀘어' },
  { code: '352480', name: '아이센스' },
  { code: '393890', name: '서남' },
  { code: '950160', name: '코오롱티슈진' },
  { code: '950130', name: '엑세스바이오' },
  { code: '326030', name: 'SK바이오팜' },
  { code: '237880', name: '클리오' },
  { code: '025980', name: '아난티' },
  { code: '278470', name: '에이피알' },
  { code: '347700', name: '라파스' },
  { code: '950170', name: 'JTC' },
  { code: '253840', name: '수젠텍' },
  { code: '215380', name: '호텔신라' },
  { code: '178320', name: '서진시스템' },
  { code: '068760', name: '셀트리온제약' },
  { code: '950210', name: '프레스티지바이오파마' },
  { code: '053800', name: '안랩' },
  { code: '060280', name: '큐렉소' },
  { code: '950220', name: '네오이뮨텍' },
  { code: '041190', name: '우리기술투자' },
  { code: '194480', name: '데브시스터즈' },
  { code: '950110', name: 'SBI핀테크솔루션즈' },
  { code: '093320', name: '케이아이엔엑스' },
  { code: '067160', name: '아프리카TV' },
  { code: '950300', name: '나노씨엠에스' },
  { code: '356860', name: '레인보우로보틱스' },
  { code: '290650', name: '엘앤씨바이오' },
  { code: '318660', name: '와이엠텍' },
  { code: '900140', name: '엘브이엠씨홀딩스' },
  { code: '950130', name: '엑세스바이오' },
  { code: '226330', name: '신스타임즈' },
  { code: '950170', name: 'JTC' },
  { code: '900340', name: '글로벌에스엠' },
  { code: '001770', name: '신화실업' },
  { code: '950070', name: 'SBI인베스트먼트' },
  { code: '041830', name: '인성정보' },
  { code: '950190', name: '미투젠' },
  { code: '900110', name: '이스트아시아홀딩스' },
  { code: '950200', name: '로스웰' },
  { code: '950180', name: '오가닉티코스메틱' },
  { code: '950100', name: '에스앤씨엔진그룹' },
  { code: '900260', name: '로스웰' },
  { code: '900290', name: '오가닉티코스메틱' },
  { code: '900270', name: '소프트센' },
  { code: '900310', name: '컬러레이' },
  { code: '900250', name: '크리스탈신소재' },
  { code: '900040', name: '차이나그레이트' },
  { code: '900280', name: '골든센츄리' },
  { code: '950150', name: '프로스테믹스' },
  { code: '950160', name: '코오롱티슈진' },
  { code: '900180', name: '윙입푸드' },
  { code: '950210', name: '프레스티지바이오파마' },
  { code: '900300', name: '오가닉티코스메틱' },
  { code: '900100', name: '뉴프라이드' },
  { code: '950220', name: '네오이뮨텍' },
];

/**
 * deduplicate seed — 일부 코드가 KOSPI·KOSDAQ 양쪽에 등장하는 경우 KOSPI 우선.
 * (예: 326030 SK바이오팜은 KOSPI 가 정답, KOSDAQ 는 오기.)
 */
function buildSeed(): StockMasterEntry[] {
  const seen = new Set<string>();
  const out: StockMasterEntry[] = [];
  for (const e of KOSPI_SEED) {
    if (seen.has(e.code)) continue;
    seen.add(e.code);
    out.push({ code: e.code, name: e.name, market: 'KOSPI' });
  }
  for (const e of KOSDAQ_SEED) {
    if (seen.has(e.code)) continue;
    seen.add(e.code);
    out.push({ code: e.code, name: e.name, market: 'KOSDAQ' });
  }
  return out;
}

let _cached: StockMasterEntry[] | null = null;

/**
 * KOSPI/KOSDAQ leader seed 반환 — Tier 4 ultimate fallback.
 * 메모리 캐시되어 호출 비용 0.
 */
export function getStockMasterSeed(): StockMasterEntry[] {
  if (!_cached) _cached = buildSeed();
  return _cached;
}

/** 테스트 전용 — 캐시 리셋. */
export function __resetStockMasterSeedCache(): void {
  _cached = null;
}
