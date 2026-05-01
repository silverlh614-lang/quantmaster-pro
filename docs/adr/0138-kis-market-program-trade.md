# ADR-0138: KIS 시장 종합 프로그램 매매 추이 페치 인프라 (사용자 P1)

## 상태

채택 (2026-05-01)

## 배경

사용자 5/1 audit 12 아이디어 중 #4 — *"KIS 종합 프로그램 매매 추이 (시장 단위).
종목 단위와 별도로 시장 전체 프로그램 매매 동향이 KIS 에 있음. 기관 프로그램매매
동향 실시간 추적 예시가 KIS 코딩도우미 MCP 에 명시. macroState 에 programNetBuy /
programArbitrageNetBuy 필드 추가, regime 분류에 가중치"*.

PR-2 (ADR-0137) 가 *종목별* 프로그램 매매 페치 인프라를 마련했지만, *시장 전체*
방향성 신호는 별도 데이터. 둘은 의미가 다르다:

- **종목별** (ADR-0137): "이 종목에 프로그램 자금이 들어왔는가?" — 단일 종목
  의사결정 입력
- **시장 단위** (본 PR): "코스피 전체에서 프로그램 매수 vs 매도 어느 쪽?" —
  레짐 분류 입력 (BULL/BEAR 신호 보조)

코드베이스 grep 결과 시장 단위 프로그램 매매 페치 0건. macroState 에도 부재.

## 결정

### Track 1 — 페치 인프라 + 영속만 (regime 가중치 wiring 후속 PR 분리)

본 PR scope 는 *데이터 페치 + macroState 영속 + 진단 명령* 만. regime 분류
가중치 (BULL_NORMAL → BULL_AGGRESSIVE 격상 / R5_CAUTION → R6_DEFENSE 격상) 는
별도 PR — 페르소나 의사결정 변경은 회귀 위험.

### Track 2 — kisClient SSOT 경유 (절대 규칙 #2)

**`server/clients/kisClient/query.ts`** 에 `fetchKisMarketProgramTrade()` 신설.
ADR-0137 (PR-2) 패턴 차용 — `realDataKisGet` SSOT 경유.

```typescript
export async function fetchKisMarketProgramTrade(): Promise<KisMarketProgramTrade | null>
```

- KIS_APP_KEY 미설정 + 실계좌 클라이언트 부재 → null (안전 fallback)
- output 다중 키 매칭 — 한글 약어 + 영문 약어 + `_2` 변형 (ADR-0137 패턴)
- programArbitrageNetBuy 부재 시 null (강제 0 fallback 차단)
- throw → null 안전 흡수

### Track 3 — TR ID + endpoint SSOT (ENV 우회)

```typescript
const MARKET_PROGRAM_TRADE_TR_ID = process.env.KIS_MARKET_PROGRAM_TRADE_TR_ID ?? 'FHPPG04600101';
const MARKET_PROGRAM_TRADE_PATH = process.env.KIS_MARKET_PROGRAM_TRADE_PATH
  ?? '/uapi/domestic-stock/v1/quotations/comp-program-trade-daily';
```

KIS Open API 공식 TR ID 가 변경될 가능성 대비 — ENV 양쪽 모두 override 가능.
default 값은 코스피 시장 단위 추정 — 운영 환경에서 첫 호출 시 검증 필요.

### Track 4 — `KisMarketProgramTrade` 타입 SSOT

```typescript
export interface KisMarketProgramTrade {
  programNetBuyQty: number;            // 시장 전체 프로그램 순매수 수량 (주)
  programNetBuyAmount: number;         // 시장 전체 프로그램 순매수 금액 (원)
  programArbitrageNetBuy: number | null; // 차익거래 순매수 (원, 부재 시 null)
  fetchedAt: string;                   // ISO
  source: 'KIS_API';
}
```

`KisClientOverrides.fetchKisMarketProgramTrade?` 추가 (VTS mock 호환).

### Track 5 — `MacroState` 영속 + `marketDataRefresh` wiring

**`MacroState` 옵셔널 필드 4종 추가**:

```typescript
programNetBuyAmount?: number;            // 시장 프로그램 순매수 금액 (억원)
programArbitrageNetBuy?: number | null;  // 차익거래 순매수 (억원, 부재 시 null)
programFetchedAt?: string;               // KIS 응답 시각 (ISO) — /program_market 신선도
programSource?: 'KIS_API' | 'NONE';      // 출처 구분
```

`refreshMarketRegimeVars()` 가 KIS 호출 → null 폴백 시 기존 macroState 값 보존
(부재 → 'NONE' 마커). 로그에 `programNetBuyAmount=+150억원` 형식 출력.

### Track 6 — `/program_market` 텔레그램 진단 명령

**`server/telegram/commands/system/programMarket.cmd.ts` 신규**:

- name: `/program_market`, alias `/prog_market` `/pm`
- category: `SYS`, riskLevel: 0 (read-only KIS 1회), visibility: `ADMIN`
- 출력:
  - 시장 프로그램 순매수 금액 (억원, 양수/음수/0 분기)
  - 차익거래 순매수 (억원 또는 null 분기)
  - 응답 시각 (KST)
  - 데이터 출처
  - KIS null 응답 시 운영자 안내 (ENV / 회로차단 / TR ID 검증)

## 결과

### 운영 효과 (배포 후)

1. 운영자가 `/program_market` 한 번에 시장 종합 프로그램 매매 즉시 확인.
2. `macroState.programNetBuyAmount` 영속 — 후속 PR (regime 가중치 / 텔레그램
   리포트 / 자기학습 narrative) 의 데이터 입력.
3. KIS 시장 단위 endpoint 첫 통합 — 향후 다른 시장 단위 KIS 진단 (신용잔고
   변화율 / 공매도 비율 변화) 패턴 차용 가능.

### KIS quota 영향

- `marketDataRefresh.refreshMarketRegimeVars()` cron 호출당 1 추가.
- 사용자 명령 1회당 단발성 1 호출.
- enrichment / signalScanner / autoTradeEngine 본체 무수정 — *주기적 호출
  부담 미미* (이미 cron 경로).

### 절대 규칙 정합

- **#2 kisClient 단일 통로**: `realDataKisGet` SSOT 경유, raw fetch 0건.
- **#4 autoTradeEngine 단일 통로**: 매매 결정 변경 0줄 — 영속 + 진단만.
- **LIVE 매매 본체 0줄 변경** — macroState 옵셔널 필드 + cron wiring.

## 회귀 테스트

- `kisClient/query.marketProgramTrade.test.ts` — fetchKisMarketProgramTrade
  분기:
  - KIS_APP_KEY 미설정 시 null
  - overrides.fetchKisMarketProgramTrade 우선 적용
  - realDataKisGet null 응답 시 null
  - 정상 응답 → KisMarketProgramTrade 객체 정확
  - output 다중 키 매칭 (한글 / 영문 / `_2`)
  - programArbitrageNetBuy 부재 시 null
  - throw graceful
  - ENV TR_ID + PATH override 적용
- `programMarket.cmd.test.ts` — 메시지 빌더 + execute:
  - 정상 응답 (양수 / 음수 / 0) 분기
  - null 응답 운영자 안내
  - programArbitrageNetBuy null 분기
  - throw graceful
- `marketDataRefreshProgramMarket.test.ts` — refreshMarketRegimeVars wiring:
  - KIS 정상 응답 시 macroState 4 필드 영속
  - KIS null 시 기존 값 보존
  - 억원 변환 정확

## 잔여 후속 PR (scope 외)

1. **wiring**: regime 분류 가중치 (BULL/BEAR 신호 보조) — 별도 ADR + 회귀 위험 격리.
2. **텔레그램 리포트 표기**: 일일 리포트 / 주간 리포트에 시장 프로그램 순매수 라인.
3. **TR ID 검증**: 운영 환경에서 첫 호출 후 ENV override 필요 시 즉시 적용.
