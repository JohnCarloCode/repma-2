import { Link } from 'react-router';
import { useSession } from '../auth/AuthContext';
import { roleHome } from '../auth/session';

/** design/pages/unauthorized.md — no queries; reads the loaded session only. */
export function UnauthorizedPage() {
  const home = roleHome(useSession());

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-base p-base text-center">
      <span className="icon text-text-secondary" aria-hidden>
        lock
      </span>
      <h1 className="text-display">Unauthorized access</h1>
      <p className="text-text-secondary">You don&apos;t have permission to view this page.</p>
      <Link
        to={home.path}
        className="flex h-[44px] items-center rounded-sm bg-accent px-base text-body-medium text-on-accent transition-colors hover:bg-accent-hover active:bg-accent-active"
      >
        {home.label}
      </Link>
    </main>
  );
}
