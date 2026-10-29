FROM node:22-bookworm-slim AS builder
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.base.json ./
COPY app/package.json app/package.json
COPY server/package.json server/package.json
RUN npm ci
COPY app app
RUN npm run build -w app

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data PUBLIC_DIR=/app/app/dist STARTER_BANK=/app/data/starter-bank.json
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY server/src server/src
COPY data/*.json data/
COPY --from=builder /workspace/app/dist app/dist
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=4 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/src/server.js"]
