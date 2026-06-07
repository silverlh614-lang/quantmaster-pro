# ADR-0583: MHS source-degrade visibility (Phase A) + flag-gated confluence guard (Phase B)

@responsibility macro/confluence — surface MHS source-degradation (FRED/ECOS 결손) end-to-end and, flag-gated, suppress optimistic MHS confluence boost while preserving the bearish penalty

## Status

Accepted (Phase A always-on visibility · Phase B flag-gated, default OFF)

## Context

FRED/ECOS 연결 진단([[fred-ecos-connectivity]] 메모리, 2026-06-07 라이브 프로브 실측) 결과:
- 배포지에서 `api.stlouisfed.org` 가 hard egress 차단(DNS 정상 resolve·TCP TIMEOUT, IPv4-only host) →
  FRED 미연결. ECOS 는 정상.
- 그런데도 `/regime` MHS 는 **75(GREEN)로 정상처럼 표시** — FRED 빠진 채 ECOS+default(중립값)로
  합산되어 산출. `computeMacroIndex` 는 이미 `sourcesOk: { ecos, fred }` 를 반환(macroIndexEngine:270)
  하지만 **MacroState 로 영속도, /regime 노출도, confluence 소비도 안 됨** = silent degradation.
- MHS 는 진단용이 아니라 **execution-adjacent** — `confluenceEngine.calcMacroScore` 가 MHS≥70 시
  +8(GREEN), 55~69 시 +3 부스트를 매크로 축 점수에 더하고(confluenceEngine:377~387), MHS 는 fomcCalendar
  완화 임계로도 소비. FRED(신용/스트레스 리스크축 입력) 결손 시 리스크축이 default 로 채워져 MHS 가
  **낙관 편향** — 살아있지 않은 소스로 매수 가산점을 줄 위험.

SDS 원칙(silent degradation 차단·providerIssue 가시화) 정합을 위해 MHS 소스 결손을 가시화하고,
낙관 부스트를 보수적으로 억제할 옵트인 경로가 필요하다.

## Decision

새 SSOT 모듈 `server/engines/mhsDegrade.ts` 에 **소스 저하 판정 규칙 + 가드 flag** 를 단일화한다.

**Phase A (always-on · executionImpact=NONE · 가시화):**
- `deriveMhsDegrade({ecos, fred})` → `confidence`(FULL=양쪽 / PARTIAL=한쪽 / FALLBACK=전면 결손·MHS 50 폴백)
  + `degraded`(confidence≠FULL).
- `marketDataRefresh` 가 매 사이클 `computeMacroIndex().sourcesOk` 로 도출해 MacroState 에 영속
  (`mhsSourcesOk`/`mhsConfidence`/`mhsDegraded`, computeMacroIndex 성공 시에만 — 실패 시 이전 값 보존),
  MHS 갱신 로그에 `confidence=… ⚠️DEGRADED` 추가.
- `/regime` 에 `formatMhsConfidenceLine` 1줄 추가 — 어느 소스(ecos/fred)가 살아있는지 + 점수 신뢰도 노출.

**Phase B (flag-gated `MHS_DEGRADE_GUARD_ENABLED` default OFF · byte-identical):**
- `isMhsDegradeGuardEnabled() && macroState.mhsDegraded === true` 일 때만 `calcMacroScore` 의 MHS 보정이:
  - MHS≥70: +8 → **+3** (factor `MHS{n}GREEN_DEGRADED`)
  - MHS 55~69: +3 → **0** (낙관 부스트 생략)
  - MHS<40: **-15 그대로 보존** (비관 페널티 = 안전 방향 → 억제하지 않음)
- 비대칭 설계: 죽은 소스로 인한 *낙관* 은 못 믿지만 *비관* 은 보수적으로 존중. flag OFF 또는
  `mhsDegraded≠true` → 기존 분기 byte-identical.

## Consequences

- **Phase A**: 표시·영속·로그만 — live 매매/Gate/사이징/Shadow 0 변화. MacroState 신규 필드는 전부 optional
  (후방호환). executionImpact=NONE.
- **Phase B**: flag OFF(default) → confluence MHS 보정 byte-identical. flag ON + degraded 시에만 매크로 축
  점수 변동 → 매크로 축 BULLISH 판정 → confluence signal(STRONG_BUY/BUY/HOLD) 영향 가능 →
  execution-adjacent → **활성 시 shadow A/B 검증 권고**. 비관 페널티 불변(안전 방향).
- 회귀: 신규 테스트 30(deriveMhsDegrade 진리표·flag·/regime 라인·confluence 가드 진리표) · lint(tsc x2) 0 ·
  complexity ACMA OK · responsibility 0 신규.
- 9대 불변식 VERBATIM 0줄. 불변식 #6(providerIssue≠marketSignal) 정합 — FRED 결손은 약세 신호로
  *변환하지 않고* confidence 강등으로만 표기. 롤백: `MHS_DEGRADE_GUARD_ENABLED` 제거 = Phase B
  byte-equivalent, Phase A 는 additive 표시(롤백 시 필드 무시).

## Guardrails

- No live trading path change unless explicitly stated (Phase A = none; Phase B = flag-gated, default OFF).
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated (Phase B ON 시 confluence signal 한정 영향).
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated (sourcesOk read only — 신규 fetch 0).
- No SourceSnapshot bypass — MacroState read/write only (불변식 #9 정합).
