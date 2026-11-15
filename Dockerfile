# Single production image (RNF-14, architecture §8): build every workspace,
# then ship a slim runtime with the API's prod dependencies, the built
# shared package and web/dist (served by the API from Phase 2, RNF-11).

# ---- build ----
FROM node:22-slim AS build
WORKDIR /app

# Manifests first so the install layer is cached across source changes.
# --ignore-scripts: the root postinstall builds shared, whose sources are
# not copied yet; `npm run build` builds it below.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --ignore-scripts

COPY apps apps
COPY packages packages
RUN npm run build

# ---- runtime ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --ignore-scripts --workspace=api \
  && npm cache clean --force

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist

USER node
WORKDIR /app/apps/api
ENV PORT=3000
EXPOSE 3000
# node directly (not npm start) so SIGTERM reaches the server's shutdown hook.
CMD ["node", "dist/server.js"]
