FROM node:22-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
# Give the build headroom: `next build` OOM-kills at "Collecting build traces"
# on the memory-constrained build host as the app grows. Raise Node's heap so
# trace collection can finish. If the build container has a hard memory limit
# below this, raise that limit in Coolify instead — this only lifts the JS heap.
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/.next/static ./.next/standalone/.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/public ./.next/standalone/public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/db ./db
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
EXPOSE 3000
CMD ["node", ".next/standalone/server.js"]
