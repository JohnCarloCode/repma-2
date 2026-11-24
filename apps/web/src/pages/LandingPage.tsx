import { useRef } from 'react';
import { Link } from 'react-router';

// design/pages/landing.md — public marketing page. Styles live in styles/landing.css, scoped under `.landing`.

function Arrow({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const ROLES_TABLE: [string, boolean, boolean, boolean][] = [
  ['Manage stores and users', true, false, false],
  ['Manage the global catalog', true, false, false],
  ["Add products to a store's assortment", true, true, false],
  ['Flag availability', true, true, true],
  ['Read the activity feed', true, true, true],
  ['Create and edit replenishment lists', true, true, true],
];

const LINKEDIN_URL = 'https://www.linkedin.com/in/johncarlogarciano/';
const CONTACT_EMAIL = 'garcianojohncarlo2001@gmail.com';

export function LandingPage() {
  const contact = useRef<HTMLDialogElement>(null);
  const openContact = () => contact.current?.showModal();
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
              Flag sizes the moment they run out and keep your restock lists, all in one place. No stock counting.
            </p>
            <div className="cta">
              <Link className="btn lg" to="/login">
                Try the demo
              </Link>
              <a className="btn lg ghost" href="#product">
                See the product
              </a>
            </div>
            <div className="stage">
              <div className="screen">
                <img src="/landing/hero-home.gif" alt="REPMA home screen for Downtown Store showing open replenishment lists and out-of-stock sizes" />
              </div>
            </div>
          </div>
        </section>

        <section className="band tint" id="how">
          <div className="w">
            <h2 className="steps-h">From empty rack to restocked, in three steps.</h2>
            <div className="steps cards">
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

        <section className="band" id="product">
          <div className="w">
            <div className="feat">
              <div className="copy">
                <h3>Flag a size the moment it&apos;s gone.</h3>
                <p>
                  Each product is a row of its sizes. Mark one out of stock and the row shows how long it has been out.
                  Mark it back when it returns.
                </p>
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
              </div>
            </div>

            <div className="feat">
              <div className="copy">
                <h3>One catalog, a different assortment per store.</h3>
                <p>
                  Platform admins maintain products, sizes and categories once. Each store picks the products it carries
                  and sees only its own availability.
                </p>
              </div>
              <div className="stage">
                <div className="screen">
                  <img src="/landing/catalog-stores.gif" alt="Platform admin switching between Downtown Store and North Store, with the Evergreen products in assortment in one store and not in the other" loading="lazy" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="band blue" id="any-shop">
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

        <section className="band" id="roles">
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
