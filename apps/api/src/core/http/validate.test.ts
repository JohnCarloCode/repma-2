import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import { validate } from './validate.js';

const schema = z.object({
  name: z.string().min(1),
  size: z.object({ label: z.string() }),
});

function catchError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('expected validate to throw');
}

describe('validate (RNF-08, AD-13)', () => {
  it('returns the parsed data when valid', () => {
    expect(validate(schema, { name: 'Tee', size: { label: 'M' } })).toEqual({ name: 'Tee', size: { label: 'M' } });
  });

  it('rejects keys the schema does not declare — whitelist, not strip', () => {
    const err = catchError(() => validate(schema, { name: 'Tee', size: { label: 'M' }, is_available: false }));
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toEqual([{ path: 'is_available', message: 'Unknown field' }]);
  });

  it('reports one issue per field, with nested paths', () => {
    const err = catchError(() => validate(schema, { name: '', size: { label: 42 }, a: 1, b: 2 }));
    const paths = (err.details as { path: string }[]).map((issue) => issue.path).sort();
    expect(paths).toEqual(['a', 'b', 'name', 'size.label']);
  });

  it('keeps refinements and defaults of the schema', () => {
    const withDefault = z.object({ q: z.string().default('x') }).refine((v) => v.q !== 'bad', { path: ['q'], message: 'no' });
    expect(validate(withDefault, {})).toEqual({ q: 'x' });
    expect(catchError(() => validate(withDefault, { q: 'bad' })).details).toEqual([{ path: 'q', message: 'no' }]);
  });
});
