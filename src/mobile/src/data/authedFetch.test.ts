import { afterEach, describe, expect, it, vi } from 'vitest';
import { authedFetch, type Authorizer } from './authedFetch';

afterEach(() => vi.unstubAllGlobals());

const reply = (status: number) => new Response('{}', { status });

function authorizer(initial: string | null, refreshed: string | null = null) {
  const calls: string[] = [];
  const auth: Authorizer = {
    token: async () => initial,
    refresh: async (stale) => {
      calls.push(stale);
      return refreshed;
    },
  };
  return { auth, calls };
}

describe('llamadas a la API con token (AC-mobile-004-05 y 11)', () => {
  it('AC-mobile-004-11 envía Authorization: Bearer y nunca X-User-Id', async () => {
    const fetchMock = vi.fn(async () => reply(200));
    vi.stubGlobal('fetch', fetchMock);

    const res = await authedFetch(authorizer('token-1').auth, 'http://api/x', { method: 'GET' });

    expect(res?.status).toBe(200);
    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-1');
    expect(headers['X-User-Id']).toBeUndefined();
  });

  it('AC-mobile-004-11 sin token no envía ninguna llamada', async () => {
    const fetchMock = vi.fn(async () => reply(200));
    vi.stubGlobal('fetch', fetchMock);

    const res = await authedFetch(authorizer(null).auth, 'http://api/x', { method: 'GET' });

    expect(res).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AC-mobile-004-05 ante un 401 renueva el token y repite la llamada una sola vez', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(401))
      .mockResolvedValueOnce(reply(200));
    vi.stubGlobal('fetch', fetchMock);
    const { auth, calls } = authorizer('viejo', 'nuevo');

    const res = await authedFetch(auth, 'http://api/x', { method: 'PUT', body: '{}' });

    expect(res?.status).toBe(200);
    expect(calls).toEqual(['viejo']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect((second.headers as Record<string, string>).Authorization).toBe('Bearer nuevo');
    expect(second.body).toBe('{}');
  });

  it('AC-mobile-004-05 si tras renovar sigue el 401 lo devuelve sin insistir', async () => {
    const fetchMock = vi.fn(async () => reply(401));
    vi.stubGlobal('fetch', fetchMock);

    const res = await authedFetch(authorizer('viejo', 'nuevo').auth, 'http://api/x', { method: 'GET' });

    expect(res?.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('AC-mobile-004-05 si no se puede renovar devuelve el 401 original', async () => {
    const fetchMock = vi.fn(async () => reply(401));
    vi.stubGlobal('fetch', fetchMock);

    const res = await authedFetch(authorizer('viejo', null).auth, 'http://api/x', { method: 'GET' });

    expect(res?.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('AC-mobile-004-05 sin conexión devuelve null (la llamada queda pendiente)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Network request failed'); }));

    const res = await authedFetch(authorizer('token-1').auth, 'http://api/x', { method: 'GET' });

    expect(res).toBeNull();
  });
});
