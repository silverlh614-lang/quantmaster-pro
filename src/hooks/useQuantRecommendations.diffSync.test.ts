// @vitest-environment node
/**
 * @responsibility diffWatchlistSync 회귀 — 최초 관측 baseline 처리로 churn(반복 편입) 차단
 */
import { describe, it, expect } from 'vitest';
import { diffWatchlistSync } from './useQuantRecommendations';

describe('diffWatchlistSync — 워치리스트 미러링 델타', () => {
  it('최초 관측(prev=null)은 baseline 만 기록 — 델타 0 (마운트 재미러링 churn 차단)', () => {
    expect(diffWatchlistSync(null, ['147760', '005930'])).toEqual({ added: [], removed: [] });
  });

  it('빈 watchlist 최초 관측도 델타 0', () => {
    expect(diffWatchlistSync(null, [])).toEqual({ added: [], removed: [] });
  });

  it('실제 신규 추가만 added 로 보고', () => {
    expect(diffWatchlistSync(['005930'], ['005930', '147760'])).toEqual({
      added: ['147760'],
      removed: [],
    });
  });

  it('실제 제거만 removed 로 보고', () => {
    expect(diffWatchlistSync(['005930', '147760'], ['005930'])).toEqual({
      added: [],
      removed: ['147760'],
    });
  });

  it('변화 없으면 델타 0 (동기 refetch 로 배열 참조만 바뀐 경우)', () => {
    expect(diffWatchlistSync(['005930', '147760'], ['147760', '005930'])).toEqual({
      added: [],
      removed: [],
    });
  });

  it('피엠티 시나리오 — baseline 에 이미 있으면 재편입 POST 안 함', () => {
    // prev 에 147760 이 이미 있으므로(이전 관측), 다시 와도 added 에 없음 → 재등록 churn 없음.
    expect(diffWatchlistSync(['147760'], ['147760'])).toEqual({ added: [], removed: [] });
  });
});
