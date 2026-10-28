# Vercel Deployment

The canonical, up-to-date instructions are in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.
This page keeps only the Vercel-specific summary.

## Project settings

| Setting | Value |
| --- | --- |
| Repository | this repo |
| Root Directory | `services/frontend` |
| Framework Preset | Next.js |
| Build Command | `npm run build` (default) |
| Install Command | `npm install` (default) |
| Node version | 20+ |

## Environment variables

| Variable | Value | Environments |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `https://<railway-gateway-domain>/api/v1` | Production, Preview |

That is the only variable the mid-term demo needs. The gateway falls back to
committed curated artifacts, so Supabase, Redis, Finnhub and model credentials
are **not** required.

`src/lib/config.ts` normalises the URL, so both of these work:

```dotenv
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_API_URL=https://api.example.com/api/v1
```

## After deploy

1. Add the Vercel domain to the gateway's `CORS_ORIGINS`:
   ```dotenv
   CORS_ORIGINS=https://your-app.vercel.app,https://your-app-git-main.vercel.app
   ```
2. Open `https://your-app.vercel.app/pipeline` and confirm the stage table and
   benchmark render.
3. If API calls fail, check the browser console and
   `https://<gateway>/health` → `dependencies.ingestion-us`.

## Supabase (optional, later)

If the database is restored, add `SUPABASE_URL`, `SUPABASE_KEY` and
`SUPABASE_SERVICE_KEY` to the **gateway** (not the frontend). The gateway
prefers Supabase and silently falls back to local artifacts on any failure.
Never expose the service-role key with a `NEXT_PUBLIC_` prefix.

## Old blueprint files

The root `vercel.json` is kept for reference. Because the Vercel project root is
`services/frontend`, Vercel uses the frontend's own `package.json`/`next.config.js`
and the environment variables above.
