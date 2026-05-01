# ADR-0144: KIS 프로그램매매 endpoint 정정 + 응답 필드 키 정렬

## 상태

채택 (2026-05-01)

## 배경

ADR-0137 (종목별 당일 프로그램 매매) + ADR-0138 (시장 종합 프로그램 매매) 도입
이후 `/program_today`, `/sh` 카드, signalScanner 후속 wiring 후보가 *200 OK + 빈
output* 으로 일관되게 실패. `/sh` 카드의 "종목 프로그램매매: 0/10" 결과가 운영
중에 지속 노출되며 프로그램 순매수 시그널 입력이 사실상 죽어 있는 상태.

KIS 공식 GitHub 저장소 `koreainvestment/open-trading-api` (검증 시점 2026-05-01)
의 `examples_llm/domestic_stock/**/program_*` 예제 파일들과 직접 비교한 결과
다음 두 건의 *교차 미스매치* 가 식별됐다.

### 결함 #1 — 종목별 프로그램매매(체결)

| 항목 | 직전 코드 | KIS 공식 (program_trade_by_stock.py) | 결과 |
|---|---|---|---|
| `tr_id` | `FHPPG04650201` | `FHPPG04650101` | 일별 ID 를 시간 path 에 송신 |
| path | `/comp-program-trade-today` | `/program-trade-by-stock` | 시장 path 를 종목 호출에 송신 |

`FHPPG04650201` 은 `program-trade-by-stock-daily` (종목 일별) 의 TR ID. KIS 는
tr_id 기준 라우팅이라 200 OK + 빈 `output` 으로 "조용한 실패" 를 반환.

### 결함 #2 — 시장 종합 프로그램매매

| 항목 | 직전 코드 | KIS 공식 | 결과 |
|---|---|---|---|
| `tr_id` | `FHPPG04600101` (시간) | `FHPPG04600101` (시간) | 일치 |
| path | `/comp-program-trade-daily` | `/comp-program-trade-today` | tr_id 와 path 가 시간/일별 어긋남 |

일별이 필요한 경우는 `tr_id=FHPPG04600001` + `path=...-daily` 조합이 따로 존재.

### 결함 #3 — 종목별 응답 필드 키 추정 오류

KIS 공식 `chk_program_trade_by_stock.py` 의 `COLUMN_MAPPING` 에서 확인되는 1차
키는 `whol_smtn_ntby_qty` / `whol_smtn_ntby_tr_pbmn` (전체 합계 순매수). 이전
코드의 `prgm_ntby_qty*` 추정은 다른 endpoint 의 키를 그대로 차용한 것으로 보이며,
실제 응답에서는 키가 다를 가능성이 높다.

## 결정

### Track 1 — endpoint 정정 (default 변경)

`server/clients/kisClient/query.ts`:

- `STOCK_PROGRAM_TRADE_TR_ID` default: `FHPPG04650201` → **`FHPPG04650101`**
- `STOCK_PROGRAM_TRADE_PATH` default: `comp-program-trade-today` → **`program-trade-by-stock`**
  - 환경변수 `KIS_STOCK_PROGRAM_TRADE_PATH` 신설 (TR ID 처럼 ENV 우회 가능)
- `MARKET_PROGRAM_TRADE_PATH` default: `comp-program-trade-daily` → **`comp-program-trade-today`**
  - TR ID (`FHPPG04600101`) 는 시간 ID 라 path 와 정합 (변경 없음)

### Track 2 — 응답 키 1차/fallback 분리

`extractKisNumber` 의 후보 키 순서를:

```
['whol_smtn_ntby_qty', 'prgm_ntby_qty', 'PRGM_NTBY_QTY']
['whol_smtn_ntby_tr_pbmn', 'prgm_ntby_tr_pbmn', 'PRGM_NTBY_TR_PBMN']
```

으로 갱신. KIS 공식 검증 키를 1차로 두되, 응답이 다른 변형으로 변동할 가능성에
대비해 직전 키도 fallback 으로 보존. `_2` 변형 키는 *과거 endpoint pagination
output* 에 특화된 가짜 fallback 이라 제거.

`programBuyRatio` 는 새 endpoint 에서 직접 필드 부재 — `prgm_byov_rate` /
`PRGM_BYOV_RATE` 두 키만 시도하고 부재 시 `null` 보존 (ADR-0136 의미 단절 차단).

### Track 3 — 후속 검증 후크

`/program_today` 명령 실패 메시지에 `KIS_STOCK_PROGRAM_TRADE_PATH` ENV 우회 안내
추가. 운영자가 KIS 응답 구조 변동에 ENV 만으로 대응할 수 있도록 보존.

## 회귀 영향

- `queryProgramTrade.test.ts`: TR ID/path default 기대값 변경 + 새 1차 키
  (`whol_smtn_*`) 매칭 케이스 추가 + 구 1차 키 fallback 케이스 추가 +
  `KIS_STOCK_PROGRAM_TRADE_PATH` ENV 케이스 추가.
- `queryMarketProgramTrade.test.ts`: path default 기대값 변경 (`-daily` → `-today`).
- 외부 시그니처 (반환 타입 `KisStockProgramTrade` / `KisMarketProgramTrade`) 불변
  → 호출자 (`signalScanner`, `programToday.cmd`, `supplyHealth.cmd`) 수정 0.

## 검증 시나리오

1. 평일 09:30 KST 첫 호출에서 `/sh` 카드의 "종목 프로그램매매: success 8~10/10" 으로
   회복되는지 확인.
2. 회복되지 않을 경우 — 응답 raw output 1회 로깅 후 `whol_smtn_*` 외 다른 키
   변동 식별. ENV (`KIS_STOCK_PROGRAM_TRADE_PATH`) 만으로 다른 endpoint 로 즉시
   전환 가능.
3. KIS 공식 GitHub 검증은 6개월마다 재수행 (2026-11-01 다음 차).

## 위험

- KIS 공식 GitHub 저장소가 추후 갱신될 가능성 — 본 ADR 의 검증은 2026-05-01
  스냅샷 기준.
- 새 endpoint 의 일별 한도/속도 정책이 직전과 다를 가능성 — `realDataKisGet`
  회로차단/jitter 가 자동 흡수.
