import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import {
  hasPermission,
  REPLENISHMENT_STATUSES,
  updateReplenishmentListBody,
  type ReplenishmentList,
  type ReplenishmentStatus,
  type UpdateReplenishmentListBody,
} from 'shared';
import { useSession } from '../auth/AuthContext';
import { ListStatusBadge } from '../components/ListStatusBadge';
import { ProgressBar } from '../components/ProgressBar';
import { dangerButtonClass, secondaryButtonClass } from '../components/buttons';
import { textAreaClass, textInputClass } from '../components/form';
import { ErrorState } from '../components/list/states';
import { DeleteListModal } from '../components/replenishment/DeleteListModal';
import { ListItems } from '../components/replenishment/ListItems';
import { ApiError, api } from '../lib/apiClient';
import { formatDate, LIST_STATUS_LABEL } from '../lib/format';
import { useToast } from '../lib/toast';
import { useStoreScope } from '../tenant/activeStore';
import type { ReplenishmentLinkState } from './ReplenishmentPage';

const cardClass = 'rounded-md border border-border bg-surface';

type MetaField = 'name' | 'notes';

/** The 400's `details` message for `field`, if the API pinned one there (components.md §Forms). */
function fieldError(error: unknown, field: MetaField): string | undefined {
  if (!(error instanceof ApiError) || error.status !== 400 || !Array.isArray(error.details)) return undefined;
  return (error.details as { path: string; message: string }[]).find((detail) => detail.path === field)?.message;
}

/**
 * One field through the shared PATCH body schema (the API validates with the same one): the
 * normalized body to send (trimmed; blank notes → `null`), or the field's first message.
 */
function parseField(field: MetaField, value: string) {
  const result = updateReplenishmentListBody.safeParse({ [field]: value });
  return { body: result.data, error: result.error?.issues.find((issue) => issue.path[0] === field)?.message };
}

/**
 * replenishment-detail.md §Flows · Metadata edits (RF-28/RF-30): one field per
 * `PATCH /replenishment-lists/:id`. Success → toast "List updated", the answer's
 * metadata written into the detail cache (items are left alone: they belong to the
 * per-item mutations) and the index refetched so its cards stay fresh. Each editor
 * calls its own instance and handles its error (inline 400 or toast + revert).
 */
function useUpdateList(id: string) {
  const scope = useStoreScope();
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: UpdateReplenishmentListBody) =>
      api.patch<ReplenishmentList>(`/replenishment-lists/${id}`, body, scope.request),
    onSuccess: ({ name, notes, status }) => {
      queryClient.setQueryData<ReplenishmentList>(scope.key('replenishment', 'list', id), (current) =>
        current ? { ...current, name, notes, status } : current,
      );
      void queryClient.invalidateQueries({ queryKey: scope.key('replenishment', 'lists') });
      // A status change moves Home's open-lists / pending-items figures.
      void queryClient.invalidateQueries({ queryKey: scope.key('home') });
      toast.success('List updated');
    },
  });
}

/**
 * replenishment-detail.md — one replenishment list: header (back arrow, name, status,
 * "Delete list"), meta line, progress card, notes card, then the items. Everything
 * autosaves (no save button, no dirty state). Without `replenishment:manage` the same
 * layout renders as read-only text (RF-32).
 */
export function ReplenishmentDetailPage() {
  const { id = '' } = useParams();
  const scope = useStoreScope();
  const session = useSession();
  const navigate = useNavigate();
  const listSearch = (useLocation().state as ReplenishmentLinkState | null)?.listSearch ?? '';
  const indexPath = `/replenishment${listSearch}`;

  const list = useQuery({
    queryKey: scope.key('replenishment', 'list', id),
    queryFn: () => api.get<ReplenishmentList>(`/replenishment-lists/${id}`, scope.request),
  });
  const canManage = !!session && hasPermission(session, 'replenishment:manage');
  const [deleting, setDeleting] = useState(false);

  const notFound = list.error instanceof ApiError && list.error.status === 404;
  const backLink = (
    <Link
      to={indexPath}
      aria-label="Back to replenishment"
      className="group inline-flex size-[44px] flex-none items-center justify-center rounded-sm"
    >
      <span className="inline-flex size-[32px] items-center justify-center rounded-sm bg-surface-raised text-text transition-colors group-hover:bg-surface-hover group-hover:text-accent-bright">
        <span className="icon" aria-hidden>
          arrow_back
        </span>
      </span>
    </Link>
  );

  if (list.isPending || list.isError) {
    return (
      <main className="flex flex-col gap-lg">
        <header className="flex items-center gap-sm">{backLink}</header>
        {list.isPending ? (
          <DetailSkeleton />
        ) : notFound ? (
          <ErrorState
            title="List not found"
            action={
              <Link to={indexPath} className={secondaryButtonClass}>
                Back to replenishment
              </Link>
            }
          />
        ) : (
          <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
        )}
      </main>
    );
  }

  const data = list.data;
  const done = data.items.filter((item) => item.isDone).length;

  return (
    <main className="flex flex-col gap-lg">
      <div className="flex flex-col gap-xs">
        {/* One row; on mobile it wraps in the same order: arrow + name, then status and a full-width delete. */}
        <header className="flex flex-wrap items-center gap-sm">
          <div className="flex min-w-0 basis-full items-center gap-sm tablet:flex-1 tablet:basis-0">
            {backLink}
            {canManage ? (
              <NameEditor key={data.name} list={data} />
            ) : (
              <h1 className="min-w-0 text-display break-words">{data.name}</h1>
            )}
          </div>
          <StatusControl list={data} canManage={canManage} />
          {canManage && (
            <button
              type="button"
              onClick={() => setDeleting(true)}
              className={`${dangerButtonClass} w-full tablet:w-auto`}
            >
              <span className="icon" aria-hidden>
                delete
              </span>
              Delete list
            </button>
          )}
        </header>
        <p className="text-caption text-text-secondary tabular-nums">
          Created {formatDate(data.createdAt)} · {data.creatorName ?? '—'}
        </p>
      </div>

      {data.items.length > 0 && <ProgressCard list={data} done={done} canManage={canManage} />}
      <NotesCard key={data.notes ?? ''} list={data} canManage={canManage} />

      <ListItems list={data} canManage={canManage} indexPath={indexPath} />

      {canManage && (
        <DeleteListModal
          list={deleting ? { id: data.id, name: data.name } : null}
          onClose={() => setDeleting(false)}
          onDeleted={() => navigate(indexPath, { replace: true })}
        />
      )}
    </main>
  );
}

/**
 * The list name as the page title, click-to-edit: the heading holds a button; clicking it
 * swaps in an input that saves on blur (Enter blurs, Escape cancels). Unchanged → no request;
 * invalid (blank) → inline error, no request, the field stays open for correction; a 400 does
 * the same with the API's message; any other error → toast and back to the server's name.
 * Remounted (`key`) whenever the server name changes, so it always starts from it.
 */
function NameEditor({ list }: { list: ReplenishmentList }) {
  const update = useUpdateList(list.id);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(list.name);
  const [error, setError] = useState<string>();
  const cancelled = useRef(false);

  const save = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const { body, error: invalid } = parseField('name', draft);
    if (!body) return setError(invalid);
    setError(undefined);
    setEditing(false);
    if (body.name === list.name) return setDraft(list.name);
    update.mutate(body, {
      onError: (err) => {
        const inline = fieldError(err, 'name');
        if (inline) {
          setError(inline);
          setEditing(true);
        } else {
          toast.error(err);
          setDraft(list.name);
        }
      },
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      cancelled.current = true;
      setDraft(list.name);
      setError(undefined);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-xs">
        <input
          // Focus lands in the field the moment it replaces the title.
          autoFocus
          onFocus={(e: FocusEvent<HTMLInputElement>) => e.currentTarget.select()}
          aria-label="List name"
          value={draft}
          maxLength={120}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={onKeyDown}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'list-name-error' : undefined}
          className={`${textInputClass} text-display`}
        />
        {error && (
          <span id="list-name-error" className="text-caption text-alert">
            {error}
          </span>
        )}
      </div>
    );
  }

  // While the PATCH is in flight the title already shows the new name, dimmed.
  return (
    <h1 className="min-w-0 text-display">
      <button
        type="button"
        title="Rename list"
        onClick={() => {
          cancelled.current = false;
          setEditing(true);
        }}
        className={`group inline-flex max-w-full items-center gap-sm rounded-sm text-left break-words hover:text-accent-bright ${update.isPending ? 'opacity-60' : ''}`}
      >
        <span className="min-w-0">{(update.isPending && update.variables.name) || list.name}</span>
        <span className="icon flex-none text-text-secondary group-hover:text-accent-bright" aria-hidden>
          edit
        </span>
      </button>
    </h1>
  );
}

/**
 * The list's state (RF-30): the badge, and for editors the adjacent select with all three
 * statuses — any transition, no state machine. It shows the picked status while the PATCH
 * is in flight; an error toasts and falls back to the server's status.
 */
function StatusControl({ list, canManage }: { list: ReplenishmentList; canManage: boolean }) {
  const update = useUpdateList(list.id);
  const toast = useToast();
  const shown = (update.isPending && update.variables.status) || list.status;

  return (
    <div className="flex items-center gap-sm">
      <ListStatusBadge status={shown} />
      {canManage && (
        <select
          aria-label="Status"
          value={shown}
          onChange={(e) =>
            update.mutate({ status: e.target.value as ReplenishmentStatus }, { onError: (err) => toast.error(err) })
          }
          className={`${textInputClass} w-auto pr-xl`}
        >
          {REPLENISHMENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {LIST_STATUS_LABEL[status]}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/**
 * The progress card (replenishment-detail.md §Content): `<ProgressBar>` from the loaded items,
 * and at 100% on a list that isn't `done` the hint "All items done." with the tertiary
 * "Mark list as done" — the same status PATCH as the header select, never fired by itself
 * (RF-30/RF-40). The consumer hides the card when there are no items.
 */
function ProgressCard({ list, done, canManage }: { list: ReplenishmentList; done: number; canManage: boolean }) {
  const update = useUpdateList(list.id);
  const toast = useToast();
  const total = list.items.length;
  const complete = done === total && list.status !== 'done';

  return (
    <section aria-label="Progress" className={`${cardClass} flex flex-col gap-base p-card`}>
      <ProgressBar done={done} total={total} />
      {complete && (
        <p className="flex flex-wrap items-center gap-x-sm text-body text-text-secondary">
          All items done.
          {canManage && (
            <button
              type="button"
              disabled={update.isPending}
              onClick={() => update.mutate({ status: 'done' }, { onError: (err) => toast.error(err) })}
              className="text-body-medium text-accent-bright hover:underline disabled:opacity-45"
            >
              Mark list as done
            </button>
          )}
        </p>
      )}
    </section>
  );
}

/**
 * The notes card: a textarea saving on blur when the (trimmed) value changed — blank clears
 * the notes (`null`) — or plain text without `replenishment:manage`. A 400 shows inline with
 * the text kept; any other error toasts and restores the server's notes.
 * Remounted (`key`) whenever the server notes change.
 */
function NotesCard({ list, canManage }: { list: ReplenishmentList; canManage: boolean }) {
  const update = useUpdateList(list.id);
  const toast = useToast();
  const saved = list.notes ?? '';
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string>();

  const save = () => {
    const { body, error: invalid } = parseField('notes', draft);
    if (!body) return setError(invalid);
    setError(undefined);
    if (body.notes === list.notes) return;
    update.mutate(body, {
      onError: (err) => {
        const inline = fieldError(err, 'notes');
        if (inline) return setError(inline);
        toast.error(err);
        setDraft(saved);
      },
    });
  };

  return (
    <section aria-labelledby="notes-heading" className={`${cardClass} flex flex-col gap-sm p-card`}>
      {canManage ? (
        <>
          <label id="notes-heading" htmlFor="list-notes" className="text-body-medium text-text">
            Notes
          </label>
          <textarea
            id="list-notes"
            value={draft}
            maxLength={2000}
            placeholder="Add notes for this list…"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'list-notes-error' : undefined}
            className={textAreaClass}
          />
          {error && (
            <span id="list-notes-error" className="text-caption text-alert">
              {error}
            </span>
          )}
        </>
      ) : (
        <>
          <h2 id="notes-heading" className="text-body-medium text-text">
            Notes
          </h2>
          <p className={`text-body whitespace-pre-line ${list.notes ? 'text-text' : 'text-text-secondary'}`}>
            {list.notes ?? 'No notes.'}
          </p>
        </>
      )}
    </section>
  );
}

/** Loading: the header line and the two summary cards in static blocks (components.md §Async states). */
function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-lg">
      <div className="flex flex-col gap-sm">
        <div className="h-[28px] w-2/3 max-w-[360px] rounded-sm bg-surface-raised" />
        <div className="h-[12px] w-[200px] rounded-sm bg-surface-raised" />
      </div>
      <div className={`${cardClass} flex flex-col gap-sm p-card`}>
        <div className="h-[14px] w-[120px] rounded-sm bg-surface-raised" />
        <div className="h-[8px] w-full rounded-full bg-surface-raised" />
      </div>
      <div className={`${cardClass} h-[160px] p-card`}>
        <div className="h-[14px] w-[80px] rounded-sm bg-surface-raised" />
      </div>
    </div>
  );
}
