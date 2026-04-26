/**
 * @responsibility node 환경에서 localStorage 부재 시 in-memory mock 부착 — 테스트 헬퍼
 *
 * PR-K (리팩토링): regimeMemoryBank / learningShadowModel 테스트 등 localStorage
 * 직접 호출이 필요한 모듈의 중복 mock 코드 통합.
 */

interface MockLocalStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  clear(): void;
}

/**
 * node env 에서만 mock 부착. jsdom env 면 no-op.
 * 멱등 — 여러 번 호출해도 store 가 reset 되지 않음 (호출자가 명시적으로 .clear()).
 */
export function attachMockLocalStorage(): MockLocalStorage | null {
  if (typeof globalThis.window !== 'undefined') return null;
  const store = new Map<string, string>();
  const mock: MockLocalStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = { localStorage: mock };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).localStorage = mock;
  return mock;
}
