# ADR-0618 — Leader-Source Daily Refresh (주도주 소스 일일 신선화)

- **Status**: Proposed (Phase 0 — 경계·타입·ADR. flag default OFF byte-identical. 구현은 engine-dev 인계.)
- **Date**: 2026-06-16
- **Domain**: screener / scheduler
- **계보**: 0617 (leader-universe-stage1-preservation — 보존 대상 소스 SSOT) · 0561 (KIS Primary Absolute) ·
  0157 (정확비교 default OFF) · 0043 (cron 가드 TRADING_DAY_ONLY/WEEKEND_MAINTENANCE) · 0445 (영속 물리 분리)

---

## Context

ADR-0617 이 보존하는 주도주(`LEADER_SOURCES = {FOREIGN_NET_BUY, INST_NET_BUY, MARKET_CAP}`)는
`dynamicUniverseExpander.getExpandedUniverse()` / `getExpandedUniverseSourceMap()` 캐시(`dynamic-universe.json`)
에서 온다. 그런데 그 캐시의 **수집 주기·TTL 이 주도주 신선도와 불일치**한다:

- `runDynamicUniverseExpansion` cron = **주 1회**(토 09:00 KST · `screenerJobs.ts:55` `0 0 * * 6` UTC ·
  `WEEKEND_MAINTENANCE`).
- 동적 엔트리 TTL = **14일**(`dynamicUniverseExpander.ts:72` `EXPIRY_DAYS = 14`).

→ ADR-0617 이 **최대 2주 묵은 "주도주"**를 Stage1 에 보존할 수 있다. 외인·기관 수급은 **매일 회전**하므로
어제까진 외인 순매수 상위였으나 오늘은 순매도 전환된 종목이 "오늘의 주도주"로 잘못 보존될 위험
(stale leader injection). 52W_HIGH/MID_RISER/LARGE_VOLUME/SHORT_HEAVY 는 수급 회전이 느리거나 보존 대상이
아니므로 본 ADR 범위 밖(주간 유지).

**재사용 seam (핵심)**: `expandOnEmpty(ttlDays=3)`(`dynamicUniverseExpander.ts:426-502`)이 **이미 랭킹 기반
신선 발굴**을 한다 — `getShadowSafeRanking(k, {limit:30})` × `RANKING_KEYS` 병렬(`Promise.allSettled` ·
5분 캐시 · 시장별 부분 실패 허용) → `toDynamic(e, source)` 매핑 → 단축 TTL 영속. 즉 신규 fetch 설계가
불필요하다. 이 랭킹 발굴 경로를 **LEADER_SOURCES 매핑분에 한해 매 거래일** 돌리면 stale leader 가 해소된다.

**KIS 랭킹 키 가용성 (kisRankingClient `RankingType`)**: `volume` · `fluctuation` · `market-cap` ·
`institutional-net-buy` · `large-volume` · `short-balance`. **외국인 순매수 전용 TR 키는 부재** — 현행
`expandOnEmpty` 가 `volume`(거래량 상위 = 수급 유입 근사)을 `FOREIGN_NET_BUY` 로 매핑하는 *근사*를 쓴다.
본 ADR 은 그 매핑을 그대로 재사용(두 번째 매핑식 신설 금지). 정밀 외인 순매수 TR 도입은 후속 ADR.

---

## Decision

**LEADER_SOURCES 3종만** 매 거래일 장전에 신선 갱신해, ADR-0617 이 "오늘의 주도주"를 보존하게 한다.
**신규 fetch 경로 0**(`expandOnEmpty` 랭킹 발굴 블록 재사용)·**flag default OFF byte-identical**(OFF 시
신규 cron 미발동, 주간 expansion 만 — 현행 동작 0 변경). 주간 `runDynamicUniverseExpansion`·기존 비주도
엔트리는 무영향.

### 1. 신규 함수 `runLeaderUniverseDailyRefresh()` (dynamicUniverseExpander, additive)

- `expandOnEmpty` 의 랭킹 발굴 블록을 **LEADER_SOURCES 매핑분만** 수행:
  - `market-cap` → `MARKET_CAP`
  - `institutional-net-buy` → `INST_NET_BUY` (양수 필터 `e.value > 0` 유지)
  - `volume` → `FOREIGN_NET_BUY` (현행 expandOnEmpty 근사 매핑 재사용 — 외인 전용 TR 부재)
  - **`fluctuation`/`large-volume`/`short-balance` 키는 호출하지 않는다** (MID_RISER/LARGE_VOLUME/
    SHORT_HEAVY 는 주간 유지 — 본 ADR 범위 밖, 일일 랭킹 호출 수 최소화).
- **단축 TTL** = `LEADER_REFRESH_TTL_DAYS = 3`(거래일 기준 영업일 환산 아닌 **달력 3일** — 주말 포함 시
  월요일 갱신분이 목요일까지 생존, 매 거래일 재갱신으로 사실상 항상 ≤1 거래일 신선). stale leader 자동 만료.
- **코드 중복 최소화 — 공통 헬퍼 추출 채택**: `expandOnEmpty` 의 (a) `toDynamic` 매핑 (b) `getShadowSafeRanking`
  allSettled 수집 (c) static/existing dedup 병합 루프를 **내부 헬퍼**
  (`collectRankingDynamicStocks(keys, sourceMap, opts)` 류)로 추출해 두 함수가 공유. 단 추출은
  `expandOnEmpty` 의 외부 동작을 **byte-identical** 로 보존해야 함(기존 5키·MID_RISER 필터·로그 포맷
  유지) — 순수 리팩토링이라 회귀 테스트로 동치 고정. **추출이 expandOnEmpty 거동을 바꾸면 추출 대신
  호출(중복 허용)으로 후퇴**(engine-dev 판단, byte-identical 우선).
- **별도 갱신·병합**: `loadDynamicUniverse()` → `purgeExpired` → LEADER 매핑분만 upsert →
  `saveDynamicUniverse`. 주간 수집분(비주도·14일 TTL 엔트리)은 read-modify-write 시 보존(아래 §4 정합).
- **Telegram 무음**(내부 유니버스 갱신만 — `runDynamicUniverseExpansion` 의 알림 블록 미복제).

### 2. 신규 cron (`screenerJobs.ts` + `scheduleCatalog.ts`)

- **매 거래일 장전**(KST 아침, stage1/stage2_3 스캔 **이전**). 권장 슬롯 = **KST 08:10**
  (`10 23 * * 0-4` UTC, `timezone:'UTC'`) — `08:35 stage2_3_final_screening` ·
  `08:20 kis_token_refresh` · `08:00 data_completeness_reset` 와 분 단위 stagger(동시각 경합 회피,
  cron stagger 감사 정합). engine-dev 가 인접 cron 과 최종 분 충돌 없는지 확인.
- **`TRADING_DAY_ONLY`**(KRX 영업일 전용·주말+공휴일 차단, 주간 expansion 의 `WEEKEND_MAINTENANCE` 와 분리).
- **Telegram 무음**(`scheduleCatalog` `silentWhen: '내부 유니버스 갱신 — Telegram 송출 없음'`).
- **flag-gated**: cron 콜백 진입 시 `isLeaderUniverseDailyRefreshEnabled()` 분기 — OFF 시 즉시 no-op
  return(랭킹 호출 0). cron 등록 자체는 항상 하되 **본체가 flag 로 단락**(등록/해제 토글이 아닌 실행 단락 —
  ENV 1줄 롤백 즉응성).

### 3. flag default OFF = 현행 byte-identical

- ENV `LEADER_DAILY_REFRESH_ENABLED === 'true'`(ADR-0157 정확비교) · SSOT
  `isLeaderUniverseDailyRefreshEnabled(env = process.env)`.
- **OFF 시**: 신규 cron 콜백이 진입 직후 단락(랭킹 fetch 0·`dynamic-universe.json` 미변경) → 주간
  `runDynamicUniverseExpansion` 만 동작 → `getExpandedUniverse`/`getExpandedUniverseSourceMap` 결과
  현행과 **byte-identical**. ENV 1줄 즉시 롤백.
- SSOT 거주: `dynamicUniverseExpander.ts`(갱신 함수와 동거) 또는
  `leaderUniverseInjectionAdr0617.ts`(LEADER 정책 동거) 중 engine-dev 택1 — **두 번째 flag enum/중복
  정의 금지**. (권장: 갱신 함수가 호출하므로 dynamicUniverseExpander 거주.)

### 4. TTL / 중복 정합 (주간 14일 ↔ 일일 3일 공존)

같은 `dynamic-universe.json` 에 주간 14일 엔트리와 일일 3일 엔트리가 공존한다. 정책:

- **`purgeExpired` 는 엔트리별 `expiresAt` 기준**(이미 per-entry) — 일일 단축 TTL 엔트리는 3일 후
  자동 만료, 주간 엔트리는 14일 유지. 혼재 안전(기존 만료 로직 무변경).
- **같은 code 충돌 (일일 LEADER 갱신 ↔ 주간 엔트리)**: 일일 갱신이 LEADER source 로 발견한 code 가 이미
  동적 목록에 존재하면 **expiresAt 를 일일 TTL 로 갱신(upsert·refresh)** + source 를 LEADER source 로
  재기입. 근거: ① 신선도 목적상 "오늘도 주도주"임을 확인했으므로 만료 연장이 맞고 ② source 재기입으로
  ADR-0617 carry 가 최신 수급 채널을 반영. **단 주간 비주도 엔트리(MID_RISER 등)는 일일 갱신이 건드리지
  않음**(LEADER 키만 수집 → 비주도 code 는 일일 수집 결과에 없음 → 기존 expiresAt·source 보존).
- **현행 `expandOnEmpty` 의 dedup 은 "기존 존재 시 skip"**(만료 연장 안 함). 본 일일 갱신은 **신선도가
  목적이므로 upsert(연장)** 가 필요 — `expandOnEmpty` 와 dedup 정책이 **의도적으로 다름**. 공통 헬퍼
  추출 시 이 차이를 `opts.refreshExisting` 류 플래그로 분기(expandOnEmpty=false 기존 동작 보존,
  일일 갱신=true). engine-dev: 이 분기가 expandOnEmpty byte-identical 을 깨지 않음을 회귀로 고정.

### 5. quota / KIS Primary (ADR-0561)

- `getShadowSafeRanking` 는 5분 캐시·KIS 단일 통로(kisRankingClient). 신규 raw KIS REST 0(불변식 #9).
- **일일 랭킹 호출 수**: LEADER 3키(`market-cap`·`institutional-net-buy`·`volume`) × 시장 2(KOSPI·KOSDAQ)
  = **시장별 호출 6 TR/거래일**(`getShadowSafeRanking` 내부에서 시장 분할 시). `expandOnEmpty`(5키)·주간
  expansion 과 5분 캐시 공유 시 동시각 중복 호출은 흡수.
- **주간 대비 증가분**: 현행 주간 expansion 은 주 1회 4종 수집(52W_HIGH·FOREIGN·MID_RISER·MARKET_CAP).
  본 ADR ON 시 **거래일당 LEADER 3키 추가 1회** → 주 5거래일 × 3키 ≈ 주당 +15 랭킹 호출(시장 미분할 기준).
  KIS 랭킹 TR 은 분당 quota 대비 미미(5분 캐시·장전 1회). KRX/Yahoo quota 0 침범.
- KIS Primary Absolute(ADR-0561): 랭킹은 KIS(L1) primary — Yahoo-first 회피·신규 Yahoo 도입 0.

---

## Patch Scope Guard (ADR-530)

- **targetDomain**: `server/screener/*`(dynamicUniverseExpander 신규 함수·flag SSOT) +
  `server/scheduler/*`(screenerJobs cron 등록·scheduleCatalog 1행). 2 도메인(≤3).
- **allowedFiles**:
  - `server/screener/dynamicUniverseExpander.ts` (신규 `runLeaderUniverseDailyRefresh` + 공통 헬퍼
    추출[byte-identical] + flag SSOT + `LEADER_REFRESH_TTL_DAYS` 상수)
  - `server/scheduler/screenerJobs.ts` (신규 cron 1건 — flag-gated 콜백)
  - `server/scheduler/scheduleCatalog.ts` (SCHEDULE_CATALOG 1행 — silentWhen 무음)
  - `*.test.ts` (회귀 — OFF byte-identical / ON LEADER 갱신·TTL upsert / expandOnEmpty 동치 / 주간 무영향)
- **forbiddenFiles**: `autoTradeEngine` · `kisClient.ts`(raw KIS REST·신규 TR) · SourceSnapshot 계열
  (`symbolDataCollector`/`sourceSnapshot*`) · `calcStage1Score` 점수식 · Gate score
  (`quantFilter`/`minimumSignalScoreTrace`) · **`runDynamicUniverseExpansion` 주간 로직 본문**(미변경 —
  헬퍼 추출 시 호출 동치만) · `leaderUniverseInjectionAdr0617.ts` `applyLeaderPreservation`/ledger 본문
  (ADR-0617 소비 측 무변경 — 본 ADR 은 공급 신선도만).
- **expectedBehaviorChange**: flag OFF → 0(byte-identical, 주간 expansion 만). flag ON → 매 거래일 장전
  LEADER 3소스 일일 신선 갱신(`dynamic-universe.json` upsert·3일 TTL) → `getExpandedUniverseSourceMap`
  이 최신 수급 주도주 반영 → ADR-0617(별도 flag ON 시)이 "오늘의 주도주"를 보존.
- **sourceSnapshotImpact**: NONE(동적 유니버스 영속 갱신 — SourceSnapshot 미생성·미변경, 불변식 #3/#4).
- **executionImpact**: OFF=NONE(byte-identical, KIS/KRX/Yahoo quota 0). ON=**universe 신선도 변경**
  → ADR-0617 도 ON 이면 보존 대상이 "오늘 주도주"로 바뀜(execution-adjacent). 단 **둘 다 default OFF ·
  현 SHADOW_ONLY 출하 안전**. 본 ADR 단독 ON(0617 OFF) 시 carry/보존 미수행이라 실행 무영향(캐시만 신선).
- **shadowLearningImpact**: ON+0617 ON 시 SHADOW 평가 풀의 주도주가 최신 수급 반영(stale leader 제거) —
  학습 표본 정합성 개선, 멈춤 0(불변식 #2).
- **telegramImpact**: NONE(무음 cron).
- **providerImpact**: 신규 fetch **경로** 0(`getShadowSafeRanking` 5분 캐시·KIS 단일 통로 재사용).
  거래일당 LEADER 3키 1회 추가 호출(주당 +15 랭킹 TR, 5분 캐시 흡수). KRX/Yahoo quota 0. KIS Primary(0561) 정합.
- **testsRequired**: ① flag OFF → cron 콜백 no-op·`dynamic-universe.json` 미변경(byte-identical)
  ② flag ON → LEADER 3소스만 갱신(fluctuation/large-volume/short-balance 키 미호출)·3일 TTL upsert
  ③ 같은 code 주간 엔트리 → expiresAt 일일 TTL 로 연장 + source LEADER 재기입 ④ 주간 비주도 엔트리
  (MID_RISER 등) 무영향(expiresAt·source 보존) ⑤ `expandOnEmpty` 헬퍼 추출 후 외부 동작 byte-identical
  (5키·MID_RISER +3~7% 필터·기존 dedup skip·로그) ⑥ getShadowSafeRanking 부분 실패(allSettled) 흡수
  ⑦ cron 가드 TRADING_DAY_ONLY(주말/공휴일 skip).
- **rollbackPlan**: `LEADER_DAILY_REFRESH_ENABLED` 미설정(=OFF) → cron 콜백 단락 → byte-identical.
  ENV 1줄 즉시 롤백.
- **complexityGuard**: `dynamicUniverseExpander.ts` 현재 **546줄**(1,500 한계 여유). 신규 함수 + 헬퍼
  추출로 순증 ~40-60줄 예상(여전히 여유). 신규 로직은 단일 함수 집약.

---

## Consequences

- (+) ADR-0617 의 보존 대상이 매 거래일 신선화 → stale leader(최대 2주 묵은 수급) 주입 위험 해소.
- (+) 신규 fetch 경로 0(expandOnEmpty 랭킹 발굴 재사용)·flag OFF byte-identical·ENV 1줄 롤백 — 출하 안전.
- (+) 공통 헬퍼 추출로 expandOnEmpty 와 일일 갱신이 랭킹 수집·매핑 로직 공유(중복 최소화).
- (−) flag ON 시 거래일당 LEADER 3키 추가 랭킹 호출(주당 +15 TR, 5분 캐시·장전 1회로 미미).
- (−) 외인 순매수는 여전히 `volume` 근사(외인 전용 TR 부재) — 정밀 외인 순매수 TR 은 후속 ADR.
- (후속) 정밀 외인 순매수 TR 도입·일중 재갱신·보존 source 확대(0617 §) 는 별도 ADR.

---

## Alternatives Considered

- (a) **주간 expansion 자체를 일일로 변경** 기각 — 52W_HIGH/MID_RISER/LARGE_VOLUME 까지 매일 갱신은
  범위 초과·quota 증가·주간 안정 소스의 불필요한 회전. LEADER 3종만 일일 신선화가 최소 침습.
- (b) **`EXPIRY_DAYS=14` 를 전역 단축** 기각 — 비주도 주간 엔트리까지 조기 만료시켜 주간 유니버스 축소.
  일일 갱신 엔트리만 단축 TTL 부여(per-entry expiresAt)가 정확.
- (c) **신규 실시간 외인 순매수 TR 도입** 기각(Phase 0) — kisClient 단일 통로 신규 TR·quota 영향.
  기존 volume 근사 매핑(expandOnEmpty 선례) 재사용, 정밀화는 후속 ADR.
- (d) **공통 헬퍼 추출 없이 expandOnEmpty 통째 호출** 기각(기본) — expandOnEmpty 는 5키·MID_RISER 필터
  포함이라 LEADER 외 소스까지 갱신(범위 초과·중복 fetch). 헬퍼 추출로 LEADER 키만 수집. (단 추출이
  expandOnEmpty byte-identical 을 깨면 본 ADR §1 폴백대로 호출+중복 허용으로 후퇴.)
- (e) **cron 을 stage1 스캔 *이후*에 배치** 기각 — 갱신이 당일 스캔에 반영되려면 스캔 *전* 신선화 필수.
  08:10(stage2_3 08:35 이전) 슬롯 채택.
- (f) **dedup skip 유지(만료 연장 안 함)** 기각 — 신선도가 목적이므로 같은 code 재발견 시 expiresAt
  upsert(연장) + source 재기입 필요. expandOnEmpty 의 skip 정책과 의도적 분기(refreshExisting 플래그).
- (g) **default ON** 기각 — opt-in(ADR-0157), ADR-0617 도 OFF 인 상태에서 단독 효과 없음(carry 미수행).
- (h) **patch type** 기각 — 신규 cron·신규 flag·신규 함수·신선도 정책 = ADR 의무.

---

## References

- ADR-0617 leader-universe-stage1-preservation (보존 대상 `LEADER_SOURCES` SSOT — 본 ADR 은 그 공급 신선도)
- ADR-0561 KIS Primary Absolute (랭킹 KIS primary·Yahoo-first 회피)
- ADR-0157 정확비교 default OFF (`=== 'true'` flag SSOT 패턴)
- ADR-0043 cron 가드 (TRADING_DAY_ONLY / WEEKEND_MAINTENANCE 분리)
- ADR-0445 영속 물리 분리 (dynamic-universe.json 단일 파일 공존 정합)
