FROM node:20-alpine
WORKDIR /app

RUN npm install -g pnpm

# Install prod deps from the locked manifest first (cached layer).
# pnpm-workspace.yaml is needed so --frozen-lockfile matches the workspace
# lockfile (packages: ["."] — this dir is the sole workspace member).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

# App source
COPY . .

# Uploads dir (mount target for the per-client host volume)
RUN mkdir -p uploads

EXPOSE 5001

# Bind 0.0.0.0 inside the container so the port is reachable from the host
ENV HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:${PORT:-5001}/health || exit 1

CMD ["node", "src/server.js"]
