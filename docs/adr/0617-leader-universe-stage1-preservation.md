# ADR-0617 — Leader-Stock Stage1 Preservation (주도주 Stage1 보존)

- **Status**: Proposed (Phase 0 — 경계·타입·ADR. flag default OFF byte-identical. 구현은 engine-dev 인계.)
- **Date**: 2026-06-16
- **Domain**: policy / screener
- **계보**: 0612 (universe-relative-strength-gate) · 0616 (universe-composition-bias-observation) · 0614 (ledger 패턴) · 0561 (KIS Primary) · 0157 (정확비교 default OFF) · 0550 (risk-on leader capture)

---

## Context

운영자 audit 에서 중대 재발견: **"외인·기관 순매수 대형 주도주 발굴"은 이미 완전 구축돼 가동 중**
이나 Stage1 입구에서 3중으로 무력화되어 발굴 산출물에 도달하지 못한다.

이미 가동 중인 발굴 인프라 (`dynamicUniverseExpander.ts`):
- `DynamicStock.source` — `FOREIGN_NET_BUY`/`INST_NET_BUY`/`MARKET_CAP`/`52W_HIGH`/`MID_RISER`/
  `LARGE_VOLUME`/`SHORT_HEAVY` 태그로 수급 채널별 발굴.
- `runDynamicUniverseExpansion()` — KIS 랭킹 TR cron 수집·영속(2주 TTL).
- `getExpandedUniverse(): {symbol,code,name}[]` — 정적 + 동적 병합 로드.

**무력화 3중** (`universeScanner.ts` `stage1QuantFilter`):
1. `:388-390` `scanUniverse = krxFullMaster(~2700) > expanded(~100) ? full : expanded`
   → 마스터가 항상 더 크므로 **항상 full master 채택** → expandedUniverse(주도주) set 폐기.
2. `:405-412` CandidateStock 생성 시 **source 태그 미탑재** → 주도주 식별 정보 소실
   (Stage2 가 어떤 종목이 외인·기관 순매수 주도주인지 알 길 없음).
3. `:424-427` `.sort((a,b)=>b.stage1Score-a.stage1Score).slice(0,60)` → `calcStage1Score` 의
   평시 분기는 눌림목·평균회귀 프리미엄(소형주 편향) → 대형 주도주가 top-60 점수 밖으로 탈락.

결과: ADR-0616 이 정량화한 편향(디버전스 장 코스피 대형 주도주 후보 누락·후보 RS −8.97%)의
**근본 원인 중 하나가 Stage1 의 주도주 dilution**임이 audit 으로 확정. ADR-0612(발굴 RS 게이트)·
ADR-0550(risk-on OVERHEAT 완화)이 입력을 *넓혔으나*, top-60 점수컷이 여전히 주도주를 *잘라냄*.

---

## Decision

expandedUniverse 의 주도주 source 태그를 Stage1 까지 **carry** 하고, **소형주 편향 top-60 점수컷에서
주도주를 강제 보존(union)** 해 Stage2(수급 confluence·RS)가 평가하게 만든다. **신규 fetch 0**
(expandedUniverse 는 이미 cron 수집분). flag default OFF byte-identical.

신규 순수 모듈 `server/screener/leaderUniverseInjectionAdr0617.ts` 에 로직 집약
(universeScanner ~1175줄 → 신규 로직을 본체에 누적하지 않음, 복잡도 가드 보호).

### 1. source 태그 carry (additive optional)

- `CandidateStock` 에 additive optional `source?: DynamicStock['source']` 필드 추가
  (`pipelineHelpers.ts` — 기존 모든 소비처 무파괴, **두 번째 enum 신설 금지**).
- scanUniverse 구성 시 expandedUniverse 종목에 태그 부여(`carrySourceTags`), full master 전용
  종목은 `undefined`(기존 동작 동치).
- carry 의 소스: `getExpandedUniverse()` 가 source 를 노출하지 않으므로(symbol/code/name 만),
  engine-dev 는 dynamicUniverseExpander 에 **additive getter**
  (`getExpandedUniverseSourceMap(): Map<string, DynamicStock['source']>`) 를 신설하거나
  `loadDynamicUniverse()` 를 직접 read 해 code→source Map 을 구성한다(기존 getExpandedUniverse 무파괴).
- **flag OFF → carry 미수행(source 전건 undefined)** → CandidateStock 형태가 기존과 byte-동치.

### 2. 주도주 강제 보존 메커니즘 — **설계 (a) "60컷 후 union(중복제거)" 채택**

- 후보: (a) top-N 컷 후 주도주를 합집합(이미 포함된 건 dedup, N 고정·주도주는 *추가*) vs
  (b) 주도주에 예약 슬롯 K개(비주도 후보 K개를 *밀어냄*).
- **(a) 채택**. 근거: ① top-N 비주도 후보를 한 건도 희생하지 않음(Stage2 평가 풀 보존)
  ② 주도주는 "추가 유입"이라 의미가 명확(관측·롤백 단순) ③ `preservedCount` = union 증분 = "보존
  안 했으면 드롭됐을 수"로 관측 직결.
- **주도주 정의** = `LEADER_SOURCES` = `{FOREIGN_NET_BUY, INST_NET_BUY, MARKET_CAP}` 만.
  52W_HIGH(가격 모멘텀·주도성과 직교)·MID_RISER·LARGE_VOLUME(수급 귀속 불명확)·
  **SHORT_HEAVY(반대 신호 — 보존 절대 금지)** 제외. 보존 확대는 후속 ADR(관측 후 결정).
- **Stage1 기본 관문(price>0·tradable·관리종목·OVERHEAT·OVEREXTENDED)은 통과 필수** —
  보존은 **점수-랭크 컷만 면제**하고 **품질 필터는 유지**한다. 입력 candidates 는 이미
  `evaluateStage1FilterTracked` 통과분이므로 +9% 과열 주도주는 OVERHEAT 에서 *이미 탈락* —
  보존 대상에 도달하지 않는다(불변식 #7 — L4 식별 태그로 매매 결정 직접 우회 금지 정합).
- 알고리즘: `result = [...topN, ...candidates.filter(isLeaderSource).filter(컷 밖)]` (dedup code 기준).
  `stage1Score` 정렬은 현행과 동일 비교자 재사용(두 번째 정렬식 신설 금지).

### 3. flag default OFF = byte-identical

- `LEADER_UNIVERSE_INJECTION_ENABLED === 'true'`(ADR-0157 정확비교) · SSOT
  `isLeaderUniverseInjectionEnabled()`.
- **OFF 시 `:388-390` scanUniverse 선택·`:424-427` top-60 컷 현행 byte-identical**
  (carry 미수행·보존 0·result === 현행 slice). ENV 1줄 즉시 롤백.
- ON 시에만: carry 활성 + top-N union 보존 활성.

### 4. 관측 ledger (ADR-0614/0616 패턴)

- 스캔당 1행: 주도주 발견 수(`leadersInPoolCount`) / top-N 안에 이미 든 수(`leadersInTopNCount`) /
  보존(union)된 수(`preservedCount` = 드롭됐을 수) + source 태그별 분포
  (`leadersInPoolDist`/`preservedDist`).
- `paths.ts LEADER_UNIVERSE_INJECTION_LEDGER_FILE` 1줄(0614/0616 ledger 와 물리 분리 ADR-0445).
- atomic write tmp→rename + rolling FIFO 60스캔 + 손상 JSON fallback + scanDateKey upsert(장중 재스캔 안전).
- stamp 지점: `stage1QuantFilter` top-N 컷 직후 1회(per-candidate 아님 — aggregate),
  flag 무관 항상 산출(OFF 시 preservedCount=0 으로 "보존 안 했으면 드롭됐을 수" 관측 가능),
  append 는 flag ON 시에만(opt-in 영속 I/O) — try/catch 격리(불변식 #1 — 관측 실패 시 scan 본체 보호).

### 5. executionImpact

- **flag OFF → NONE**(byte-identical, KIS/KRX/Yahoo quota 0).
- **flag ON → EXECUTION_ADJACENT**(유니버스 변경 → LIVE 시 실매수 대상 변동). 단 현재 SHADOW_ONLY·
  default OFF 라 출하 안전. `observationOnly`/`executionImpact` 는 `preservedCount>0` 으로 결정
  (보존 0 이면 ON 이어도 NONE).
- 9대 불변식 보존: #3(SourceSnapshot 우회 0 — source 태그는 식별 전용·Snapshot 미변경)·
  #7(L4 태그로 매매 결정 직접 금지 — 품질 필터 유지)·#9(kisClient 단일 통로 — 신규 fetch 0).

### 신규 fetch 여부

- **신규 fetch 0**: expandedUniverse 는 이미 cron 수집분(`getExpandedUniverse`). 추가 실시간 fetch 불요.
- **stale 허용**: 기존 2주 TTL 캐시 재사용으로 fetch-0 출하. 주도주는 신선도가 중요하나, 신선도 개선
  (수집 주기 단축·실시간 보강)은 **후속 ADR** 로 분리한다(quota·kisClient 단일 통로 영향 격리).
  신규 fetch 도입 시 kisClient 단일 통로 경유 의무.

---

## Patch Scope Guard (ADR-530)

- **targetDomain**: `server/screener/*` (universeScanner Stage1 carry/preservation wiring +
  신규 leaderUniverseInjectionAdr0617 모듈 + pipelineHelpers 타입 + paths.ts ledger). 3 도메인 이내.
- **allowedFiles**:
  - `server/screener/leaderUniverseInjectionAdr0617.ts` (신규 — 본 ADR scaffold)
  - `server/screener/universeScanner.ts` (`stage1QuantFilter` carry + top-N union + ledger stamp wiring)
  - `server/screener/pipelineHelpers.ts` (`CandidateStock.source?` additive optional 1필드)
  - `server/screener/dynamicUniverseExpander.ts` (additive `getExpandedUniverseSourceMap` getter — 기존 export 무파괴)
  - `server/persistence/paths.ts` (ledger 상수 1줄)
  - `*.test.ts` (회귀 — OFF byte-identical / ON 보존+ledger)
- **forbiddenFiles**: `autoTradeEngine` · `kisClient.ts`(raw KIS REST·신규 fetch) · SourceSnapshot 계열
  (`symbolDataCollector`/`sourceSnapshot*`) · `calcStage1Score` **점수식 본문**(보존은 점수식 미변경) ·
  `evaluateStage1Filter` 품질 필터 본문(관문 유지) · Gate score(`quantFilter`/`minimumSignalScoreTrace`).
- **expectedBehaviorChange**: flag OFF → 0(byte-identical). flag ON → Stage1 후보 풀에 컷 밖 주도주
  union 추가(top-N 비주도 후보 무손실) + carry 된 source 태그 + ledger append.
- **sourceSnapshotImpact**: NONE(source 태그는 CandidateStock 식별 필드 — SourceSnapshot 미변경, 불변식 #3).
- **executionImpact**: OFF=NONE / ON=EXECUTION_ADJACENT(유니버스 변경, SHADOW_ONLY·default OFF 출하 안전).
- **shadowLearningImpact**: ON 시 SHADOW 평가 후보 풀 확대(주도주 추가) — 학습 표본 enrich, 멈춤 0(불변식 #2).
- **telegramImpact**: NONE(Phase 0). 관측 노출은 후속(선택).
- **providerImpact**: 신규 fetch 0(getExpandedUniverse cron 캐시 재사용 + 이미 fetch 된 후보 quote read).
  KIS/KRX/Yahoo quota 0 침범.
- **testsRequired**: ① carrySourceTags OFF→undefined / ON→태그 ② applyLeaderPreservation OFF→byte-identical
  slice / ON→union(컷 밖 주도주 보존·dedup·topN 비주도 무손실) ③ SHORT_HEAVY 보존 금지 ④ OVERHEAT 주도주
  미도달(품질 필터 유지) ⑤ observation preservedCount=드롭됐을 수·source 분포 ⑥ ledger atomic/FIFO/upsert/손상 fallback.
- **rollbackPlan**: `LEADER_UNIVERSE_INJECTION_ENABLED` 미설정(=OFF) → byte-identical. ENV 1줄 즉시 롤백.
- **complexityGuard**: universeScanner ~1175(여유), 신규 로직은 leaderUniverseInjectionAdr0617 모듈 집약.

---

## Consequences

- (+) 이미 가동 중인 외인·기관·시총 주도주 발굴이 Stage1 dilution 을 우회해 Stage2 평가에 도달.
- (+) 신규 fetch 0·flag OFF byte-identical·ENV 1줄 롤백 — 출하 안전.
- (+) 관측 ledger 로 운영자가 "보존 안 했으면 드롭됐을 주도주 수·source 분포"를 정량 관측 후 효과 판단.
- (−) flag ON 시 후보 풀 증가(주도주 union) → Stage2/Stage3 평가 비용 소폭 증가(주도주 수 한정·미미).
- (−) source carry 는 expandedUniverse code→source Map 신규 구성 의존(engine-dev getter 신설).
- (후속) 신선도 개선(수집 주기 단축)·보존 source 확대·관측→Gate 승격은 별도 ADR.

---

## Alternatives Considered

- (a) **calcStage1Score 점수식 직접 교정(주도주 가점)** 기각 — 점수식 본문 변경은 평시 눌림목 전략과
  충돌·미검증 즉시 발굴 영향. 보존(union)이 점수식 무변경으로 더 안전.
- (b) **예약 슬롯 K개** 기각 — 비주도 top-N 후보 K개를 밀어냄(품질 후보 손실). union 이 무손실.
- (c) **품질 필터(OVERHEAT/OVEREXTENDED)까지 면제** 기각 — +9% 과열 주도주를 보존하면 추격 매수
  위험·불변식 #7 위반. 점수컷만 우회, 품질 필터 유지(보수).
- (d) **52W_HIGH/LARGE_VOLUME 까지 주도주 포함** 기각 — 수급 귀속 불명확·SHORT_HEAVY 는 반대 신호.
  외인·기관·시총 3종만 보수적 채택, 확대는 관측 후 후속 ADR.
- (e) **신규 실시간 fetch 로 주도주 신선도 보강** 기각(Phase 0) — quota·kisClient 단일 통로 영향.
  기존 cron 캐시 재사용으로 fetch-0 출하, 신선도는 후속 ADR.
- (f) **두 번째 source enum 신설** 기각 — DynamicStock['source'] union 재사용(단일 소스).
- (g) **default ON** 기각 — opt-in(ADR-0157), 관측 먼저.
- (h) **patch type** 기각 — 신규 정책·경계·flag·ledger = ADR 의무.

---

## References

- ADR-0616 universe-composition-bias-observation (편향 정량화 — 본 ADR 의 직전 관측)
- ADR-0612 universe-relative-strength-gate (입력 RS 게이트 — 본 ADR 은 출력 top-N 보존)
- ADR-0550 stage1-risk-on-leader-capture (OVERHEAT 완화 — 품질 필터 측)
- ADR-0614 consecutive-netbuy-observation-ledger (ledger atomic/FIFO/upsert 패턴)
- ADR-0561 KIS Primary Absolute · ADR-0157 정확비교 default OFF · ADR-0445 ledger 물리 분리
