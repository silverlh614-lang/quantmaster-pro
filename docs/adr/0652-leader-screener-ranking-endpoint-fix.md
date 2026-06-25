<!--
@responsibility ADR-0652 — Leader/Screener 랭킹 endpoint 문자열 정정(volume path·market-cap trId+scr·institutional foreign-institution-total 전환).
랭킹=발굴 전용·executionImpact NONE·LIVE 0줄. KIS 공식 GitHub 1:1 검증. engine-dev 구현 계약 SSOT.
-->

# ADR-0652 — Leader/Screener Ranking Endpoint String Fix

- **Status:** Accepted (운영자 silverlh614 standing approval)
- **Date:** 2026-06-25
- **Type:** patch/fix (검증된 결함 endpoint 문자열 정정 — 신규 경계 0, kill-switch flag 1)
- **Branch:** `claude/scan-blockers-diagnostic-wp93a3`
- **계보:** 0651(leader 404 root-fix·circuit 격리) · 0561(KIS Primary Absolute) · 0146(자가 review) ·
  0530(Patch Scope Guard) · 0157(opt-IN/kill-switch flag 규약) · 0641(flag-lifecycle governance)

---

## Context

ADR-0651 의 "circuit 오염(circuit contamination)" 모델은 **틀렸다.** leader/screener 랭킹 TR 이
bare 404 를 내던 진짜 결함은 **잘못된 path/tr_id/scr 문자열**이다. KIS 공식 GitHub
(`koreainvestment/open-trading-api`) 와 1:1 대조해 다음을 확정했다.

### KIS 공식 GitHub 검증 표

| 랭킹 | repo (404) | KIS 공식 (정) | 정정 범위 |
|------|------------|---------------|-----------|
| volume (거래량) | path `/uapi/domestic-stock/v1/ranking/volume` | path `/uapi/domestic-stock/v1/quotations/volume-rank` (tr_id `FHPST01710000` 불변·scr `20171` 불변) | **PATH ONLY** |
| market-cap (시총) | tr_id `FHPST01720000`·scr `20172` | tr_id `FHPST01740000`·scr `20174` (path `/ranking/market-cap` 불변) | **tr_id + scr** |
| institutional (기관) | path `/uapi/domestic-stock/v1/ranking/investor`·tr_id `FHPST01600000` (KIS 미존재 → 404) | path `/uapi/domestic-stock/v1/quotations/foreign-institution-total`·tr_id `FHPTJ04400000` | **full migration** (path+trId+params+mapRow) |
| fluctuation (등락률) | path `/ranking/fluctuation`·`FHPST01700000` | 동일 — **정상** | 무접촉 |

`institutional` 의 KIS 권위 param(소문자·repo 컨벤션 일치): `fid_cond_mrkt_div_code:'V'`,
`fid_cond_scr_div_code:'16449'`, `fid_input_iscd:` (J/KOSPI='0001' · Q/KOSDAQ='1001'),
`fid_div_cls_code:'0'`(수량정렬), `fid_rank_sort_cls_code:'0'`(순매수), `fid_etc_cls_code:'2'`(기관).

### 출력 필드 — KIS 공식 소스로 확정 (2026-06-25)

`foreign-institution-total`(FHPTJ04400000) 출력 필드를 KIS 공식 레포
`koreainvestment/open-trading-api` 의 `chk_foreign_institution_total.py` COLUMN_MAPPING 으로 확정:
code = `mksc_shrn_iscd`(유가증권 단축 종목코드), name = `hts_kor_isnm`(HTS 한글 종목명),
instNet = `orgn_ntby_qty`(**기관계 순매수 수량**), changePercent = `prdy_ctrt`(전일 대비율).
mapRow 의 방어적 `??` 체인(`orgn_ntby_qty ?? orgn_ntby_tr_pbmn ?? ntby_qty`, code `?? stck_shrn_iscd`)은
**primary 필드가 공식 확정**되었으므로 그대로 유지(graceful 방어, 회귀 안전). 운영 검증: `/lr`
bypassCache 프로브가 장외에도 시총 30·기관 60·거래량 30 실데이터 수신(404 소멸) 확인.

---

## Decision

3개 정정을 **단일 kill-switch flag `isLeaderRankingEndpointFixEnabled()` (default ON)** 뒤에 둔다.

1. **volume / large-volume** — path 만 `/quotations/volume-rank` 로 정정. tr_id·scr·params 불변.
2. **market-cap** — tr_id `FHPST01740000` + scr `20174`. path 불변.
3. **institutional-net-buy** — `/quotations/foreign-institution-total` + `FHPTJ04400000` 로 전 migration
   (path+trId+params+mapRow). `getRanking` 의 J/Q 루프는 본 endpoint 에 한해 항상
   `fid_cond_mrkt_div_code:'V'` 를 보내고 div 'J'→`fid_input_iscd '0001'`, 'Q'→`'1001'` 로 매핑한다.

DRY: `server/clients/kisRankingClient.ts` 에 `resolveRankingEndpoint(type, mrktDiv)` 단일 resolver
(flag 게이트 1지점) 추가 — `{ trId, apiPath, scrDivOverride? }` 반환. 인라인 screener/expander/scanner
호출은 flag ternary 로 게이트. caller inline ENV 검사 금지 — `gateConfig.ts` SSOT 만 사용.

### flag 충돌 정리 (0651 W2 supersede)

기존 `isLeaderRankingParamFixEnabled()`(0651 W2)는 그대로 둔다. 단 endpoint-fix flag 가 ON 이면
institutional-net-buy 는 `foreign-institution-total` 로 migration 되며 W2 의 sort param 분기를
**supersede** 한다(두 flag 가 깨끗이 게이트되어 충돌 없음). endpoint-fix OFF 일 때만 W2 분기가 구
`/ranking/investor` path 에 적용된다.

### 기본값 근거 (default ON kill-switch)

현 endpoint 가 100% broken(검증된 404)이고 정정이 권위적이며 engineMode SHADOW_ONLY 로
executionImpact=NONE 이므로 default ON kill-switch(`!== 'false'`). `LEADER_RANKING_ENDPOINT_FIX_ENABLED=false`
1줄 = 즉시 구(broken) 문자열로 byte-identical 롤백.

---

## Consequences

### 긍정
- leader funnel + screener 랭킹 404 근본 해소 → 동적 유니버스 충전 복원.
- KIS 공식 GitHub 검증 기반이라 추측 0.

### 비용·위험
- foreign-institution-total 출력 필드명 KIS 공식 소스로 확정(orgn_ntby_qty=기관계 순매수 수량) — 방어적 mapRow 유지(회귀 안전).
- leader/screener 발굴 종목 구성 변동 가능. Gate1/2/3 판정 본문·requiredScore=70 무접촉 →
  **매매 안전성 영향 NONE**.

### 무접촉 보증 (forbidden)
`autoTradeEngine` · `buyPipeline` · SourceSnapshot 생성기 · Gate1/2/3 판정 본문 · `requiredScore=70` ·
ADR-0471 곡선 · `src/**` — 전부 무손상.

### 9대 불변식 보존
- **#1** Trading Engine 무정지 (랭킹 실패=빈 배열·throw 0).
- **#2** Shadow Learning 무정지·무접촉.
- **#6** Provider 404 ≠ bearish (graceful 빈 배열·marketSignal 변환 0).
- **#7** AI_ESTIMATED live 사용 0 (랭킹=발굴 전용).
- **#8** 실거래 차단과 Shadow 판단 차단 분리 유지.

---

## Patch Scope Guard (ADR-530, 11 필드)

| 필드 | 값 |
|------|-----|
| `targetDomain` | KIS provider 랭킹 endpoint 문자열 (단일 도메인 — 한계 내) |
| `allowedFiles` | `server/clients/kisRankingClient.ts` · `server/trading/gateConfig.ts`(flag) · `server/screener/stockScreener.ts`(랭킹 호출만) · `server/screener/dynamicUniverseExpander.ts`(랭킹 호출만) · `server/screener/universeScanner.ts`(랭킹 호출만) · `server/clients/kisClient/kisOfficialEndpointRegistry.ts` · `server/clients/mockKisClient.ts` · 해당 `*.test.ts` · governance(`docs/adr/*`·`docs/ai/10`·`.env.example`·`scripts/gate_flag_lifecycle.json`) |
| `forbiddenFiles` | `server/trading/autoTradeEngine*` · `server/trading/buyPipeline*` · SourceSnapshot 생성기 · Gate1/2/3 판정 본문 · `requiredScore`/ADR-0471 곡선 모듈 · `src/**` |
| `expectedBehaviorChange` | 랭킹 TR 404 회피 → leader/screener 캐시 충전 복원 (발굴 단계) |
| `sourceSnapshotImpact` | NONE (불변식 #3·#9 — 랭킹은 SourceSnapshot 외부 발굴) |
| `executionImpact` | NONE (랭킹=발굴 전용·engineMode SHADOW_ONLY) |
| `shadowLearningImpact` | NONE (불변식 #2 — 무정지·무접촉) |
| `telegramImpact` | NONE (표시 문자열 무변 — probe 는 resolved trId 로 동일 행 표시) |
| `providerImpact` | endpoint 문자열 정정. 404≠bearish(불변식 #6)·KIS Primary 단일통로 유지(ADR-0561·0651) |
| `testsRequired` | flag ON → volume path/market-cap trId+scr/institutional path+trId+etc_cls 검증 · flag OFF → 구 문자열 byte-identical · 방어적 mapRow(orgn_ntby_qty 파싱·missing code→null) |
| `rollbackPlan` | `LEADER_RANKING_ENDPOINT_FIX_ENABLED=false` 1줄 즉시 구(broken) 문자열 byte-identical 복원 |

---

## flag-lifecycle

- `envFlag`: `LEADER_RANKING_ENDPOINT_FIX_ENABLED`
- `adr`: `0652`
- `status`: `ON` (default — kill-switch `!== 'false'`)
- `reviewBy`: `2026-07-25` (출력 필드는 2026-06-25 KIS 공식 소스로 확정 완료 — 장중 정렬 동작만 운영 모니터링)
- `rollback`: `LEADER_RANKING_ENDPOINT_FIX_ENABLED=false` 1줄 즉시 구 문자열 복원

---

## References

- 코드: `server/clients/kisRankingClient.ts`(TR_SPECS·resolveRankingEndpoint·probe) ·
  `server/screener/stockScreener.ts`(preScreenStocks 랭킹 4-TR) ·
  `server/screener/dynamicUniverseExpander.ts`(volume·market-cap) ·
  `server/screener/universeScanner.ts`(Stage1 volume) ·
  `server/clients/kisClient/kisOfficialEndpointRegistry.ts`(rankingVolume·rankingMarketCap·rankingInvestor) ·
  `server/clients/mockKisClient.ts`(trId allowlist + mock rows)
- KIS 공식: `koreainvestment/open-trading-api` (volume-rank · ranking/market-cap · foreign-institution-total)
- 선행: ADR-0651 (circuit 모델 supersede)
