import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { api, ApiError, NETWORK_ERROR } from './apiClient';

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected the request to fail');
}

describe('apiClient', () => {
  it('calls /api/v1 with the session cookie and returns the JSON body', async () => {
    let seen: Request | undefined;
    server.use(
      http.get('*/api/v1/things', ({ request }) => {
        seen = request;
        return HttpResponse.json({ items: [1] });
      }),
    );

    await expect(api.get('/things')).resolves.toEqual({ items: [1] });
    expect(new URL(seen!.url).pathname).toBe('/api/v1/things');
    expect(seen!.credentials).toBe('include');
  });

  it('sends a JSON body on writes', async () => {
    server.use(
      http.post('*/api/v1/things', async ({ request }) =>
        HttpResponse.json({ type: request.headers.get('content-type'), body: await request.json() }),
      ),
    );

    await expect(api.post('/things', { name: 'x' })).resolves.toEqual({
      type: 'application/json',
      body: { name: 'x' },
    });
  });

  it('resolves undefined on 204', async () => {
    server.use(http.delete('*/api/v1/things/1', () => new HttpResponse(null, { status: 204 })));
    await expect(api.delete('/things/1')).resolves.toBeUndefined();
  });

  it('turns the error envelope into an ApiError', async () => {
    server.use(
      http.post('*/api/v1/things', () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: [{ path: 'name' }] } },
          { status: 400 },
        ),
      ),
    );

    const error = await caught(api.post('/things', {}));
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid body',
      details: [{ path: 'name' }],
    });
  });

  it('still fails with an ApiError when the body is not the envelope', async () => {
    server.use(http.get('*/api/v1/things', () => new HttpResponse('Bad gateway', { status: 502 })));
    expect(await caught(api.get('/things'))).toMatchObject({ status: 502, code: 'HTTP_ERROR' });
  });

  it('reports a network failure as status 0', async () => {
    server.use(http.get('*/api/v1/things', () => HttpResponse.error()));
    expect(await caught(api.get('/things'))).toMatchObject({ status: 0, code: NETWORK_ERROR });
  });
});
