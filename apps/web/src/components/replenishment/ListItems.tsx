import { useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  updateReplenishmentListItemBody,
  type ReplenishmentList,
  type ReplenishmentListItem,
  type UpdateReplenishmentListItemBody,
} from "shared";
import { ApiError, api } from "../../lib/apiClient";
import { sizeName } from "../../lib/format";
import { useToast } from "../../lib/toast";
import { useStoreScope } from "../../tenant/activeStore";
import { ProductPicker, type PickerSelection } from "../ProductPicker";
import { secondaryButtonClass } from "../buttons";
import { textInputClass } from "../form";
import { DataTable, RowAction, type Column } from "../list/DataTable";
import {
  FilterBand,
  SearchField,
  filterControlClass,
} from "../list/FilterBand";
import { EmptyState } from "../list/states";
import { useListParams } from "../list/useListParams";

type Item = ReplenishmentListItem;
type ItemWrite =
  { kind: "patch"; body: UpdateReplenishmentListItemBody } | { kind: "delete" };

/** Per-item write state while that item has a request in flight or waiting. */
interface Slot {
  /** The item as the server last confirmed it: what an error reverts to, and what "Undo" re-adds. */
  confirmed: Item;
  inFlight: boolean;
  /** The write waiting for the in-flight one: PATCH changes merged (latest value per field wins), or the removal. */
  next?: ItemWrite;
  /** Where a removed row stood, to put it back if the DELETE fails or is undone. */
  removedAt?: number;
}

/** An insertion position, or how to find it in the current items for the item being inserted. */
type At = number | ((items: Item[], item: Item) => number);

const isNotFound = (error: unknown) =>
  error instanceof ApiError && error.status === 404;

/**
 * Where an added item goes so the product grouping holds (RF-26): among its product's rows in the
 * size run's order (`sizeOrder`, the picked product's sizeIds), or — a product new to the list —
 * before the first product whose name sorts after it. The settling refetch has the last word.
 */
function insertionIndex(items: Item[], added: Item, sizeOrder: string[]) {
  const rank = (item: Item) => sizeOrder.indexOf(item.sizeId);
  const siblings = items.flatMap((item, index) =>
    item.product.id === added.product.id ? [index] : [],
  );
  if (siblings.length > 0)
    return (
      siblings.find((index) => rank(items[index]!) > rank(added)) ??
      siblings.at(-1)! + 1
    );
  const next = items.findIndex(
    (item) => item.product.name.localeCompare(added.product.name) > 0,
  );
  return next === -1 ? items.length : next;
}

/**
 * replenishment-detail.md §Flows — the per-item autosave writes (RF-28/RF-40), optimistic on the
 * detail cache. **One in-flight request per item**: an edit made while that item's request is
 * pending is queued — PATCH changes merge so the latest value of each field wins — and sent when
 * it settles, so requests never race out of order; a removal replaces whatever was queued and
 * waits for the in-flight PATCH too. Success is silent (the RF-36 exception) except the removal's
 * "Undo" toast. Errors toast; a 404 ("Item not found") lets the refetch drop the row, anything
 * else reverts the item to the server's last answer. Once no item write is in flight, the detail
 * and the index cards (counts) are refetched — not earlier, so a refetch never overwrites another
 * item's optimistic state. An add (picker confirm, or "Undo") is not optimistic: the server's
 * answer is inserted inside its product group; a 409 (already on the list) toasts and the refetch
 * shows the server's line.
 */
function useItemWrites(listId: string, indexPath: string) {
  const scope = useStoreScope();
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const key = scope.key("replenishment", "list", listId);
  const slots = useRef(new Map<string, Slot>());
  const active = useRef(0);
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());

  const setItems = (update: (items: Item[]) => Item[]) =>
    queryClient.setQueryData<ReplenishmentList>(key, (current) =>
      current ? { ...current, items: update(current.items) } : current,
    );
  const replaceItem = (item: Item) =>
    setItems((items) => items.map((i) => (i.id === item.id ? item : i)));
  const insertItem = (item: Item, at: At) =>
    setItems((items) => {
      if (items.some((i) => i.sizeId === item.sizeId)) return items;
      const index = typeof at === "number" ? at : at(items, item);
      return [...items.slice(0, index), item, ...items.slice(index)];
    });
  const markPending = (id: string, on: boolean) =>
    setPending((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // Counts every item write in flight; the last one to settle refetches.
  const track = (request: Promise<unknown>) => {
    active.current++;
    return request.finally(() => {
      if (--active.current > 0) return;
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({
        queryKey: scope.key("replenishment", "lists"),
      });
      // Home's pending-items figure counts these rows.
      void queryClient.invalidateQueries({ queryKey: scope.key("home") });
    });
  };

  // A refetch in flight would land on top of the optimistic write: cancel it first. The cancel (and
  // its revert to the pre-fetch state) happens inside the call, so the write can follow right away,
  // in the same event — the control never shows its old value for a frame.
  const cancelRefetch = () => void queryClient.cancelQueries({ queryKey: key });

  /** POSTs a size and inserts the answer at `at`; errors toast. The returned promise rejects on error. */
  const post = (body: { sizeId: string; quantity: number }, at: At) => {
    const request = api
      .post<Item>(`/replenishment-lists/${listId}/items`, body, scope.request)
      .then((added) => {
        cancelRefetch();
        insertItem(added, at);
      });
    void track(
      request.catch((error: unknown) => {
        toast.error(error);
        // The list itself is gone (deleted in another session).
        if (isNotFound(error)) navigate(indexPath);
      }),
    );
    return request;
  };

  // Already toasted by `post`.
  const undo = (item: Item, at: number) =>
    void post({ sizeId: item.sizeId, quantity: item.quantity }, at).catch(
      () => {},
    );

  /** The picker's confirm: resolves once the row is in, rejects (already toasted) so the picker keeps the selection. */
  const add = ({ sizeId, quantity, product }: PickerSelection) => {
    const sizeOrder = product.sizes.map((size) => size.sizeId);
    return post({ sizeId, quantity }, (items, added) =>
      insertionIndex(items, added, sizeOrder),
    );
  };

  function send(itemId: string) {
    const slot = slots.current.get(itemId)!;
    const write = slot.next!;
    slot.next = undefined;
    slot.inFlight = true;
    markPending(itemId, true);
    const path = `/replenishment-lists/${listId}/items/${itemId}`;

    const request =
      write.kind === "patch"
        ? api.patch<Item>(path, write.body, scope.request).then((saved) => {
            slot.confirmed = saved;
            if (!slot.next) replaceItem(saved);
          })
        : api.delete(path, scope.request).then(() => {
            const { confirmed, removedAt = 0 } = slot;
            toast.success("Item removed", {
              label: "Undo",
              onAction: () => undo(confirmed, removedAt),
            });
          });

    void track(
      request
        .catch((error: unknown) => {
          toast.error(error);
          if (isNotFound(error)) {
            slot.next = undefined;
            return;
          }
          if (write.kind === "delete")
            return insertItem(slot.confirmed, slot.removedAt ?? 0);
          // A queued removal still goes ahead; queued changes are dropped with the reverted ones.
          if (slot.next?.kind === "patch") slot.next = undefined;
          replaceItem(slot.confirmed);
        })
        .finally(() => {
          slot.inFlight = false;
          if (slot.next) return send(itemId);
          slots.current.delete(itemId);
          markPending(itemId, false);
        }),
    );
  }

  /** Queues `changes` for `item` (the row as rendered) and shows them at once. */
  const patch = (item: Item, changes: UpdateReplenishmentListItemBody) => {
    cancelRefetch();
    const slot = slots.current.get(item.id) ?? {
      confirmed: item,
      inFlight: false,
    };
    slots.current.set(item.id, slot);
    if (slot.next?.kind === "delete") return;
    slot.next = { kind: "patch", body: { ...slot.next?.body, ...changes } };
    setItems((items) =>
      items.map((i) => (i.id === item.id ? { ...i, ...changes } : i)),
    );
    if (!slot.inFlight) send(item.id);
  };

  /** Removes the row at once; the DELETE follows (after the item's in-flight PATCH, if any). */
  const remove = (item: Item) => {
    cancelRefetch();
    const slot = slots.current.get(item.id) ?? {
      confirmed: item,
      inFlight: false,
    };
    slots.current.set(item.id, slot);
    slot.next = { kind: "delete" };
    slot.removedAt =
      queryClient
        .getQueryData<ReplenishmentList>(key)
        ?.items.findIndex((i) => i.id === item.id) ?? 0;
    setItems((items) => items.filter((i) => i.id !== item.id));
    if (!slot.inFlight) send(item.id);
  };

  return { add, patch, remove, pending };
}

/**
 * replenishment-detail.md §Content · Filter band, Items table, "Add product". The table is always
 * grouped: by product in the endpoint's order (product name → product id → size position, RF-26),
 * or by category with the toggle (a product's sizes stay adjacent). Search (product name / SKU),
 * category and grouping are URL state applied client-side to the loaded items — no refetch; the
 * progress card above keeps counting the whole list. Editors get the done check, the quantity
 * input, the remove action and "Add product" (the `<ProductPicker>` over the store's assortment;
 * availability state is not a filter — DP-06); without `replenishment:manage` the checks render
 * disabled and the quantities as plain numbers (RF-32).
 */
export function ListItems({
  list,
  canManage,
  indexPath,
}: {
  list: ReplenishmentList;
  canManage: boolean;
  indexPath: string;
}) {
  const writes = useItemWrites(list.id, indexPath);
  const filters = useListParams(["search", "categoryId"] as const);
  const grouping = useListParams(["group"] as const);
  const { search, categoryId } = filters.filters;
  const byCategory = grouping.filters.group === "category";
  const [picking, setPicking] = useState(false);
  const listed = useMemo(
    () => new Set(list.items.map((item) => item.sizeId)),
    [list.items],
  );

  // The category options are the ones present on the list, by name.
  const categories = [
    ...new Map(
      list.items.map((item) => [
        item.product.categoryId,
        item.product.categoryName,
      ]),
    ).entries(),
  ].sort(([, a], [, b]) => a.localeCompare(b));
  const query = search.toLowerCase();
  const shown = list.items.filter(
    (item) =>
      (!categoryId || item.product.categoryId === categoryId) &&
      (!query ||
        item.product.name.toLowerCase().includes(query) ||
        item.sku.toLowerCase().includes(query)),
  );
  // A stable sort keeps the endpoint's product order inside each category.
  const rows = byCategory
    ? [...shown].sort((a, b) =>
        a.product.categoryName.localeCompare(b.product.categoryName),
      )
    : shown;

  const openPicker = () => setPicking(true);
  const picker = canManage && (
    <ProductPicker
      open={picking}
      onClose={() => setPicking(false)}
      title="Add product"
      confirmLabel="Add to list"
      pendingLabel="Adding…"
      disabledSizeIds={listed}
      disabledLabel="Already on the list"
      onConfirm={writes.add}
    />
  );

  if (list.items.length === 0) {
    return (
      <>
        <EmptyState
          icon="list_alt"
          title="This list has no items"
          action={
            canManage
              ? { label: "Add product", onClick: openPicker }
              : undefined
          }
        />
        {picker}
      </>
    );
  }

  const muted = (item: Item) =>
    item.isDone ? "text-text-secondary" : "text-text";
  const columns: Column<Item>[] = [
    {
      header: "Done",
      cell: (item) => (
        <label className="-my-[10px] inline-flex size-[44px] items-center justify-center max-tablet:my-0">
          <input
            type="checkbox"
            checked={item.isDone}
            disabled={!canManage}
            aria-label={`Done: ${sizeName(item.product.name, item.sizeLabel)}`}
            onChange={() => writes.patch(item, { isDone: !item.isDone })}
            className="size-[16px] accent-accent disabled:opacity-45"
          />
        </label>
      ),
    },
    {
      header: "Product",
      cell: (item) => (
        <span className={`text-body-medium ${muted(item)}`}>
          {item.product.name}
        </span>
      ),
    },
    {
      header: "Size",
      cell: (item) => (
        <span className={`inline-flex flex-col ${muted(item)}`}>
          <span>{item.sizeLabel}</span>
          <span className="font-mono text-caption text-text-secondary">
            {item.sku}
          </span>
        </span>
      ),
    },
    {
      header: "Requested quantity",
      align: "right",
      cell: (item) =>
        canManage ? (
          <QuantityInput
            item={item}
            pending={writes.pending.has(item.id)}
            onSave={(quantity) => writes.patch(item, { quantity })}
          />
        ) : (
          <span className={`font-mono tabular-nums ${muted(item)}`}>
            {item.quantity}
          </span>
        ),
    },
  ];
  if (canManage) {
    columns.push({
      header: "",
      align: "right",
      cell: (item) => (
        <RowAction
          icon="close"
          label={`Remove ${sizeName(item.product.name, item.sizeLabel)}`}
          onClick={() => writes.remove(item)}
        />
      ),
    });
  }

  // Same shape as the empty branch (fragment, picker second) so the open picker isn't remounted
  // — losing its selection — when the first item swaps the empty state for the table.
  return (
    <>
      <div className="flex flex-col gap-base">
        <FilterBand>
          <SearchField
            label="Search items"
            placeholder="Search by product or SKU…"
            value={search}
            onChange={(value) => filters.setFilter("search", value)}
          />
          <select
            aria-label="Category"
            value={categoryId}
            onChange={(e) => filters.setFilter("categoryId", e.target.value)}
            className={`${filterControlClass} tablet:min-w-[200px]`}
          >
            <option value="">All categories</option>
            {categories.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <label
            className={`${filterControlClass} inline-flex cursor-pointer items-center gap-sm`}
          >
            <input
              type="checkbox"
              checked={byCategory}
              onChange={(e) =>
                grouping.setFilter("group", e.target.checked ? "category" : "")
              }
              className="size-[16px] accent-accent"
            />
            Group by category
          </label>
        </FilterBand>
        {rows.length === 0 ? (
          <EmptyState
            icon="search"
            title="No results for these filters"
            action={{ label: "Clear filters", onClick: filters.clearFilters }}
          />
        ) : (
          <DataTable
            label="Items"
            columns={columns}
            rows={rows}
            rowKey={(item) => item.id}
            group={(item) =>
              byCategory
                ? {
                    key: item.product.categoryId,
                    label: item.product.categoryName,
                  }
                : { key: item.product.id, label: item.product.name }
            }
          />
        )}
        {canManage && (
          <div>
            <button
              type="button"
              onClick={openPicker}
              className={secondaryButtonClass}
            >
              <span className="icon" aria-hidden>
                add
              </span>
              Add product
            </button>
          </div>
        )}
      </div>
      {picker}
    </>
  );
}

/**
 * The requested quantity, saved on blur (Enter blurs) only when valid — an integer 1–9999 by the
 * shared item schema — and changed. Invalid → inline error, no request, the value kept for
 * correction; unchanged → nothing. Dimmed while the item's write is in flight.
 */
function QuantityInput({
  item,
  pending,
  onSave,
}: {
  item: Item;
  pending: boolean;
  onSave: (quantity: number) => void;
}) {
  const id = useId();
  // `null` while not being edited: the input then shows the item's (cached, maybe optimistic) value,
  // so a revert shows through by itself.
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  const commit = () => {
    if (draft === null) return;
    const text = draft.trim();
    const parsed =
      /^\d+$/.test(text) &&
      updateReplenishmentListItemBody.safeParse({ quantity: Number(text) });
    if (!parsed || !parsed.success) return setInvalid(true);
    setInvalid(false);
    setDraft(null);
    if (parsed.data.quantity !== item.quantity) onSave(parsed.data.quantity!);
  };

  return (
    <span className="inline-flex flex-col items-end gap-xs">
      <input
        inputMode="numeric"
        aria-label={`Requested quantity: ${sizeName(item.product.name, item.sizeLabel)}`}
        value={draft ?? String(item.quantity)}
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className={`${textInputClass} w-[88px] text-right tabular-nums transition-opacity ${pending ? "opacity-60" : ""}`}
      />
      {invalid && (
        <span id={`${id}-error`} className="text-caption text-alert">
          Enter a whole number from 1 to 9999.
        </span>
      )}
    </span>
  );
}
