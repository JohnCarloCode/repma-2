import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

// design/pages/landing.md — public marketing page. Styles live in styles/landing.css, scoped under `.landing`.

const PRODUCTS = [
  { id: 'p1', name: 'Cadri #8 First Jersey 2025', category: 'First Competition' },
  { id: 'p2', name: 'Evergreen Hoodie', category: 'Evergreen Collection' },
  { id: 'p3', name: 'Dusk T-Shirt', category: 'Dusk Collection' },
];
const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];
const LOG_LIMIT = 6;

interface DemoEvent {
  text: string;
  kind: 'out' | 'back';
  who: string;
  when: string;
}

const INITIAL_OUT: Record<string, string[]> = { p1: ['L'], p2: [], p3: ['S'] };
const INITIAL_EVENTS: DemoEvent[] = [
  { text: 'Cadri #8 First Jersey 2025, size L', kind: 'out', who: 'Manager, Downtown Store', when: '3 days ago' },
  { text: 'Dusk T-Shirt, size S', kind: 'out', who: 'Employee, Downtown Store', when: '1 day ago' },
];

/** The interactive "flag a size" demo: local state only, mirrors the immutable event log idea (nothing is edited, events are added). */
function SizeDemo() {
  const [out, setOut] = useState(INITIAL_OUT);
  const [events, setEvents] = useState(INITIAL_EVENTS);
  const count = Object.values(out).reduce((n, sizes) => n + sizes.length, 0);

  function toggle(productId: string, productName: string, size: string) {
    const current = out[productId] ?? [];
    const isOut = current.includes(size);
    setOut({ ...out, [productId]: isOut ? current.filter((s) => s !== size) : [...current, size] });
    setEvents([
      { text: `${productName}, size ${size}`, kind: isOut ? 'back' : 'out', who: 'You, Downtown Store', when: 'just now' },
      ...events,
    ]);
  }

  return (
    <div className="lab">
      <div>
        <h3>Try it: flag a size</h3>
        <p className="hint">
          Tap a size to mark it out of stock. Tap again when it&apos;s back. Real products from the demo catalog.
        </p>
        <div className="rows">
          {PRODUCTS.map((p) => (
            <div className="row" key={p.id}>
              <div>
                <div className="name">{p.name}</div>
                <div className="cat">{p.category}</div>
              </div>
              <div className="sizes">
                {SIZES.map((s) => {
                  const isOut = out[p.id]?.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      className="size"
                      aria-pressed={!!isOut}
                      aria-label={`${p.name} size ${s}${isOut ? ', out of stock' : ', available'}`}
                      onClick={() => toggle(p.id, p.name, s)}
                    >
                      <span className="dot" />
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <p className="tally">
          {count} {count === 1 ? 'size' : 'sizes'} out of stock. Units in stock: not tracked.
        </p>
      </div>
      <div>
        <h3>Event log</h3>
        <p className="hint">Each tap adds an event. Nothing is edited in place, and no quantity is stored anywhere.</p>
        <ul className="log" aria-label="Event log">
          {events.slice(0, LOG_LIMIT).map((e, i) => (
            <li key={events.length - i}>
              <span>
                <b className={e.kind}>{e.kind === 'out' ? 'Marked out of stock' : 'Marked available'}</b> {e.text}
              </span>
              <time>
                {e.who}, {e.when}
              </time>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Arrow({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const SCREENS = [
  { file: 'home', alt: 'Home dashboard with open lists and sizes out of stock', title: 'Home.', text: 'Open lists, items to replenish and sizes out right now.' },
  { file: 'availability', alt: 'Availability list with sizes marked out of stock', title: 'Availability.', text: 'One row per product, one chip per size, days out on the right.' },
  { file: 'replenishment', alt: 'Replenishment lists with draft, in progress and done statuses', title: 'Replenishment.', text: 'Lists with a status, written by the team.' },
  { file: 'catalog', alt: 'Global catalog with products and assortment status', title: 'Catalog.', text: 'The global catalog, with what each store carries.' },
];

const ROLES_TABLE: [string, boolean, boolean, boolean][] = [
  ['Manage stores and users', true, false, false],
  ['Manage the global catalog', true, false, false],
  ["Add products to a store's assortment", true, true, false],
  ['Flag availability', true, true, true],
  ['Read the activity feed', true, true, true],
  ['Create and edit replenishment lists', true, true, true],
];

/** Strip auto-scroll speed (px per second) and how long manual input holds it back (ms). */
const STRIP_SPEED = 40;
const STRIP_HOLD = 1500;
/** The strip renders its screens three times so it can wrap around invisibly. */
const STRIP_COPIES = 3;

const LINKEDIN_URL = 'https://www.linkedin.com/in/johncarlogarciano/';
const CONTACT_EMAIL = 'garcianojohncarlo2001@gmail.com';

export function LandingPage() {
  const strip = useRef<HTMLDivElement>(null);
  const contact = useRef<HTMLDialogElement>(null);
  const openContact = () => contact.current?.showModal();
  const holdUntil = useRef(0);
  const hovering = useRef(false);
  const hold = (ms = STRIP_HOLD) => {
    holdUntil.current = performance.now() + ms;
  };
  // Endless auto-scroll: one set of screens is `setW` wide; the strip sits in the middle copy and jumps
  // by `setW` whenever it leaves it, so the loop never shows a seam. Paused while hovered, focused,
  // touched or scrolled by hand, and off for reduced motion.
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const setWidth = () => {
      const shots = el.children;
      const first = shots[0] as HTMLElement | undefined;
      const next = shots[SCREENS.length] as HTMLElement | undefined;
      return first && next ? next.offsetLeft - first.offsetLeft : 0;
    };
    const wrap = () => {
      const w = setWidth();
      if (w <= 0) return;
      if (el.scrollLeft >= 2 * w) el.scrollLeft -= w;
      else if (el.scrollLeft <= 0) el.scrollLeft += w;
    };
    const start = setWidth();
    if (start > 0) el.scrollLeft = start;
    el.addEventListener('scroll', wrap, { passive: true });

    let raf = 0;
    let last = performance.now();
    let pos = el.scrollLeft;
    const frame = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      if (reduced || hovering.current || now < holdUntil.current) pos = el.scrollLeft;
      else if (setWidth() > 0) {
        pos += (STRIP_SPEED * dt) / 1000;
        el.scrollLeft = pos;
        pos = Math.max(pos, el.scrollLeft); // keep sub-pixel progress, follow the wrap jump
        if (Math.abs(pos - el.scrollLeft) > 1) pos = el.scrollLeft;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', wrap);
    };
  }, []);

  return (
    <div className="landing">
      <header className="nav">
        <div className="w">
          <a className="brand" href="#top" aria-label="REPMA home">
            <img src="/logo.svg" alt="" />
            <span>REPMA</span>
          </a>
          <nav className="nav-links" aria-label="Sections">
            <a href="#top">Home</a>
            <a href="#product">Product</a>
            <a href="#how">How it works</a>
            <a href="#roles">Roles</a>
          </nav>
          <div className="nav-actions">
            <button type="button" className="btn ghost" onClick={openContact}>
              Contact me
            </button>
            <Link className="btn" to="/login">
              Try the demo
            </Link>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="w">
            <h1>
              Every store knows what&apos;s out and what to restock
              <img src="/logo-blink.svg" alt="" />
            </h1>
            <p className="lede">
              REPMA is an availability and replenishment platform for retail chains. Staff flag a size when it runs out
              and keep their own restock lists. Nobody counts stock.
            </p>
            <div className="cta">
              <Link className="btn lg" to="/login">
                Try the demo
              </Link>
              <a className="btn lg ghost" href="#product">
                See the product
              </a>
            </div>
            <p className="typed" aria-label="From missing sizes to a restock plan">
              <span aria-hidden="true">From missing sizes to a restock plan</span>
            </p>
            <div className="stage">
              <div className="screen">
                <img src="/landing/hero-home.gif" alt="REPMA home screen for Downtown Store showing open replenishment lists and out-of-stock sizes" />
              </div>
            </div>
            <div className="facts">
              <span>Immutable availability event log</span>
              <span>Postgres row-level security per store</span>
              <span>Three roles, one permission matrix</span>
            </div>
          </div>
        </section>

        <section className="band statement" id="problem">
          <div className="w">
            <h2>A stock count is out of date before it&apos;s finished.</h2>
            <p className="sub">
              What the shop floor needs is simpler: is size M of this shirt on the rack or not. REPMA records exactly
              that, per store, with who and when.
            </p>
            <SizeDemo />
          </div>
        </section>

        <section className="band" id="screens" style={{ paddingTop: 0 }}>
          <div className="strip-head w">
            <p>See the day at a glance, flag sizes, plan the restock, browse the catalog. Scroll sideways.</p>
          </div>
          <div
            className="strip"
            ref={strip}
            tabIndex={0}
            role="region"
            aria-label="REPMA screens"
            onMouseEnter={() => (hovering.current = true)}
            onMouseLeave={() => (hovering.current = false)}
            onFocusCapture={() => (hovering.current = true)}
            onBlurCapture={() => (hovering.current = false)}
            onTouchStart={() => hold(STRIP_HOLD * 3)}
            onWheel={() => hold()}
          >
            {Array.from({ length: STRIP_COPIES }, (_, copy) =>
              SCREENS.map((s) => (
                <figure className="shot" key={`${copy}-${s.file}`} aria-hidden={copy === 1 ? undefined : true}>
                  <div className="screen">
                    <img src={`/landing/shot-${s.file}.jpg`} alt={copy === 1 ? s.alt : ''} loading="lazy" />
                  </div>
                  <figcaption>
                    <b>{s.title}</b> {s.text}
                  </figcaption>
                </figure>
              )),
            )}
          </div>
        </section>

        <section className="band" id="product" style={{ paddingTop: 0 }}>
          <div className="w">
            <div className="feat">
              <div className="copy">
                <h3>Flag a size the moment it&apos;s gone.</h3>
                <p>
                  Each product is a row of its sizes. Mark one out of stock and the row shows how long it has been out.
                  Mark it back when it returns.
                </p>
                <ul>
                  <li>Every change is an event with person, store and time.</li>
                  <li>Filter to out-of-stock only, or search by name or SKU.</li>
                  <li>The app never shows a stock quantity.</li>
                </ul>
              </div>
              <div className="stage">
                <div className="screen">
                  <img src="/landing/flag-size.gif" alt="Searching the availability list, marking a size out of stock, then marking it restocked" loading="lazy" />
                </div>
              </div>
            </div>

            <div className="feat flip">
              <div className="stage">
                <div className="screen">
                  <img src="/landing/replenishment-lists.gif" alt="Opening a replenishment list, ticking an item off and editing its requested quantity while progress updates" loading="lazy" />
                </div>
              </div>
              <div className="copy">
                <h3>Replenishment lists you write yourself.</h3>
                <p>
                  A list has a name, notes, a status and a requested quantity for each product and size. Tick items as
                  they come out of the stockroom.
                </p>
                <ul>
                  <li>Draft, In progress, Done, with progress shown as items ticked.</li>
                  <li>Group by category when the stockroom is organized that way.</li>
                  <li>Never generated from availability flags. What to restock is a decision.</li>
                </ul>
              </div>
            </div>

            <div className="feat">
              <div className="copy">
                <h3>One catalog, a different assortment per store.</h3>
                <p>
                  Platform admins maintain products, sizes and categories once. Each store picks the products it carries
                  and sees only its own availability.
                </p>
                <ul>
                  <li>Seeded with 24 products in jersey, hoodie, jacket and tracksuit lines.</li>
                  <li>Product photos in the picker and on every list.</li>
                  <li>Managers add to the assortment. Employees flag sizes.</li>
                </ul>
              </div>
              <div className="stage">
                <div className="screen">
                  <img src="/landing/catalog-stores.gif" alt="Platform admin switching between Downtown Store and North Store, with the Evergreen products in assortment in one store and not in the other" loading="lazy" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="band" id="how" style={{ paddingTop: 0 }}>
          <div className="w">
            <h2 className="steps-h">From empty rack to restocked, in three steps.</h2>
            <div className="steps">
              <div className="step">
                <h3>Open your store</h3>
                <p>
                  Sign in. You land on your store&apos;s home with open lists and the sizes currently out. Platform
                  admins pick a store from the sidebar.
                </p>
              </div>
              <div className="step">
                <h3>Flag what&apos;s out</h3>
                <p>
                  Tap the size on the availability list. An event is written and the row starts counting days out. Tap
                  it again when it&apos;s back.
                </p>
              </div>
              <div className="step">
                <h3>Plan the restock</h3>
                <p>
                  Start a replenishment list, add products and sizes with quantities, and tick them off. The list is
                  yours, not generated from flags.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="band" id="any-shop" style={{ paddingTop: 0 }}>
          <div className="w roles-grid">
            <div className="copy">
              <h2>The demo is clothing. The idea fits any shop.</h2>
              <p>
                Nothing in REPMA is specific to apparel. If you sell products and need to know what ran out, it works:
                you list your products, flag what is missing and keep your own restock lists. It records what is
                missing, never how much is left.
              </p>
              <p>
                It is multi-tenant, so a chain, a franchise or several unrelated venues can live side by side, each with
                its own assortment and its own data.
              </p>
            </div>
            <ul className="biz" aria-label="Kinds of business">
              {['Clothing and sportswear', 'Restaurants', 'Cafés and bakeries', 'Pharmacies', 'Florists', 'Any retail chain'].map(
                (name) => (
                  <li key={name}>{name}</li>
                ),
              )}
            </ul>
          </div>
        </section>

        <section className="band" id="roles" style={{ paddingTop: 0 }}>
          <div className="w roles-grid flip">
            <div className="copy">
              <h2>Many stores. Three roles. One permission matrix.</h2>
              <p>
                Access is decided by permission, never by a role name in the code. Each store&apos;s data is isolated in
                the database with row-level security, and isolation tests block the build.
              </p>
            </div>
            <div className="tbl" role="region" aria-label="Permissions by role" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>Can</th>
                    <th className="c">Platform admin</th>
                    <th className="c">Manager</th>
                    <th className="c">Employee</th>
                  </tr>
                </thead>
                <tbody>
                  {ROLES_TABLE.map(([can, ...allowed]) => (
                    <tr key={can}>
                      <td>{can}</td>
                      {allowed.map((yes, i) => (
                        <td key={i} className={yes ? 'y' : 'n'}>
                          {yes ? 'Yes' : 'No'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="band final" style={{ paddingTop: 0 }}>
          <div className="w">
            <div className="cta-card">
              <h2>Open the demo, flag a size, plan the restock.</h2>
              <p>One tap shows how a store&apos;s availability changes, and a list shows what happens next.</p>
              <div className="cta">
                <Link className="btn lg" to="/login">
                  Try the demo
                </Link>
                <button type="button" className="btn lg ghost" onClick={openContact}>
                  Contact me
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="w">
          <div className="foot-top">
            <div>
              <a className="brand" href="#top" aria-label="REPMA, back to top">
                <img src="/logo-blink.svg" alt="" />
              </a>
              <p className="tag">
                Availability and replenishment for retail chains. Built to show engineering quality: TypeScript, Express,
                Postgres with RLS, React.
              </p>
            </div>
            <nav aria-label="Footer">
              <b>Product</b>
              <a href="#product">Features</a>
              <a href="#how">How it works</a>
              <a href="#roles">Roles</a>
            </nav>
            <nav aria-label="Try it">
              <b>Try it</b>
              <Link to="/login">Open the demo</Link>
              <button type="button" onClick={openContact}>
                Contact me
              </button>
            </nav>
          </div>
          <div className="mark" aria-hidden="true">
            REPMA
          </div>
          <div className="legal">REPMA demo project. All data in the demo is sample data.</div>
        </div>
      </footer>

      <dialog
        ref={contact}
        className="contact"
        aria-labelledby="contact-title"
        onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
      >
        <button type="button" className="contact-close" aria-label="Close" onClick={() => contact.current?.close()}>
          <Arrow d="M6 6l12 12M18 6L6 18" />
        </button>
        <h2 id="contact-title">Get in touch</h2>
        <p>Questions about REPMA, or want to talk about the project? Reach me here.</p>
        <a className="contact-link" href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer">
          <span>LinkedIn</span>
          <code>in/johncarlogarciano</code>
        </a>
        <a className="contact-link" href={`mailto:${CONTACT_EMAIL}`}>
          <span>Email</span>
          <code>{CONTACT_EMAIL}</code>
        </a>
      </dialog>
    </div>
  );
}
