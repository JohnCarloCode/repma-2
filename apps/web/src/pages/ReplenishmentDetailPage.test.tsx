import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type {
  AvailabilityProduct,
  Permission,
  ReplenishmentList,
  ReplenishmentListItem,
} from "shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../App";
import { createQueryClient } from "../lib/queryClient";
import { SELECTED_STORE_KEY } from "../tenant/activeStore";
import { authMe, renderAt, sessionFor } from "../test/renderApp";
import { server } from "../test/server";

// Every store role holds `replenishment:manage` today, so the read-only fallback (RF-32) is
// exercised by narrowing the shared matrix for this file's sessions.
const matrix = vi.hoisted(() => ({ denyManage: false }));
vi.mock("shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("shared")>();
  return {
    ...actual,
    hasPermission: (
      subject: { role: Parameters<typeof actual.hasPermission>[0]["role"] },
      permission: Permission,
    ) =>
      !(matrix.denyManage && permission === "replenishment:manage") &&
      actual.hasPermission(subject, permission),
  };
});

const item = (
  id: string,
  isDone: boolean,
  overrides: Partial<ReplenishmentListItem> = {},
): ReplenishmentListItem => ({
  id,
  sizeId: `size-${id}`,
  sizeLabel: String(40 + Number(id.slice(1))),
  sku: `SKU-${id}`,
  quantity: 2,
  isDone,
  product: {
    id: "p1",
    name: "Air Max",
    imageUrl: null,
    categoryId: "c1",
    categoryName: "Footwear",
  },
  ...overrides,
});

const base: ReplenishmentList = {
  id: "l1",
  name: "Weekly replenishment",
  status: "processing",
  createdAt: new Date(2026, 9, 3, 9, 5).toISOString(),
  creatorName: "Ana Ruiz",
  notes: "Back wall first",
  items: [item("i1", true), item("i2", false), item("i3", false)],
};

const DETAIL = "*/api/v1/replenishment-lists/l1";

type Respond = Response | Promise<Response>;
/** Item endpoint overrides: each answers instead of the default (which applies the write to the server state). */
interface ItemHandlers {
  patchItem?: (itemId: string, body: Record<string, unknown>) => Respond;
  deleteItem?: (itemId: string) => Respond;
  postItem?: (body: { sizeId: string; quantity: number }) => Respond;
  /** Items the default POST can add besides the list's own sizes (what the store's assortment holds). */
  catalog?: ReplenishmentListItem[];
}

/**
 * The detail endpoint (GET answers `list`; PATCH applies the body and answers via `patch`), recording PATCH bodies,
 * plus the item endpoints (PATCH/DELETE `…/items/:itemId`, POST `…/items`) recorded in `itemCalls`. Every successful
 * write changes the server state the next GET answers.
 */
function detail(
  list: ReplenishmentList = base,
  patch: (
    body: Record<string, unknown>,
    current: ReplenishmentList,
  ) => Response = (body, current) => HttpResponse.json({ ...current, ...body }),
  { patchItem, deleteItem, postItem, catalog = [] }: ItemHandlers = {},
) {
  let current = list;
  const bodies: Record<string, unknown>[] = [];
  const gets: Request[] = [];
  const patches: Request[] = [];
  const itemCalls: { method: string; itemId?: string; body?: unknown }[] = [];
  const setItems = (items: ReplenishmentListItem[]) =>
    (current = { ...current, items });
  server.use(
    http.patch(`${DETAIL}/items/:itemId`, async ({ params, request }) => {
      const itemId = params.itemId as string;
      const body = (await request.json()) as Record<string, unknown>;
      itemCalls.push({ method: "PATCH", itemId, body });
      if (patchItem) return patchItem(itemId, body);
      const found = current.items.find((i) => i.id === itemId);
      if (!found) return error(404, "Item not found");
      const saved = { ...found, ...body };
      setItems(current.items.map((i) => (i.id === itemId ? saved : i)));
      return HttpResponse.json(saved);
    }),
    http.delete(`${DETAIL}/items/:itemId`, ({ params }) => {
      const itemId = params.itemId as string;
      itemCalls.push({ method: "DELETE", itemId });
      if (deleteItem) return deleteItem(itemId);
      if (!current.items.some((i) => i.id === itemId))
        return error(404, "Item not found");
      setItems(current.items.filter((i) => i.id !== itemId));
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${DETAIL}/items`, async ({ request }) => {
      const body = (await request.json()) as {
        sizeId: string;
        quantity: number;
      };
      itemCalls.push({ method: "POST", body });
      if (postItem) return postItem(body);
      // The endpoint's order: product name, then the known sizes' order.
      const known = [...list.items, ...catalog];
      const template = known.find((i) => i.sizeId === body.sizeId)!;
      const added = {
        ...template,
        id: `${template.id}-new`,
        quantity: body.quantity,
        isDone: false,
      };
      const position = (i: ReplenishmentListItem) =>
        known.findIndex((x) => x.sizeId === i.sizeId);
      setItems(
        [...current.items, added].sort(
          (a, b) =>
            a.product.name.localeCompare(b.product.name) ||
            position(a) - position(b),
        ),
      );
      return HttpResponse.json(added, { status: 201 });
    }),
    http.get(DETAIL, ({ request }) => {
      gets.push(request);
      return HttpResponse.json(current);
    }),
    http.patch(DETAIL, async ({ request }) => {
      patches.push(request);
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      const response = patch(body, current);
      if (response.ok)
        current = (await response.clone().json()) as ReplenishmentList;
      return response;
    }),
  );
  return { bodies, gets, patches, itemCalls, setItems };
}

const error = (status: number, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code: "ERR", message, details } }, { status });

function renderPage(
  path: string | { pathname: string; state: unknown } = "/replenishment/l1",
  role: "employee" | "platform_admin" = "employee",
) {
  server.use(authMe(sessionFor(role)));
  const queryClient = createQueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  renderAt(path, <AppRoutes />, queryClient);
  return { invalidate };
}

const location = () => screen.getByTestId("location").textContent;
const toasts = () => screen.getByRole("region", { name: "Notifications" });
const title = () => screen.findByRole("heading", { level: 1 });
// `hidden`: the page also reads behind the open picker (its dialog hides the page from the a11y tree).
const progressCard = () =>
  screen.queryByRole("region", { name: "Progress", hidden: true });

afterEach(() => {
  matrix.denyManage = false;
});

describe("/replenishment/:id — header & cards (replenishment-detail.md §Content)", () => {
  it("renders the header row, the meta line, progress and notes", async () => {
    detail();
    renderPage();

    expect(await title()).toHaveTextContent("Weekly replenishment");
    expect(
      screen.getByRole("link", { name: "Back to replenishment" }),
    ).toHaveAttribute("href", "/replenishment");
    expect(
      screen.getByText("In progress", { selector: "span" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue(
      "processing",
    );
    expect(
      screen.getByRole("button", { name: "Delete list" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Created 03/10/2026 09:05 · Ana Ruiz"),
    ).toBeInTheDocument();

    const bar = within(progressCard()!).getByRole("progressbar", {
      name: "Progress",
    });
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "3");
    expect(bar).toHaveAttribute("aria-valuetext", "1/3");
    expect(within(progressCard()!).getByText("1/3")).toBeInTheDocument();
    expect(within(progressCard()!).queryByText("All items done.")).toBeNull();

    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue(
      "Back wall first",
    );
  });

  it('a deleted creator reads "—"; an empty list has no progress card', async () => {
    detail({ ...base, creatorName: null, items: [] });
    renderPage();
    await title();

    expect(
      screen.getByText("Created 03/10/2026 09:05 · —"),
    ).toBeInTheDocument();
    expect(progressCard()).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("the back arrow returns to the index URL state the card was opened from", async () => {
    detail();
    renderPage({
      pathname: "/replenishment/l1",
      state: { listSearch: "?status=draft&page=2" },
    });
    await title();

    expect(
      screen.getByRole("link", { name: "Back to replenishment" }),
    ).toHaveAttribute("href", "/replenishment?status=draft&page=2");
  });

  it("the platform admin reads and writes the selected store (X-Tenant-Id)", async () => {
    localStorage.setItem(
      SELECTED_STORE_KEY,
      JSON.stringify({ id: "store-b", name: "Store B" }),
    );
    const { gets, patches } = detail();
    renderPage("/replenishment/l1", "platform_admin");
    await title();
    expect(gets[0]!.headers.get("x-tenant-id")).toBe("store-b");

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Status" }),
      "done",
    );
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]!.headers.get("x-tenant-id")).toBe("store-b");
  });
});

describe("/replenishment/:id — states", () => {
  it('a 404 shows "List not found" with a way back, not Retry', async () => {
    server.use(http.get(DETAIL, () => error(404, "List not found")));
    renderPage({
      pathname: "/replenishment/l1",
      state: { listSearch: "?search=week" },
    });

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("List not found")).toBeInTheDocument();
    expect(
      within(alert).getByRole("link", { name: "Back to replenishment" }),
    ).toHaveAttribute("href", "/replenishment?search=week");
    expect(within(alert).queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("any other error offers Retry", async () => {
    let fail = true;
    server.use(
      http.get(DETAIL, () =>
        fail ? error(403, "Not allowed here") : HttpResponse.json(base),
      ),
    );
    renderPage();

    const alert = await screen.findByRole("alert");
    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await title()).toHaveTextContent("Weekly replenishment");
  });
});

describe("/replenishment/:id — name (click-to-edit, saves on blur)", () => {
  it("blur saves the trimmed name: toast, new title, index invalidated", async () => {
    const { bodies } = detail();
    const { invalidate } = renderPage();
    await userEvent.click(
      within(await title()).getByRole("button", {
        name: "Weekly replenishment",
      }),
    );

    const input = screen.getByRole("textbox", { name: "List name" });
    expect(input).toHaveFocus();
    await userEvent.clear(input);
    await userEvent.type(input, "  Monday run ");
    await userEvent.tab();

    await waitFor(() => expect(bodies).toEqual([{ name: "Monday run" }]));
    expect(
      await within(toasts()).findByText("List updated"),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Monday run" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "List name" })).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["store", expect.any(String), "replenishment", "lists"],
    });
  });

  it("Enter saves; Escape cancels without a request; an unchanged name sends nothing", async () => {
    const { bodies } = detail();
    renderPage();
    const heading = await title();

    await userEvent.click(within(heading).getByRole("button"));
    await userEvent.type(
      screen.getByRole("textbox", { name: "List name" }),
      " draft{Escape}",
    );
    expect(await title()).toHaveTextContent("Weekly replenishment");

    await userEvent.click(within(await title()).getByRole("button"));
    await userEvent.type(
      screen.getByRole("textbox", { name: "List name" }),
      "  {Enter}",
    );
    expect(screen.queryByRole("textbox", { name: "List name" })).toBeNull();
    expect(bodies).toHaveLength(0);

    await userEvent.click(within(await title()).getByRole("button"));
    await userEvent.type(
      screen.getByRole("textbox", { name: "List name" }),
      " B{Enter}",
    );
    await waitFor(() =>
      expect(bodies).toEqual([{ name: "Weekly replenishment B" }]),
    );
  });

  it("a blank name shows the schema error inline and sends nothing; the field stays open", async () => {
    const { bodies } = detail();
    renderPage();
    await userEvent.click(within(await title()).getByRole("button"));

    const input = screen.getByRole("textbox", { name: "List name" });
    await userEvent.clear(input);
    await userEvent.tab();

    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "List name" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(bodies).toHaveLength(0);
  });

  it("a 400 maps its detail inline and keeps the value for correction, with no toast", async () => {
    detail(base, () =>
      error(400, "Invalid request", [
        { path: "name", message: "Name is taken" },
      ]),
    );
    renderPage();
    await userEvent.click(within(await title()).getByRole("button"));
    await userEvent.type(
      screen.getByRole("textbox", { name: "List name" }),
      " 2{Enter}",
    );

    expect(await screen.findByText("Name is taken")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "List name" })).toHaveValue(
      "Weekly replenishment 2",
    );
    expect(within(toasts()).queryByRole("alert")).toBeNull();
  });

  it("any other error toasts and reverts to the server name", async () => {
    detail(base, () => error(403, "Not allowed here"));
    renderPage();
    await userEvent.click(within(await title()).getByRole("button"));
    await userEvent.type(
      screen.getByRole("textbox", { name: "List name" }),
      " 2{Enter}",
    );

    expect(await within(toasts()).findByRole("alert")).toHaveTextContent(
      "Not allowed here",
    );
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Weekly replenishment",
      }),
    ).toBeInTheDocument();
  });
});

describe("/replenishment/:id — status (any transition, RF-30)", () => {
  it("the select PATCHes the status alone: badge follows, toast, index and Home invalidated", async () => {
    const { bodies } = detail();
    const { invalidate } = renderPage();
    await title();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Status" }),
      "draft",
    );
    await waitFor(() => expect(bodies).toEqual([{ status: "draft" }]));
    expect(
      await within(toasts()).findByText("List updated"),
    ).toBeInTheDocument();
    expect(screen.getByText("Draft", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue(
      "draft",
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: listsKey });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: homeKey });
  });

  it("an error toasts and falls back to the server status", async () => {
    detail(base, () => error(500, "boom"));
    renderPage();
    await title();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Status" }),
      "done",
    );
    expect(await within(toasts()).findByRole("alert")).toHaveTextContent(
      "Something went wrong. Try again.",
    );
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue(
        "processing",
      ),
    );
    expect(
      screen.getByText("In progress", { selector: "span" }),
    ).toBeInTheDocument();
  });
});

describe("/replenishment/:id — progress card (RF-40)", () => {
  it('at 100% on an open list it suggests "Mark list as done" — only on click does the status change', async () => {
    const { bodies } = detail({
      ...base,
      items: [item("i1", true), item("i2", true)],
    });
    renderPage();
    await title();

    const card = progressCard()!;
    expect(within(card).getByText("2/2")).toBeInTheDocument();
    expect(within(card).getByText("All items done.")).toBeInTheDocument();
    expect(bodies).toHaveLength(0); // never automatic

    await userEvent.click(
      within(card).getByRole("button", { name: "Mark list as done" }),
    );
    await waitFor(() => expect(bodies).toEqual([{ status: "done" }]));
    await waitFor(() =>
      expect(within(progressCard()!).queryByText("All items done.")).toBeNull(),
    );
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue(
      "done",
    );
  });

  it("no hint when the list is already done", async () => {
    detail({ ...base, status: "done", items: [item("i1", true)] });
    renderPage();
    await title();

    expect(within(progressCard()!).getByText("1/1")).toBeInTheDocument();
    expect(within(progressCard()!).queryByText("All items done.")).toBeNull();
  });
});

describe("/replenishment/:id — notes (saves on blur)", () => {
  it("blur saves changed notes; blank clears them; unchanged sends nothing", async () => {
    const { bodies } = detail();
    renderPage();
    await title();

    const notes = screen.getByRole("textbox", { name: "Notes" });
    await userEvent.click(notes);
    await userEvent.tab();
    expect(bodies).toHaveLength(0);

    await userEvent.type(notes, " — then shoes");
    await userEvent.tab();
    await waitFor(() =>
      expect(bodies).toEqual([{ notes: "Back wall first — then shoes" }]),
    );
    expect(
      await within(toasts()).findByText("List updated"),
    ).toBeInTheDocument();

    await userEvent.clear(screen.getByRole("textbox", { name: "Notes" }));
    await userEvent.tab();
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ notes: null });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue(""),
    );
  });

  it("an error toasts and restores the server notes", async () => {
    detail(base, () => error(500, "boom"));
    renderPage();
    await title();

    const notes = screen.getByRole("textbox", { name: "Notes" });
    await userEvent.type(notes, "!");
    await userEvent.tab();

    expect(await within(toasts()).findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue(
      "Back wall first",
    );
  });
});

describe("/replenishment/:id — delete (RF-29)", () => {
  it('"Delete list" confirms, deletes and lands on the index it came from', async () => {
    detail();
    let deleted = 0;
    server.use(
      http.delete(DETAIL, () => {
        deleted++;
        return new HttpResponse(null, { status: 204 });
      }),
      http.get("*/api/v1/replenishment-lists", () =>
        HttpResponse.json({ items: [], page: 1, pageSize: 20, total: 0 }),
      ),
    );
    const { invalidate } = renderPage({
      pathname: "/replenishment/l1",
      state: { listSearch: "?status=draft" },
    });
    await title();

    await userEvent.click(screen.getByRole("button", { name: "Delete list" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete list" });
    expect(dialog).toHaveTextContent(
      "Delete the list “Weekly replenishment”? Its items will be deleted too.",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete list" }),
    );

    await waitFor(() => expect(location()).toBe("/replenishment?status=draft"));
    expect(deleted).toBe(1);
    expect(within(toasts()).getByText("List deleted")).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: listsKey });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: homeKey });
  });
});

describe("/replenishment/:id — read-only fallback (no replenishment:manage, RF-32)", () => {
  it("renders the same layout as text: no editors, no delete; progress still shows", async () => {
    matrix.denyManage = true;
    detail({ ...base, items: [item("i1", true)] });
    renderPage();

    const heading = await title();
    expect(heading).toHaveTextContent("Weekly replenishment");
    expect(within(heading).queryByRole("button")).toBeNull();
    expect(
      screen.getByText("In progress", { selector: "span" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Status" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete list" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Back wall first")).toBeInTheDocument();

    const card = progressCard()!;
    expect(within(card).getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      "1/1",
    );
    expect(within(card).getByText("All items done.")).toBeInTheDocument();
    expect(within(card).queryByRole("button")).toBeNull();

    const table = screen.getByRole("table", { name: "Items" });
    expect(
      within(table).getByRole("checkbox", { name: "Done: Air Max — 41" }),
    ).toBeDisabled();
    expect(within(table).getByRole("cell", { name: "2" })).toBeInTheDocument();
    expect(within(table).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add product" })).toBeNull();
    expect(screen.getByRole("search")).toBeInTheDocument(); // filtering is reading
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["Done", "Product", "Size", "Requested quantity", "Air Max"]);
  });
});

/** A response that waits until `release()` — to hold a request in flight. */
function held(response: () => Response) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  return {
    respond: async () => (await gate, response()),
    release: () => release(),
  };
}

const detailKey = ["store", expect.any(String), "replenishment", "list", "l1"];
const listsKey = ["store", expect.any(String), "replenishment", "lists"];
const homeKey = ["store", expect.any(String), "home"];
const itemsTable = () =>
  screen.getByRole("table", { name: "Items", hidden: true });
const check = (size: string) =>
  screen.getByRole("checkbox", { name: `Done: Air Max — ${size}` });
const quantity = (size: string) =>
  screen.getByRole("textbox", {
    name: `Requested quantity: Air Max — ${size}`,
  });
const fraction = () =>
  within(progressCard()!)
    .getByRole("progressbar", { hidden: true })
    .getAttribute("aria-valuetext");

describe("/replenishment/:id — items table (RF-26/RF-28)", () => {
  it("groups rows under product header rows in the endpoint order, with every editor control", async () => {
    const samba = {
      id: "p2",
      name: "Samba",
      imageUrl: "https://example.test/samba.webp",
      categoryId: "c1",
      categoryName: "Footwear",
    };
    detail({
      ...base,
      items: [
        item("i1", true),
        item("i2", false),
        item("i5", false, { product: samba, sizeLabel: "One size" }),
      ],
    });
    renderPage();
    // Each line shows its product's thumb; one with an image opens the preview.
    expect(await screen.findByRole("button", { name: "Enlarge image of Samba" })).toBeInTheDocument();
    await title();

    expect(
      within(itemsTable())
        .getAllByRole("row")
        .map((tr) => tr.textContent),
    ).toEqual([
      "DoneProductSizeRequested quantity",
      "Air Max",
      "AMAir Max41SKU-i1close", // AM: the thumb's initials placeholder (no image)
      "AMAir Max42SKU-i2close",
      "Samba",
      "SambaOne sizeSKU-i5close",
    ]);
    expect(check("41")).toBeChecked();
    expect(check("42")).not.toBeChecked();
    expect(quantity("42")).toHaveValue("2");
    expect(
      screen.getByRole("checkbox", { name: "Done: Samba" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Samba" }),
    ).toBeInTheDocument();
  });

  it('an empty list says so, with "Add product" — no table, no filter band', async () => {
    detail({ ...base, items: [] });
    renderPage();
    await title();

    expect(screen.getByText("This list has no items")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Items" })).toBeNull();
    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Add product" })).toHaveLength(
      1,
    );
  });
});

describe("/replenishment/:id — done check (RF-40, silent autosave)", () => {
  it("flips at once (row, bar) and PATCHes { isDone } silently; settles by refetching detail and index", async () => {
    const hold = held(() => HttpResponse.json({ ...item("i2", true) }));
    const { itemCalls, setItems } = detail(base, undefined, {
      patchItem: hold.respond,
    });
    const { invalidate } = renderPage();
    await title();

    await userEvent.click(check("42"));
    expect(check("42")).toBeChecked();
    expect(fraction()).toBe("2/3");
    await waitFor(() =>
      expect(itemCalls).toEqual([
        { method: "PATCH", itemId: "i2", body: { isDone: true } },
      ]),
    );
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: detailKey });

    setItems([item("i1", true), item("i2", true), item("i3", false)]);
    hold.release();
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: detailKey }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: listsKey });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: homeKey });
    expect(check("42")).toBeChecked();
    expect(toasts()).toBeEmptyDOMElement();
  });

  it("an error reverts the flip and toasts", async () => {
    detail(base, undefined, { patchItem: () => error(500, "boom") });
    renderPage();
    await title();

    await userEvent.click(check("41"));
    expect(await within(toasts()).findByRole("alert")).toHaveTextContent(
      "Something went wrong. Try again.",
    );
    expect(check("41")).toBeChecked();
    expect(fraction()).toBe("1/3");
  });

  it("a 404 (removed in another session) toasts and the refetch drops the row", async () => {
    const { setItems } = detail();
    renderPage();
    await title();

    setItems([item("i1", true), item("i3", false)]);
    await userEvent.click(check("42"));
    expect(await within(toasts()).findByRole("alert")).toHaveTextContent(
      "Item not found",
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("checkbox", { name: "Done: Air Max — 42" }),
      ).toBeNull(),
    );
    expect(fraction()).toBe("1/2");
  });
});

describe("/replenishment/:id — quantity (saves on blur when valid and changed)", () => {
  it("blur or Enter saves a changed value silently; an unchanged one sends nothing", async () => {
    const { itemCalls } = detail();
    renderPage();
    await title();

    await userEvent.click(quantity("42"));
    await userEvent.tab();
    expect(itemCalls).toHaveLength(0);

    await userEvent.clear(quantity("42"));
    await userEvent.type(quantity("42"), "5");
    await userEvent.tab();
    await waitFor(() =>
      expect(itemCalls).toEqual([
        { method: "PATCH", itemId: "i2", body: { quantity: 5 } },
      ]),
    );

    await userEvent.clear(quantity("43"));
    await userEvent.type(quantity("43"), "12{Enter}");
    await waitFor(() => expect(itemCalls).toHaveLength(2));
    expect(itemCalls[1]).toEqual({
      method: "PATCH",
      itemId: "i3",
      body: { quantity: 12 },
    });
    await waitFor(() => expect(quantity("43")).toHaveValue("12"));
    expect(quantity("42")).toHaveValue("5");
    expect(toasts()).toBeEmptyDOMElement();
  });

  it.each(["", "0", "2.5", "abc", "10000"])(
    '"%s" shows the inline error and sends nothing',
    async (value) => {
      const { itemCalls } = detail();
      renderPage();
      await title();

      await userEvent.clear(quantity("42"));
      if (value) await userEvent.type(quantity("42"), value);
      await userEvent.tab();

      expect(
        screen.getByText("Enter a whole number from 1 to 9999."),
      ).toBeInTheDocument();
      expect(quantity("42")).toHaveAttribute("aria-invalid", "true");
      expect(quantity("42")).toHaveValue(value);
      expect(itemCalls).toHaveLength(0);
    },
  );

  it("correcting an invalid value and blurring saves normally", async () => {
    const { itemCalls } = detail();
    renderPage();
    await title();

    await userEvent.clear(quantity("42"));
    await userEvent.tab();
    expect(
      screen.getByText("Enter a whole number from 1 to 9999."),
    ).toBeInTheDocument();

    await userEvent.type(quantity("42"), "3");
    expect(
      screen.queryByText("Enter a whole number from 1 to 9999."),
    ).toBeNull();
    await userEvent.tab();
    await waitFor(() =>
      expect(itemCalls).toEqual([
        { method: "PATCH", itemId: "i2", body: { quantity: 3 } },
      ]),
    );
  });

  it("an error toasts and reverts to the server value", async () => {
    detail(base, undefined, { patchItem: () => error(429, "slow down") });
    renderPage();
    await title();

    await userEvent.clear(quantity("42"));
    await userEvent.type(quantity("42"), "9");
    await userEvent.tab();

    expect(await within(toasts()).findByRole("alert")).toHaveTextContent(
      "Too many requests",
    );
    expect(quantity("42")).toHaveValue("2");
  });

  it("one PATCH in flight per item: edits made meanwhile are merged, the latest value wins", async () => {
    const holds: ReturnType<typeof held>[] = [];
    const { itemCalls, setItems, gets } = detail(base, undefined, {
      patchItem: (itemId, body) => {
        const hold = held(() =>
          HttpResponse.json({ ...item(itemId, false), ...body }),
        );
        holds.push(hold);
        return hold.respond();
      },
    });
    renderPage();
    await title();

    await userEvent.clear(quantity("42"));
    await userEvent.type(quantity("42"), "5");
    await userEvent.tab();
    await userEvent.clear(quantity("42"));
    await userEvent.type(quantity("42"), "6");
    await userEvent.tab();
    await userEvent.click(check("42"));
    await userEvent.clear(quantity("42"));
    await userEvent.type(quantity("42"), "7");
    await userEvent.tab();

    // The optimistic state shows every edit; only the first request is out.
    expect(quantity("42")).toHaveValue("7");
    expect(check("42")).toBeChecked();
    await waitFor(() => expect(itemCalls).toHaveLength(1));
    expect(itemCalls[0]!.body).toEqual({ quantity: 5 });

    holds[0]!.release();
    await waitFor(() => expect(itemCalls).toHaveLength(2));
    expect(itemCalls[1]!.body).toEqual({ quantity: 7, isDone: true });
    // Another item is never held back by this one.
    await userEvent.click(check("43"));
    await waitFor(() => expect(itemCalls).toHaveLength(3));
    expect(itemCalls[2]).toEqual({
      method: "PATCH",
      itemId: "i3",
      body: { isDone: true },
    });

    setItems([
      item("i1", true),
      item("i2", true, { quantity: 7 }),
      item("i3", true),
    ]);
    holds[1]!.release();
    holds[2]!.release();
    await waitFor(() => expect(gets).toHaveLength(2)); // one refetch, once every write settled
    await waitFor(() => expect(quantity("42")).toHaveValue("7"));
    expect(check("42")).toBeChecked();
    expect(check("43")).toBeChecked();
    expect(itemCalls).toHaveLength(3);
  });
});

describe("/replenishment/:id — remove + Undo", () => {
  it('removes at once with an "Undo" toast; Undo re-adds the same size and quantity, unchecked', async () => {
    const { itemCalls } = detail();
    const { invalidate } = renderPage();
    await title();

    await userEvent.click(
      screen.getByRole("button", { name: "Remove Air Max — 41" }),
    );
    expect(
      screen.queryByRole("checkbox", { name: "Done: Air Max — 41" }),
    ).toBeNull();
    expect(fraction()).toBe("0/2");
    expect(
      await within(toasts()).findByText("Item removed"),
    ).toBeInTheDocument();
    expect(itemCalls).toEqual([{ method: "DELETE", itemId: "i1" }]);
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: listsKey }),
    );

    await userEvent.click(
      within(toasts()).getByRole("button", { name: "Undo" }),
    );
    expect(
      await screen.findByRole("checkbox", { name: "Done: Air Max — 41" }),
    ).not.toBeChecked();
    expect(itemCalls[1]).toEqual({
      method: "POST",
      body: { sizeId: "size-i1", quantity: 2 },
    });
    expect(within(toasts()).queryByText("Item removed")).toBeNull();
    // Back in its place inside the product group.
    expect(
      within(itemsTable())
        .getAllByRole("checkbox")
        .map((c) => c.getAttribute("aria-label")),
    ).toEqual([
      "Done: Air Max — 41",
      "Done: Air Max — 42",
      "Done: Air Max — 43",
    ]);
    expect(fraction()).toBe("0/3");
  });

  it("removing the last item leaves the empty state, without a progress card", async () => {
    detail({ ...base, items: [item("i1", false)] });
    renderPage();
    await title();

    await userEvent.click(
      screen.getByRole("button", { name: "Remove Air Max — 41" }),
    );
    expect(screen.getByText("This list has no items")).toBeInTheDocument();
    expect(progressCard()).toBeNull();
  });

  it("a removal waits for the item's in-flight PATCH, and Undo restores the saved quantity", async () => {
    const hold = held(() =>
      HttpResponse.json({ ...item("i2", false), quantity: 8 }),
    );
    const { itemCalls } = detail(base, undefined, { patchItem: hold.respond });
    renderPage();
    await title();

    await userEvent.clear(quantity("42"));
    await userEvent.type(quantity("42"), "8");
    await userEvent.tab();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Air Max — 42" }),
    );
    await waitFor(() => expect(itemCalls).toHaveLength(1));

    hold.release();
    await waitFor(() =>
      expect(itemCalls[1]).toEqual({ method: "DELETE", itemId: "i2" }),
    );
    await userEvent.click(
      await within(toasts()).findByRole("button", { name: "Undo" }),
    );
    await waitFor(() =>
      expect(itemCalls[2]).toEqual({
        method: "POST",
        body: { sizeId: "size-i2", quantity: 8 },
      }),
    );
  });

  it("a failed removal puts the row back and toasts", async () => {
    detail(base, undefined, { deleteItem: () => error(500, "boom") });
    renderPage();
    await title();

    await userEvent.click(
      screen.getByRole("button", { name: "Remove Air Max — 42" }),
    );
    expect(await within(toasts()).findByRole("alert")).toBeInTheDocument();
    expect(check("42")).toBeInTheDocument();
    expect(within(toasts()).queryByText("Item removed")).toBeNull();
  });

  it("a 404 removal (already removed elsewhere) toasts and the row stays gone", async () => {
    const { setItems } = detail();
    renderPage();
    await title();

    setItems([item("i1", true), item("i3", false)]);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Air Max — 42" }),
    );
    expect(await within(toasts()).findByRole("alert")).toHaveTextContent(
      "Item not found",
    );
    expect(
      screen.queryByRole("checkbox", { name: "Done: Air Max — 42" }),
    ).toBeNull();
  });

  it('Undo after the list was deleted elsewhere: "List not found" and back to the index', async () => {
    detail(base, undefined, { postItem: () => error(404, "List not found") });
    server.use(
      http.get("*/api/v1/replenishment-lists", () =>
        HttpResponse.json({ items: [], page: 1, pageSize: 20, total: 0 }),
      ),
    );
    renderPage({
      pathname: "/replenishment/l1",
      state: { listSearch: "?status=draft" },
    });
    await title();

    await userEvent.click(
      screen.getByRole("button", { name: "Remove Air Max — 41" }),
    );
    await userEvent.click(
      await within(toasts()).findByRole("button", { name: "Undo" }),
    );

    expect(await within(toasts()).findByRole("alert")).toHaveTextContent(
      "List not found",
    );
    await waitFor(() => expect(location()).toBe("/replenishment?status=draft"));
  });

  it("Undo when the size was re-added meanwhile (409): toast, and the refetch shows the server's line", async () => {
    const backend = detail(base, undefined, {
      postItem: () => {
        backend.setItems([
          item("i9", false, {
            sizeId: "size-i1",
            sizeLabel: "41",
            quantity: 4,
          }),
          ...base.items.slice(1),
        ]);
        return error(409, "This size is already on the list");
      },
    });
    renderPage();
    await title();

    await userEvent.click(
      screen.getByRole("button", { name: "Remove Air Max — 41" }),
    );
    await userEvent.click(
      await within(toasts()).findByRole("button", { name: "Undo" }),
    );

    expect(await within(toasts()).findByRole("alert")).toHaveTextContent(
      "This size is already on the list",
    );
    expect(
      await screen.findByRole("textbox", {
        name: "Requested quantity: Air Max — 41",
      }),
    ).toHaveValue("4");
  });
});

const samba = {
  id: "p5",
  name: "Samba",
  imageUrl: "https://example.test/samba.webp",
  categoryId: "c2",
  categoryName: "Lifestyle",
};
const boost = {
  id: "p7",
  name: "Boost",
  imageUrl: null,
  categoryId: "c3",
  categoryName: "Accessories",
};
/** Air Max 41 + 43 and Samba: room for Air Max 42 inside its group, and for Boost between the two groups. */
const mixed: ReplenishmentList = {
  ...base,
  items: [
    item("i1", true),
    item("i3", false),
    item("i5", false, { product: samba }),
  ],
};
const catalog = [item("i2", false), item("i7", false, { product: boost })];

/** The store's assortment as `GET /availability` answers it to the picker (AD-22). */
const assortment = (
  products: { product: ReplenishmentListItem["product"]; ids: string[] }[],
): AvailabilityProduct[] =>
  products.map(({ product, ids }) => ({
    id: product.id,
    name: product.name,
    imageUrl: null,
    categoryName: product.categoryName,
    isActive: true,
    sizes: ids.map((id) => ({
      id: `a-${id}`,
      sizeId: `size-${id}`,
      label: String(40 + Number(id.slice(1))),
      sku: `SKU-${id}`,
      isAvailable: id !== "i2", // an out-of-stock size is addable like any other (DP-06)
      isActive: true,
      latestEventAt: null,
    })),
  }));

function picker() {
  const products = assortment([
    { product: base.items[0]!.product, ids: ["i1", "i2", "i3", "i4"] },
    { product: boost, ids: ["i7"] },
    { product: samba, ids: ["i5"] },
  ]);
  const requests: URL[] = [];
  server.use(
    http.get("*/api/v1/availability", ({ request }) => {
      requests.push(new URL(request.url));
      return HttpResponse.json({
        items: products,
        page: 1,
        pageSize: 24,
        total: products.length,
      });
    }),
  );
  return { requests };
}

const dialog = () => screen.findByRole("dialog", { name: "Add product" });
const tile = (product: string, label: string) =>
  within(screen.getByRole("group", { name: `${product} sizes` })).getByRole(
    "button",
    {
      name: new RegExp(`^${label}\\b`),
    },
  );
const groupedRows = () =>
  within(itemsTable())
    .getAllByRole("row", { hidden: true })
    .slice(1)
    .map(
      (tr) =>
        within(tr)
          .queryByRole("checkbox", { hidden: true })
          ?.getAttribute("aria-label") ?? `# ${tr.textContent}`,
    );

/** Opens the picker from the page and adds `product`'s `label` size. */
async function addSize(product: string, label: string) {
  if (!screen.queryByRole("dialog"))
    await userEvent.click(screen.getByRole("button", { name: "Add product" }));
  const modal = await dialog();
  await userEvent.click(
    await within(modal).findByRole("button", { name: new RegExp(product) }),
  );
  await userEvent.click(tile(product, label));
  await userEvent.click(
    within(modal).getByRole("button", { name: "Add to list" }),
  );
}

describe("/replenishment/:id — add product (RF-28, RN-04)", () => {
  it("adds inside the product group (before any refetch), silently; the tile flips disabled and the picker stays open", async () => {
    const { requests } = picker();
    const { itemCalls } = detail(mixed, undefined, { catalog });
    const { invalidate } = renderPage();
    await title();
    // Hold the settling refetch: what shows meanwhile is the insertion itself.
    const hold = held(() =>
      HttpResponse.json({
        ...mixed,
        items: [
          item("i1", true),
          item("i2-new", false, {
            sizeId: "size-i2",
            sizeLabel: "42",
            quantity: 1,
          }),
          ...mixed.items.slice(1),
        ],
      }),
    );
    server.use(http.get(DETAIL, hold.respond));

    await addSize("Air Max", "42");
    await waitFor(() =>
      expect(itemCalls).toEqual([
        { method: "POST", body: { sizeId: "size-i2", quantity: 1 } },
      ]),
    );
    await waitFor(() => expect(tile("Air Max", "42")).toBeDisabled());
    expect(tile("Air Max", "42")).toHaveAccessibleName(/already on the list/);
    expect(
      screen.getByRole("dialog", { name: "Add product" }),
    ).toBeInTheDocument();
    expect(groupedRows()).toEqual([
      "# Air Max",
      "Done: Air Max — 41",
      "Done: Air Max — 42",
      "Done: Air Max — 43",
      "# Samba",
      "Done: Samba — 45",
    ]);
    expect(fraction()).toBe("1/4");

    // A product new to the list gets its own group, in product-name order.
    await addSize("Boost", "47");
    await waitFor(() => expect(itemCalls).toHaveLength(2));
    await waitFor(() => expect(tile("Boost", "47")).toBeDisabled());
    expect(groupedRows()).toEqual([
      "# Air Max",
      "Done: Air Max — 41",
      "Done: Air Max — 42",
      "Done: Air Max — 43",
      "# Boost",
      "Done: Boost — 47",
      "# Samba",
      "Done: Samba — 45",
    ]);
    expect(toasts()).toBeEmptyDOMElement();

    // The picker browses the assortment without an availability filter (DP-06).
    expect(requests.every((url) => !url.searchParams.has("outOfStock"))).toBe(
      true,
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: detailKey }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: listsKey });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: ["store", expect.any(String), "availability"],
    });
    hold.release();
  });

  it("the picker marks the sizes already on the list as disabled", async () => {
    picker();
    detail(mixed);
    renderPage();
    await title();

    await userEvent.click(screen.getByRole("button", { name: "Add product" }));
    const modal = await dialog();
    await userEvent.click(
      await within(modal).findByRole("button", { name: /Air Max/ }),
    );
    expect(tile("Air Max", "41")).toBeDisabled();
    expect(tile("Air Max", "43")).toBeDisabled();
    expect(tile("Air Max", "42")).toBeEnabled();
    expect(tile("Air Max", "44")).toBeEnabled();
  });

  it("a 409 (added meanwhile in another session) toasts the API message; the refetch flips the tile", async () => {
    picker();
    const backend = detail(mixed, undefined, {
      postItem: () => {
        backend.setItems([
          item("i1", true),
          item("i2", false),
          ...mixed.items.slice(1),
        ]);
        return error(409, "This size is already on the list");
      },
    });
    renderPage();
    await title();

    await addSize("Air Max", "42");
    expect(await within(toasts()).findByRole("alert")).toHaveTextContent(
      "This size is already on the list",
    );
    await waitFor(() => expect(tile("Air Max", "42")).toBeDisabled());
    expect(
      screen.getByRole("checkbox", {
        name: "Done: Air Max — 42",
        hidden: true,
      }),
    ).toBeInTheDocument();
  });

  it("a 400 (not in the assortment, RN-12) toasts and adds nothing; the selection is kept for a retry", async () => {
    picker();
    detail(mixed, undefined, {
      postItem: () => error(400, "This size is not in the store's assortment"),
    });
    renderPage();
    await title();

    await addSize("Air Max", "44");
    expect(await within(toasts()).findByRole("alert")).toHaveTextContent(
      "This size is not in the store's assortment",
    );
    expect(
      screen.queryByRole("checkbox", {
        name: "Done: Air Max — 44",
        hidden: true,
      }),
    ).toBeNull();
    await waitFor(() =>
      expect(tile("Air Max", "44")).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("from the empty state: the first item brings the table, the filter band and the progress card", async () => {
    picker();
    detail({ ...base, items: [] }, undefined, { catalog });
    renderPage();
    await title();

    await userEvent.click(screen.getByRole("button", { name: "Add product" }));
    await addSize("Boost", "47");
    expect(
      await screen.findByRole("checkbox", {
        name: "Done: Boost — 47",
        hidden: true,
      }),
    ).not.toBeChecked();
    expect(screen.getByRole("search", { hidden: true })).toBeInTheDocument();
    expect(fraction()).toBe("0/1");
    // The picker survives the empty state → table swap: still open, same product selected.
    await waitFor(() => expect(tile("Boost", "47")).toBeDisabled());
    expect(
      screen.getByRole("dialog", { name: "Add product" }),
    ).toBeInTheDocument();
  });

  it("without replenishment:manage the empty state only explains", async () => {
    matrix.denyManage = true;
    detail({ ...base, items: [] });
    renderPage();
    await title();

    expect(screen.getByText("This list has no items")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add product" })).toBeNull();
  });
});

describe("/replenishment/:id — client-side filters & grouping (URL state, no refetch)", () => {
  const search = () => screen.getByRole("searchbox", { name: "Search items" });
  const category = () => screen.getByRole("combobox", { name: "Category" });
  const groupToggle = () =>
    screen.getByRole("checkbox", { name: "Group by category" });

  it("search matches product name or SKU, debounced; header rows vanish with their group; nothing refetches", async () => {
    const { gets } = detail(mixed);
    renderPage({
      pathname: "/replenishment/l1",
      state: { listSearch: "?status=draft" },
    });
    await title();

    await userEvent.type(search(), "samba");
    await waitFor(() =>
      expect(location()).toBe("/replenishment/l1?search=samba"),
    );
    expect(groupedRows()).toEqual(["# Samba", "Done: Samba — 45"]);

    await userEvent.clear(search());
    await userEvent.type(search(), "sku-i3");
    await waitFor(() =>
      expect(groupedRows()).toEqual(["# Air Max", "Done: Air Max — 43"]),
    );

    expect(gets).toHaveLength(1);
    expect(fraction()).toBe("1/3"); // progress keeps counting the whole list
    // The back arrow keeps its target through the URL updates.
    expect(
      screen.getByRole("link", { name: "Back to replenishment" }),
    ).toHaveAttribute("href", "/replenishment?status=draft");
  });

  it("the category select offers the categories on the list and filters by them", async () => {
    const { gets } = detail(mixed);
    renderPage();
    await title();

    expect(
      within(category())
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["All categories", "Footwear", "Lifestyle"]);
    await userEvent.selectOptions(category(), "c2");
    expect(location()).toBe("/replenishment/l1?categoryId=c2");
    expect(groupedRows()).toEqual(["# Samba", "Done: Samba — 45"]);
    expect(gets).toHaveLength(1);
  });

  it('"Group by category" regroups under category headers, keeping product order inside', async () => {
    const { gets } = detail({
      ...base,
      items: [
        item("i1", false),
        item("i3", false),
        item("i5", false, { product: samba }),
        item("i7", false, { product: boost }),
      ],
    });
    renderPage();
    await title();

    await userEvent.click(groupToggle());
    expect(location()).toBe("/replenishment/l1?group=category");
    expect(groupedRows()).toEqual([
      "# Accessories",
      "Done: Boost — 47",
      "# Footwear",
      "Done: Air Max — 41",
      "Done: Air Max — 43",
      "# Lifestyle",
      "Done: Samba — 45",
    ]);
    // Rows keep their controls inside category groups.
    expect(
      screen.getByRole("textbox", { name: "Requested quantity: Boost — 47" }),
    ).toBeInTheDocument();

    await userEvent.click(groupToggle());
    expect(location()).toBe("/replenishment/l1");
    expect(groupedRows()[0]).toBe("# Air Max");
    expect(gets).toHaveLength(1);
  });

  it('filters read from the URL; no match → "No results for these filters" + Clear filters (grouping kept)', async () => {
    detail(mixed);
    renderPage("/replenishment/l1?search=zzz&categoryId=c1&group=category");
    await title();

    expect(search()).toHaveValue("zzz");
    expect(category()).toHaveValue("c1");
    expect(groupToggle()).toBeChecked();
    expect(
      screen.getByText("No results for these filters"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Items" })).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "Clear filters" }),
    );
    expect(location()).toBe("/replenishment/l1?group=category");
    expect(groupedRows()[0]).toBe("# Footwear");
  });
});
