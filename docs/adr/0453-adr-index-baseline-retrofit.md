# ADR-0453: ADR Index Baseline Retrofit (22 violations → 0)

**Status**: Accepted (P3 — 사용자 명시 3순위 잔여 부채 정리 첫 단계)
**Date**: 2026-05-08

> **번호 재발급 보고**: 본 ADR 은 본래 **ADR-0445** 로 발급 시도됐으나 origin/main 의 다른 세션 작업 (krx-investor-flow-parser-empty-rows-hardening / shadow-near-breakout-entry-liveness 등) 이 0445~0452 번호를 동시 사용 → INDEX.md `다음 발급` SSOT 정합 (ADR-0148) 위반 회피로 PR #725 close 후 번호 **0453** 으로 재발급.
>
> 본 PR 본 의도 (ADR Index baseline retrofit) 와 발급 번호는 무관 — INDEX.md 의 §"다음 발급" 단일 진실 출처 정합으로 0453 채택. 본 ADR 의 정책·결정·검증·잘못된 해결 방법은 PR #725 의 0445 시안과 동일 (번호 외 동일).

## 배경

`scripts/check_adr_index.js` (ADR-0148 거버넌스 자동화) 가 baseline 22 violations 누적 — fast-iteration 시기 (2026-05-02~05-03) PR #622~#634 + #428 머지 시 commit-label 만 등재되고 ADR 본문 파일 미생성된 entries. PR #696~#701 시리즈 동안 *baseline 무관 사전 baseline* 으로 처리됐지만 거버넌스 SSOT (`validate:adrIndex`) baseline 가 22 으로 영구화 → 신규 위반 검출 정확도 격하.

`node scripts/check_adr_index.js` 본 PR 도입 시점 결과:

```
[ADR Index] FAIL — 22건 위반:
  [F_INVALID_FILENAME] 1건:
    - 0394-p1.5-execution-terminology-ssot.md (영소문자+숫자+하이픈 정책 — `p1.5` 의 `.` 위반)
  [A_MISSING_INDEX_ENTRY] 1건:
    - 0411-evaluator-provider-degraded-and-kis-recovery.md (파일 존재, INDEX 미등재)
  [B_STALE_INDEX_ENTRY] 20건:
    - 0211 / 0221 / 0231 / 0234 / 0235 / 0237 / 0241 / 0242
    - 0245 / 0248 / 0249 / 0250 / 0251 / 0252 / 0255 / 0256
    - 0258 / 0259 / 0260 / 0394
```

사용자 명시 — *"ADR Index 22 violations + ACMA baseline 정리"*. 거버넌스 도구 신뢰성 회복 의도.

## 결정 매트릭스

### A) F_INVALID_FILENAME — 화이트리스트 (1건)

ADR-0159 §"파일명 무변경" 정책 (외부 참조 무결성 / git diff 보존) 으로 `0394-p1.5-execution-terminology-ssot.md` 파일명 변경 **금지**.

**대안**: `INVALID_FILENAME_WHITELIST = Object.freeze(new Set([...]))` SSOT 도입.

```javascript
export const INVALID_FILENAME_WHITELIST = Object.freeze(
  new Set([
    '0394-p1.5-execution-terminology-ssot.md', // ADR-0394 P1.5
  ])
);
```

화이트리스트 entry 는 `scanAdrFiles` 가 invalid 분류 *제외* 하면서 byNumber Map 에는 *등재* (INDEX 정합 검증 보존).

향후 마이그레이션 PR 이 0394 를 다른 이름으로 옮기면 화이트리스트 entry 도 동시 제거.

### B) A_MISSING_INDEX_ENTRY — `ADR-0411` 등재 (1건)

`docs/adr/0411-evaluator-provider-degraded-and-kis-recovery.md` 파일 존재 (2026-05-06 머지) 하지만 INDEX.md §"전체 인덱스" 미등재.

**해결**: 표 한 줄 추가 — 0401 / 0412 사이.

```markdown
| 0411 | evaluator-provider-degraded-and-kis-recovery (ADR-0263 정책 개정 + ADR-0387~0390 SSOT 활용 — yahooQuoteAdapter Yahoo↔KIS 50% 괴리 시 *KIS 현재가 채택 + universe 보존*. 14 시계열 evaluator PROVIDER_DEGRADED 자동 강등 → 자연 진입 차단 효과) | trading |
```

### C) B_STALE_INDEX_ENTRY — *commit-label only* 마커 (20건)

20건 모두 fast-iteration commit-label 시기 (PR #622~#634, #428) 에 *ADR 본문 없이 INDEX + commit message 로 발급* 된 사례. 정상 절차 위반이지만 commit history 와 INDEX 에 영속 등재됐으므로 *역사적 사실* 로 인정.

**옵션 매트릭스**:

| 옵션 | 설명 | 채택 여부 |
|------|------|-----------|
| A. INDEX entries 일괄 삭제 | 20건 entries 제거 | ❌ git history 추적성 손실 |
| B. 본문 파일 일괄 retrofit | 20건 ADR 본문 작성 | ❌ scope 과대 (~1주 작업) |
| C. 마커 기반 분류 격상 | `(commit-label only, fast-iteration)` 마커 + check_adr_index 인식 | ✅ ADR-0148 정합 + 정책 보존 |

**옵션 C 채택**: `scripts/check_adr_index.js` 의 `parseIndex` 가 entry title 끝의 `(commit-label only, fast-iteration)` 또는 `(no file)` regex 매칭 시 `commitLabelOnly: true` 설정 → `validate` 의 B_STALE 검증에서 자동 제외.

```javascript
const COMMIT_LABEL_ONLY_RE = /\(commit-label only|\(no file\)/i;

// ...validate() 안:
if (info.commitLabelOnly) continue; // ADR-0453 — historical fact recognized
```

마커는 *역사적 사실 인정* 의미 — 신규 ADR 발급 시 본문 파일 작성 의무 보존 (마커 없는 entries 는 여전히 stale 검출).

20건 ADR 번호: 0211 / 0221 / 0231 / 0234 / 0235 / 0237 / 0241 / 0242 / 0245 / 0248 / 0249 / 0250 / 0251 / 0252 / 0255 / 0256 / 0258 / 0259 / 0260 / 0394.

각 entry 의 commit-label 본문은 `git log --all --grep="ADR-NNNN"` 으로 추출 가능 — 20건 모두 INDEX 등재 시점에 한 줄 요약이 이미 있어 그대로 보존하고 마커만 끝에 추가.

## 12 invariants

1. **ADR-0159 §"파일명 무변경" 정책 보존** — 외부 참조 무결성 / git diff 보존 / 0394 파일명 변경 금지.
2. **ADR-0148 INDEX SSOT 정책 보존** — 신규 ADR 발급 시 §"다음 발급" 번호 사용 + 본문 파일 작성 의무.
3. **F_INVALID_FILENAME 화이트리스트 영구 명시** — 1건만 (legacy 흡수). 향후 변경 시 ADR 갱신 의무.
4. **B_STALE_INDEX_ENTRY 마커 명시** — `(commit-label only, fast-iteration)` 또는 `(no file)` 명시.
5. **20 stale entries 의 commit history 보존** — `git log --all --grep="ADR-NNNN"` 으로 추적 가능.
6. **baseline 22 → 0 violations 회복** — 거버넌스 도구 신뢰성 회복.
7. **신규 ADR 발급 시 본문 파일 작성 의무 보존** — 마커 없는 entries 는 stale 검출 정상.
8. **LIVE 매매 본체 0줄 변경** — `signalScanner.ts` / `entryEngine.ts` / `exitEngine/**` / `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` 모두 0줄.
9. **KIS/KRX/Yahoo/Naver outbound 0** — 정적 검증 도구 + markdown 변경만.
10. **외부 패키지 0건** — node 빌트인 + 기존 ESM SSOT.
11. **ENV 신규 도입 0건** — 정책 강제, ENV 우회 의도적 부재.
12. **ADR-0146 PR 자가 review 5 카테고리 정합** — LIVE 안전성 / wiring vs 인프라 / ADR 발급 무결성 / 회귀 테스트 / 정책 위반.

## 잘못된 해결 방법 영구 차단

1. **ADR-0394 파일명 변경** (`0394-p1-5-execution-terminology-ssot.md` rename) — ADR-0159 §"파일명 무변경" 정책 위반, 외부 참조 무결성 손실.
2. **`STRICT_NAME_RE` 정규식 완화** (`.` 허용) — 향후 신규 ADR 의 비표준 파일명 자동 통과 위험. 화이트리스트만 허용.
3. **20 stale entries INDEX 일괄 삭제** — git history 추적성 손실, ADR-0148 §"건너뛰기 금지" 위반.
4. **20 stale entries 본문 파일 일괄 retrofit** — scope 과대, 본 PR scope 외 (별도 retrofit PR).
5. **commit-label 마커 자동 추가 (스크립트)** — 운영자 의사결정 위임 보존, 마커 부착은 ADR 발급 PR 의 의무.
6. **`commitLabelOnly` 임계 ENV 화** — 마커 인식은 *항상* 활성. ENV 우회 시 fast-iteration 결함 재현 위험.
7. **stale 검증 *완화*** — 본 PR 은 *마커 기반 분류 격상* 만, 마커 없는 stale 은 여전히 위반.

## 회귀 테스트

`scripts/check_adr_index.test.js` +8 신규 케이스 (heuristic ≥5/100 LoC):

1. **F_INVALID_FILENAME 화이트리스트** — `INVALID_FILENAME_WHITELIST` 등재 entry 통과
2. **화이트리스트 외 invalid filename** — 여전히 FAIL
3. **B_STALE_INDEX_ENTRY 마커 인식** — `(commit-label only, ...)` entry stale 분류 제외
4. **B_STALE_INDEX_ENTRY 마커 없는 stale** — 여전히 FAIL
5. **`(no file)` 마커 인식** — `(no file)` 도 동등 처리
6. **commitLabelOnly 카운트** — `summary.commitLabelOnlyEntries` 정확
7. **OK 출력 포맷** — commit-label only 카운트 표시
8. **baseline EXIT=0** — 본 PR 도입 시점 22 → 0 violations

## 검증

- `node scripts/check_adr_index.js` baseline EXIT=0 (22 → 0 violations)
- `npx vitest run scripts/check_adr_index.test.js` 신규 + 기존 모두 PASS
- `npm run lint` 변경 파일 0 errors
- `ALLOW_DEPLOY_WINDOW=1 npm run precommit` 본체 통과 — *ADRIndex baseline 22 → 0* (사전 SilentDegradation 1건만 잔여, 본 PR 무관)
- 외부 패키지 추가 0건
- LIVE 매매 본체 0줄 변경

## 후속 PR (scope 외)

1. **20 stale entries 본문 retrofit** — 운영 데이터 누적 후 우선순위 결정 (commit history 충분).
2. **`scripts/check_adr_index.js` 카탈로그 시기 baseline 격상** — 본 PR 정합 회복으로 baseline 0건 영구 유지 가능.
3. **사전 SilentDegradation 1건** (`MacroState.sectorEnergyInputsUpdatedAt`) — 본 PR 무관 별도 retrofit PR.

## 거버넌스

- **ADR-0146 PR 자가 review 5 카테고리 모두 PASS** (LIVE 안전성 / wiring 완료 / ADR 발급 무결성 / 회귀 테스트 / 정책 위반).
- **ADR-0148 INDEX SSOT 정합** — `다음 발급 0454` 갱신 + 본 ADR 등재 + 0411 등재.
- **ADR-0159 §"파일명 무변경"** — 화이트리스트 1건만 영구 명시 (`0394-p1.5-execution-terminology-ssot.md`).
- **사용자 명시 3순위 (잔여 부채 정리)** 첫 단계 직접 반영.
