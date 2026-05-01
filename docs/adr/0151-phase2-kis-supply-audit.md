# ADR-0151: Phase 2 KIS Supply Silent Degradation 차단 + audit findings 권고 정정

**날짜**: 2026-05-01
**상태**: 채택
**관련 PR**: PR-Phase2-KisSupplyAudit (PR-Phase0-Audit `_workspace/audit-pr-phase0/findings.md` §B 권고 정정)
**관련 ADR**:
- ADR-0011 (PR-25-A/B/C, AI 추천 KIS/KRX 분리) — 본 PR 정합 의무
- ADR-0150 (Phase 1 DART 마무리) — Phase 1 직속 후속이지만 *결과는 격상이 아닌 결함 차단*
- ADR-0029 (PR-B sourceTier 도입)
- ADR-0140 (Naver 외인 추세) — 진정한 #4 supplyInflow 격상의 후속 인프라

## 문제

PR-Phase0-Audit (`_workspace/audit-pr-phase0/findings.md`) §B 가 *Phase 2 KIS supply wiring P1, ~80 LoC* 를 권고했지만, Phase 2 진입 시 audit 깊이 검증 결과 **권고 자체가 부정확** 함을 확인. 진짜 결함은 *격상 wiring 이 부재* 가 아니라 *현재 코드가 silent degradation 결함을 가지고 있음*.

### 결함 1 — main path silent degradation

`enrichment.ts:481-482` (이전 코드):
```typescript
institutionalBuying: (kisSupply?.institutionNet ?? 0) > 0 ? 1 : 0,
supplyInflow: (kisSupply?.foreignNet ?? 0) > 0 ? 1 : 0,
```

`kisSupply` 의 출처는 `buildSnapshotSupplyStub(snap)` (`enrichment.ts:410`). ADR-0011 PR-25-C 가 *KIS 수급 호출 제거 + AI 자체 판단 위임* 정책을 채택한 후 stub 의 정의:

```typescript
return {
  foreignNet: 0,                  // ← AI 위임으로 0 박제
  institutionNet: 0,              // ← AI 위임으로 0 박제
  individualNet: 0,
  ...
  foreignerOwnRatio: snap.foreignerOwnRatio,  // ← Naver 정적 외인 보유율만 보존
  dataSource: snap.found ? 'NAVER_SNAPSHOT' : 'NONE',
};
```

→ `kisSupply.foreignNet === 0` 영원히. main path 분기는 *항상 0 으로 평가*. AI 가 채워준 `stock.checklist.supplyInflow` (1~10 점) 점수를 0 으로 *덮어쓰는* silent degradation. 27 조건 학습 가중치 입력의 #4/#12 가 영원히 0 — 사용자 4/30 보고 후 attribution wiring 단절 결함의 *연장선*.

### 결함 2 — `buildConditionSourceTiers` 의미 mismatch

`enrichment.ts:80-83` (이전 코드):
```typescript
if (ctx.hasKisSupply) {
  meta.institutionalBuying = 'API';
  meta.supplyInflow = 'API';
}
```

`hasKisSupply=true` 의 실제 의미는 *Naver snapshot 의 정적 `foreignerOwnRatio` 가 가용* — *외인 보유율* (정적 % 값). 이는 #4 supplyInflow (수급 *흐름*) / #12 institutionalBuying (기관/외인 *순매수*) 의미와 **mismatch**. 'API' 라벨 부여는 잘못된 라벨 (UI DataQualityBadge 사용자에게 *KIS 호출이 작동 중* 으로 잘못 시사).

### 결함 3 — audit findings §B 권고 자체 부정확

audit findings §B 가:
> | ChecklistKey | DART 격상 상태 | 코드 위치 |
> | `institutionalBuying` (#12) | (KIS supply 격상 wired) | `enrichment.ts:481` |
> | `supplyInflow` (#4) | (KIS supply 격상 wired) | `enrichment.ts:482` |

ADR-0011 정책 검토 누락 — "wired" 라 표기했지만 *작동 안 함* (0 박제).

## 결정

### 1. main path silent degradation 차단 — `stock.checklist` (AI 추정) 보존

`enrichment.ts:481-482` 정정:
```typescript
// ADR-0151: AI 자체 판단 stock.checklist 보존 (ADR-0011 정책 정합)
institutionalBuying: stock.checklist?.institutionalBuying ?? 0,
supplyInflow: stock.checklist?.supplyInflow ?? 0,
```

효과:
- 신규 매수 시점부터 #4/#12 가 *AI 추정 점수 (1~10)* 영속, 학습 입력 정합
- ADR-0011 정책 (KIS 호출 금지, AI 위임) 그대로 유지 — 정책 변경 0
- 진정한 KIS supply 격상은 ADR-0011 정책 변경 후 별도 ADR

### 2. `buildConditionSourceTiers` 'API' 라벨 부여 폐기

`hasKisSupply=true` 시 `institutionalBuying / supplyInflow` 'API' 라벨 부여 분기 제거. ctx.hasKisSupply 인자는 *후방호환 옵셔널* (호출자 무수정).

```typescript
// 이전:
if (ctx.hasKisSupply) {
  meta.institutionalBuying = 'API';
  meta.supplyInflow = 'API';
}

// ADR-0151: 라벨 부여 분기 제거 — 의미 mismatch (Naver foreignerOwnRatio 정적 % vs
// #4/#12 *흐름* 의미). 호출자가 ctx.hasKisSupply 전달해도 'API' 부여 안 함.
// 진정한 'API' 격상은 ADR-0011 정책 변경 후 별도 ADR + 신규 ctx 필드.
```

효과:
- UI DataQualityBadge 의 'AI_INFERRED' 카운트 19 → 21 (정합)
- main path 'API' 카운트 7 → 5 (DART 5 만), 'COMPUTED' 1 (VCP), 'AI_INFERRED' 19 → 21
- 사용자 인지 정확화 — *KIS supply 가 실제로 작동 안 함* 이라는 silent 거짓말 차단

### 3. audit findings §B 권고 정정 명문화

본 ADR 가 audit findings 의 잘못된 권고를 정정. 후속 PR (Phase 3 globalIntel 합성) 진입 전 audit findings.md 의 §B 갱신 필수 (정확한 코드베이스 상태 반영).

### 4. 진정한 #4/#12 격상 — 후속 ADR

ADR-0011 정책 변경 또는 ADR-0140 Naver 외인 추세 endpoint 신설 후 별도 ADR:

**옵션 A**: ADR-0011 정책 변경 — KIS 수급 호출 제한적 허용 (예: enrichment 1회 호출). KIS quota 영향 평가 + 자동매매 별도 통로 격리 검토 필요.

**옵션 B**: ADR-0140 추세 endpoint 신설 — `GET /api/foreigner-ratio/trend?code=...` HTTP endpoint 신설. 클라이언트 enrichment 가 호출 → `changePct5d > 0 AND sampleSize ≥ 6` 시 #4 supplyInflow 격상. 5d/20d 추세는 *흐름* 의미와 정합. ADR-0011 정책 무영향.

**옵션 C**: 정성 fallback 영구 유지 — 정량 격상 포기. AI 추정만 사용. 사용자 의도와 어긋남.

본 PR 은 결함 차단만, 격상 결정은 후속 ADR.

## 회귀 테스트

기존 `enrichment.dartFinalize.test.ts` + `enrichmentSourceTier.test.ts` 정합 정정:

1. **main path (DART + VCP) → 6 키 격상** (이전: 8 키). hasKisSupply=true 후방호환 인자, 라벨 부여 0.
2. **institutionalBuying / supplyInflow `'AI_INFERRED'` 유지** — hasKisSupply 와 무관.
3. **API 카운트 5 + COMPUTED 1 + AI_INFERRED 21 = 27** (이전: 7+1+19=27).

신규 회귀 테스트 (선택, 본 PR scope 외) — main path 의 stock.checklist 보존 검증 (실제 enrichment 호출은 vi.mock 의존성 큼, 통합 테스트로 격리).

## 영향

### 27 조건 격상 진행도

audit findings §E 가 표기한 *Phase 2 후 59% (16개)* 는 ADR-0011 정책 변경 또는 ADR-0140 endpoint 신설 후에만 가능. 본 PR 후 진행도:

| Phase | 누적 격상 % | 격상 항목 |
|---|---|---|
| Phase 1 (PR-Phase1-DartFinalize) | 52% (14개) | REAL_DATA 9 + DART 5 |
| **Phase 2 (본 PR — silent degradation 차단)** | **52% (14개)** | *동일 — 격상 0 추가, 결함 1건 차단* |
| Phase 2-Real (후속 ADR, KIS 또는 Naver 추세) | 59% (16개) | + #4 supplyInflow, #12 institutionalBuying |
| Phase 3 globalIntel 합성 | 70% (19개) | + #5/#1/#16 |
| Phase 4 외부 컨센서스 | 78% (21개) | + #14/#13 |
| 격상 불가능 (정성) | 100% | 22% (5개) |

→ 본 PR 은 *격상 진행도 변화 없음*. 그러나 *학습 입력의 정확성 회복* 이라는 무형의 가치 — 신규 매수 시점부터 #4/#12 가 AI 추정 점수로 영속.

### LIVE 매매 영향

- ADR-0011 정책 그대로 유지 — KIS supply 호출 0건 변경
- main path 의 0 박제 → AI 추정 보존으로 격상
- 신규 매수 시점부터 #4/#12 학습 가중치 입력 정합 (이전 0 박제 제거)
- 기존 영속 데이터 (ADR-0149 정책 정합) 보존 — 강제 마이그레이션 금지

## ENV 우회

본 PR 미도입. silent degradation 차단은 의무 — ENV 우회 불필요.

## PENDING_WIRING.md 갱신

- **C8 → DECIDED_NOT_WIRING (Phase 2 audit + silent degradation 차단 완료)**: 진정한 KIS supply 격상은 ADR-0011 정책 변경 (옵션 A) 또는 ADR-0140 endpoint 신설 (옵션 B) 후 별도 ADR.
- **신규 항목 C15 (옵션 B 권장 — Naver 외인 추세 endpoint 신설)** P2 등재 — `/api/foreigner-ratio/trend?code=...` HTTP endpoint 신설 + 클라이언트 enrichment 호출 wiring + #4 격상.
- 진행 통계 정합 정정 — C 카테고리 P1=2 (C8 P1 → DECIDED_NOT_WIRING) / P2=7 (C15 신규).
