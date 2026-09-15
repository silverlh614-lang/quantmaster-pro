// @responsibility Verify OpenDART request parameters across existing entry points.
import { afterEach, expect, it, vi } from 'vitest';
import { fastDartCheck, pollDartDisclosures } from './dartPoller.js';
import router from '../routes/dartRouter.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('uses Korean morning dates with documented date sorting in both pollers', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-15T23:10:00Z')); vi.stubEnv('DART_API_KEY', 'test-key');
  const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ status: '013' }) }); vi.stubGlobal('fetch', fetchMock);
  await pollDartDisclosures(); await fastDartCheck();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const [url] of fetchMock.mock.calls) {
    const params = new URL(url).searchParams;
    expect(params.get('sort')).toBe('date'); expect(params.get('bgn_de')).toBe('20260916');
  }
});
it.each([undefined, '', 'B001'])('uses the correct provider field for list filter %s', async (filter) => {
  vi.stubEnv('DART_API_KEY', 'test-key');
  const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ status: '013' }) }); vi.stubGlobal('fetch', fetchMock);
  const layer = router.stack.find((item: any) => item.route?.path === '/list') as any;
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  await layer.route.stack[0].handle({ query: { bgn_de: '20260915', end_de: '20260916', pblntf_ty: filter } }, res);
  const params = new URL(fetchMock.mock.calls[0][0]).searchParams;
  expect(params.get('sort')).toBe('date'); expect(params.get('pblntf_ty')).toBe(filter === undefined ? 'B' : null);
  expect(params.get('pblntf_detail_ty')).toBe(filter === 'B001' ? 'B001' : null);
  expect(res.json).toHaveBeenCalledWith({ status: '013' });
});
