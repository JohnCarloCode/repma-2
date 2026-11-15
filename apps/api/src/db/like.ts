// `search` is a substring, never a pattern: LIKE's metacharacters are escaped
// before the value is wrapped for an `ILIKE` contains-match.
export function containsPattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, '\\$&')}%`;
}
