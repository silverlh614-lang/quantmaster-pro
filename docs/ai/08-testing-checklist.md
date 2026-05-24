# 08 · Testing Checklist (검증 파이프라인·precommit·PR 자가 review)

**Read this file only when working on:**
- 커밋 전 검증(typecheck · test · `validate:*`) 실행 · precommit 훅
- 새 validate 스크립트 추가/수정 · 정적 가드(silent catch · exposure · boundary) 통과
- PR 자가 review (ADR-0146 5 카테고리) · ADR-0148 정적 체크
- 변경 이력 한 줄 의무 점검

**Do not read this file for:**
- 파일 분해 워크플로 · baseline 카탈로그 · 복잡도 한계 → `09-refactor-rules.md`
- PR 범위·diff 출력·ADR vs patch type 규칙 → `CLAUDE.md` §5
- 모듈 경계·에이전트 DoD → `01-architecture-map.md`

---

## 검증 파이프라인 (validate:*)

`scripts/` 자체 검증 도구. 커밋 전 `validate:all` 통과 의무. 훅 우회(`--no-verify`) 금지.

| 스크립트 | 강제 내용 |
|----------|-----------|
| `validate:responsibility` | 모든 새 파일 상단 20줄 내 `@responsibility` 25단어 이내 |
| `validate:complexity` | 파일당 1,500줄 한계 (→ `docs/ai/09-refactor-rules.md`) |
| `validate:sds` | Silent catch (사유 없는 swallow) 차단 — 의도 무시는 `/* SDS-ignore: <사유> */` |
| `validate:exposure` | 비밀/토큰/채널 ID 등 민감값 코드 노출 차단 |
| `validate:symbolBoundary` | Yahoo `.KS/.KQ` direct concat 금지 (ADR-0444 resolver SSOT 위임) |
| `validate:channelBoundary` | `TELEGRAM_*_CHANNEL_ID` 직접 접근은 alertRouter 만 |
| `validate:sensitiveAlerts` | 채널 발송에 잔고/자산 키워드 누출 차단 (ADR-0038) |
| `validate:marketOverviewBoundary` | 시장 개요 데이터 경계 위반 차단 |
| `validate:yahooRange` | Yahoo range ≤1y 전역 정책 (ADR-0082 capYahooRange) |
| `validate:uiLanguage` | UI 문자열 언어 정책 정합 |
| `validate:dataTrust` | L1~L4 신뢰 등급 경계 위반 차단 (L4 → live 금지 등) |
| `validate:silentDegradation` | 무고지 degradation(조용한 성능 격하) 차단 |
| `validate:adrIndex` | ADR INDEX `다음 발급` SSOT 정합 (ADR-0148) |
| `validate:pendingWiring` | wiring 완료 vs 인프라만 — pending wiring SLA 추적 (ADR-0158/0159) |
| `validate:prPaceAudit` | PR pace 감사 (과속/누락 변경 이력) |
| `validate:gemini` | Gemini 호출 경로/프롬프트 정책 정합 |

---

## precommit / lint

- **precommit 필수** — 커밋 전 훅 실행 의무. `--no-verify` 우회 절대 금지 (절대 규칙 #7).
- **lint** — engine-dev DoD (`server/trading/*` 등 수정 시 `lint` + 해당 `*.test.ts` 통과).
- **해당 테스트** — 수정 모듈의 `*.test.ts` 회귀 통과. LIVE 매매 본체 변경 시 회귀 테스트 의무.

---

## Minimum Validation by Patch Type (ADR-530)

패치 유형별 **최소** 검증 기준. `npm run lint` = client+server `tsc` 타입체크 (이 프로젝트의 typecheck).
Patch Plan 의 도메인에 맞춰 아래 중 하나를 적용한다.

- **Documentation-only patch** — 변경 파일만 확인. 문서가 명령/생성물을 참조하지 않으면 런타임 테스트 불필요.
- **Type-only / interface patch** — `npm run lint` + 관련 unit 테스트(있으면).
- **Gate / SourceSnapshot patch** — `npm run lint` + 관련 gate/source-snapshot 테스트 + 해당 시 `/scan_blockers` 진단 확인.
- **Provider patch** — `npm run lint` + provider fallback/stale/empty 테스트(있으면) + providerIssue 가 marketSignal 로 변환되지 않음 확인.
- **Telegram patch** — `npm run lint` + telegram 포맷/dedup/command route 테스트(있으면) + CH1~CH4 채널 분리 확인.
- **Shadow Learning patch** — `npm run lint` + shadow lifecycle/ledger/counterfactual 테스트(있으면) + SELL_ONLY/R6/providerIssue 하에서 `shadowAllowed` 가 true 유지 확인.
- **Refactor patch** — `npm run lint` + 기존 관련 테스트 + 명시되지 않는 한 동작 변경 0 (byte-equivalent).
- **Diagnostics / severity-taxonomy patch (ADR-531)** — `npm run lint` + severity 매핑 테스트(있으면) +
  아래 taxonomy 케이스 확인 + warning cleanup 은 runtime 동작 무변경.

### Severity Taxonomy 검증 케이스 (ADR-531)

severity/diagnostic/telegram-display 패치 시 다음을 만족해야 한다 (SSOT →
`docs/archive/adr/adr-531-warning-error-taxonomy.md`):

1. providerIssue=true · marketSignal=false · executionImpact=NONE → severity ∈ {INFO, DIAGNOSTIC} (ERROR/WARN 아님).
2. SELL_ONLY + live buy blocked → INFO/POLICY_STATE (장애 아님).
3. R6 active + shadowAllowed=true → ERROR 아님 (불변식 #2).
4. P3/P4 budget exceeded → DIAGNOSTIC · dataVacuum=false (승격 금지).
5. P0 execution-critical provider missing → WARN/ERROR 가능.
6. Telegram signal 채널에 DIAGNOSTIC/DEBUG/SUPPRESSED 직접 노출 안 됨.
7. Shadow lifecycle failure → WARN/ERROR 유지.

상세 Patch Scope Guard·Patch Plan/Report 템플릿 → `docs/ai/09-refactor-rules.md` ·
`docs/ai/templates/patch-plan-template.md` · `docs/ai/templates/patch-report-template.md`.

---

## ADR-0146 PR 자가 review (5 카테고리)

모든 PR 은 머지 전 5 카테고리 자가 검증:

1. **LIVE 매매 안전성** — KIS/KRX quota 0 침범 · ENV 1줄 즉시 롤백 가능 · 회귀 테스트 존재.
2. **wiring 완료 vs 인프라만** — 코드만 추가하고 호출 연결 누락(dead wiring) 아닌지.
3. **ADR 발급 무결성** — 신규 경계/정책은 ADR 발급(`docs/adr/INDEX.md` `다음 발급` SSOT) + INDEX 갱신.
   hotfix/정합 정정/진단 가시화는 patch type (ADR 0건, INDEX 갱신 0건).
4. **회귀 테스트 적정성** — 변경 표면에 맞는 테스트 커버리지.
5. **정책 위반 baseline 무회귀** — `validate:all` baseline 위반 수가 증가하지 않을 것.

### byte-equivalent 원칙

LIVE 매매 본체 **0줄 변경** + ENV **1줄 즉시 롤백** + 회귀 테스트 + KIS/KRX quota **0 침범**.
신규 기능은 ENV gate default OFF → SHADOW 검증 → LIVE 승격 순서.

---

## ADR-0148 정적 체크 (4종)

- ADR INDEX `다음 발급` 번호 SSOT 단조 증가 (중복/건너뜀 차단).
- ADR 파일 ↔ INDEX 행 정합 (orphan ADR / orphan INDEX 행 차단).
- pending wiring 항목 SLA 초과 추적 (ADR-0158/0159).
- 변경 이력 한 줄 누락 차단 — 모든 PR 은 `docs/ai/10-patch-history-index.md` ## 색인 한 줄 (ADR-529 형식).

---

## 변경 이력 의무

- 모든 PR 은 `docs/ai/10-patch-history-index.md` **## 색인** 에 **한 줄** 추가 (ADR-529 형식); 구조/거버넌스 ADR 은 ## 핵심 ADR 요약 7-필드 블록 추가.
- CLAUDE.md / AGENTS.md 에는 패치 노트 누적 금지 (→ `CLAUDE.md` §4 Forbidden). 상세는 `docs/archive/adr/`.

복잡도 한계·분해 워크플로 → `docs/ai/09-refactor-rules.md` · 과거 변경 이력 → `docs/ai/10-patch-history-index.md`
PR 범위 규칙 → `CLAUDE.md` §5 Patch Scope Rule
