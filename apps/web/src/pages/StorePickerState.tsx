import { StoreSelector } from '../components/shell/TenantBlock';

/**
 * layout.md §Tenant context block: a store route opened by the platform admin
 * with no store selected renders this instead of a broken page or a silent 400
 * — the same selector as the sidebar's; picking a store renders the route.
 */
export function StorePickerState() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-base p-base text-center">
      <span className="icon text-text-secondary" aria-hidden>
        storefront
      </span>
      <div>
        <h1 className="text-h2">Select a store to continue</h1>
        <p className="mt-sm text-text-secondary">This view depends on the active store. Pick one to load its data.</p>
      </div>
      <div className="w-full max-w-[320px]">
        <StoreSelector />
      </div>
    </main>
  );
}
