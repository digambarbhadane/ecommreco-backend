# Swagger / OpenAPI Setup

## URLs (development)

| URL | Description |
|-----|-------------|
| http://localhost:5000/api/v1/docs | Swagger UI |
| http://localhost:5000/api/v1/docs-json | OpenAPI 3 JSON spec |
| http://localhost:5000/api/v1/docs-yaml | OpenAPI 3 YAML spec |

## Enable / disable

| Environment | Default | Override |
|-------------|---------|----------|
| `development`, `staging`, `test` | Enabled | — |
| `production` | Disabled | `ENABLE_SWAGGER=true` |

## Run locally

```bash
cd ecommreco-backend
npm run dev
```

Open http://localhost:5000/api/v1/docs

## Validate spec (server must be running)

```bash
npm run docs:swagger
```

## Authentication in Swagger UI

Server URLs in the spec include the `/api/v1` prefix. Operation paths are relative (e.g. `/auth/login`), so requests go to `http://localhost:5000/api/v1/auth/login` — not `/api/v1/api/v1/...`.

1. Call `POST /auth/login` with email and password.
2. Copy `data.accessToken` from the response.
3. Click **Authorize** and enter: `Bearer <your-token>`

For setup/debug routes, use the **setup-token** scheme with your `SUPER_ADMIN_SETUP_TOKEN` value.

## API coverage

All controllers under `src/**/*.controller.ts` are included via `@ApiTags` and `@ApiOperation`. DTO schemas are generated from `class-validator` decorators (Nest Swagger plugin in `nest-cli.json`).

## Production

Keep Swagger disabled unless needed. Set `ENABLE_SWAGGER=true` only behind network restrictions.
