import type { ReactNode } from 'react';
import { Link, Navigate } from 'react-router';
import type { AvailabilitySize } from 'shared';
import { useSession } from '../auth/AuthContext';
import { roleHome } from '../auth/session';
import { AgingFigure, SizeRun } from '../components/availability/SizeRun';
import { Wordmark } from '../components/Wordmark';
import { primaryButtonClass, textButtonClass } from '../components/buttons';

/** The seed users (database.md §9) and their demo-only public password (README, landing.md). */
const DEMO_PASSWORD = 'repma-demo-2026';
const DEMO_ACCOUNTS = [
  { label: 'Platform Admin · all stores', email: 'admin@repma.demo' },
  { label: 'Manager · Downtown Store', email: 'manager.downtown@repma.demo' },
  { label: 'Employee · Downtown Store', email: 'employee.downtown@repma.demo' },
  { label: 'Manager · North Store', email: 'manager.north@repma.demo' },
  { label: 'Employee · North Store', email: 'employee.north@repma.demo' },
] as const;

const BUILT = [
  {
    title: 'Tenant isolation in the database',
    body: 'Every store shares one schema, isolated by PostgreSQL Row-Level Security that is forced on every tenant table and fed per transaction by the API. Isolation tests run in CI and fail the build on any cross-store leak.',
  },
  {
    title: 'An immutable availability log',
    body: 'A size changes state only by appending an “Out of stock” or “Restocked” event. Nothing edits the flag directly, and no stock quantity is ever stored or shown.',
  },
  {
    title: 'Authorization by permission',
    body: 'One role-to-permission matrix, shared by the API and the UI. Routes, menus and actions check permissions, never role names.',
  },
  {
    title: 'Tested and deployed',
    body: 'TypeScript end to end. Unit and integration tests run against a real Postgres with RLS; GitHub Actions gates every change, and merges to main deploy automatically.',
  },
] as const;

const DAY_MS = 86_400_000;

/** The illustrative run (landing.md §Two jobs): 38–43, size 41 out of stock for 9 days. Static, no API. */
function exampleRun(): { sizes: AvailabilitySize[]; since: string } {
  const since = new Date(Date.now() - 9 * DAY_MS).toISOString();
  const sizes = ['38', '39', '40', '41', '42', '43'].map((label) => ({
    id: `example-${label}`,
    sizeId: `example-${label}`,
    label,
    sku: `EX-${label}`,
    isAvailable: label !== '41',
    isActive: true,
    latestEventAt: label === '41' ? since : null,
  }));
  return { sizes, since };
}

const card = 'rounded-md border border-border bg-surface p-card';

function JobCard({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <article className={`${card} flex flex-col gap-sm`}>
      <div className="flex items-center gap-sm">
        <span className="icon text-accent-bright" aria-hidden>
          {icon}
        </span>
        <h3 className="text-h2">{title}</h3>
      </div>
      {children}
    </article>
  );
}

/** design/pages/landing.md — public pitch (DP-01); a signed-in visitor goes to their role home. */
export function LandingPage() {
  const session = useSession();
  if (session) return <Navigate to={roleHome(session).path} replace />;

  const run = exampleRun();

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-xxl px-base py-lg tablet:px-lg">
        <header className="flex items-center justify-between gap-base">
          <Wordmark letterTile />
          <Link to="/login" className={textButtonClass}>
            Sign in
          </Link>
        </header>

        <main className="flex flex-col gap-xxl">
          <section
            aria-labelledby="landing-title"
            className="grid items-start gap-lg tablet:grid-cols-[minmax(0,1fr)_minmax(0,360px)]"
          >
            <div className="flex flex-col items-start gap-base">
              <p className="text-label text-text-secondary">Availability &amp; replenishment for multi-store retail</p>
              <h1 id="landing-title" className="text-display">
                Know which sizes are missing — without counting stock.
              </h1>
              <p className="max-w-[60ch] text-text-secondary">
                REPMA is a multi-tenant web app for sports retail stores. Staff flag the sizes that are out of stock
                and see how long each one has been missing; separately, they keep manual lists of what to bring out
                from the stockroom. A platform admin runs the stores, the users and the shared catalog.
              </p>
              <Link to="/login" className={primaryButtonClass}>
                Sign in to the demo
              </Link>
            </div>

            <section aria-labelledby="demo-accounts" className={`${card} flex flex-col gap-base`}>
              <h2 id="demo-accounts" className="text-h2">
                Demo accounts
              </h2>
              <p>
                Every account uses the password{' '}
                <code className="select-all whitespace-nowrap rounded-sm bg-surface-raised px-xs font-mono text-data">
                  {DEMO_PASSWORD}
                </code>
              </p>
              <ul className="flex flex-col divide-y divide-border">
                {DEMO_ACCOUNTS.map(({ label, email }) => (
                  <li key={email} className="flex flex-col gap-[2px] py-sm first:pt-0 last:pb-0">
                    <span className="text-caption text-text-secondary">{label}</span>
                    <span className="select-all font-mono text-data [overflow-wrap:anywhere]">{email}</span>
                  </li>
                ))}
              </ul>
              <p className="text-caption text-text-secondary">
                Admins manage stores, users and the global catalog. Managers also curate their store&apos;s
                assortment; employees flag sizes and work the lists. This is a shared public demo — other visitors
                may change the data.
              </p>
            </section>
          </section>

          <section aria-labelledby="landing-jobs" className="flex flex-col gap-base">
            <h2 id="landing-jobs" className="text-h2">
              Two jobs, kept apart
            </h2>
            <p className="max-w-[60ch] text-text-secondary">
              An out-of-stock flag and a replenishment list answer different questions, so neither is ever generated
              from the other.
            </p>
            <div className="grid gap-base tablet:grid-cols-2">
              <JobCard icon="inventory_2" title="Availability">
                <p className="text-text-secondary">
                  Out of stock means gone from the whole store, stockroom included. Staff flag a size from the floor,
                  everyone sees it at once, and the time since the flag sets its emphasis — a few hours is normal
                  churn, a week is a failure nobody noticed. Every change is an event in an append-only history.
                </p>
                <div className="mt-sm flex flex-col gap-sm rounded-sm bg-canvas p-base">
                  <span className="text-caption text-text-secondary">Example</span>
                  <div className="flex flex-wrap items-center justify-between gap-base">
                    <SizeRun sizes={run.sizes} label="Example sizes" />
                    <AgingFigure since={run.since} />
                  </div>
                </div>
              </JobCard>
              <JobCard icon="list_alt" title="Replenishment">
                <p className="text-text-secondary">
                  A list is written by staff walking the floor: what the sales area needs from a stockroom that does
                  have it. Lists are manual on purpose — generating them from out-of-stock flags would ask the
                  stockroom for exactly what it doesn&apos;t have.
                </p>
              </JobCard>
            </div>
          </section>

          <section aria-labelledby="landing-built" className="flex flex-col gap-base">
            <h2 id="landing-built" className="text-h2">
              How it&apos;s built
            </h2>
            <div className="grid gap-base tablet:grid-cols-2">
              {BUILT.map(({ title, body }) => (
                <article key={title} className={`${card} flex flex-col gap-sm`}>
                  <h3 className="text-h2">{title}</h3>
                  <p className="text-text-secondary">{body}</p>
                </article>
              ))}
            </div>
            <p className="text-caption text-text-secondary">
              TypeScript · Node.js + Express · PostgreSQL on Supabase · Drizzle ORM · React · TanStack Query · Tailwind
              CSS
            </p>
          </section>
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-sm border-t border-border pt-lg text-caption text-text-secondary">
          <span>REPMA is a portfolio project built to demonstrate engineering quality.</span>
          <a
            href="https://github.com/JohnCarloCode/repma-2"
            className="rounded-sm text-accent-bright underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-bright"
          >
            Source code on GitHub
          </a>
        </footer>
      </div>
    </div>
  );
}
