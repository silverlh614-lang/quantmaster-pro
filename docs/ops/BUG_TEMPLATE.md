# BUG TEMPLATE — QuantMaster Pro

신규 BUG 항목을 `docs/ops/BUG_LEDGER.md` 에 추가할 때 본 템플릿을 복사하여 사용한다.

frontmatter 는 `BUG_LEDGER.md` §"BUG frontmatter 표준" 과 정확히 일치해야 하며, area 필드는 `BUG_AREAS.md` 의 영역 이름과 byte-equivalent 동일 문자열을 사용해야 한다.

## 템플릿

```markdown
---
id: BUG-YYYY-MM-DD-NNN
status: OPEN
severity: P0
area: Market Truth Layer
discovered: YYYY-MM-DD
resolved: null
related_adrs: []
related_bugs: []
keywords: []
recurrence_count: 0
---

## BUG-YYYY-MM-DD-NNN — [한 줄 요약]

### 증상 (What)

시스템이 어떻게 잘못 작동하는가?
관찰된 사실만 적는다.
추측과 해결책은 여기 적지 않는다.

### 영향 (Impact)

무엇이 망가지는가?
자금 손실, 오판정, 오매수, 오매도, 학습 오염, 운영자 오인지 가능성을 명시한다.

### 재현 (Reproduction)

정확한 재현 절차, 날짜, 조건, 로그 위치를 적는다.

### 근본 원인 (Root Cause)

Why 5회를 적용한다.

- Why 1:
- Why 2:
- Why 3:
- Why 4:
- Why 5:

### 기대 동작 (Expected)

정상이라면 어떻게 작동해야 하는가?

### 해결 (Resolution)

- 수정 PR:
- 관련 ADR:
- 검증 방법:
- 회귀 테스트:

### 재발 감시 (Watch)

- 감시 기간:
- 재발 감지 신호:
- 재발 횟수:
```

## 작성 원칙

1. 한 BUG 는 하나의 결함만 다룬다.
2. 같은 결함이 재발하면 새 BUG 를 만들지 말고 기존 BUG 의 `recurrence_count` 를 증가시킨다.
3. 결함과 기능 요청을 섞지 않는다. 기능 요청은 본 장부 대신 별도 RFC / ADR 초안 / `_workspace/PENDING_WIRING.md` 로 분리한다.
4. 원인 분석 전에는 해결책부터 쓰지 않는다. "증상 → 영향 → 재현 → 근본 원인 → 기대 동작 → 해결 → 재발 감시" 순서를 지킨다.
5. P0 는 자금 손실 가능성을 기준으로 판단한다 (`BUG_LEDGER.md` §"Severity 기준 — P0 Critical" 참조).
6. Hotfix PR 본문에는 반드시 `Fixes BUG-YYYY-MM-DD-NNN` 을 적는다. 이 형식으로 PR ↔ BUG 추적성을 보존한다.
7. ADR 이 생성되면 BUG 의 `related_adrs` 에 연결한다.
8. ADR 문서가 BUG 를 해결한다면 ADR 본문에도 해당 BUG ID 를 적는다 (양방향 링크).
9. `WATCHING` 상태는 재발 방지를 위한 핵심 상태다. 단순 "해결 완료" 가 아니라 "감시 기간 동안 재발 없음" 을 증명해야 `CLOSED` 로 격상된다.
10. `CLOSED` 는 해결이 아니라 "감시 기간 동안 재발 없음" 을 의미한다.

## ID 발급 규칙

- 형식: `BUG-YYYY-MM-DD-NNN`
- `YYYY-MM-DD`: 결함이 처음 관측된 KST 날짜.
- `NNN`: 동일 일자 내 발견 순서. 001 부터 시작.
- 발급 후 영구 불변. 결함 내용 갱신 시에도 ID 는 변경하지 않는다.
- 재발 시 신규 ID 발급 금지 — 기존 ID 의 `recurrence_count` 만 증가.

## 상태 갱신 시 동시에 수정해야 하는 필드

| 상태 전이 | 갱신 필드 |
|-----------|-----------|
| `OPEN → PATCHED` | `status`, `resolved` (PR 머지 일자), `Resolution` 섹션의 PR 링크 + 해결 방법 |
| `PATCHED → VERIFIED` | `status`, `Resolution` 섹션의 검증 방법 결과 |
| `VERIFIED → WATCHING` | `status`, `Watch` 섹션의 감시 기간 시작 시점 |
| `WATCHING → CLOSED` | `status` |
| `WATCHING → OPEN` | `status`, `recurrence_count` 증가, `Watch` 섹션의 재발 횟수 갱신 |
| `ANY → WONTFIX` | `status`, `Resolution` 섹션에 미수정 결정 사유 명시 |
