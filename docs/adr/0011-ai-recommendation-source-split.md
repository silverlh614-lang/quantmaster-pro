# ADR-0011 — AI 추천 경로 KIS/KRX 분리 + 비용 가드

- **Status**: Accepted (2026-04-24, PR-25-A 인프라 / PR-25-B wiring 예정)
- **Owners**: architect, engine-dev
- **Extends**: ADR-0009 (외부 호출 예산), ADR-0010 (호출 예산 강화)

## 문제 정의

현재 `src/services/stock/momentumRecommendations.ts` /
`quantScreenRecommendations.ts` / `bearScreenerRecommendations.ts` 3 경로가
모두 KIS 랭킹 TR (`fetchKisRanking`) + KRX valuation (`/api/krx/valuation`) 에
의존한다. KIS/KRX 는 자동매매 경로(signalScanner / entryEngine / autoTradeEngine)
의 데이터원이기도 해서 다음 문제가 발생한다.

1. **자동매매 quota 침범**: 사용자가 "AI 추천" 버튼을 누를 때마다 KIS 랭킹 TR 6건 +
   종목별 KRX valuation 호출이 동시 6건 발생. 자동매매가 같은 KIS 토큰 버킷을 공유하므로
   장중 추천 호출이 자동매매 신호 호출에 백프레셔를 가한다.
2. **장외 비용 무용**: KIS 랭킹은 ADR-0009 (PR-23) 게이트로 장외에 빈 배열을 반환하는데,
   AI 추천이 빈 배열을 받아도 Gemini 호출은 그대로 발생 (사용자 지적).
3. **단일 통로 정책 모호**: CLAUDE.md 절대 규칙 #2 (`kisClient` 단일 통로) 와 #3
   (`stockService` 단일 통로) 가 "자동매매 데이터" vs "AI 추천 데이터" 를 구분하지 않아
   같은 통로가 두 목적에 동원된다.

사용자 요청 (원문 축약): **"AI 종목 추천은 KIS·KRX 안 쓰고 Google searching 으로
찾을 것. 자동매매에만 KIS/KRX 사용. 비용 최소화."**

## 결정

AI 추천 universe 발굴·enrichment 와 자동매매 데이터원을 **물리적으로 분리**한다.

### 1. 분리 정책 (절대 규칙 갱신)

CLAUDE.md 절대 규칙 #3 을 다음과 같이 분기:

- `stockService` — 자동매매·서버 스크리너용 단일 통로 (KIS/KRX/Yahoo/DART/Gemini)
- `aiUniverseService` (신규) — **AI 추천 전용** universe 발굴 + enrichment 단일 통로

`aiUniverseService` 는 **KIS/KRX 를 직접 호출하지 않는다**. 단 한 가지 예외:
- 종목코드 → 종목명 매핑이 필요할 때 `krxStockMasterRepo` 가 부팅 시 1회만 KRX 마스터를
  다운로드해 영속 캐시한다. 이후 매핑은 메모리·디스크 only. (사용자 옵션 답변에 따라
  KRX 1회 다운로드는 허용 — 자동매매도 같은 종목 마스터를 사용하므로 통로 중복 없음.)

### 2. 통로 구성 (B+C 하이브리드)

```
                 ┌─────────────────────────────────────┐
                 │ aiUniverseService (신규 SSOT)        │
                 └────────┬────────┬──────────┬────────┘
                          │        │          │
                ┌─────────▼──┐ ┌───▼────┐ ┌───▼──────────┐
                │ google-    │ │ naver- │ │ krxStock-    │
                │ Search     │ │ Finance│ │ MasterRepo   │
                │ Client (B) │ │ (C)    │ │ (1회 KRX)    │
                └─────┬──────┘ └────────┘ └──────────────┘
                      │
              ┌───────▼────────┐
              │ aiCallBudget   │
              │ Repo (예산 가드) │
              └────────────────┘
```

- **(B) Google Custom Search JSON API** (`googleSearchClient`):
  - 도메인 화이트리스트: `m.stock.naver.com`, `finance.naver.com`, `hankyung.com`,
    `mk.co.kr`, `sedaily.com`, `infostock.co.kr`
  - 일일 무료 한도 100 query
  - 검색 결과 → 페이지 제목·snippet 에서 6자리 종목코드 / 종목명 추출
- **(C) Naver Finance 모바일 API** (`naverFinanceClient`):
  - `m.stock.naver.com/api/...` — 현재가 / PER / PBR / 시총 / 외인·기관 수급
  - 비용 0, 비공식이지만 모바일 앱이 사용하는 안정 endpoint
  - 실패 시 호출자가 fallback 결정 (이번 ADR 에서는 강제 fallback 미정의)
- **종목 마스터** (`krxStockMasterRepo`):
  - 부팅 또는 24h TTL 만료 시 KRX `MDCSTAT00101` (전체 종목 마스터) 1회 호출
  - 결과를 `data/krx-master.json` 에 영속화 (코드/이름/시장/섹터)
  - AI 추천·자동매매 모두 이 단일 마스터를 참조

### 3. 비용 가드 (`aiCallBudgetRepo`)

각 외부 통로별 일일 호출 카운터를 Volume JSON 으로 영속한다.

```ts
interface DailyBudgetState {
  date: string;                    // YYYY-MM-DD KST
  counters: Record<string, number>; // bucketName → count
}
```

- 기본 한도: `AI_DAILY_CALL_BUDGET=80` (Google Custom Search 무료 100/day 의 80% 안전 마진)
- bucketName: `google_search`, `naver_finance`, `krx_master_refresh`
- 한도 도달 시 호출자에게 `BudgetExceededError` 또는 `null` 반환 (호출자 정책)
- 자정(KST) 자동 리셋

### 4. 호출 빈도 가정

- 사용자 dashboard "AI 추천" 수동 호출 = 1회당 google_search 1~5 query
  (mode 별 후보 발굴: momentum / quantScreen / bearScreen)
- 기존 cron (장 마감 후 추천 새로고침) 유지하되 같은 가드 적용
- 최악 시나리오: 일일 google_search 호출 ≤ 80 (예산 안에서 자동 차단)

### 5. 폴백 정책

| 통로 | 실패 시 정책 |
|------|---|
| googleSearch | 캐시된 직전 universe 반환 (24h TTL). 캐시도 없으면 빈 배열 + telegram WARN |
| naverFinance | 단일 종목 enrichment 실패는 무시 (해당 종목 누락) |
| krxStockMaster | 마스터 부재 시 부팅 실패시키지 않음 — `getStockMaster()` 가 빈 Map 반환 |

### 6. PR-25-A vs PR-25-B/C 범위

- **PR-25-A (이번 PR)**: 인프라만. 신규 모듈 6개 + ADR + 회귀 테스트.
  AI 추천 3 경로의 코드 변경 **없음**.
- **PR-25-B (다음)**: `momentumRecommendations` /
  `quantScreenRecommendations` / `bearScreenerRecommendations` 가
  `aiUniverseService` 사용하도록 wiring. `enrichment.ts` 의 `/api/krx/valuation` 호출도
  Naver finance 로 대체.
- **PR-25-C (다음)**: 비용 텔레메트리 + Gemini grounding (옵션 A) 을 narrative 보조용
  으로 한정 도입.

## 비결정 사항 (의도적)

- Naver finance 모바일 endpoint 의 정확한 path 는 PR-25-A 구현 시 fingerprint
  (`/api/json/search/searchListJson.nhn` 등) 후 안정 path 만 화이트리스트.
- google_search 결과 파싱 휴리스틱 (제목·snippet 에서 종목명/코드 추출) 의 정확도는
  PR-25-B 의 wiring 결과를 보고 PR-25-C 에서 튜닝.
- KRX 마스터의 24h TTL 은 ADR 본문에 고정. env 노출 안 함.

## 영향 범위 (PR-25-A 한정)

- `server/persistence/krxStockMasterRepo.ts` (신규, ~140 LoC)
- `server/persistence/aiCallBudgetRepo.ts` (신규, ~110 LoC)
- `server/persistence/paths.ts` (+ 2 경로)
- `server/clients/googleSearchClient.ts` (신규, ~150 LoC)
- `server/clients/naverFinanceClient.ts` (신규, ~140 LoC)
- `server/services/aiUniverseService.ts` (신규, ~120 LoC)
- `.env.example` (3 변수)
- `ARCHITECTURE.md` (boundary 추가)
- `CLAUDE.md` (절대 규칙 #3 보강)

테스트:
- `server/persistence/krxStockMasterRepo.test.ts`
- `server/persistence/aiCallBudgetRepo.test.ts`
- `server/clients/googleSearchClient.test.ts`
- `server/services/aiUniverseService.test.ts`
