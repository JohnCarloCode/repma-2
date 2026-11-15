import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  /** One line under the title (store · headline count); pass it only once the data is there. */
  subtitle?: ReactNode;
  /** The screen's one primary action, already permission-gated by the page. */
  action?: ReactNode;
}

/** components.md §`<PageHeader>`: title + optional subtitle on the left, primary action on the right. */
export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-base">
      <div className="min-w-0">
        <h1 className="text-display">{title}</h1>
        {subtitle && <p className="mt-xs text-body text-text-secondary">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
