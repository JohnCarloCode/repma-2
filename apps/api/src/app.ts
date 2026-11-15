import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env, frontendUrls } from './config/env.js';
import { createHealthHandler } from './core/health.js';
import { errorHandler, notFoundHandler } from './core/errors.js';
import { serveWeb } from './core/http/web.js';
import { byIp, rateLimit } from './core/rateLimit/rateLimit.js';
import { pingDatabase } from './db/client.js';
import { authRouter } from './modules/auth/router.js';
import { availabilityRouter } from './modules/availability/router.js';
import { tenantsRouter } from './modules/tenants/router.js';

// architecture.md §3.3 request pipeline:
//   helmet → cors(allowlist) → json(100kb) → /api/v1 router → web (RNF-11) → … → errorHandler
const supabaseOrigin = new URL(env.SUPABASE_URL).origin;

export const app = express();

app.set('trust proxy', 1); // RNF-09 — correct client IPs behind the deploy proxy
app.disable('x-powered-by'); // RNF-04

// Structured request logs with a request id (architecture.md §8). Credentials
// never reach the logs: the session cookie both ways and the Bearer header.
app.use(
  pinoHttp({
    redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
  }),
);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'img-src': ["'self'", supabaseOrigin], // RNF-04 — product images from Storage
      },
    },
  }),
);

app.use(cors({ origin: frontendUrls, credentials: true })); // RNF-05

app.use(express.json({ limit: '100kb' })); // RNF-06
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

const v1 = express.Router();

// RNF-10; public, so limited per IP under the read family (RNF-07).
v1.get('/health', rateLimit('read', byIp), createHealthHandler(() => pingDatabase()));
v1.use('/auth', authRouter);
v1.use('/tenants', tenantsRouter);
v1.use('/availability', availabilityRouter);

app.use('/api/v1', v1);

// RNF-11 — the web build, same origin. Resolved from this file (src/ in tests,
// dist/ in prod — both two levels under apps/), never from cwd. Absent in dev
// (Vite serves the web) and in CI tests (run before the build): not mounted.
const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
if (existsSync(`${webDist}/index.html`)) {
  app.use(serveWeb(webDist));
}

app.use(notFoundHandler);
app.use(errorHandler);
