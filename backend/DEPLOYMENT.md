# Nexus CRM Backend — Hosting & Deployment

How the backend API is hosted: Docker image build/upload, port forwarding,
nginx reverse proxy, and which folder lives where.

```
                                    ┌──────────────────────────────┐
   Browser ──► shadowcodes.in/CRM ► │  Linux box (myserver)        │
                                    │  aaPanel, host prdinfotech    │
                                    │                              │
                                    │  nginx ─► 127.0.0.1:5001     │
                                    │           Docker: nexus_crm  │
                                    └──────────────────────────────┘
```

- Backend = Docker container on the **Linux aaPanel box** (`myserver`),
  public at `https://shadowcodes.in/CRM/` via nginx reverse proxy → host port `5001`.
- One DB = one company (`CompId=1`). Multi-tenancy is in-app (CompId/BranchId),
  **not** one-container-per-client.

> **Rule:** Claude never runs `ssh` / `rsync` / remote `docker`. It writes the
> commands; the user runs them.

---

## 1. Docker

### 1.1 What the image is

`backend/Dockerfile` — `node:20-alpine`:

- installs pnpm, then prod deps from the **locked** manifest (`pnpm install --prod --frozen-lockfile`) as a cached layer,
- copies source, `mkdir -p uploads`,
- `EXPOSE 5001`, `ENV HOST=0.0.0.0` (so the port is reachable from the host — binding `127.0.0.1` inside the container would hide it),
- `HEALTHCHECK` hits `/health`,
- `CMD node src/server.js`.

`backend/docker-compose.yml` — single service `crm`:

- `container_name: nexus_crm`, `restart: always`,
- **port map `5001:5001`** (host:container),
- env from `.env.prd` (+ inline `NODE_ENV/PORT/HOST`),
- **volume `./CRMUploads:/app/uploads`** — per-client uploads on the host, survive rebuilds,
- `nexus_network` bridge, json-file logging (10m × 3).

### 1.2 Server folder layout

```
/www/wwwroot/shadowcodes.in/CRM/        <- REMOTE  (the deploy dir on myserver)
├── src/                                 rsync'd app source
├── package.json  pnpm-lock.yaml  pnpm-workspace.yaml
├── Dockerfile  docker-compose.yml  .dockerignore
├── .env.prd                             prod env (git-ignored, travels via rsync)
└── CRMUploads/                          host volume, auto-created, per-entity subfolders
    ├── task/  ticket/  lead/            created by the app on first upload
```

`.dockerignore` keeps `node_modules`, `.env*`, `tests`, `sql`, `uploads`,
`CRMUploads`, `*.md`, `ecosystem.config.js` **out of the image**. The env file is
loaded at runtime by compose `env_file`, never baked in.

### 1.3 Upload (build) + deploy

Transport is **always `rsync`** (idempotent, `-c` checksum skips unchanged; add
`-n` for a dry-run preview). Run from `backend/`:

```bash
REMOTE=/www/wwwroot/shadowcodes.in/CRM

# 1. code + deploy config + prod env (env travels with the code)
rsync -avzc src/ myserver:$REMOTE/src/
rsync -avzc package.json pnpm-lock.yaml pnpm-workspace.yaml \
      Dockerfile docker-compose.yml .dockerignore .env.prd myserver:$REMOTE/

# 2. build + (re)start just the crm service, then tail
ssh myserver "cd $REMOTE && docker compose up -d --build crm && docker compose logs crm --tail=50"
```

- `docker compose up -d --build crm` rebuilds the image and restarts the one
  service. No dep change → the `pnpm install` layer stays cached (fast).
- SQL is **never** shipped or run by the container — schema is applied by hand
  (see `backend/sql/`).

### 1.4 Uploads folder — auto-created

Nothing to pre-create. The app writes to `/app/uploads/<entity>/`; compose maps
that to `./CRMUploads` on the host. On first upload for an entity the app
`mkdir`s the subfolder. A second isolated instance = copy the compose service
block, rename `container_name` + host volume dir + port + `env_file`.

---

## 2. Port forwarding

- **Convention: the CRM API always uses the 5000 range** — `5001` first, then
  `5002`, … for further instances. The `30xx`/`80xx` ranges on the box belong to
  the eStock docker cluster + PM2 apps — never collide.
- Container listens on `0.0.0.0:5001` (via `HOST` env). Compose maps host
  `5001` → container `5001`. nginx talks to `127.0.0.1:5001`.

---

## 3. Reverse proxy (nginx, aaPanel)

The container only listens on `127.0.0.1:5001`. nginx maps the public HTTPS path
`/CRM/` → it.

**One file** does it — aaPanel auto-includes `proxy/shadowcodes.in/*.conf` from
the site conf:

```
/www/server/panel/vhost/nginx/proxy/shadowcodes.in/CRM.conf
```

```nginx
#PROXY-START/CRM/
location ^~ /CRM/
{
    proxy_pass http://127.0.0.1:5001/;   # trailing slash strips the /CRM prefix -> backend sees /health, /api/...
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header REMOTE-HOST $remote_addr;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_http_version 1.1;
    add_header X-Cache $upstream_cache_status;
    set $static_fileCRM 0;
    if ( $uri ~* "\.(gif|png|jpg|css|js|woff|woff2)$" ) { set $static_fileCRM 1; expires 1m; }
    if ( $static_fileCRM = 0 ) { add_header Cache-Control no-cache; }
}
#PROXY-END/CRM/
```

Apply / reload (mandatory — editing the file alone does nothing):

```bash
nginx -t && nginx -s reload
curl -s https://shadowcodes.in/CRM/health   # expect 200 JSON
```

Gotchas:
- **`nginx -s reload` is mandatory** — a stale reload was the one 404 hit.
- `location ^~ /CRM/` (prefix, high-priority) beats any SPA `location /`.
- Trailing slash on `proxy_pass` strips the `/CRM` prefix so the backend sees
  `/health`, `/api/...`.
- Public API base = `https://shadowcodes.in/CRM`.

---

## 4. Quick reference — where which folder

| Thing | Path (on `myserver`) |
|-------|------|
| Deploy dir (`REMOTE`) | `/www/wwwroot/shadowcodes.in/CRM/` |
| Uploads host volume | `…/CRM/CRMUploads/` (→ `/app/uploads` in container) |
| Prod env file | `…/CRM/.env.prd` |
| nginx proxy conf | `/www/server/panel/vhost/nginx/proxy/shadowcodes.in/CRM.conf` |
| Host port | `5001` (5000-range convention) |
| Public API URL | `https://shadowcodes.in/CRM/` |
