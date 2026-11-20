FROM node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS base
WORKDIR /app
ENV OPENUI_TELEMETRY_DISABLED=1

FROM base AS manifests
COPY .npmrc package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/travel-ui/package.json packages/travel-ui/

FROM manifests AS deps
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS test
RUN install -d -o node -g node -m 0750 /data
COPY --from=build --chown=node:node app ./
USER node
CMD ["npm", "run", "test:offline"]

FROM manifests AS production-deps
RUN npm ci --omit=dev --no-audit --no-fund

FROM base AS runtime
ENV NODE_ENV=production
RUN install -d -o node -g node -m 0750 /data
COPY --from=production-deps app ./
COPY --from=build app/apps/api/dist/*.js apps/api/dist/
COPY --from=build app/apps/api/dist/db/database.js apps/api/dist/db/
COPY --from=build app/apps/api/dist/db/migrations/ apps/api/dist/db/migrations/
COPY --from=build app/apps/api/dist/auth/*.js apps/api/dist/auth/
COPY --from=build app/apps/api/dist/trips/*.js apps/api/dist/trips/
COPY --from=build app/apps/web/dist/ apps/web/dist/
COPY --from=build app/packages/contracts/dist/index.js packages/contracts/dist/
COPY --from=build app/packages/travel-ui/dist/library.js app/packages/travel-ui/dist/validate.js packages/travel-ui/dist/
COPY --from=build app/packages/travel-ui/generated/schema.json packages/travel-ui/generated/
COPY --from=build app/assets/catalog/ assets/catalog/
USER node
EXPOSE 8080
CMD ["node", "apps/api/dist/main.js"]
