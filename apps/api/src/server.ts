import { PACKAGE_NAME } from 'shared';

// Placeholder bootstrap — replaced by the Express app in sub-task 1.5.
export function describeService(): string {
  return `api (depends on "${PACKAGE_NAME}")`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(describeService());
}
