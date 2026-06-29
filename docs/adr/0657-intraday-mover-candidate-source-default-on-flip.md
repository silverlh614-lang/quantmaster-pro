# ADR-0657 — Intraday-Mover Candidate Source default-ON flip (ADR-0629 검증 후 승격)

- Status: Accepted (운영자 silverlh614 "구현시작" 승인 + 운영 /scan_blockers 실측 검증)
- Date: 2026-06-29
- 계보: 0629(도입) · 0628(screener.json 신선화) · 0652(leader 랭킹 endpoint 정정) · 0617(leader Stage1 보존) · 0157(flag 비교) · 0641(flag-lifecycle) · 0146(LIVE 안전·byte-equivalent) · 0530(Patch Scope Guard)

## Context

ADR-0652 로 leader 랭킹 endpoint 404 를 정정해 동적 유니버스(218)가 복원됐으나, `/scan_blockers` 추적 결과
**복원된 주도주가 Gate 평가 candidate 풀(44)에 진입하지 못함**이 드러났다. 근본 원인은 leader → Gate-candidate 배선 갭:

- 메인 스캔 candidate pool(`buildCandidatePool`)은 watchlist 파생 + 직전 스캔 carry 자기복제만 읽고,
  신선 screener 우물(getScreenerCache)을 안 읽었다.
- ADR-0617 주도주 Stage1 보존은 top-60 점수컷 *밖* leader 만 union 하는데, 풀이 44(<60)라 컷이 안 걸려 no-op.
- ADR-0629 가 `collectIntradayMoverCandidates()`(신선 screener 당일 상위 → `intradayMovers` 슬롯 주입)를
  도입했으나 flag default OFF 로 비활성 상태였다.

## Decision

ADR-0629 의 `INTRADAY_MOVER_CANDIDATE_SOURCE_ENABLED` 를 **default-ON kill-switch(`!== 'false'`)** 로 flip 한다.
운영자가 운영 환경에서 ENV=true 로 먼저 검증한 결과를 코드 default 로 승격하는 것이다.

### 운영 검증 (2026-06-29 13:22 KST `/scan_blockers full`)

- `topCandidateSources=WATCHLIST=50, PREVIOUS_DAY_TOP_RANKED=50, HIGH_LIQUIDITY=44, **INTRADAY_MOVER=31**, FALLBACK_BROAD_UNIVERSE=6`
- candidate 풀에 주도주 진입 확인: 005930(삼성전자)·000660(SK하이닉스)·010140(삼성중공업)·018260(삼성SDS) 등
- `paperObservationalCreatedCount=16` — 주도주 대상 observational paper entry 생성(shadow/learning 라인 진입)
- KIS 재무 정상 머지(대형주): `KIS_FINANCE source=KIS_PRIMARY kisMergeApplied=true roe=11.9% opm=16.1%`

즉 "반등장 주도주 미발굴" funnel 갭이 발굴→평가 단계에서 해소됐다.

## Scope / Safety (Patch Scope Guard, ADR-0530)

- targetDomain: 발굴 candidate pool 소스 1개(INTRADAY_MOVER) flag default — 1 도메인.
- allowedFiles: `intradayMoverCandidateSource.ts`(flag) · 회귀 테스트 · 거버넌스(ADR/INDEX/patch-history/.env/flag-lifecycle).
- forbiddenFiles: autoTradeEngine · buyPipeline · SourceSnapshot · Gate0~3 판정 본문 · requiredScore=70 · ADR-0471 곡선 · src/**.
- executionImpact: **NONE** — engineMode SHADOW_ONLY 라 live 주문 0. candidate 풀 구성만 변경(채점·임계 우회 0, Gate0~3+requiredScore70 그대로 적용).
- sourceSnapshotImpact: 없음(주입은 candidate 후보 목록만, SourceSnapshot 생성기 무접촉).
- providerImpact: 신규 KIS/KRX/Yahoo fetch 0 — getScreenerCache read 만(ADR-0561 정합).
- shadowLearningImpact: 주도주가 shadow/counterfactual/observational 라인에 진입(학습 표본 확대).
- telegramImpact: `/scan_blockers` topCandidateSources 에 INTRADAY_MOVER 노출(기존).
- testsRequired: flag `=false` → byte-identical([]) · UNSET → default-ON 매핑 회귀.
- rollbackPlan: `INTRADAY_MOVER_CANDIDATE_SOURCE_ENABLED=false` 1줄 → 구 OFF 동작 byte-identical.

## 9대 불변식

#1 Trading Engine·#2 Shadow Learning 보존 · #6 provider issue ≠ bearish(빈 캐시 graceful []) ·
#7 품질 필터 우회 0(Gate0~3+requiredScore70 적용) · #8 실거래 차단과 Shadow 분리 유지.

## Note — 본 flip 으로 해소되지 않는 것 (의도된 하류 게이트)

주도주가 candidate 에 진입해도 LIVE 진입까지 가려면 별도 게이트가 남는다 — 본 ADR 범위 아님:
- engineMode SHADOW_ONLY(liveEntryAllowed=false) — 운영자 정책.
- Gate1 finalScore 58.5 < required 70 — ADR-0471 freeze(forward-outcome 관측·운영자 승인 전 임계 자동변경 금지).
- 진입 타이밍 PRE_BREAKOUT_WAIT / price OVEREXTENDED — 반등 과열 구간 진입 보류(정상 동작).

이들은 working-as-designed 이며 forward-outcome 관측·운영자 승인 하에 별도 검토한다.
