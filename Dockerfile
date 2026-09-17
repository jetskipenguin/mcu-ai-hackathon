FROM node:22.22.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY portal ./portal
COPY countersign ./countersign
COPY dashboard ./dashboard
RUN npm run build && npm prune --omit=dev

FROM node:22.22.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY portal/data ./portal/data
COPY countersign/client ./countersign/client
COPY countersign/policy ./countersign/policy
COPY data/cui ./data/cui
EXPOSE 3000 3001
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/login').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/portal/server.js"]
