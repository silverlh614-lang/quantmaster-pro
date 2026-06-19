# ADR-0638 — Leader Pipeline Funnel Observation (주도주 발굴 funnel 가시화)

- Status: Proposed (Phase 0 — 경계·타입·ADR. 관측 전용. 구현은 engine-dev 인계.)
- Date: 2026-06-19
- 계보: ADR-0616(universe composition bias obs) · ADR-0617(leader Stage1 preservation) · ADR-0618(LEADER_REFRESH_TTL) · ADR-0622(top-N) · CLAUDE.md §2.1 불변식 #6/#7/#9

## Context

운영자가 leader-universe(`LEADER_UNIVERSE_INJECTION_ENABLED`)·intraday refresh(`LEADER_DAILY_REFRESH_ENABLED`)를 모두 ON 했으나, 20일 +35% 진짜 주도주(예: 포스코퓨처엠·삼성SDI)가 후보 풀에 미진입한다. 원인이 (a) `OVEREXTENDED`(5일 > risk-on 30%) 가드의 **의도된 추격금지 설계**(`pipelineHelpers.ts:529`, leader injection 도 품질 관문 면제 안 함 — `leaderUniverseInjectionAdr0617.ts:119-120`)인지, (b) `dynamic-universe.json` leader 캐시 빔/stale(일일 갱신 cron 미작동) **결함**인지를 추측 없이 판별할 관측이 없다.

기존 관측으로는 답이 불가하다:
- **ADR-0617** 보존 관측은 입력이 *Stage1 통과 후* candidates(`leadersInPool = candidates.filter(isLeaderSource)`)뿐 — Stage1 에서 OVEREXTENDED 로 탈락한 leader 는 **구조적으로 비가시**(질문 a 답 불가).
- **ADR-0616** 은 후보 집합의 구성 편향(KOSPI/KOSDAQ·RS leader/laggard) 관측으로 직교.

## Decision

관측 전용 모듈 `server/screener/leaderPipelineFunnelObservationAdr0638.ts` 신설. per-scan aggregate 2종:

1. **캐시 신선도** — `dynamic-universe.json` 총 entry 수, leader-source(FOREIGN_NET_BUY/INST_NET_BUY/MARKET_CAP) entry 수, age(`LEADER_REFRESH_TTL_DAYS` 기준 stale 여부), `cacheEmpty`/`cacheStale` bool.
2. **leader funnel** — `cacheLeaderCodes` → `leaderCodesEnteredStage1`(스캔 유니버스 교집합) → `leaderCutByOverextended` / `leaderCutByOverheat` / `leaderCutByOther`(Stage1 `evaluateStage1FilterTracked().reason` 교차) → `leaderPreservedIntoPool`(ADR-0617 `leadersInPoolCount` 재사용·정합 cross-check).
3. 결론 필드 — `cacheEmptyOrStale`(bool), `dominantLeaderCutReason`.

집계 seam = `universeScanner.stage1QuantFilter` Yahoo/full-master 루프(`:420-449`) — 이미 carry 된 `stock.source`(leaderSourceMap, `:438`) × 현재 버려지던 `evaluateStage1FilterTracked().reason`(`:428`)의 교집합(**신규 fetch 0**). 결과는 rolling FIFO(60) ledger + `/scan_blockers` 1섹션(ADR-0616 universe 관측 인접). ENV `LEADER_PIPELINE_FUNNEL_OBS_ENABLED` default OFF(ADR-0157, `=== 'true'` 만 활성).

판별 규칙(단일 섹션에서 즉시):
- `cacheEmpty || cacheStale` → **(b) 캐시 결함** — 일일 갱신 cron 점검.
- 캐시 정상 + `dominantLeaderCutReason === 'OVEREXTENDED'` → **(a) 의도된 추격금지** — threshold tuning 은 별도 리스크 결정.

## Consequences

- (+) (a)/(b) 가설을 `dominantLeaderCutReason` · `cacheEmpty`/`cacheStale` 단일 섹션으로 판별. threshold 변경 없이 정책 논의 데이터 확보.
- (+) executionImpact=NONE — LIVE 매매 본체·발굴·Stage1 컷·정렬·Gate score 0줄. ENV 1줄 롤백.
- (−) Stage1 루프에 flag-guard 분기 1개 추가(OFF 시 미실행 byte-identical). ledger 파일 1개 신규(물리 분리).
- 불변식: #3/#6/#7/#9 정합 — SourceSnapshot 우회 0, `cacheStale ≠ bearish`(결손은 측정 보류), 매매 결정 직접 사용 0, provider 직접 조회 0.

## Alternatives Considered

1. ADR-0617 observation 에 cut 필드 add(patch) — **기각**: 0617 은 Stage1 *통과분* 만 입력, 탈락 leader 비가시(질문 a 답 불가).
2. 신규 텔레그램 진단 명령 — **기각**: 명령 레지스트리·dedup·메뉴 budget(ADR-0506/0507) 대비 효용 낮음, `/scan_blockers` 맥락이 자연.
3. OVEREXTENDED threshold 즉시 완화 — **기각**: 원인 미확정 상태의 정책 변경은 추측. 관측 우선.

## References

ADR-0616 · ADR-0617 · ADR-0618 · ADR-0622 · CLAUDE.md §2.1 불변식 #6/#7/#9
