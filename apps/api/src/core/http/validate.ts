import type { z } from 'zod';
import { AppError } from '../errors.js';

export interface FieldIssue {
  path: string;
  message: string;
}

// RNF-08 / AD-13 — the controller's single entry point for body/query/params.
// Whitelisting is enforced HERE, not remembered by each schema: the object is
// parsed in strict mode, so any key the schema doesn't declare (e.g. a stray
// `is_available` on a write — RF-22, RN-05) is a 400, never silently passed
// through. Every issue maps to one `{ path, message }` entry in the error
// envelope's `details`, so the client can mark the exact field.
export function validate<S extends z.ZodObject>(schema: S, data: unknown): z.output<S> {
  const result = schema.strict().safeParse(data);
  if (result.success) {
    return result.data as z.output<S>;
  }
  throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', toFieldIssues(result.error.issues));
}

function toFieldIssues(issues: z.core.$ZodIssue[]): FieldIssue[] {
  return issues.flatMap((issue) => {
    const base = issue.path.map(String);
    if (issue.code === 'unrecognized_keys') {
      // Zod reports all unknown keys as one issue on the parent; split it per field.
      return issue.keys.map((key) => ({ path: [...base, key].join('.'), message: 'Unknown field' }));
    }
    return [{ path: base.join('.'), message: issue.message }];
  });
}
