# Validation Hooks

이 디렉토리는 빌드/커밋/푸시 단계에서 품질·보안을 강제하는 스크립트 묶음입니다.
모든 스크립트는 ESM(`type: "module"`)이며 Node 20 이상에서 실행합니다.

## 설치

```bash
npm install
npm run install:hooks   # .git/hooks/pre-commit 생성
```

## 스크립트 개요

| 스크립트 | 이름 | 역할 |
| --- | --- | --- |
| `check_complexity.js` + `refactor_suggester.js` | ACMA | `App.tsx` 등 대형 파일의 라인/JSX 깊이/useEffect/import 수를 측정하여 한계치 초과 시 실패. SUGGEST=1 설정 시 분리 후보 자동 제안. |
| `silent_degradation_sentinel.js` | SDS | 전 코드베이스의 AI 모델 문자열이 `AI_MODELS` 상수와 다르면 실패. 로깅 없이 삼켜지는 `catch` 블록 검출. |
| `scan_exposure.js` | PRES | `grep_output.txt`, `.env*`, API 키/앱 URL 패턴, 과거 커밋 히스토리 내 민감 파일까지 검사. |
| `check_responsibility.js` | SRP | 모든 `.ts/.tsx` 상단 `@responsibility` 한 문장 주석 강제. "and/or/또는" 접속사나 25단어 초과 시 SRP 위반. |
| `validate_gemini_calls.js` | (기존) | Gemini `responseMimeType × googleSearch` 충돌 검사. |

## 한계치

| 지표 | 한계 | 위치 |
| --- | --- | --- |
| 파일 라인 수 | 1500 | `check_complexity.js` `LIMITS.lines` |
| JSX 최대 깊이 | 12 | `LIMITS.jsxDepth` |
| `useEffect` 개수 | 10 | `LIMITS.useEffects` |
| `import` 개수 | 50 | `LIMITS.imports` |
| `@responsibility` 단어 수 | 25 | `check_responsibility.js` `MAX_WORDS` |

## NPM 스크립트

```bash
npm run validate:gemini
npm run validate:complexity       # ACMA
npm run validate:sds              # SDS
npm run validate:exposure         # PRES
npm run validate:responsibility   # SRP (warn)
npm run validate:all              # 전부

npm run precommit                 # pre-commit 에서 실제 실행되는 묶음
```

## 무시 규칙

- `check_responsibility.js` 는 `*.d.ts`, `*.test.ts(x)`, `*.spec.ts(x)` 를 건너뜁니다.
- `silent_degradation_sentinel.js` 의 catch 검출에서 의도적으로 무시하려면 `catch (e) { /* SDS-ignore */ }` 형태로 주석을 추가하세요.
- `scan_exposure.js` 는 `.env.example` 은 허용합니다.

## CI

`.github/workflows/validation-hooks.yml` 에서 각 스크립트를 개별 job으로 실행합니다.
`SRP` 만 `continue-on-error: true` 로 설정되어 있어 점진적으로 `@responsibility`
주석을 추가하는 동안에도 PR이 막히지 않습니다. 성숙 단계에서 `continue-on-error` 를
제거해 hard-fail 로 승격시키세요.
