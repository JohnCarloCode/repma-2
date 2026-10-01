import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env, frontendUrls } from './config/env.js';
import { createHealthHandler } from './core/health.js';
import { errorHandler, notFoundHandler } from './core/errors.js';
import { pingDatabase } from './db/client.js';

// architecture.md §3.3 request pipeline:
//   helmet → cors(allowlist) → json(100kb) → /api/v1 router → … → errorHandler
const supabaseOrigin = new URL(env.SUPABASE_URL).origin;

export const app = express();

app.set('trust proxy', 1); // RNF-09 — correct client IPs behind the deploy proxy
app.disable('x-powered-by'); // RNF-04

app.use(pinoHttp()); // structured request logs with a request id (architecture.md §8)

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

v1.get('/health', createHealthHandler(() => pingDatabase())); // RNF-10

app.use('/api/v1', v1);

app.use(notFoundHandler);
app.use(errorHandler);
