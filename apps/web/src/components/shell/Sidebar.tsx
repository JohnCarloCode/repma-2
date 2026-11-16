import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react';
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import type { AuthSession } from 'shared';
import { Tooltip } from '../Tooltip';
import { Wordmark } from '../Wordmark';
import { NAV, navSections, type NavItem } from './nav';
import { TenantBlock } from './TenantBlock';
import { UserMenu } from './UserMenu';
import { useSidebarCollapsed } from './useShellLayout';

const iconButton =
  'flex size-[44px] shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-surface-hover hover:text-text';

function NavEntry({ item, rail }: { item: NavItem; rail: boolean }) {
  // NavLink matches by prefix, so /availability/:id keeps "Availability" active (and sets aria-current).
  // Collapsed: icon only, the label stays as the accessible name and shows as a tooltip.
  return (
    <li>
      <Tooltip content={rail ? item.label : null}>
        <NavLink
          to={item.to}
          className={({ isActive }) =>
            `group flex h-[44px] items-center rounded-full text-body-medium transition-colors ${
              rail ? 'w-[44px] justify-center' : 'gap-3 px-3'
            } ${isActive ? 'bg-accent-soft text-text' : 'text-text-secondary hover:bg-surface-hover hover:text-text'}`
          }
        >
          <span className="icon shrink-0 group-aria-[current=page]:text-accent-bright" aria-hidden>
            {item.icon}
          </span>
          <span className={rail ? 'sr-only' : 'truncate'}>{item.label}</span>
        </NavLink>
      </Tooltip>
    </li>
  );
}

/**
 * The sidebar's content, shared by the rail/panel and the mobile drawer
 * (layout.md §Sidebar): wordmark → tenant context block → nav sections (only
 * the nav scrolls) → user menu. `rail` = collapsed icon-only; `onClose` adds
 * the drawer's close button to the top row.
 */
function SidebarBody({ session, rail, onClose }: { session: AuthSession; rail: boolean; onClose?: () => void }) {
  return (
    <>
      {/* The logo tile keeps its x in both states: rail content starts 2px further in
          (14px padding) so it lines up with the expanded 16px padding. */}
      <div className={`flex min-h-[44px] items-center justify-between ${rail ? 'pl-[2px]' : ''}`}>
        <Wordmark compact={rail} />
        {onClose && (
          <button type="button" aria-label="Close navigation" onClick={onClose} className={`${iconButton} text-text`}>
            <span className="icon" aria-hidden>
              close
            </span>
          </button>
        )}
      </div>
      <TenantBlock session={session} rail={rail} />
      <nav aria-label="Main" className="-mx-xs flex min-h-0 flex-1 flex-col gap-lg overflow-y-auto px-xs">
        {navSections(session, NAV).map((section) =>
          section.title ? (
            // Collapsed: the section header gives way to the hairline divider (kept for screen readers).
            <div key={section.title} className="border-t border-border pt-lg">
              <h2
                id={`nav-${section.title}`}
                className={rail ? 'sr-only' : 'px-3 pb-sm text-label text-text-secondary'}
              >
                {section.title}
              </h2>
              <ul aria-labelledby={`nav-${section.title}`} className="flex flex-col gap-xs">
                {section.items.map((item) => (
                  <NavEntry key={item.to} item={item} rail={rail} />
                ))}
              </ul>
            </div>
          ) : (
            <ul key="main" className="flex flex-col gap-xs">
              {section.items.map((item) => (
                <NavEntry key={item.to} item={item} rail={rail} />
              ))}
            </ul>
          ),
        )}
      </nav>
      <UserMenu session={session} rail={rail} />
    </>
  );
}

/**
 * Tablet/desktop sidebar (layout.md §Collapse / expand, §Responsive): 248px
 * expanded / 72px rail, width animated.
 * - desktop: the toggle flips the persisted `sidebarCollapsed` preference and
 *   the content reflows;
 * - tablet: always starts as the rail; the toggle expands the panel in place
 *   over a scrim (the 72px flow box never grows, so the content never
 *   reflows); it re-collapses on navigation or outside click.
 * The overlay is "open on this location": any navigation closes it.
 */
export function Sidebar({ session, mode }: { session: AuthSession; mode: 'tablet' | 'desktop' }) {
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const { key } = useLocation();
  const [openOn, setOpenOn] = useState<string | null>(null);

  const overlayOpen = mode === 'tablet' && openOn === key;
  const rail = mode === 'tablet' ? !overlayOpen : collapsed;
  const flowRail = mode === 'tablet' || collapsed;
  const toggle = mode === 'tablet' ? () => setOpenOn(overlayOpen ? null : key) : toggleCollapsed;

  return (
    <>
      {overlayOpen && (
        <div
          aria-hidden
          data-testid="sidebar-scrim"
          className="fixed inset-0 z-shell-overlay bg-scrim"
          onClick={() => setOpenOn(null)}
        />
      )}
      <div
        className={`sticky top-0 h-screen shrink-0 transition-[width] duration-base ${flowRail ? 'w-[72px]' : 'w-[248px]'} ${
          overlayOpen ? 'z-shell-panel' : 'z-shell'
        }`}
      >
        <aside
          className={`absolute inset-y-0 left-0 flex flex-col gap-lg overflow-hidden border-r border-border bg-surface py-base transition-[width] duration-base ${
            rail ? 'w-[72px] px-[14px]' : 'w-[248px] px-base'
          }`}
        >
          <SidebarBody session={session} rail={rail} />
        </aside>
        {/* Straddles the sidebar's right edge at the logo's height, in both states; it lives
            outside the aside (overflow-hidden) and follows its width. 44px hit area, 32px circle. */}
        <button
          type="button"
          aria-expanded={!rail}
          aria-label={rail ? 'Expand menu' : 'Collapse menu'}
          onClick={toggle}
          className={`group absolute top-base flex size-[44px] items-center justify-center rounded-full transition-[left] duration-base ${
            rail ? 'left-[50px]' : 'left-[226px]'
          }`}
        >
          <span className="flex size-8 items-center justify-center rounded-full border border-border-strong bg-surface-raised text-text-secondary transition-colors group-hover:bg-border-strong group-hover:text-text">
            <span className="icon" aria-hidden>
              {rail ? 'chevron_right' : 'chevron_left'}
            </span>
          </span>
        </button>
      </div>
    </>
  );
}

/**
 * Mobile (< 744px, layout.md §Mobile header, §Responsive): a fixed 56px header
 * whose only content is the hamburger, opening the sidebar as an off-canvas
 * drawer (always full labels, no toggle) over its scrim — both in the shell
 * band, below dialogs. Closes via its close button, outside tap, Escape or
 * any navigation.
 */
export function MobileNav({ session }: { session: AuthSession }) {
  const { key } = useLocation();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === key;
  const close = () => setOpenOn(null);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-shell flex h-[56px] items-center border-b border-border bg-surface px-sm">
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpenOn(key)}
          className={`${iconButton} text-text`}
        >
          <span className="icon" aria-hidden>
            menu
          </span>
        </button>
      </header>
      <Dialog open={open} onClose={close} aria-label="Navigation">
        <DialogBackdrop
          transition
          className="fixed inset-0 z-shell-overlay bg-scrim transition-opacity duration-base data-closed:opacity-0"
        />
        <DialogPanel
          transition
          className="fixed inset-y-0 left-0 z-shell-panel flex w-[248px] flex-col gap-lg border-r border-border bg-surface p-base transition-transform duration-base data-closed:-translate-x-full"
        >
          <SidebarBody session={session} rail={false} onClose={close} />
        </DialogPanel>
      </Dialog>
    </>
  );
}
