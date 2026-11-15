import type { ReplenishmentStatus, Role } from 'shared';

// The demo dataset (database.md §9). Pure data: `seed.ts` writes it.
// Product images stay NULL until the Storage bucket exists (plan 8.8).

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
  { email: 'manager.downtown@repma.demo', fullName: 'Dana Torres', role: 'manager', store: 'downtown' },
  { email: 'employee.downtown@repma.demo', fullName: 'Eli Brooks', role: 'employee', store: 'downtown' },
  { email: 'manager.north@repma.demo', fullName: 'Nora Patel', role: 'manager', store: 'north' },
  { email: 'employee.north@repma.demo', fullName: 'Sam Ortiz', role: 'employee', store: 'north' },
];

export const CATEGORIES = [
  { slug: 'footwear', name: 'Footwear', description: 'Running, training and outdoor shoes.' },
  { slug: 'apparel', name: 'Apparel', description: 'Technical clothing for training and competition.' },
  { slug: 'accessories', name: 'Accessories', description: 'Bags, bottles, caps and small gear.' },
  { slug: 'sports-electronics', name: 'Sports electronics', description: 'Watches, sensors and audio for training.' },
  { slug: 'nutrition', name: 'Nutrition', description: 'Supplements, gels and recovery products.' },
  { slug: 'equipment', name: 'Equipment', description: 'Home and gym training equipment.' },
] as const;

type CategorySlug = (typeof CATEGORIES)[number]['slug'];

const APPAREL = ['XS', 'S', 'M', 'L', 'XL', '2XL'];
const ONE_SIZE = ['One size'];
const shoes = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

// `code` is the stable seed key: it derives the product id and prefixes SKUs.
// `stores` builds overlapping assortments with exclusives on both sides.
export const PRODUCTS: {
  code: string;
  name: string;
  category: CategorySlug;
  description: string;
  sizes: string[];
  stores: StoreKey[];
}[] = [
  { code: 'FW01', name: 'Trail Runner GTX', category: 'footwear', description: 'Waterproof trail shoe with a lugged outsole.', sizes: shoes(39, 45), stores: ['downtown', 'north'] },
  { code: 'FW02', name: 'Road Racer Elite', category: 'footwear', description: 'Lightweight racing flat for road events.', sizes: shoes(38, 45), stores: ['downtown', 'north'] },
  { code: 'FW03', name: 'Court Classic Low', category: 'footwear', description: 'Low-top indoor court shoe.', sizes: shoes(36, 44), stores: ['downtown'] },
  { code: 'FW04', name: 'Studio Flex Trainer', category: 'footwear', description: 'Flexible trainer for studio and gym sessions.', sizes: shoes(36, 42), stores: ['downtown', 'north'] },
  { code: 'FW05', name: 'Cloudstep Daily', category: 'footwear', description: 'Cushioned everyday running shoe.', sizes: shoes(37, 45), stores: ['downtown', 'north'] },
  { code: 'FW06', name: 'Peak Approach Boot', category: 'footwear', description: 'Mid-cut approach boot for rocky trails.', sizes: shoes(40, 45), stores: ['north'] },
  { code: 'FW07', name: 'Sprint Spike Pro', category: 'footwear', description: 'Track spike for sprint distances.', sizes: shoes(38, 44), stores: ['downtown'] },
  { code: 'FW08', name: 'Recovery Slide', category: 'footwear', description: 'Soft foam slide for post-workout recovery.', sizes: shoes(36, 45), stores: ['downtown', 'north'] },
  { code: 'AP01', name: 'Dry-Fit Training Tee', category: 'apparel', description: 'Breathable short-sleeve training tee.', sizes: APPAREL, stores: ['downtown', 'north'] },
  { code: 'AP02', name: 'Thermal Base Layer Top', category: 'apparel', description: 'Long-sleeve thermal layer for cold days.', sizes: APPAREL, stores: ['north'] },
  { code: 'AP03', name: 'Windshell Running Jacket', category: 'apparel', description: 'Packable wind-resistant running jacket.', sizes: APPAREL, stores: ['downtown', 'north'] },
  { code: 'AP04', name: 'Performance Shorts 7"', category: 'apparel', description: 'Running shorts with a built-in liner.', sizes: APPAREL, stores: ['downtown', 'north'] },
  { code: 'AP05', name: 'Seamless Sports Bra', category: 'apparel', description: 'Medium-support seamless sports bra.', sizes: APPAREL, stores: ['downtown'] },
  { code: 'AP06', name: 'Fleece Training Hoodie', category: 'apparel', description: 'Brushed fleece hoodie for warm-ups.', sizes: APPAREL, stores: ['downtown', 'north'] },
  { code: 'AP07', name: 'Compression Tights', category: 'apparel', description: 'Full-length compression running tights.', sizes: APPAREL, stores: ['north'] },
  { code: 'AP08', name: 'Rain Shell Pants', category: 'apparel', description: 'Waterproof over-trousers.', sizes: APPAREL, stores: ['downtown', 'north'] },
  { code: 'AP09', name: 'Lightweight Track Pants', category: 'apparel', description: 'Tapered track pants with zip pockets.', sizes: APPAREL, stores: ['downtown'] },
  { code: 'AC01', name: 'Insulated Water Bottle 750 ml', category: 'accessories', description: 'Double-wall steel bottle.', sizes: ONE_SIZE, stores: ['downtown', 'north'] },
  { code: 'AC02', name: 'Running Cap', category: 'accessories', description: 'Lightweight cap with a reflective trim.', sizes: ONE_SIZE, stores: ['downtown', 'north'] },
  { code: 'AC03', name: 'Sports Duffel 40 L', category: 'accessories', description: 'Duffel bag with a shoe compartment.', sizes: ONE_SIZE, stores: ['north'] },
  { code: 'AC04', name: 'Running Belt', category: 'accessories', description: 'Slim waist belt for phone and keys.', sizes: ONE_SIZE, stores: ['downtown', 'north'] },
  { code: 'AC05', name: 'Sweatband Set', category: 'accessories', description: 'Head and wrist sweatbands.', sizes: ONE_SIZE, stores: ['downtown'] },
  { code: 'AC06', name: 'Merino Running Socks', category: 'accessories', description: 'Cushioned merino blend socks.', sizes: ONE_SIZE, stores: ['downtown', 'north'] },
  { code: 'EL01', name: 'GPS Running Watch', category: 'sports-electronics', description: 'Multisport GPS watch with wrist heart rate.', sizes: ONE_SIZE, stores: ['downtown', 'north'] },
  { code: 'EL02', name: 'Heart Rate Chest Strap', category: 'sports-electronics', description: 'Bluetooth and ANT+ chest strap.', sizes: ONE_SIZE, stores: ['downtown', 'north'] },
  { code: 'EL03', name: 'Wireless Sport Earbuds', category: 'sports-electronics', description: 'Sweat-resistant earbuds with ear hooks.', sizes: ONE_SIZE, stores: ['downtown'] },
  { code: 'EL04', name: 'Bike Computer', category: 'sports-electronics', description: 'Handlebar GPS computer with mapping.', sizes: ONE_SIZE, stores: ['north'] },
  { code: 'EL05', name: 'Smart Jump Rope', category: 'sports-electronics', description: 'Jump rope with a built-in counter.', sizes: ONE_SIZE, stores: ['downtown', 'north'] },
  { code: 'NU01', name: 'Whey Protein 1 kg Vanilla', category: 'nutrition', description: 'Whey protein concentrate, vanilla flavour.', sizes: ONE_SIZE, stores: ['downtown', 'north'] },
  { code: 'NU02', name: 'Energy Gel Pack (6)', category: 'nutrition', description: 'Six carbohydrate gels, mixed flavours.', sizes: ONE_SIZE, stores: ['downtown', 'north'] },
  { code: 'NU03', name: 'Electrolyte Tablets', category: 'nutrition', description: 'Effervescent electrolyte tablets, 20 count.', sizes: ONE_SIZE, stores: ['downtown', 'north'] },
  { code: 'NU04', name: 'Oat Protein Bar Box (12)', category: 'nutrition', description: 'Twelve oat and protein bars.', sizes: ONE_SIZE, stores: ['north'] },
  { code: 'NU05', name: 'Recovery Shake Chocolate', category: 'nutrition', description: 'Carbohydrate and protein recovery mix.', sizes: ONE_SIZE, stores: ['downtown'] },
  { code: 'NU06', name: 'Isotonic Drink Powder', category: 'nutrition', description: 'Isotonic sports drink powder, lemon.', sizes: ONE_SIZE, stores: ['downtown', 'north'] },
  { code: 'EQ01', name: 'Yoga Mat 6 mm', category: 'equipment', description: 'Non-slip yoga mat with a carry strap.', sizes: ONE_SIZE, stores: ['downtown', 'north'] },
  { code: 'EQ02', name: 'Adjustable Dumbbell 20 kg', category: 'equipment', description: 'Quick-change adjustable dumbbell.', sizes: ONE_SIZE, stores: ['north'] },
  { code: 'EQ03', name: 'Resistance Band Set', category: 'equipment', description: 'Five bands from light to extra heavy.', sizes: ONE_SIZE, stores: ['downtown', 'north'] },
  { code: 'EQ04', name: 'Foam Roller', category: 'equipment', description: 'High-density foam roller, 45 cm.', sizes: ONE_SIZE, stores: ['downtown', 'north'] },
  { code: 'EQ05', name: 'Kettlebell 12 kg', category: 'equipment', description: 'Cast-iron kettlebell.', sizes: ONE_SIZE, stores: ['downtown'] },
  { code: 'EQ06', name: 'Pull-up Bar', category: 'equipment', description: 'Doorway pull-up bar, no screws.', sizes: ONE_SIZE, stores: ['north'] },
];

export function skuOf(code: string, label: string): string {
  return `${code}-${label === 'One size' ? 'OS' : label}`;
}

// Availability histories, oldest first, as hours before the seed runs. Types
// strictly alternate starting with `out_of_stock` (RN-14), so the type of each
// entry is implied by its position; an odd length ends out of stock. Ages span
// DP-07's three aging bands.
export const AVAILABILITY: Record<StoreKey, { sku: string; hoursAgo: number[] }[]> = {
  downtown: [
    { sku: 'FW01-42', hoursAgo: [3] },
    { sku: 'FW02-44', hoursAgo: [240, 216, 72] },
    { sku: 'AP01-M', hoursAgo: [300] },
    { sku: 'AP01-L', hoursAgo: [30] },
    { sku: 'EL01-OS', hoursAgo: [190, 120, 30] },
    { sku: 'AC01-OS', hoursAgo: [120, 48] },
    { sku: 'NU01-OS', hoursAgo: [6] },
  ],
  north: [
    { sku: 'FW01-42', hoursAgo: [50] },
    { sku: 'AP03-L', hoursAgo: [200] },
    { sku: 'EQ01-OS', hoursAgo: [10, 5, 1] },
    { sku: 'FW05-40', hoursAgo: [20] },
    { sku: 'NU02-OS', hoursAgo: [96, 90] },
    { sku: 'EL04-OS', hoursAgo: [400, 380, 180] },
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
        { sku: 'FW05-41', quantity: 4, done: true },
        { sku: 'AC02-OS', quantity: 10, done: true },
        { sku: 'NU03-OS', quantity: 12, done: true },
      ],
    },
    {
      name: 'Footwear wall restock',
      status: 'processing',
      notes: 'Bring sizes out from the stockroom before noon.',
      daysAgo: 1,
      lines: [
        { sku: 'FW01-43', quantity: 3, done: true },
        { sku: 'FW02-42', quantity: 2, done: true },
        { sku: 'FW04-38', quantity: 4, done: false },
        { sku: 'FW08-40', quantity: 6, done: false },
        { sku: 'FW03-39', quantity: 2, done: false },
      ],
    },
    {
      name: 'Apparel front tables',
      status: 'draft',
      notes: null,
      daysAgo: 0,
      lines: [
        { sku: 'AP04-M', quantity: 5, done: false },
        { sku: 'AP06-L', quantity: 3, done: false },
        { sku: 'AP09-S', quantity: 4, done: false },
      ],
    },
    { name: 'Accessories reorder', status: 'draft', notes: null, daysAgo: 0, lines: [] },
  ],
  north: [
    {
      name: 'Last week run',
      status: 'done',
      notes: null,
      daysAgo: 8,
      lines: [
        { sku: 'EQ02-OS', quantity: 2, done: true },
        { sku: 'NU04-OS', quantity: 6, done: true },
      ],
    },
    {
      name: 'Morning restock',
      status: 'processing',
      notes: 'Start with the running section.',
      daysAgo: 0,
      lines: [
        { sku: 'AP07-M', quantity: 4, done: true },
        { sku: 'AP02-S', quantity: 3, done: false },
        { sku: 'FW06-43', quantity: 2, done: false },
        { sku: 'AC03-OS', quantity: 3, done: false },
      ],
    },
    {
      name: 'Nutrition shelf',
      status: 'draft',
      notes: null,
      daysAgo: 2,
      lines: [
        { sku: 'NU06-OS', quantity: 8, done: false },
        { sku: 'NU02-OS', quantity: 10, done: false },
      ],
    },
    { name: 'Weekend promo', status: 'draft', notes: 'Waiting for the promo plan.', daysAgo: 0, lines: [] },
  ],
};
