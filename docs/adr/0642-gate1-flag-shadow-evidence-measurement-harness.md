# ADR-0642 — Gate1 Flag Shadow 증거 측정 하네스 (5 default-OFF flags, 관측 전용 · executionImpact NONE)

@responsibility ADR-0641 거버넌스가 요구하는 flip 결정 수치(legacy vs flag-ON pass delta·입력 커버리지%·sessions observed)를 5개 default-OFF Gate1 flag 에 대해 측정·영속·노출하는 하네스. 0611 force-ON hypothetical 신규 산출 + 5-flag 공통 증거 스키마 + ledger carry + 세션 누적 레지스트리 + /promotion_readiness 섹션. 어떤 flag 도 flip 하지 않음(force-ON 은 hypothetical 산출 전용·실채점 미반영). LIVE 동작 0 변화·byte-equivalent.

- **Status:** Proposed (Phase 1 — engine-dev: 0611 force-ON hypothetical·5-flag 공통 증거 스키마·ledger carry·세션 누적 레지스트리·/promotion_readiness 섹션 구현. architect: 타입 계약·설계 확정.)
- **Date:** 2026-06-21
- **Branch:** claude/gate-shadow-optimization-0h85d8
- **Supersedes / Extends:** ADR-0146(byte-equivalent·"OFF 출하" 안전 규칙)·ADR-0530(Patch Scope Guard)·ADR-0631(Shadow→Live 승격 준비도 진단 단일 창구)·ADR-0641(Gate flag 수명주기 거버넌스 — 본 ADR 이 그 측정 축을 완결)·ADR-0546/0611/0613/0627/0640(측정 대상 5개 Gate1 OFF 플래그)·ADR-0476(dry-run observation ledger 영속 인프라)
- **Patch vs ADR:** ADR (신규 영속 경계 `data/gate1-flag-shadow-evidence.json` 세션 누적 레지스트리 + 신규 측정 정책 — 5-flag 공통 증거 스키마 = flip 결정의 SSOT 수치 계약). INDEX.md 0642→0643 갱신 의무.

---

## Context — flip 결정 수치가 영구히 비어 있던 측정 공백

ADR-0641 은 5개 default-OFF Gate1 플래그(0546 regime-aware required · 0611 sector RS · 0613
positive ceiling wiring · 0627 RS continuous · 0640 denominator normalization)에 대해 reviewBy
만료를 강제하고, 각 `activationCriteria` 가 flip 결정에 필요한 **측정 수치**("legacy 70 vs flag-ON
pass-rate delta N세션", "입력 커버리지%", "denomNorm 4필드 델타", "0.7× clamp binding 빈도" 등)를
명시한다. 그러나 그 수치를 **측정·영속·집계·노출하는 하네스 자체가 부재**했다 — 거버넌스는 만료를
강제하지만, 만료가 와도 결정 근거가 "데이터 없음"이라 flip/sunset/연장 어느 쪽도 정량 판단 불가.

architect 매핑(`_workspace/2026-06-21_gate-shadow-flag-evidence/architect/current-state.md`)이 밝힌 근본:

- **0613/0627/0640** 은 per-row force-ON hypothetical 을 `minimumSignalScoreTrace.ts` 에서
  try/catch 격리 후 trace 결과에 stamp 한다. 그러나 `rowFromSnapshot`
  (`gate1DryRunObservationLedgerAdr0476.ts`)이 이 필드를 ledger row 로 carry 하지 않아
  **scan 종료와 함께 증발** — 영속도, 집계도, forward-outcome 추적도, 노출도 0.
- **0611** 은 force-ON hypothetical 산출 자체가 전무(scorer 가 flag OFF 면 maxScore 0·weightedScore 0
  byte-equivalent, ON 이면 maxScore 8 복원 — "ON 이면 몇 점 추가됐을지"를 측정하는 force-ON 산출 없음).
- **5개 공통**: "sessions observed", "legacy pass count vs flag-on hypothetical pass count", "delta",
  "입력 커버리지%", "reviewBy", "status" 를 flag 별로 한 곳에 누적·집계·노출하는 per-flag 증거판 부재.

---

## Decision

설계 원칙: **gap 만 채운다. 산식은 재사용. 어떤 flag 도 flip 하지 않는다.**

### D1. 0611 SECTOR_RS force-ON hypothetical 신규 산출

`server/trading/signalScanner/gate1SectorRsHypotheticalAdr0642.ts`(신규) — 섹터상대(stock−sector 20d)
입력만 소비(ADR-0469 dedup 정합)해 force-ON 가정 weightedScore(0~8)를 산출하고, 현행(flag OFF=0)
대비 delta·hypotheticalActualScore·hypotheticalPassed·inputPresent(coverage 분자)를 반환하는 순수
함수. 기존 0611 산식(`resolveSectorRsComponentScore` 의 force-ON 분기)을 재현 — 신규 산식 0,
provider/store/now/fetch 0. `minimumSignalScoreTrace.ts` 가 try/catch 격리 후 trace 에 stamp
(0613/0627/0640 패턴 동형, actualScore/passed 본체 영향 0).

### D2. 5-flag 공통 증거 스키마 + 순수 집계기

`server/trading/signalScanner/gate1FlagShadowEvidenceAdr0642.ts`(신규):

```
interface Gate1FlagShadowEvidence {
  flagId; adr; sessionsObserved; legacyPassCount; flagOnHypotheticalPassCount;
  passCountDelta; inputCoveragePct; reviewBy; status; flagActive;
  clampBindingCount;            // 0640 전용 (0.7× 하한 binding 빈도)
  executionImpact: 'NONE';      // backstop
}
interface Gate1FlagShadowEvidenceBoard {
  generatedAt; flags[5];
  liveScoringChanged: false; operatorApprovalRequired: true; executionImpact: 'NONE';
}
```

ledger rows(+per-row hypothetical carry) + 0546 survivor 를 받아 5개 flag 별 single-session 증거로
환원하는 순수 함수 `buildGate1FlagShadowEvidenceBoard`. flag 별 매핑: 0546=survivor 재사용
(legacyPass=score≥70, flagOnPass=legacyPass+regimeAwareWouldPass) / 0611=sectorRsHypotheticalPassed,
coverage=sectorRsInputPresent / 0613=ceilingWiringHypotheticalPassed, coverage=ceilingWiringInputPresent /
0627=rsContinuousHypotheticalPassed, coverage=rsContinuousInputPresent / 0640=denomNormHypotheticalPassed,
coverage=denomNormDeficitPresent + clampBindingCount(effectiveRequired==required×0.7). reviewBy/status 는
`gate_flag_lifecycle.json` 전사(정적 SSOT·런타임 fetch 0). 신규 산식 0 — 전부 carry 재사용.

### D3. ledger row hypothetical carry

`Gate1DryRunObservationRow`(`gate1DryRunObservationLedgerAdr0476/types.ts`)에 0613/0627/0640/0611
hypothetical optional 필드 + coverage flag 추가. minimumSignalScoreTrace stamp →
`minSignalScoreBySymbol`(persistScanResultsMidBlocks: gate1CandidateTraces 의 minSignalScoreTrace 에서
추출) → `resolveObservationMinSignal` → `rowFromSnapshot` → `gate1-dry-run-observation-ledger.json`
영속. forward-outcome(5D/10D 성과) 갱신 인프라를 그대로 탄다(0641 activationCriteria 의 forward-outcome
성숙 요구 충족). optional 필드 추가라 기존 forward-outcome 갱신 무회귀.

### D4. 세션 누적 영속 레지스트리

`server/trading/signalScanner/gate1FlagShadowEvidenceStoreAdr0642.ts`(신규) — 신규 경량 JSON
`data/gate1-flag-shadow-evidence.json`. scan 1회당 5-flag 1행 append(멱등 upsert by sessionKey —
동일 scan 재실행 시 중복 누적 0)·FIFO 120세션·atomic write(tmp→rename)·손상 JSON 빈 fallback·재부팅
안전. `buildCumulativeGate1FlagShadowEvidenceBoard` 가 세션 행을 flag 별 합산(legacyPass/flagOnPass
누적·coverage 세션 평균·sessionsObserved=distinct 세션 수)해 렌더 입력 board 재구성. ledger(후보 단위
forward-outcome)와 물리 분리 — 본 레지스트리는 flag-세션 누적.

### D5. 진단 노출 (기존 명령 확장)

`/promotion_readiness`(`promotionReadiness.cmd.ts`) 출력 끝에 5-flag 증거 섹션
(`formatGate1FlagShadowEvidenceSection`) append — 세션 레지스트리 load → render. 신규 명령 0(단일
통로·SRP). 근거: 0631 이 이미 "Shadow→Live 승격 준비도" 진단의 단일 창구이고, 본 5-flag 증거는 그
의사결정의 직접 입력. coverage 결손은 결손으로만 표시(market signal 변환 0·불변식 #6), flip 결정은
operatorApprovalRequired=true backstop.

---

## Consequences

- **executionImpact = NONE / byte-equivalent.** LIVE 매매 본체·Gate 채점 곡선(weightedScore/
  componentScorers)·requiredScore=70·autoTradeEngine·kisClient·SourceSnapshot 0줄. force-ON 은
  hypothetical 산출 전용 — 실채점(actualScore/passed) 미반영. **flag flip 0**(5개 전부 SHADOW_OFF 유지).
- **신규 산출:** 5-flag hypothetical 증거가 ledger·세션 레지스트리에 영속되고 `/promotion_readiness`
  에 섹션으로 표시됨(관측 가시화만). 0641 의 flip 결정 수치 공백 완결.
- **9대 불변식:** #1(stamp/집계 try/catch 격리·scorer/엔진 무정지) · #2(증거 추가만·shadow 수집 무변경) ·
  #3/#9(provider 직접 조회 0·coverage% 는 기존 trace 입력 카운트만·SourceSnapshot 무접촉) · #6(coverage
  결손은 결손으로만 카운트·market signal 변환 0) · #7(매매 결정 경로 무접촉) · #8(flag flip 0·shadow
  관측만 추가) 전부 무위반.
- **rollback:** 신규 파일 3개 삭제 + 수정 8개 revert + 레지스트리 데이터 파일 삭제. flag flip 0 이라
  ENV 롤백 대상 없음. LIVE 매매 본체 0줄·KIS/KRX quota 0 침범 → byte-equivalent 롤백(ADR-0146).

---

## Alternatives Considered

- **세션 레지스트리 없이 single-scan 만** — N세션 누적 불가, flip 결정에 필요한 sessions observed·누적
  delta 측정 상실. 기각.
- **신규 진단 명령 분리** — 단일 통로·dedup·운영자 UX 위배(0631 이 이미 승격 준비도 단일 창구). 기각.
- **ledger 미경유, 세션 레지스트리만** — forward-outcome(통과 후보의 실제 5D/10D 성과) 연계 상실 →
  0641 activationCriteria 의 forward-outcome 성숙 요구 미충족. 기각.
- **per-flag 증거를 `src/types/` 공유 타입으로** — 본 타입은 서버 scan 파이프라인 전용·클라이언트
  미import. 기존 0546/0613/0640 hypothetical 타입도 전부 server 로컬 — 일관성 유지(server 로컬 정의). 기각.

---

## References

ADR-0146 · ADR-0530 · ADR-0631 · ADR-0641 · ADR-0546 · ADR-0611 · ADR-0613 · ADR-0627 · ADR-0640 ·
ADR-0476 · `scripts/gate_flag_lifecycle.json`(reviewBy/status SSOT) ·
`_workspace/2026-06-21_gate-shadow-flag-evidence/architect/{current-state,design,patch-scope-guard}.md`
