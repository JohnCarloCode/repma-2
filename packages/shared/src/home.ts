// RF-41 — `GET /home/summary`: the three figures of Home's KPI strip, counts
// only (RN-05). `openLists` = lists in `draft` or `processing`;
// `pendingItems` = unchecked lines across all those lists; `outOfStock` =
// out-of-stock **sizes** (assortment items), not products. The figures sit
// side by side and are never derived from one another (DP-06).
export interface HomeSummary {
  openLists: number;
  pendingItems: number;
  outOfStock: number;
}
