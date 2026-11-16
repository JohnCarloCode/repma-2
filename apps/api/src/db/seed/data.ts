import { ONE_SIZE_LABEL, SIZE_PRESETS, type ReplenishmentStatus, type Role } from 'shared';

// The demo dataset (database.md §9). Pure data: `seed.ts` writes it.
// Product images: one per product, see images.ts.

// Demo-only credential, public by design: shown on the landing page and in
// the README (database.md §9). Never reuse it for a real account.
export const DEMO_PASSWORD = 'repma-demo-2026';

export type StoreKey = 'downtown' | 'north';

export const STORES: Record<StoreKey, { name: string; slug: string }> = {
  downtown: { name: 'Downtown Store', slug: 'downtown-store' },
  north: { name: 'North Store', slug: 'north-store' },
};

export const USERS: { email: string; fullName: string; role: Role; store: StoreKey | null }[] = [
  { email: 'admin@repma.demo', fullName: 'Platform Admin', role: 'platform_admin', store: null },
  { email: 'manager.downtown@repma.demo', fullName: 'John', role: 'manager', store: 'downtown' },
  { email: 'employee.downtown@repma.demo', fullName: 'Manu', role: 'employee', store: 'downtown' },
  { email: 'manager.north@repma.demo', fullName: 'Alina', role: 'manager', store: 'north' },
  { email: 'employee.north@repma.demo', fullName: 'Elena', role: 'employee', store: 'north' },
];

// One category per kit's match jerseys and one per streetwear collection
// (each collection in the colours of a kit).
export const CATEGORIES = [
  { slug: 'first-competition', name: 'First Competition', description: 'Liga REPMA 2025 first-kit match jerseys.' },
  { slug: 'second-competition', name: 'Second Competition', description: 'Liga REPMA 2025 second-kit match jerseys.' },
  { slug: 'third-competition', name: 'Third Competition', description: 'Liga REPMA 2025 third-kit match jerseys.' },
  { slug: 'origins-collection', name: 'Origins Collection', description: 'Streetwear in the first kit\'s red, blue and gold.' },
  { slug: 'evergreen-collection', name: 'Evergreen Collection', description: 'Streetwear in the second kit\'s green and black.' },
  { slug: 'dusk-collection', name: 'Dusk Collection', description: 'Streetwear in the third kit\'s orange and purple.' },
] as const;

type CategorySlug = (typeof CATEGORIES)[number]['slug'];

// Every seed product is clothing (RF-38 preset).
const APPAREL = SIZE_PRESETS.clothing.labels;

// The three kits: their jersey category, their streetwear collection and the
// players printed on the jerseys. `stores` carries a kit's player jerseys
// (except #10) and its collection.
const KITS: { prefix: string; name: string; competition: CategorySlug; collection: { name: string; category: CategorySlug }; stores: StoreKey[] }[] = [
  { prefix: 'H', name: 'First', competition: 'first-competition', collection: { name: 'Origins', category: 'origins-collection' }, stores: ['downtown', 'north'] },
  { prefix: 'A', name: 'Second', competition: 'second-competition', collection: { name: 'Evergreen', category: 'evergreen-collection' }, stores: ['downtown'] },
  { prefix: 'T', name: 'Third', competition: 'third-competition', collection: { name: 'Dusk', category: 'dusk-collection' }, stores: ['north'] },
];
const PLAYERS = [
  { number: 8, name: 'Cadri' },
  { number: 9, name: 'Lecarlo Mine' },
  { number: 10, name: 'Johninho' },
] as const;
const STREETWEAR = [
  { code: 'TEE', name: 'T-Shirt', description: 'Cotton tee' },
  { code: 'TRK', name: 'Tracksuit', description: 'Zip jacket and trousers set' },
  { code: 'HOD', name: 'Hoodie', description: 'Brushed fleece hoodie' },
  { code: 'JKT', name: 'Jacket', description: 'Lightweight jacket' },
] as const;

// `code` is the stable seed key: it derives the product id, prefixes SKUs and
// names the product's image (`images/<code>.webp`, see images.ts). `stores`
// builds overlapping assortments with exclusives on both sides; every kit's
// plain and #10 jerseys are in both stores.
export const PRODUCTS: {
  code: string;
  name: string;
  category: CategorySlug;
  description: string;
  sizes: readonly string[];
  stores: StoreKey[];
}[] = KITS.flatMap((kit) => [
  {
    code: `${kit.prefix}J00`,
    name: `${kit.name} Jersey 2025`,
    category: kit.competition,
    description: `Liga REPMA 2025 ${kit.name.toLowerCase()}-kit jersey, no name or number.`,
    sizes: APPAREL,
    stores: ['downtown', 'north'] satisfies StoreKey[],
  },
  ...PLAYERS.map((player) => ({
    code: `${kit.prefix}J${String(player.number).padStart(2, '0')}`,
    name: `${player.name} #${player.number} ${kit.name} Jersey 2025`,
    category: kit.competition,
    description: `Liga REPMA 2025 ${kit.name.toLowerCase()}-kit jersey with ${player.name}'s name and number ${player.number}.`,
    sizes: APPAREL,
    stores: player.number === 10 ? (['downtown', 'north'] satisfies StoreKey[]) : kit.stores,
  })),
  ...STREETWEAR.map((item) => ({
    code: `${kit.prefix}${item.code}`,
    name: `${kit.collection.name} ${item.name}`,
    category: kit.collection.category,
    description: `${item.description} from the ${kit.collection.name} collection.`,
    sizes: APPAREL,
    stores: kit.stores,
  })),
]);

// The previous demo catalog's keys (generic sports products, replaced on
// 2026-11-16). The seed removes those rows where nothing references them and
// deactivates the rest, so a re-seeded environment shows only PRODUCTS.
export const RETIRED_PRODUCT_CODES = [
  ...['FW01', 'FW02', 'FW03', 'FW04', 'FW05', 'FW06', 'FW07', 'FW08'],
  ...['AP01', 'AP02', 'AP03', 'AP04', 'AP05', 'AP06', 'AP07', 'AP08', 'AP09'],
  ...['AC01', 'AC02', 'AC03', 'AC04', 'AC05', 'AC06'],
  ...['EL01', 'EL02', 'EL03', 'EL04', 'EL05'],
  ...['NU01', 'NU02', 'NU03', 'NU04', 'NU05', 'NU06'],
  ...['EQ01', 'EQ02', 'EQ03', 'EQ04', 'EQ05', 'EQ06'],
];
export const RETIRED_CATEGORY_SLUGS = ['footwear', 'apparel', 'accessories', 'sports-electronics', 'nutrition', 'equipment'];

export function skuOf(code: string, label: string): string {
  return `${code}-${label === ONE_SIZE_LABEL ? 'OS' : label}`;
}

// Availability histories, oldest first, as hours before the seed runs. Types
// strictly alternate starting with `out_of_stock` (RN-14), so the type of each
// entry is implied by its position; an odd length ends out of stock. Ages span
// DP-07's three aging bands.
export const AVAILABILITY: Record<StoreKey, { sku: string; hoursAgo: number[] }[]> = {
  downtown: [
    { sku: 'HJ10-M', hoursAgo: [3] },
    { sku: 'HJ08-L', hoursAgo: [240, 216, 72] },
    { sku: 'AJ10-S', hoursAgo: [300] },
    { sku: 'HJ00-XL', hoursAgo: [30] },
    { sku: 'AJ00-M', hoursAgo: [190, 120, 30] },
    { sku: 'HHOD-L', hoursAgo: [120, 48] },
    { sku: 'ATEE-M', hoursAgo: [6] },
  ],
  north: [
    { sku: 'HJ10-M', hoursAgo: [50] },
    { sku: 'TJ09-L', hoursAgo: [200] },
    { sku: 'HTEE-S', hoursAgo: [10, 5, 1] },
    { sku: 'TJ00-XL', hoursAgo: [20] },
    { sku: 'THOD-M', hoursAgo: [96, 90] },
    { sku: 'HJ09-2XL', hoursAgo: [400, 380, 180] },
  ],
};

// Manual replenishment lists (DP-06: independent of the flags above).
// `daysAgo` sets created_at so list ordering looks lived-in.
export const LISTS: Record<
  StoreKey,
  {
    name: string;
    status: ReplenishmentStatus;
    notes: string | null;
    daysAgo: number;
    lines: { sku: string; quantity: number; done: boolean }[];
  }[]
> = {
  downtown: [
    {
      name: 'Monday delivery',
      status: 'done',
      notes: 'Unloaded and shelved.',
      daysAgo: 6,
      lines: [
        { sku: 'HJ00-M', quantity: 4, done: true },
        { sku: 'HTEE-L', quantity: 10, done: true },
        { sku: 'AJ00-S', quantity: 12, done: true },
      ],
    },
    {
      name: 'Jersey wall restock',
      status: 'processing',
      notes: 'Bring sizes out from the stockroom before noon.',
      daysAgo: 1,
      lines: [
        { sku: 'HJ10-M', quantity: 3, done: true },
        { sku: 'HJ08-L', quantity: 2, done: true },
        { sku: 'AJ09-S', quantity: 4, done: false },
        { sku: 'AJ10-XL', quantity: 6, done: false },
        { sku: 'HJ09-M', quantity: 2, done: false },
      ],
    },
    {
      name: 'Streetwear front tables',
      status: 'draft',
      notes: null,
      daysAgo: 0,
      lines: [
        { sku: 'ATRK-M', quantity: 5, done: false },
        { sku: 'AHOD-L', quantity: 3, done: false },
        { sku: 'AJKT-S', quantity: 4, done: false },
      ],
    },
    { name: 'Matchday reorder', status: 'draft', notes: null, daysAgo: 0, lines: [] },
  ],
  north: [
    {
      name: 'Last week run',
      status: 'done',
      notes: null,
      daysAgo: 8,
      lines: [
        { sku: 'TJ08-M', quantity: 2, done: true },
        { sku: 'THOD-L', quantity: 6, done: true },
      ],
    },
    {
      name: 'Morning restock',
      status: 'processing',
      notes: 'Start with the jersey wall.',
      daysAgo: 0,
      lines: [
        { sku: 'TJ10-M', quantity: 4, done: true },
        { sku: 'HJ00-S', quantity: 3, done: false },
        { sku: 'TTRK-L', quantity: 2, done: false },
        { sku: 'TJKT-XL', quantity: 3, done: false },
      ],
    },
    {
      name: 'Streetwear shelf',
      status: 'draft',
      notes: null,
      daysAgo: 2,
      lines: [
        { sku: 'TTEE-M', quantity: 8, done: false },
        { sku: 'HHOD-S', quantity: 10, done: false },
      ],
    },
    { name: 'Weekend promo', status: 'draft', notes: 'Waiting for the promo plan.', daysAgo: 0, lines: [] },
  ],
};
