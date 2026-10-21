import { describe, expect, it, vi } from 'vitest';
import { CONFLICT_MESSAGE, FORBIDDEN_MESSAGE, parseReviews, saveEventReview } from '../useEventReviews';

const EVENT = '0123456789abcdef';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

describe('saveEventReview', () => {
  it('PUTs { eventId, decision } and returns the stored reviews from the response', async () => {
    const fetchImpl = mockFetch(200, { event_reviews: { [EVENT]: 'dismissed', ffffffffffffffff: 'confirmed' } });
    const result = await saveEventReview('an-1', EVENT, 'dismissed', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/analyses/an-1/event-reviews');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ eventId: EVENT, decision: 'dismissed' });
    // the response is the source of truth, including decisions made elsewhere
    expect(result).toEqual({ ok: true, reviews: { [EVENT]: 'dismissed', ffffffffffffffff: 'confirmed' } });
  });

  it('sends null to clear a decision', async () => {
    const fetchImpl = mockFetch(200, { event_reviews: {} });
    const result = await saveEventReview('an-1', EVENT, null, fetchImpl as unknown as typeof fetch);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ eventId: EVENT, decision: null });
    expect(result).toEqual({ ok: true, reviews: {} });
  });

  it('explains a concurrent write (409)', async () => {
    const result = await saveEventReview('an-1', EVENT, 'confirmed', mockFetch(409, { error: 'x' }) as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, error: CONFLICT_MESSAGE });
    expect(CONFLICT_MESSAGE).toBe('Someone else just changed this analysis; reload to see the latest.');
  });

  it('reports a refused (403) or failed save', async () => {
    expect(await saveEventReview('a', EVENT, 'confirmed', mockFetch(403, { error: 'Forbidden' }) as unknown as typeof fetch)).toEqual({
      ok: false,
      error: FORBIDDEN_MESSAGE,
    });
    expect(await saveEventReview('a', EVENT, 'confirmed', mockFetch(500, { error: 'Failed to save review' }) as unknown as typeof fetch)).toEqual({
      ok: false,
      error: 'Failed to save review',
    });
    const offline = vi.fn(async () => {
      throw new TypeError('network');
    });
    const r = await saveEventReview('a', EVENT, 'confirmed', offline as unknown as typeof fetch);
    expect(r.ok).toBe(false);
  });
});

describe('parseReviews', () => {
  it('keeps only confirmed/dismissed entries', () => {
    expect(parseReviews({ a: 'confirmed', b: 'dismissed', c: 'maybe', d: 1 })).toEqual({ a: 'confirmed', b: 'dismissed' });
    expect(parseReviews(null)).toEqual({});
    expect(parseReviews(['x'])).toEqual({});
  });
});
