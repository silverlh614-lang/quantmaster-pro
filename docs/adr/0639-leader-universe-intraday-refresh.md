# ADR-0639 — Leader Universe 장중 갱신 cron (캐시 영구 EMPTY 결함 수리)

- Status: Proposed (Phase 0 — 경계·정책. execution-adjacent 스케줄. 구현은 engine-dev 인계.)
- Date: 2026-06-19
- 계보: ADR-0009(장외 랭킹 스킵) · ADR-0617(leader Stage1 보존) · ADR-0618(LEADER_DAILY_REFRESH) · ADR-0638(leader funnel 관측) · ADR-0561(KIS-Primary Absolute) · ADR-0157(flag default)

## Context

운영자가 `LEADER_UNIVERSE_INJECTION_ENABLED=true`·`LEADER_DAILY_REFRESH_ENABLED=true`를 모두 켰는데도 주도주가 후보 풀에 미진입(Gate1 평균 52점 고착). ADR-0638 funnel 관측이 원인을 실측 확정: `🦁 캐시: EMPTY · cache 0 · cut OVEREXTENDED 0 · 판정→(b) 캐시 빔`. 즉 OVEREXTENDED 추격금지가 아니라 **`dynamic-universe.json` leader 캐시가 통째로 비어 있음.**

코드 추적으로 근본 원인 확정:

1. `kisRankingClient.getRanking`(`:302-314`, ADR-0009): KIS 순위 TR(FHPST...)은 **장외(주말·평일 09:00 이전·15:30 이후)에 캐시 miss면 빈 배열 반환**.
2. leader 캐시를 채우는 cron이 **전부 장외**: `leader_universe_daily_refresh`(08:10 KST 장전)·`runDynamicUniverseExpansion`(주간 토 휴장)·`stage1_pre_screening`(16:55 KST 장후). → `getRanking` 항상 `[]` → 캐시 못 채움.
3. `shadowDataGate.getShadowSafeRanking`(`:165`): real-KIS(`isVtsOnly()=false`)면 KIS 빔 시 Yahoo 폴백 미작동(ADR-0561 정합·의도). 
4. `getExpandedUniverse`(`:628`): 비었을 때 lazy 재생성 안 함(cron만 채움).

**순효과: leader 랭킹은 장중에만 나오는데 채우는 cron은 전부 장외 → 캐시 영구 EMPTY → leader injection이 보존할 게 0 → 주도주 영구 미진입.** 타이밍 불일치 결함.

## Decision

**장중 주기 leader refresh cron `leader_universe_intraday_refresh` 신설.** 기존 `runLeaderUniverseDailyRefresh()` 본체를 **0줄 변경**으로 재사용하고, **호출 시점만 장중**(평일 매시 32분, KST 09:32~15:32 — cron `32 0-6 * * 1-5` UTC, 09:30 슬롯 혼잡 회피 stagger)으로 추가한다. `getRanking` 내부 `isMarketOpen()` 가드가 장중 슬롯에서만 실데이터를 반환 → 그 창에서 캐시 충전.

- **신규 ENV 0** — 기존 `LEADER_DAILY_REFRESH_ENABLED` 재사용(운영자가 이미 켠 flag). 콜백 진입 시 `if (!isLeaderUniverseDailyRefreshEnabled()) return;` 단락.
- **신규 함수/타입 0** — 순수 스케줄 wiring(`screenerJobs.ts` cron 1 + `scheduleCatalog.ts` 엔트리 1).
- `'TRADING_DAY_ONLY'` + 분 stagger(09:30 슬롯 혼잡 회피).

판별: ADR-0638 funnel이 이 수리 후 `캐시: HEALTHY · cache N`으로 바뀌면 해소 확인.

## Consequences

- (+) leader 랭킹이 실제로 반환되는 장중 창에서 캐시가 채워짐 → leader injection이 주도주를 Stage1 보존 → 후보 풀 진입.
- (+) 기존 코드 재사용(본체 0줄), 신규 flag/타입 0. 결함 본질("시점이 장외")만 정확히 교정.
- (−) cron 1개 추가. ON 시 KIS quota +36 TR/거래일(6 슬롯 × 랭킹키 3 × 시장 2), 전량 KIS Primary·burst 없음(30분 분산).
- executionImpact: flag OFF=NONE byte-identical(fetch 0·`dynamic-universe.json` 무변경) / ON=발굴 풀 확장(execution-adjacent·현 SHADOW_ONLY 출하 안전·ENV 1줄 롤백).
- 불변식: #1(cron throw try/catch 격리·엔진 무중단)·#2(Shadow 입력 풍부화)·#7(KIS L1 랭킹·매매 직접 결정 0)·#8(autoTradeEngine 무접촉)·#9(KIS 단일통로·신규 raw 0) 보존.

## Alternatives Considered

1. 08:10 cron을 장중으로 **이동** — 기각: 기존 `leader_universe_daily_refresh` 의미 변질 + scheduleCatalog/test 회귀. additive 추가가 byte-identical 보존에 유리.
2. scan(stage1QuantFilter)에서 EMPTY 시 lazy seed — 보류(2차): scan 핫패스 지연 + 매 스캔 quota 침범. (B)가 미리 채우면 불필요. 잔존 EMPTY 시 별도 ADR.
3. `bypassCache=true` 강제 호출 — 기각: 장외엔 랭킹 데이터 자체가 없음(ADR-0009 전제). 무의미 + quota 낭비.
4. `getShadowSafeRanking` real-KIS Yahoo 폴백 추가 — 기각: ADR-0561 KIS-Primary Absolute 위반 소지(L3 primary화). (B)가 장중 KIS로 근본 해소하므로 불필요.

## References

ADR-0009 · ADR-0617 · ADR-0618 · ADR-0638 · ADR-0561 · ADR-0157 · CLAUDE.md §2 KIS 단일 통로
