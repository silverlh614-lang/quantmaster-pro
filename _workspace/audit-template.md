# Audit PR 표준 템플릿 — QuantMaster Pro

> **본 파일은 audit PR 작성 시 복사하여 `_workspace/audit-pr-{name}/findings.md` 로 저장하는 *표준 형식*. 모든 audit PR 은 본 템플릿의 4 섹션 (검증 항목 / 발견 / 결정 / 후속 조치) + ADR-0146 5 카테고리 체크리스트를 따라야 한다.**

---

## 사용 지침

1. **언제 사용?** — ADR-0146 §"강제 트리거 시점" 의 3 조건 중 하나 충족 시:
   - **N0 boundary 24h** (PR 번호 10/20/30/... 직후 24시간 이내, audit-only PR 작성 의무)
   - **사용자 명시 요청** ("audit 해보자" / "PR-N1~N2 검증")
   - **인시던트 후 직후 PR** (Critical 결함 차단 직후 누적 변경 검증)
2. **어디에 저장?** — `_workspace/audit-pr-{name}/findings.md` (예: `audit-pr-510/findings.md` / `audit-pr-attribution-wiring/findings.md`)
3. **본 PR 의 코드 변경?** — 0줄 (audit 전용). findings 산출물 + 필요 시 PENDING_WIRING.md 백로그 갱신만.
4. **수리 PR 분리** — findings 의 후속 액션 항목은 *별도 PR* 분리 (회귀 위험 격리 + audit ↔ 수리 책임 분리).

---

## 템플릿 본문

> 아래 마크다운을 복사 → `findings.md` 로 저장 → 4 섹션 채우기.

```markdown
# {AUDIT_NAME} — {SCOPE 한 줄 요약}

**작성일**: {YYYY-MM-DD}
**PR scope**: PR-{NN1} ~ PR-{NN2} 누적 변경 / {AUDIT_TRIGGER: N0 boundary | 사용자 명시 | 인시던트 후속}
**목적**: {audit 의 진단 목적 — 1~2 문장으로 명료하게}
**KIS/KRX/Yahoo quota 영향**: 0 (read-only audit)
**LIVE 매매 본체 변경**: 0줄

---

## 결론 (TL;DR — 3줄 이내)

{핵심 발견 + 결정 한 줄로}.

근거:
- {근거 1: 정적 grep / 코드 위치 / 영속 데이터 검증 결과}
- {근거 2}
- {근거 3}

**후속 액션**: {수리 PR 진입 | 백로그 정정만 | 영구 정책 명문화}

---

## 1. 검증 항목 (Audit Scope)

본 audit 가 검증한 5 카테고리 (ADR-0146 정합):

### A. LIVE 매매 안전성

- [ ] KIS/KRX 자동매매 quota 영향 (절대 규칙 #2/#3/#4)
- [ ] kisClient/orchestrator/signalScanner/autoTradeEngine 본체 변경 여부
- [ ] AUTO_TRADE_ENABLED + emergencyStop 가드 정합
- [ ] ENV 롤백 스위치 존재 (default=정책 / DISABLED=legacy 복원)
- [ ] 회귀 테스트 추가 (신규 변경 100 LoC 당 5+ 케이스 heuristic)

### B. wiring 완료 vs 인프라만

- [ ] PENDING_WIRING.md 백로그 등재 정합 (해당 PR 의 잔여 wiring 명시)
- [ ] DECIDED_NOT_WIRING 항목은 reason 에 PR/ADR/audit 인용 명시
- [ ] INFRASTRUCTURE_ONLY/PARTIAL/BLOCKED 항목은 차단 사유 명시
- [ ] G 카테고리 (`check_pending_wiring.js`) baseline 통과

### C. ADR 번호 발급 무결성

- [ ] INDEX.md `다음 발급` 번호 사용 의무 준수
- [ ] 본 PR 머지 후 INDEX.md `다음 발급` 갱신 (+1)
- [ ] 기존 ADR 번호 무변경 (외부 참조 무결성 보호)

### D. 회귀 테스트 적정성

- [ ] vitest 본 PR 영향 영역 100% pass (사전 baseline 무회귀)
- [ ] 정적 grep 가드 (회귀 차단 패턴) 도입 여부
- [ ] 단위/통합 테스트 비율 적정 (외부 의존성 mock 격리)

### E. 정책 위반 (validate:all 13종 baseline)

- [ ] Gemini / ACMA / SDS / PRES / Responsibility / SymbolBoundary
- [ ] ChannelBoundary / SensitiveAlerts / MarketOverviewBoundary
- [ ] YahooRange / UILanguage / DataTrust / SilentDegradation
- [ ] ADRIndex / PendingWiring / PrPaceAudit (Governance 자동화)

---

## 2. 발견 (Findings)

### Critical (즉시 차단 필요, P0)

| # | 위치 | 결함 | 증거 | 영향 |
|---|------|------|------|------|
| C1 | `path/file.ts:LINE` | {1줄 요약} | `grep ...` / 영속 read 결과 / 정적 분석 | LIVE / 학습 / UI / 영속 |

### High (즉시 수리 권장, P1)

| # | 위치 | 결함 | 증거 | 영향 |
|---|------|------|------|------|
| H1 | ... | ... | ... | ... |

### Medium (후속 PR 분리 가능, P2)

| # | 위치 | 결함 | 증거 | 영향 |
|---|------|------|------|------|
| M1 | ... | ... | ... | ... |

### Pass (검증 통과 항목 — 회귀 가드)

- {항목 1}: {간단한 검증 결과} ✅
- {항목 2}: {간단한 검증 결과} ✅

---

## 3. 결정 (Decisions)

각 발견 항목에 대한 *처리 방침* 명시:

| ID | 결정 | 근거 | 후속 PR |
|----|------|------|---------|
| C1 | 즉시 수리 / 정책 변경 / 영구 잔존 결정 | {근거 1줄} | PR-{name} (별도 분리) |
| H1 | ... | ... | ... |
| M1 | 후속 PR 분리 (운영 데이터 N주 누적 후) | ... | PENDING_WIRING.md {ID} 등재 |

### 결정 분류 (4종)

- **즉시 수리** (별도 수리 PR) — Critical/High 결함, 회귀 위험 격리 후 진행
- **후속 PR 분리** — Medium, 운영 데이터 누적 후 또는 사용자 결정 대기
- **DECIDED_NOT_WIRING** (영구 정책) — 정성 항목 / 외부 의존 / 의도된 잔존
- **백로그 정정만** — 본 audit PR 에서 PENDING_WIRING.md 갱신만 (코드 변경 0)

---

## 4. 후속 조치 (Follow-ups)

### 본 PR 작업 (audit 산출물)

- [ ] `_workspace/audit-pr-{name}/findings.md` 영속 (본 파일)
- [ ] PENDING_WIRING.md 갱신 (해당 항목 status / reason 정정)
- [ ] CLAUDE.md 변경 이력 한 줄 추가
- [ ] 코드 변경 0줄 확인 (audit 전용)

### 별도 후속 PR

| 우선순위 | PR 이름 | 작업 | ADR | 진입 조건 |
|---------|---------|------|-----|----------|
| P0 | PR-{fix-1} | C1 수리 | ADR-{NNNN} | 즉시 |
| P1 | PR-{fix-2} | H1 수리 | — | 1~2주 |
| P2 | PR-{wiring-1} | M1 wiring | — | 운영 데이터 1~2주 누적 후 |

---

## 5. 검증 명령 (재현 가능성)

audit 시 사용한 명령들 — 향후 동일 audit 재실행 시 참조:

```bash
# 정적 grep 검증
grep -rn "패턴" src/ server/ --include="*.ts"

# 영속 데이터 read-only 검증
node -e "import('./server/persistence/x.js').then(m => console.log(m.loadX().length))"

# 회귀 테스트 무회귀 검증
npx vitest run server/path/file.test.ts

# validate:all 13종 baseline
npm run validate:all

# precommit 통과
ALLOW_DEPLOY_WINDOW=1 npm run precommit
```

---

## 6. 코드 변경 0건 (Audit 전용)

본 PR 은 audit 산출물 전용 — 코드 변경 0줄. 후속 수리 PR 은 별도로 분리하여 회귀 위험 격리.

추적성:
- audit 시작 시 `git log -10` 결과 기록 (어느 PR 까지 누적 변경에 대한 audit 인지 명시)
- audit 끝 시 `git status` 결과 = `M _workspace/...` 만 (코드 변경 0 확인)

---

## 부록 A. audit 패턴 카탈로그

자주 쓰이는 audit 검증 패턴:

### A1. SSOT drift 검출

```bash
# 두 위치의 동일 의미 상수가 일치하는지
grep -A 30 "const FOO_SSOT" server/x.ts
grep -A 30 "const FOO_SSOT" src/y.ts
diff <(grep -A 30 "const FOO_SSOT" server/x.ts) <(grep -A 30 "const FOO_SSOT" src/y.ts)
```

### A2. 호출자 매트릭스

```bash
# 함수 호출자 0건 검증 (dead code)
grep -rn "functionName(" src/ server/ --include="*.ts" | grep -v "test\.ts" | grep -v ".d.ts"
```

### A3. 영속 schema 옵셔널 필드 wiring 정합

```bash
# 옵셔널 필드 reader/writer 카운트 (silent degradation)
grep -rn "\.fieldName\b" server/ --include="*.ts" | wc -l    # reader
grep -rn "fieldName: " server/ --include="*.ts" | wc -l       # writer (literal)
```

### A4. 외부 호출 quota 영향

```bash
# KIS/KRX/Yahoo 직접 호출자 (절대 규칙 #2 위반)
grep -rn "fetch.*koreainvestment\|fetch.*krx\|fetch.*yahoo" server/ --include="*.ts" | grep -v "kisClient\|krxClient\|yahooQuoteAdapter\|EgressGuard"
```

---

## 부록 B. audit findings 가 학습 데이터

ADR-0146 §"감속 효과" — audit PR 자체가 *코드베이스 진화의 학습 데이터*. 시간 경과 후 audit-pr-N0 폴더들을 모아보면 *결함 패턴의 시계열* 이 드러남:

- 같은 결함이 반복되는가? → 정적 검증 자동화 후속 PR (validate:all 카테고리 추가)
- 특정 모듈에 결함 집중? → 분해 PR 의 트리거 (CLAUDE.md "기존 복잡도 위반" 표 등재)
- 사용자 보고 결함이 우리 audit 으로 사전 검출 가능했나? → audit 항목 추가

본 템플릿 자체도 시간이 지나면 진화 — 새 패턴 발견 시 부록 A 추가 / 검증 항목 5 카테고리 확장 등.

---

## 변경 이력

| 날짜 | PR | 변경 내용 |
|------|----|-----------|
| 2026-05-01 | PR-Governance-Followup-2 | 초기 작성 — ADR-0146 5 카테고리 체크리스트 + 사용자 4 섹션 (검증 항목 / 발견 / 결정 / 후속 조치) 결합 |
