# Deploying the API on EC2

## Env file names (important)

The server **does not** load `.env.dev`. It loads **one** file based on `NODE_ENV`:

| `NODE_ENV`     | File loaded          |
|----------------|----------------------|
| `development`  | `.env.development`   |
| `staging`      | `.env.uat`           |
| `test`         | `.env.test`          |
| `production`   | `.env.production`    |

If you copied settings to `.env.dev` on the server, rename it:

```bash
cd /path/to/ecommreco-backend
mv .env.dev .env.development   # only if NODE_ENV=development
```

For a production-style EC2 deploy, use `.env.production` and `NODE_ENV=production`.

## Do not run `node dist/src/main.js` directly

That **skips** `.env.development` / `.env.production`. You will see:

- `POSTMARK_API_KEY is not set`
- MongoDB testing `mongodb://127.0.0.1:27017/sellerspl` (defaults)

Always load env first via one of the commands below.

## Typical EC2 startup (production)

```bash
cd ecommreco-backend
npm ci --include=dev
npm run build
export NODE_ENV=production
node server.js
# or: npm run prod
# or: npm run start:dist:prod
```

## EC2 with `.env.development` + compiled build

```bash
npm run build
npm run start:dist:dev
# same as: NODE_ENV=development node start-dist.js
```

`npm start` / `npm run prod` always set `NODE_ENV=production` and read **`.env.production`**, not `.env.development`.

## MongoDB Atlas from EC2

Your `.env.development` uses `ALLOW_MEMORY_DB_FALLBACK=false`. If Atlas is unreachable, the app **exits** with:

`Could not connect to configured MongoDB URIs...`

Fix on Atlas:

1. **Network Access** → add the EC2 **public IP** (or `0.0.0.0/0` for testing only).
2. Confirm `MONGODB_URI` password is URL-encoded (`@` → `%40`).
3. Use the same **standard** `mongodb://` host list as in `.env.development` (not only `mongodb+srv` if DNS fails).

Test from the EC2 box:

```bash
export NODE_ENV=development   # or production
node scripts/test-mongodb-connection.js
```

## EC2 `.env` checklist

Public URLs (no per-deploy edits after the first setup):

```env
# api-dev  (NODE_ENV=development → .env.development)
FRONTEND_URL=https://dev.ecommreco.com
API_PUBLIC_URL=https://api-dev.ecommreco.com

# api-test (NODE_ENV=test → .env.test)
FRONTEND_URL=https://test.ecommreco.com
API_PUBLIC_URL=https://api-test.ecommreco.com

# api-prod (NODE_ENV=production → .env.production)
FRONTEND_URL=https://ecommreco.com
API_PUBLIC_URL=https://api.ecommreco.com
```

## Health check

After start:

```bash
curl http://127.0.0.1:5000/api/v1/health
curl http://127.0.0.1:5000/
```

Open **security group** port `5000` (or proxy via Nginx on 80/443).

## Nginx — fix `413 Request Entity Too Large` on large report uploads

Dev/UAT API hosts (`api-dev.ecommreco.com`, etc.) sit behind **nginx**. Nginx defaults to **`client_max_body_size 1m`**, so Flipkart/Amazon Excel files larger than ~1 MB are rejected **before** they reach NestJS (local dev has no nginx, so uploads work there).

Health check confirms nginx: `Server: nginx/1.24.0 (Ubuntu)`.

### One-time fix on EC2

```bash
cd ~/ecommreco_dev/ecommreco-backend   # adjust path
git pull
chmod +x scripts/apply-nginx-upload-limits.sh
./scripts/apply-nginx-upload-limits.sh
```

Or manually:

```bash
sudo cp deploy/nginx/snippets/upload-limits.conf /etc/nginx/snippets/ecommreco-upload-limits.conf
```

Add **inside** the `server { ... }` block for `api-dev.ecommreco.com`:

```nginx
include /etc/nginx/snippets/ecommreco-upload-limits.conf;
```

Then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

This sets `client_max_body_size 100m` (matches app multer limit) and longer proxy timeouts for slow uploads.

Full example site file: `deploy/nginx/api-dev.ecommreco.com.conf`.

## PM2 (development on EC2)

`ecosystem.config.js` defines **`api-dev`**, **`api-test`**, **`api-uat`**, and **`api-prod`**. Each app uses `start-dist.js` and loads the matching `.env.*` file from `NODE_ENV`.

```bash
cd ~/ecommreco_dev/ecommreco-backend
ls -la .env.development    # must exist and contain MONGODB_URI, JWT_SECRET, etc.
npm run build
pm2 delete all             # stop api-prod if it was started by mistake
pm2 start ecosystem.config.js --only api-dev
pm2 logs api-dev
curl http://127.0.0.1:5000/api/v1/health
pm2 save
```

### Test server (`api-test.ecommreco.com`)

The test API must run the **latest compiled build**. A 404 on routes like `/api/v1/report-imports/platform-analytics` means the server is still on an old build (Nest returns 401 when the route exists but you are not logged in).

```bash
cd ~/ecommreco_test/ecommreco-backend   # adjust path on EC2
git pull
npm ci --include=dev
npm run build
ls -la .env.test                        # must exist on the server
pm2 start ecosystem.config.js --only api-test   # first time
# or after deploy:
pm2 restart api-test
npm run verify:routes -- https://api-test.ecommreco.com
```

Expected after deploy:

```text
[OK] GET /api/v1/report-imports/platform-analytics?... → 401
```

If you see `404`, the new build was not picked up — check `pm2 describe api-test` → `script path` and `cwd`.

**Do not start `api-prod`** unless you add a real `.env.production` file.

Do **not** point PM2 at `dist/main.js` (wrong path) or `dist/src/main.js` (skips dotenv).

If PM2 logs `Cannot find module '../config/env-file'`, rebuild after pulling latest code (`npm run build`) — env resolution now lives in `src/config/env-file.ts` and compiles to `dist/src/config/env-file.js`.

## Common errors

| Symptom | Cause | Fix |
|---------|--------|-----|
| `Missing dist/src/main.js` | Started with `production` without build | `npm run build` |
| `MONGODB_URI is not set` | Wrong env file / empty production env | Use `.env.production` with URI, or `NODE_ENV=development` + `.env.development` |
| `Could not connect to MongoDB` | Atlas IP block / wrong URI | Atlas allowlist + `npm run db:test` on EC2 |
| Env vars ignored | File named `.env.dev` | Rename to `.env.development` or `.env.production` |
| CORS errors in browser | `FRONTEND_URL` still localhost / dev origin missing | Set `FRONTEND_URL=https://dev.ecommreco.com` in `.env.development` on EC2; redeploy API. Code also allows all `https://*.ecommreco.com` origins. |
| `413 Request Entity Too Large` on file upload | Nginx `client_max_body_size` default 1m | Run `scripts/apply-nginx-upload-limits.sh` or add `deploy/nginx/snippets/upload-limits.conf` (see Nginx section above) |
