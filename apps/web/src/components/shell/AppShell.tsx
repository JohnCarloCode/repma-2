import { Outlet } from 'react-router';
import { useSession } from '../../auth/AuthContext';
import { MobileNav, Sidebar } from './Sidebar';
import { useShellMode } from './useShellLayout';

/**
 * Layout route for every authenticated page (layout.md §Structure): the
 * sidebar plus the content area (24px padding — 16px on mobile, below the
 * fixed 56px mobile header; max 1440px). Without a session it renders the page
 * bare — only /unauthorized reaches it that way; guarded routes redirect to
 * /login first. Pages fill the column with `flex-1`.
 */
export function AppShell() {
  const session = useSession();
  const mode = useShellMode();

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col bg-canvas">
        <Outlet />
      </div>
    );
  }
  return (
    <div className="flex min-h-screen bg-canvas">
      {mode === 'mobile' ? <MobileNav session={session} /> : <Sidebar session={session} mode={mode} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className={`mx-auto flex w-full max-w-[1440px] flex-1 flex-col ${
            mode === 'mobile' ? 'px-base pt-[72px] pb-base' : 'p-lg'
          }`}
        >
          <Outlet />
        </div>
      </div>
    </div>
  );
}
