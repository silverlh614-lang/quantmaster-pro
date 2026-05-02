# ADR-0159 — ADR 충돌 별칭 시스템 (Diaspora Policy)

@responsibility ADR 번호 충돌 17건의 인용 시 모호성 해소 SSOT — 파일명 무변경 + git diff 무결성 보존 + 별칭 정규 표기 통일.

**일자**: 2026-05-02
**관련 PR**: PR-Diaspora (#516, ADR-0159)
**도메인**: governance / 거버넌스 자동화

## 배경

ADR-0148 (PR-Governance-Followup) + ADR-0158 (Wiring SLA) 가 ADR 발급 무결성 자동화를 완성했지만, 이미 누적된 *충돌 ADR 17건* 의 인용 시 모호성은 해소되지 않은 상태:

- `ADR-0028` 인용 시 *exitEngine 분해* / *rejection-universe-tracker* / *ui-redesign-p0-banners-badges-cards* 중 어느 것을 가리키는지 불분명
- 0028 그룹 (3) / 0029 그룹 (3) / 0030 그룹 (3) / 0031 그룹 (3) / 0032 그룹 (2) / 0067 그룹 (2) / 0068 그룹 (2) / 0124 그룹 (2) — 8 그룹 17 ADR
- 인용 시 PR 번호 병기로 어느 정도 구분 가능하지만 (예: `ADR-0028 (PR-53)`) 관습일 뿐 강제력 없음

사용자 명시 옵션 평가:
- **옵션 A — 파일명 변경** (예: `0028a-exitEngine-decomposition.md`): 외부 참조·git history·기존 PR 노트 인용 모두 깨짐 → 거부
- **옵션 B — 인용 정책만 명문화** (예: 인용 시 PR 번호 병기 의무): 회귀 위험 0 이지만 강제력 없음 → 미흡
- **옵션 C — 별칭 시스템** (alias): 파일명 무변경 + 인용 시 별칭 사용 권장 + INDEX.md SSOT 매핑 → 채택

## 결정

INDEX.md §"알려진 충돌" 표에 `별칭` 컬럼 추가. 17 충돌 ADR 에 후행 영문자 별칭 (a/b/c) 부여 — 동일 그룹 내 *작성순* (PR 머지 시점 오름차순) 기준. 파일명·git diff 무변경, *인용 시* 만 별칭 사용 권장.

### 별칭 매트릭스 SSOT

| 번호 | 별칭 | 의도 도메인 | PR | 파일 |
|------|------|-------------|-----|------|
| **0028a** | exitEngine-decomposition | refactor | PR-53 | `0028-exitEngine-decomposition.md` |
| **0028b** | rejection-universe-tracker | learning | PR-L | `0028-rejection-universe-tracker.md` |
| **0028c** | ui-redesign-p0-banners-badges-cards | ui | PR-A | `0028-ui-redesign-p0-banners-badges-cards.md` |
| **0029a** | condition-source-tier-and-recommendation-history | ui | PR-B | `0029-condition-source-tier-and-recommendation-history.md` |
| **0029b** | counterfactual-twin-portfolio | learning | PR-M | `0029-counterfactual-twin-portfolio.md` |
| **0029c** | stockScreener-decomposition | refactor | PR-55 | `0029-stockScreener-decomposition.md` |
| **0030a** | latent-signal-scorer | learning | PR-N | `0030-latent-signal-scorer.md` |
| **0030b** | price-alert-watcher | ui | PR-C | `0030-price-alert-watcher.md` |
| **0030c** | signalScanner-entry-gates-phase-b | refactor | PR-57 | `0030-signalScanner-entry-gates-phase-b.md` |
| **0031a** | last-trigger-enemy-tranche-cards | ui | PR-D | `0031-last-trigger-enemy-tranche-cards.md` |
| **0031b** | order-type-optimizer | learning | PR-O | `0031-order-type-optimizer.md` |
| **0031c** | signalScanner-revalidation-and-sizing-patterns | refactor | PR-59 | `0031-signalScanner-revalidation-and-sizing-patterns.md` |
| **0032a** | sector-rotation-heatmap | ui | PR-E | `0032-sector-rotation-heatmap.md` |
| **0032b** | self-learning-series-overview | learning | PR-P | `0032-self-learning-series-overview.md` |
| **0067a** | multi-timeframe-confluence-gate | learning | PR-Q | `0067-multi-timeframe-confluence-gate.md` |
| **0067b** | marketoverview-boundary-guard | data | PR-α 후속 | `0067-marketoverview-boundary-guard.md` |
| **0068a** | macrostate-stale-block | data | PR-α 후속 | `0068-macrostate-stale-block.md` |
| **0068b** | shadow-learning-hooks-wiring | learning | PR-R | `0068-shadow-learning-hooks-wiring.md` |
| **0124a** | regime-coverage-suggest-false-positive | learning | (날짜 추가 필요) | `0124-regime-coverage-suggest-false-positive.md` |
| **0124b** | telegram-reports-be-visibility | telegram | PR-ADR-0124 | `0124-telegram-reports-be-visibility.md` |

별칭 부여 정책 — 동일 그룹 내 PR 머지 시점 오름차순 (a → b → c). 동일 시점 PR 다수 시 PR 번호 오름차순.

### 인용 정책

**권장 (강제 X)**:
- 신규 PR 노트 / 변경 이력 / 코드 주석 / commit message 의 충돌 ADR 인용 시 별칭 사용 (예: `ADR-0028a` 또는 `ADR-0028b`)
- 비충돌 ADR 인용은 기존 형식 유지 (예: `ADR-0085`)
- 충돌 ADR 의 *불특정 그룹* 참조 시 PR 번호 병기 허용 (예: `ADR-0028 (PR-53)` ≡ `ADR-0028a`)

**금지**:
- 파일명 변경 (git diff·외부 참조 무결성)
- 기존 PR 노트의 충돌 ADR 인용 일괄 정정 (변경 이력 무수정 — 신규 PR 부터만 적용)
- 별칭 강제 lint 검증 즉시 활성화 (50+ 기존 인용 정정 부담 큼 — 6개월 운영 후 검토)

### check_adr_index.js 옵셔널 검증

본 ADR 도입 시 default OFF — `validateAliasReferences(src, options)` 신규 함수 export 만, 호출자 0건. 운영자가 6개월 운영 후 *별칭 인용 비율 충분* 확인 후 `validate:adrIndex --strict-alias` 옵션 활성화 결정. ENV `ADR_ALIAS_STRICT=true` 우회.

검증 패턴 — `ADR-(0028|0029|0030|0031|0032|0067|0068|0124)\s` (그룹 번호 후 영문자 부재) 매칭 시 WARN. 코드 주석 / 변경 이력 (CLAUDE.md `## 변경 이력` 섹션) skip.

## 적용

### 1. ADR-0159 발행

본 파일 — 별칭 매트릭스 SSOT + 인용 정책 + check_adr_index.js 옵셔널 검증 명문화.

### 2. INDEX.md §"알려진 충돌" 표 확장

기존 5 컬럼 (번호/파일/도메인/PR/비고) → 6 컬럼 (**별칭** 추가). 17 항목 모두 별칭 부여. 표 헤더 + 정렬 갱신.

§"알려진 충돌" 본문에 별칭 정책 안내 1단락 추가:

> 충돌 ADR 인용 시 *별칭 사용 권장* (예: `ADR-0028a` exitEngine 분해 / `ADR-0028b` rejection-universe-tracker / `ADR-0028c` ui-redesign-p0). 비충돌 ADR 은 기존 형식 그대로. 별칭 부여 기준 — 동일 그룹 내 PR 머지 시점 오름차순. 본 표가 단일 진실 출처 (ADR-0159).

### 3. PR 템플릿 권장 안내

`.github/pull_request_template.md` "📜 ADR 발급" 섹션에 1줄 추가:

> - [ ] 충돌 ADR (0028/0029/0030/0031/0032/0067/0068/0124) 인용 시 별칭 (a/b/c) 사용 권장 (ADR-0159 §인용 정책).

### 4. check_adr_index.js 옵셔널 검증 (default OFF)

`validateAliasReferences(src, options)` 신규 export — 별칭 매트릭스 SSOT 기반 검증 함수만 정의. 호출자 0건 (default OFF). 운영자 결정 후 활성화.

`ALIAS_MAPPING` 상수 SSOT export — 17 항목 매트릭스 (번호 → { alias, intent, pr, file }).

### 5. CLAUDE.md 340 줄 중복 PR 노트 정리

PR-Governance-3-SLA (#515) 머지 시 printf 실패로 partial 첫 노트 + complete 두 번째 노트 합쳐진 결함 차단. partial 첫 노트 (4805 byte 짤린 부분) 제거 + 두 번째 노트만 단일 행 유지.

## 결과

- **즉시 효과** — 17 충돌 ADR 의 인용 시 모호성 해소 (인용자가 별칭 사용 시 즉시 식별 가능). 파일명·git history·기존 인용 모두 무변경.
- **회귀 위험 격리** — 강제 검증 default OFF + 50+ 기존 인용 정정 부담 0 + 파일명 변경 금지 3중 안전망.
- **점진 채택** — 신규 PR 부터 별칭 사용 권장, 6개월 운영 후 강제 검증 활성화 결정. 본 ADR 매트릭스가 *진실의 출처* 라 alias 변경 시 본 ADR 갱신 + INDEX.md §"알려진 충돌" 표 동시 정정.
- **CLAUDE.md 변경 이력 정리** — PR-Governance-3-SLA (#515) 머지 시 printf 결함 자연 차단.

## 잔여 후속 PR (scope 밖)

- 운영 6개월 후 별칭 강제 검증 활성화 결정 — `check_adr_index.js --strict-alias` 또는 ENV `ADR_ALIAS_STRICT=true`. 기존 50+ 인용 정정 부담 vs 모호성 차단 효과 trade-off 평가.
- ADR 본문 자체에서 다른 ADR 인용 시 별칭 사용 점진 마이그레이션 (예: ADR-0085 본문이 `ADR-0028` 참조 시 → `ADR-0028a`).
- 신규 충돌 발생 시 (ADR-0148 자동 검증으로 영구 차단되지만 만약의 경우) 본 ADR 매트릭스에 즉시 추가.

## 참고

- ADR-0148 거버넌스 자동화 (#503) — ADR INDEX 충돌 검증 (카테고리 C/E).
- ADR-0158 Wiring SLA (#515) — 거버넌스 자동화 시리즈 마지막 PR.
- 사용자 명시 *"#3+#4 분리하면 회귀 위험 격리 + audit 단위 명확. 본인이 만든 ADR-0146 (10-PR audit) 룰에 더 잘 맞습니다"* — 본 PR 분리 진행 정합.
