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

Update values that still point at localhost:

```env
PORT=5000
FRONTEND_URL=https://your-frontend-domain.com
FRONTEND_URLS=https://your-frontend-domain.com,http://ec2-xx-xx-xx-xx.compute.amazonaws.com:8080
CORS_ALLOW_ALL=false
# or true only for temporary debugging

MONGODB_URI=...ecommreco_dev...   # or ecommreco_prod on production
MONGODB_DB_NAME=ecommreco_dev
JWT_SECRET=<long-random-string>
```

## Health check

After start:

```bash
curl http://127.0.0.1:5000/api/v1/health
curl http://127.0.0.1:5000/
```

Open **security group** port `5000` (or proxy via Nginx on 80/443).

## PM2 (recommended)

Use the repo `ecosystem.config.js` — it runs `start-dist.js` (loads `.env.*` then `dist/src/main.js`).

```bash
cd ~/ecommreco_dev/ecommreco-backend
npm run build
pm2 delete api-dev 2>/dev/null || true
pm2 start ecosystem.config.js --only api-dev
pm2 logs api-dev
curl http://127.0.0.1:5000/api/v1/health
pm2 save
```

For production env file:

```bash
pm2 start ecosystem.config.js --only api-prod
```

Do **not** point PM2 at `dist/main.js` (wrong path) or `dist/src/main.js` (skips dotenv).

## Common errors

| Symptom | Cause | Fix |
|---------|--------|-----|
| `Missing dist/src/main.js` | Started with `production` without build | `npm run build` |
| `MONGODB_URI is not set` | Wrong env file / empty production env | Use `.env.production` with URI, or `NODE_ENV=development` + `.env.development` |
| `Could not connect to MongoDB` | Atlas IP block / wrong URI | Atlas allowlist + `npm run db:test` on EC2 |
| Env vars ignored | File named `.env.dev` | Rename to `.env.development` or `.env.production` |
| CORS errors in browser | `FRONTEND_URL` still localhost | Set real site URL in env |
