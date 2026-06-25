<!--
@responsibility ADR-0651 — Leader Funnel 랭킹 404 근본수리 결정(W1 메시지바디·W2 param정합·W3 circuit격리).
랭킹=발굴 전용·executionImpact NONE·LIVE 0줄. engine-dev 구현 계약 SSOT.
-->

# ADR-0651 — Leader Ranking 404 Root Fix (Funnel EMPTY + Screener Stale Universe)

- **Status:** Accepted (운영자 "구현 시작" · "메인 직접 머지" 승인)
- **Date:** 2026-06-25
- **Type:** ADR (신규 경계 — leader 전용 circuit 격리 + param 정합 정책)
- **Branch:** `claude/scan-blockers-diagnostic-wp93a3`
- **Workspace:** `_workspace/2026-06-25_leader-ranking-404-fix/`
- **계보:** 0638(leader funnel) · 0639(leader refresh cron) · #1412(probe last-error surface) ·
  0477(investor flow router) · 0009(장외 skip) · 0561(KIS Primary Absolute) · 0146 · 0530

---

## Context

운영자 `/lr`(`/leader_refresh`) 진단(2026-06-24, 추적 확정 사실):

```
LEADER_RANKING_TYPES = [
  market-cap            FHPST01720000,
  institutional-net-buy FHPST01600000,
  volume                FHPST01710000,
]
```

- **기관(FHPST01600000)·거래량(FHPST01710000) → 404/BAD_REQUEST_OR_SYMBOL** → 회로 OPEN(`trId` 단위,
  soft 404 누적) → leader 캐시 EMPTY → 동적 유니버스 미충전.
- 반등장(KOSPI +5.66%)에서 주도주 미포착.

### 추적된 연쇄 (코드 확정)

1. **circuit 은 `trId` 단위** (`server/clients/kisClient/resilience.ts:119` `_circuitByTrId`).
   `_recordCircuitFailure(trId, 404)` → `softFailures += 1` + `_recordBlacklist404(trId)`
   (`resilience.ts:151-200`). 임계 도달 시 `openUntil` 설정.
2. **leader `volume` 와 screener `volume` 가 같은 `trId` FHPST01710000 공유.**
   leader 404 가 회로를 열면 `_isCircuitOpen('FHPST01710000')` → screener 의 다음 volume 호출도
   `http.ts:578` 에서 즉시 `null` 반환(blackhole). → `server/screener/stockScreener.ts:136-203`
   `Promise.allSettled` 의 volume 슬롯이 빈 응답 → `PREVIOUS_DAY_TOP_RANKED` / `WATCHLIST` fallback →
   **stale 유니버스**.
3. 즉 **랭킹 404 가 (a) Leader Funnel EMPTY + (b) 스크리너 stale 유니버스 둘 다의 단일 뿌리.**

### Prime 용의자 — 파라미터 불일치 (코드 확정)

| TR | kisRankingClient (404) | stockScreener (작동) | 비고 |
|----|------------------------|----------------------|------|
| investor FHPST01600000 | `sort_cls='2'`(기관)·`vol_cnt='10000'`·`cnt_1='30'` | `sort_cls='1'`(외인)·`vol_cnt='50000'`·`cnt_1='40'` | **기관 sort='2' 미검증** |
| market-cap FHPST01720000 | `input_price_1=''`·`vol_cnt=''` | (expander 동일·작동) | param 동일 → 404 원인 아님(circuit 의심) |
| volume FHPST01710000 | `fid_div_cls_code` **누락**·`price_1='3000'` | `fid_div_cls_code='0'`·`price_1='3000'` | div_cls 누락 + 공유 trId circuit 오염 |

`stockScreener` 의 investor 호출은 **외국인(sort='1')** 이고, leader 의 institutional 은 **기관(sort='2')**
— 후자는 working baseline 이 없는 미검증 param. 단 동일 investor TR 응답이 row 별 `orgn_ntby_qty`(기관)·
`frgn_ntby_qty`(외인)를 **모두** 내려준다(`kisRankingClient.ts:210-211` 주석·`dynamicUniverseExpander.ts:216`).

### 검증 한계 (명시)

**현재 환경에 live KIS 접근 불가** — 정확한 KIS param 수용 여부·응답 바디(rt_cd/msg_cd/msg1)는
실 KIS 호출로만 확정 가능. 따라서 본 ADR 은 **W1(메시지 바디 표면화)을 선행**해 배포 후 단일 `/lr` 스캔으로
param 수정의 정오를 사후 확정하는 경로를 필수로 둔다. W2 param 변경은 W1 가 깔아 둔 가시성 위에서만 신뢰.

---

## Decision

3개 워크스트림으로 분해. 전부 **랭킹=발굴 전용 · executionImpact=NONE · LIVE 주문 0줄 · SourceSnapshot 무접촉**.

### W1 — KIS 메시지 바디 표면화 (진단 선행 · 무위험)

`!res.ok` 경로(`http.ts:771-818`)에서 KIS 응답 바디를 파싱해 `rt_cd`/`msg_cd`/`msg1` 을 진단 맵에 stamp.
현재 `res.text()` 는 성공(`http.ts:839`) 경로에서만 읽혀 실패 시 KIS 의 실제 거부 사유가 소실된다.
#1412 가 httpStatus/errorKind 까지만 표면화 — **본 W1 은 그 위에 KIS 메시지 1줄을 additive 로 얹는다(중복 아님).**

- `realDataNoiseStore` 의 `RealDataLastErrorDiag` 에 `kisMsg?` 필드 additive. 기존 `record/get/clear`
  호출 빈도·인자 0 변경. cooldown/circuit/provider-health 무접촉(passive observation only).
- `LeaderRankingProbeRow` 에 `lastKisMsg?` additive optional. `leaderRefresh.cmd` 표시에 노출.

### W2 — Param 정합 (근본수리)

1. **institutional-net-buy 단일통로 파생 (1차 선택):** 미검증 `sort='2'` 를 새로 두들기는 대신,
   **이미 작동하는 외국인 investor 응답에서 `orgn_ntby_qty>0` 으로 기관 leader 를 파생**한다.
   동일 TR(FHPST01600000) 응답이 양 필드를 모두 내려주므로 **두 번째 랭킹 공식 신설을 회피**하고
   ADR-0477(investor flow router) 단일통로와 정합. 404 회피 + 추가 KIS 호출 0.
2. **volume div_cls 보정:** `kisRankingClient.volume` 의 `fid_div_cls_code:'0'` 누락을
   stockScreener working 형태로 정합.
3. **market-cap:** param 은 expander 와 동일(작동) — 변경 없음. 404 는 W3 circuit 오염이 원인으로 격리됨.

기관 sort 미수용 시 **graceful**: 빈 배열 반환(404 ≠ bearish, 불변식 #6). 어떤 경우에도 throw 없음.

### W3 — Circuit 격리 (재발 방지)

leader 1종의 404 가 같은 `trId` 를 쓰는 screener 호출을 blackhole 하지 않도록 분리.
**leader probe 경로(bypassCache 강제)는 공유 circuit 을 오염·trip 시키지 않는다** — probe 는 관측 전용이므로
`_recordCircuitFailure` 누적 대상에서 leader-probe 호출을 제외하거나, leader 전용 circuit 키를 분리한다.
구현 전략(키 분리 vs probe bypass)은 engine-dev 가 현 `resilience.ts` circuit 구현에 맞춰 최소 침습으로 결정하되,
**screener 의 정상 운영 circuit 동작(5xx/404 누적·blacklist)은 byte-equivalent 유지**가 제약.

---

## Consequences

### 긍정
- leader funnel EMPTY 해소 → 동적 유니버스 충전 → 반등장 주도주 포착 복원.
- screener volume 슬롯이 leader 404 에 오염되지 않음 → stale 유니버스 회귀 제거.
- W1 으로 향후 랭킹 404 의 KIS 실사유가 1-스캔 가시 → 진단 사각지대 영구 제거.

### 비용·위험
- W2 institutional 파생 변경은 leader 캐시 충전 종목 구성을 바꿀 수 있음(발굴 단계).
  Gate1/2/3 판정 본문·requiredScore=70 무접촉이라 **매매 안전성 영향 NONE**.
- W3 circuit 격리가 screener 정상 circuit 을 약화시키면 회귀 → byte-equivalent 회귀 테스트 필수.

### 무접촉 보증 (forbidden)
`autoTradeEngine` · `buyPipeline` · `SourceSnapshot` 생성기 · Gate1/2/3 판정 본문 · `requiredScore=70` ·
ADR-0471 곡선 · `src/**` · 스크리너 fallback 경로(PREVIOUS_DAY_TOP_RANKED/WATCHLIST) — 전부 무손상.

---

## Patch Scope Guard (ADR-530, 11 필드)

| 필드 | 값 |
|------|-----|
| `targetDomain` | KIS provider (랭킹 TR) · 진단 가시성 · circuit 격리 (3 도메인 — 한계 내) |
| `allowedFiles` | `server/clients/kisRankingClient.ts` · `server/clients/kisClient/realDataNoiseStore.ts` · `server/clients/kisClient/http.ts` · `server/clients/kisClient/resilience.ts`(W3 격리만) · `server/telegram/commands/trade/leaderRefresh.cmd.ts`(표시만) · 해당 `*.test.ts` |
| `forbiddenFiles` | `server/trading/autoTradeEngine*` · `server/trading/buyPipeline*` · SourceSnapshot 생성기 · Gate1/2/3 판정 본문 · `requiredScore`/ADR-0471 곡선 모듈 · `src/**` · `server/screener/stockScreener.ts` fallback 본문 |
| `expectedBehaviorChange` | 랭킹 TR 404 회피 → leader 캐시 충전 · screener volume circuit 비오염 · /lr 에 KIS msg 노출 |
| `sourceSnapshotImpact` | NONE (불변식 #3·#9 — 랭킹은 SourceSnapshot 외부 발굴) |
| `executionImpact` | NONE (랭킹=발굴 전용, 매매 결정 직접 사용 0) |
| `shadowLearningImpact` | NONE (불변식 #2 — Shadow 무정지·무접촉) |
| `telegramImpact` | `/lr` 진단 행에 `lastKisMsg` 표시 additive (CH 라우팅·dedup 무변) |
| `providerImpact` | 랭킹 param 정합 + circuit 격리. 404≠bearish(불변식 #6) · KIS Primary 단일통로 유지(ADR-0561) |
| `testsRequired` | param 정합 단위 · circuit 격리(leader 404 가 screener trId 미오염) · W1 kisMsg stamp/read · graceful 빈배열 · screener circuit byte-equivalent 회귀 |
| `rollbackPlan` | W2 param 변경에 ENV flag(아래 §flag-lifecycle) — `=false` 1줄 즉시 기존 param 복원. W1/W3 은 additive·passive 라 무게이트 가능(engine-dev 판단) |

---

## Alternatives Considered

1. **기관 sort='2' 를 직접 재시도(현 param 유지·재두들김).** 기각 — live 검증 불가 환경에서 미검증
   param 을 그대로 두면 404 재발 위험. 단일통로 파생이 추가 호출 0 + 검증된 응답 재사용으로 우월.
2. **Yahoo/KRX 로 leader 발굴 우회.** 기각 — ADR-0561 KIS Primary Absolute 위반. quota 는 회피 사유 아님.
3. **circuit 전면 비활성(KIS_LENIENT_404).** 기각 — screener 정상 circuit 보호(반복 404 차단) 손실.
   leader-probe 경로만 격리하는 최소 침습이 옳다.
4. **W2 만 하고 W1 생략.** 기각 — live 검증 불가 → 배포 후 정오 확인 경로 없음. W1 선행 필수.

---

## flag-lifecycle (W2 param 변경 게이트)

W2 의 **institutional 파생 전환 + volume div_cls 보정** 은 leader 발굴 종목 구성을 바꾸므로
`scripts/gate_flag_lifecycle.json` 에 ENV flag 등재(default 신중). engine-dev 가 byte-equivalent 입증
(OFF=기존 param 100% 복원)을 충족하면 default-ON 검토 가능하나, **초기 default 는 보수적**으로 둔다.

- `envFlag`: `LEADER_RANKING_PARAM_FIX_ENABLED` (제안 — engine-dev 최종 확정)
- `adr`: `0651`
- `status`: `SHADOW_OFF` (초기) — OFF=기존 kisRankingClient param byte-identical
- `activationCriteria`: W1 배포 후 `/lr` 1-스캔으로 KIS msg=정상 확인 + leader count>0 관측 → 운영자 승인
- `rollback`: `LEADER_RANKING_PARAM_FIX_ENABLED=false` 1줄 즉시 기존 param 복원

W1(진단)·W3(circuit 격리·passive) 는 behavior-additive 라 flag 없이 가능(engine-dev 최종 판단).

---

## References

- 코드: `server/clients/kisRankingClient.ts:97-283`(TR_SPECS)·`378-447`(probe) ·
  `server/screener/stockScreener.ts:136-203`(working investor sort='1') ·
  `server/clients/kisClient/http.ts:771-841`(!res.ok body 소실 · 성공 시 parse) ·
  `server/clients/kisClient/resilience.ts:119-220`(trId 단위 circuit) ·
  `server/screener/dynamicUniverseExpander.ts:184-340`(leader source 소비)
- PR #1412 (`18ca9ef`) — last-error httpStatus/errorKind 표면화(W1 이 그 위에 kisMsg additive)
- HANDOFF: `_workspace/2026-06-25_leader-ranking-404-fix/architect/HANDOFF_0651.md`
