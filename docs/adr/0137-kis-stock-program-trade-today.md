# ADR-0137: KIS 종목별 당일 프로그램 매매 페치 인프라 (사용자 P1)

## 상태

채택 (2026-05-01)

## 배경

사용자 5/1 audit 12 아이디어 중 #3 — *"KIS comp-program-trade-today — 종목별
당일 프로그램 매매. 엔드포인트가 이미 KIS Open API 공식 문서에 등재됨. 현재 코드의
realDataKisGet 헬퍼를 그대로 재사용해서 30~50줄로 추가 가능. 페르소나 #6
'외국인 프로그램/비프로그램' 시그널을 0→1 로 채우는 가장 빠른 길."*

페르소나 자료 #6 (외국인 프로그램 vs 비프로그램 매매) 시그널의 *데이터 입력 자체*
가 코드베이스에 부재. enrichment / autoTradeEngine / signalScanner 어디에서도
종목별 프로그램 매매 데이터를 조회하지 않음 (grep `comp-program-trade` /
`prgm_ntby` / `programNetBuy` 결과 0건).

## 결정

### Track 1 — 페치 인프라만 (의사결정 wiring 후속 PR 분리)

본 PR scope 는 *데이터 페치 + 진단 명령* 만. enrichment / signalScanner /
autoTradeEngine wiring (프로그램 순매수 양수 종목에 가중치 +X) 은 별도 PR —
페르소나 의사결정 변경은 회귀 위험.

### Track 2 — kisClient SSOT 경유 (절대 규칙 #2)

**`server/clients/kisClient/query.ts`** 에 `fetchKisStockProgramTrade(code)`
신설. ADR-0135 (kisClient 분해) 의 도메인 격리 패턴 차용 — `realDataKisGet`
SSOT 경유로 회로차단/블랙리스트/jitter 자동 적용.

```typescript
export async function fetchKisStockProgramTrade(code: string): Promise<KisStockProgramTrade | null>
```

- KIS_APP_KEY 미설정 + 실계좌 클라이언트 부재 → null (안전 fallback)
- output 필드명 한글 약어 + 영문 약어 + `_2` 변형 모두 시도 (KIS 응답 변동 안전)
- programBuyRatio 부재 시 null (강제 0 fallback 차단 — 의미 단절 방지, ADR-0136 정합)
- throw → null (KIS 일시 장애가 의사결정 차단 안 함)

### Track 3 — TR ID + endpoint SSOT

```typescript
const STOCK_PROGRAM_TRADE_TR_ID = process.env.KIS_STOCK_PROGRAM_TRADE_TR_ID ?? 'FHPPG04650201';
const STOCK_PROGRAM_TRADE_PATH = '/uapi/domestic-stock/v1/quotations/comp-program-trade-today';
```

ENV `KIS_STOCK_PROGRAM_TRADE_TR_ID` override — KIS Open API 공식 문서 TR ID
가 변경될 가능성 대비 (운영자 즉시 수정 가능). default 값 `FHPPG04650201` 은
공개 문서 + 패턴 추정 — 운영 환경에서 첫 호출 시 검증 필요.

### Track 4 — `KisStockProgramTrade` 타입 SSOT

```typescript
export interface KisStockProgramTrade {
  stockCode: string;
  programNetBuyQty: number;        // 프로그램 순매수 수량 (주, 양수=순매수 / 음수=순매도)
  programNetBuyAmount: number;     // 프로그램 순매수 금액 (원)
  programBuyRatio: number | null;  // 프로그램 매수 비중 (%) — 부재 시 null
  fetchedAt: string;               // ISO
  source: 'KIS_API';
}
```

`KisClientOverrides.fetchKisStockProgramTrade?` 추가 — VTS mock 호환.

### Track 5 — `/program_today` 텔레그램 진단 명령

**`server/telegram/commands/system/programToday.cmd.ts` 신규**:

- name: `/program_today`, alias `/prog`
- category: `SYS`, riskLevel: 0 (read-only KIS 1회 호출), visibility: `ADMIN`
- usage: `/program_today <6자리 코드>` (예: `/program_today 005930`)
- 출력:
  - 종목코드 + 응답 시각 (KST)
  - 프로그램 순매수 수량 (양수 / 음수 / 0 분기)
  - 프로그램 순매수 금액 (억원 변환)
  - 프로그램 매수 비중 (% 또는 null)
  - 데이터 출처 (KIS_API)
  - KIS 응답 null 시 운영자 안내 (ENV / 회로차단 / TR ID 검증)
- KIS 단일 호출 → 회로차단 부담 미미 + 운영자 진단 인프라 시드

## 결과

### 운영 효과 (배포 후)

1. 운영자가 `/program_today <code>` 한 번에 종목별 당일 프로그램 매매 즉시 확인.
2. fetchKisStockProgramTrade SSOT 가 후속 PR (enrichment wiring / signalScanner
   가중치 / 텔레그램 리포트) 의 데이터 입력 인프라.
3. KIS Open API 공식 endpoint 첫 통합 — 향후 다른 KIS 진단 데이터 (시장 단위
   프로그램 매매 / 신용잔고 시장 5d 변화율) 페치 패턴 차용 가능.

### KIS quota 영향

- 신규 단발성 호출 (사용자 텔레그램 명령 1회당 1 호출).
- enrichment / signalScanner / autoTradeEngine 본체 무수정 — *주기적 호출
  부담 0건* (의사결정 wiring 후속 PR 시점에 검토).

### 절대 규칙 정합

- **#2 kisClient 단일 통로**: `realDataKisGet` SSOT 경유, raw fetch 0건.
- **#4 autoTradeEngine 단일 통로**: 매매 결정 변경 0줄 — 진단 명령 + 페치 인프라만.
- **LIVE 매매 본체 0줄 변경** — 신규 모듈만 추가.

## 회귀 테스트

- `kisClient/query.programTrade.test.ts` — fetchKisStockProgramTrade 분기:
  - KIS_APP_KEY 미설정 시 null
  - overrides.fetchKisStockProgramTrade 우선 적용 (VTS mock)
  - realDataKisGet null 응답 시 null
  - 정상 응답 → KisStockProgramTrade 객체 정확
  - output 필드 다중 키 매칭 (한글 약어 / 영문 약어 / `_2` 변형)
  - programBuyRatio 부재 시 null (강제 0 fallback 차단)
  - realDataKisGet throw → null 안전 흡수
  - ENV `KIS_STOCK_PROGRAM_TRADE_TR_ID` override 적용
- `programToday.cmd.test.ts` — 메시지 빌더 + execute:
  - 정상 응답 (양수 / 음수 / 0) 분기
  - null 응답 운영자 안내
  - programBuyRatio null 분기
  - 잘못된 코드 입력 (6자리 미달) 안내
  - throw graceful

## 잔여 후속 PR (scope 외)

1. **PR-3 (P1)**: KIS 시장 종합 프로그램 매매 추이 — `macroState.programNetBuy` 영속.
2. **wiring**: enrichment 에 `programNetBuyQty / programBuyRatio` 옵셔널 필드 →
   stock 카드 표시 + signalScanner 가중치 (별도 ADR + 회귀 위험 격리).
3. **TR ID 검증**: 운영 환경에서 첫 호출 후 ENV override 필요 시 즉시 적용.
