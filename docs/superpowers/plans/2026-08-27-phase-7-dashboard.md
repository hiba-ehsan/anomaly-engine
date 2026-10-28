# Anomaly Engine — Phase 7: Dashboard (Next.js)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the interactive dashboard — the user-facing product. Dark Bloomberg/QuantConnect theme (navy `#0a1a2e` + yellow `#eab308`), live metrics, candlestick charts with anomaly markers, filing viewer with diff/heatmap, anomaly explorer, and backtest results.

**Architecture:** Next.js 14 (App Router) on port 3000. Talks ONLY to the API gateway (`NEXT_PUBLIC_API_URL`). SWR for data fetching. TradingView Lightweight Charts for price data. GSAP/Lenis for the parallax hero.

**Tech Stack:** Next.js 14.2.35, React 18, TypeScript, Tailwind CSS, SWR, lightweight-charts v4, GSAP, Lenis

---

## File Structure

```
services/frontend/
├── Dockerfile
├── .dockerignore               # excludes node_modules/.next/.env.local
├── package.json
├── next.config.js
├── tailwind.config.js
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── globals.css          # navy+yellow theme, parallax CSS
│   │   ├── page.tsx             # Dashboard (stats, chart, companies, anomalies)
│   │   ├── companies/
│   │   │   ├── page.tsx         # Company list
│   │   │   └── [ticker]/
│   │   │       ├── page.tsx     # Company detail (filings, anomalies, chart)
│   │   │       └── filings/
│   │   │           ├── page.tsx         # All filings (filterable)
│   │   │           └── [id]/page.tsx    # Filing detail + diff compare
│   │   ├── anomalies/
│   │   │   └── page.tsx         # Anomaly explorer (filters)
│   │   ├── backtest/
│   │   │   └── page.tsx         # Backtest results
│   │   └── parallax-demo/
│   │       └── page.tsx         # GSAP parallax hero
│   ├── components/
│   │   ├── ui/                  # Sidebar, Button, Badge, Card, Table, Input, Select, paranoia-scrolling
│   │   ├── charts/
│   │   │   └── PriceChart.tsx   # TradingView candlesticks + anomaly markers
│   │   └── filings/
│   │       ├── FilingViewer.tsx     # Section tabs, sentiment badges
│   │       └── FilingDiffViewer.tsx # Side-by-side diff with heatmap
│   ├── lib/
│   │   ├── api.ts               # Typed API client (base URL from env)
│   │   ├── hooks.ts             # SWR hooks (companies, filings, anomalies, market, backtest)
│   │   └── utils.ts             # cn() class merge helper
│   └── types/index.ts           # TypeScript interfaces
```

---

### Task 1: Foundation + API Layer

**Files:**
- Create: `src/lib/api.ts`, `src/lib/hooks.ts`, `src/lib/utils.ts`, `src/types/index.ts`

**Interfaces:**
- Produces: Typed API client with all gateway endpoints; SWR hooks derived from it

- [ ] **Step 1: Create api.ts with a full typed client** covering companies, filings, anomalies, search, backtest, market, health. Base URL from `process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'`.

- [ ] **Step 2: Create hooks.ts** — one SWR hook per endpoint. The fetcher MUST use the full base URL (NOT relative paths). Provide helpers `pricesToCandlesticks()` and `anomaliesToMarkers()` for the chart.

> **Gotcha:** Do not call `fetch('/api/v1/...')` with a relative path — it hits the Next server (port 3000) instead of the gateway (8000). Always prefix with the base URL.

- [ ] **Step 3: Commit**

```bash
git add services/frontend/src/lib services/frontend/src/types
git commit -m "feat: frontend api layer with SWR hooks"
```

---

### Task 2: UI Component Library

**Files:**
- Create: `src/components/ui/Sidebar.tsx`, `Button.tsx`, `Badge.tsx`, `Card.tsx`, `Table.tsx`, `Input.tsx`, `Select.tsx`

**Interfaces:**
- Consumed by all pages

- [ ] **Step 1: Sidebar** — 64-width sticky nav: Dashboard, Companies, Anomalies, Backtest + system status footer. Uses `usePathname()` for active state.

- [ ] **Step 2: Button** — support `variant` (primary/secondary/ghost/danger), `size`, `loading`, **and `asChild`** (cloneElement slot pattern so `<Button asChild><Link>...</Link></Button>` works).

- [ ] **Step 3: Badge/Card/Table/Input/Select** — simple presentational components consistent with the theme.

- [ ] **Step 4: Commit**

```bash
git add services/frontend/src/components/ui
git commit -m "feat: ui component library"
```

---

### Task 3: Dashboard + Companies Pages

**Files:**
- Create: `src/app/page.tsx`
- Create: `src/app/companies/page.tsx`
- Create: `src/app/companies/[ticker]/page.tsx`

**Interfaces:**
- Consumes: SWR hooks; the dashboard renders PriceChart + stats + tables

- [ ] **Step 1: Dashboard** (`/`) — stat cards (Companies, Anomalies, High Severity, System Health), first company's **PriceChart with anomaly markers**, tracked companies table, recent anomaly feed.

> **Gotcha:** Never render `new Date()` directly in JSX — it causes a **React hydration mismatch** (server/client time differ). Store it in state set via `useEffect` instead.

> **Gotcha:** Avoid complex nested ternaries and emoji inside `className` template literals — the Next.js SWC compiler can throw a confusing `Unexpected token 'div'. Expected jsx identifier` error. Extract className logic to helper functions.

- [ ] **Step 2: Companies list** (`/companies`) — searchable/filterable table of tracked companies linking to detail pages.

- [ ] **Step 3: Company detail** (`/companies/[ticker]`) — key metric cards, PriceChart, Recent Filings panel, Recent Anomalies panel, ingest/analyze action buttons.

- [ ] **Step 4: Commit**

```bash
git add services/frontend/src/app/page.tsx services/frontend/src/app/companies
git commit -m "feat: dashboard and companies pages"
```

---

### Task 4: Anomalies Explorer + Filings Viewer

**Files:**
- Create: `src/app/anomalies/page.tsx`
- Create: `src/components/charts/PriceChart.tsx`
- Create: `src/components/filings/FilingViewer.tsx`
- Create: `src/components/filings/FilingDiffViewer.tsx`
- Create: `src/app/companies/[ticker]/filings/page.tsx`
- Create: `src/app/companies/[ticker]/filings/[id]/page.tsx`

**Interfaces:**
- Consumes: anomaly + filing hooks; produces the core analysis views

- [ ] **Step 1: Anomaly explorer** (`/anomalies`) — filters (ticker, signal type, min score), severity-colored signal badges, links to detail.

- [ ] **Step 2: PriceChart** — TradingView Lightweight Charts candlestick series with anomaly markers (red/amber/green by score). ResizeObserver-aware.

- [ ] **Step 3: FilingViewer** — section tabs, per-section content, sentiment badge coloring, chunk navigation.

- [ ] **Step 4: FilingDiffViewer** — side-by-side diff with color-coded heatmap highlighting textual changes between two filings.

- [ ] **Step 5: Filing routes** — list page (`/filings`) with type filter; detail page (`/filings/[id]`) with compare controls wired to the diff viewer.

- [ ] **Step 6: Commit**

```bash
git add services/frontend/src/app/anomalies services/frontend/src/components/charts services/frontend/src/components/filings services/frontend/src/app/companies
git commit -m "feat: anomalies explorer, price charts, filing diff viewer"
```

---

### Task 5: Palette, Parallax, Backtest, Deploy

**Files:**
- Modify: `src/app/globals.css`, `tailwind.config.js`
- Create: `src/components/ui/parallax-scrolling.tsx`, `src/app/parallax-demo/page.tsx`
- Create: `src/app/backtest/page.tsx`

- [ ] **Step 1: Theme** — navy `#0a1a2e` background, yellow `#eab308` accents, glassy cards, custom scrollbar. Add parallax keyframes + `.parallax__layer-*` classes.

- [ ] **Step 2: Parallax hero** — GSAP ScrollTrigger + Lenis smooth scroll. Four stacked layers (nebula image, galaxy image, title, market image) moving at different rates. Showcase route at `/parallax-demo`.

- [ ] **Step 3: Backtest page** (`/backtest?ticker=AAPL`) — CAR (30/60/90d), volatility before/after, XGBoost prediction + confidence.

- [ ] **Step 4: docker-compose wiring** — frontend gets `NEXT_PUBLIC_API_URL` from the environment (NOT a UTF-16 `.env.local` file copied into the image).

- [ ] **Step 5: Dockerfile multi-stage + .dockerignore**

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]
```

```gitignore
node_modules
.next
.git
.env.local
Dockerfile
docker-compose.yml
```

- [ ] **Step 6: Verify** — build and hit every route: `/`, `/companies`, `/companies/AAPL`, `/companies/AAPL/filings`, `/companies/AAPL/filings/:id`, `/anomalies`, `/backtest`, `/parallax-demo`. All must return 200 with no hydration errors.

- [ ] **Step 7: Commit**

```bash
git add services/frontend docker-compose.yml
git commit -m "feat: dashboard complete"
```