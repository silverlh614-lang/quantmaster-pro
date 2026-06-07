# ADR-0584: VKOSPI stale visibility (Phase A) + flag-gated flat-during-move isolation (Phase B)

@responsibility regime — surface VKOSPI staleness (baseDate/fetchedAt + carry-forward warn) and, flag-gated, isolate a frozen VKOSPI that stays flat while KOSPI moves hard (the crash-day gap ADR-0530 left open)

## Status

Accepted (Phase A always-on visibility; Phase B flag-gated `VKOSPI_STALE_GUARD_ENABLED` default OFF). 후속(미구현): 공식 인덱스코드 검증 · baseDate 거래일 캘린더 stale-gate · risk-axis/MHS 격리.

## Context

라이브 `/regime`(2026-06-07 17:20 KST) VKOSPI=**73.4**, prevClose=73.44, dayChange=**0.00**, source=`KRX_DERIV_INDEX_DAILY`, VIX=16.1, KOSPI=−5.54%. 3-에이전트 진단(워크플로) 결과 **stale/오류 확정**:
- **fetch 취약**: `fetchDerivativesIndexDaily()`(KRX `idx/drvprod_dd_trd` 파생-상품 일별 피드)에서 VKOSPI 행을 **이름 substring**(`'VKOSPI'|'변동성지수'|'코스피변동성'`)으로 줍고 공식 인덱스코드 검증·단일매칭 assert 없음 → 엉뚱/오래된 행 선택 위험. 스케일 버그는 아님(원값 그대로).
- **신선도 추적 부재**: 타 지표(공매도·신용잔고·프로그램)는 `*FetchedAt`가 있으나 VKOSPI만 없음. KRX 행의 거래일(BAS_DD)은 `mapIndexDailyRow`가 노출하는데 호출부가 **버림**. `state.updatedAt`은 매 크론 갱신 → "fresh"가 거짓.
- **silent carry-forward**: KRX+Yahoo 모두 실패 시 `{...existing}` merge로 옛 값이 **경고 없이 무기한 유지**(공매도와 달리 warn 0).
- **dayChange=0.00**: prevClose(73.44)≠current(73.4)이므로 naive 'prevClose==current' 아티팩트 아님 — KRX 행의 FLUC_RT=0.00이 −0.04 change와 모순된 stale/garbled 행.
- **ADR-0530 가드의 crash-day 갭**: `vkospiSanityGuard`는 G1(VIX 괴리>25) ∧ **G2(KOSPI 비스트레스)** ∧ G3 일 때만 격리. 진짜 폭락 spike 보호를 위해 G2를 1차 안전판으로 뒀는데, **폭락일(KOSPI −5.54%)엔 G2=false라 가드가 미발동** → stale-high 73.4가 그 틈으로 통과(vkospiConfidence=UNKNOWN, usable=true). ADR-0530은 fetch를 안 고치고 마스크만 추가 → 동일 결함 재발(이전 67/71.33 사건).

## Decision

새 SSOT `server/trading/regime/vkospiFreshness.ts` 에 freshness 판정 + 가드 flag 단일화.

**Phase A — always-on · executionImpact=NONE (가시화):**
- `marketDataRefresh`가 KRX 행의 `baseDate`(BAS_DD) + `vkospiFetchedAt`(ISO)를 MacroState에 영속(기존엔 폐기).
- 이름 매칭 **다중 매칭 시 `VKOSPI_ROW_AMBIGUOUS` 경고**(선택은 기존과 동일 첫 매칭 → byte-equivalent).
- KRX+Yahoo 모두 실패 시 **`VKOSPI_CARRY_FORWARD` 경고**(공매도처럼 silent 차단, 불변식 #6).
- `classifyVkospiFreshness`(순수, 캘린더 의존 0): "KOSPI 급변 중 VKOSPI flat" 감지 → `/regime`에 `⚠️STALE` 마커 + `baseDate`/`fetchedAt` 노출.

**Phase B — flag-gated `VKOSPI_STALE_GUARD_ENABLED` (default OFF · byte-identical):**
- `vkospiSanityGuard`에 G4 추가: flag ON ∧ `detectVkospiFlatDuringMove`(|KOSPI 수익률|≥`VKOSPI_STALE_MOVE_PCT`=3 ∧ |VKOSPI 변화|<`VKOSPI_STALE_FLAT_EPS`=0.5) → **`UNTRUSTED_IMPLAUSIBLE` 격리**(G2와 **무관** → 폭락일 갭 차단).
- `guardTriggered = !disabled && (classic(G1∧G2∧G3) || g4StaleFlat)`. flag OFF → g4 미평가 → **기존 분기 byte-identical**.
- 진짜 폭락 spike는 큰 vkospiDayChange라 flat=false → **마스킹 안 됨**(오진 방지). 기존 IMPLAUSIBLE 격리 경로(vkospiOk level gate) 재사용 → 신규 소비처 배선 0.

## Consequences

- **Phase A**: 영속·경고·표시만 — 매매/레짐 0 변화. MacroState 신규 필드(vkospiBaseDate/vkospiFetchedAt) optional 후방호환. executionImpact=NONE.
- **Phase B**: flag OFF(default) → 가드 byte-identical. flag ON → stale-flat VKOSPI가 R6-recovery `vkospiOk` level gate에서 격리(현재 라이브 R6는 KOSPI발이라 R6 자체는 불변). 불변식 #6 보존(providerIssue=true·marketSignal=false — 약세 신호 변환 아님).
- **알려진 한계(후속)**: (1) confluence/MHS의 **risk axis(scoreRisk)는 macroState.vkospi 원값을 직접 읽어** trustState를 안 봄 → 격리해도 risk axis엔 stale 값 잔존(단 confluence는 discovery-only 경로, ADR-0583 맥락). (2) **공식 인덱스코드 검증**(이름 substring 대체)은 공식 KRX VKOSPI 코드 확인 후 별도. (3) **baseDate 거래일 캘린더 stale-gate**(일별지수가 구조적으로 전 영업일이라 단순 비교 불가)도 후속. flat-during-move가 관측 사건은 커버.
- 회귀: 신규 테스트 33(detector 진리표·flag·freshness view·guard flag OFF byte-identical/ON 격리/spike 미마스킹/ADR-0530 클래식 회귀/kill-switch)·lint(tsc x2) 0·complexity ACMA OK·responsibility 0. 롤백=`VKOSPI_STALE_GUARD_ENABLED` 제거 byte-equivalent(Phase A는 additive 표시).

## Guardrails

- No live trading path change unless explicitly stated (Phase A = none; Phase B = flag-gated, default OFF).
- No KIS/order import or invocation unless explicitly stated.
- Provider 장애를 market signal로 변환 금지 — stale VKOSPI는 confidence 격리이지 bearish 아님(불변식 #6). 값 0 치환 금지(null≠0).
- ADR-0530 클래식 가드(G1∧G2∧G3) 동작 보존 — G4는 OR 추가분, flag-gated.
- No SourceSnapshot bypass — MacroState read/write only.
