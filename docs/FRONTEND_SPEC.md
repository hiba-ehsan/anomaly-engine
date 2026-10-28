# Anomaly Engine — Frontend (React/Next.js) Master Spec

> Reusable prompt + ground-truth spec for the React/Next.js dashboard layer of
> the **Anomaly Engine** MERN stack. Every claim below is grounded in what was
> actually built and verified in this repo — no scaffolding fiction. Use it to
> (a) regenerate the frontend with any AI tool, (b) write the resume bullet, or
> (c) hand to an interviewer as the "R" of your MERN story.

---

## 1. Brand & pitch (use verbatim)

**Anomaly Engine** — a full-stack financial-anomaly detection system. It
ingests real SEC **EDGAR 10-K filings** for AAPL (and other large-cap
issuers), runs a **FinBERT** (ProsusAI/finbert) NLP engine over the filing
text to score anomaly risk, and surfaces everything through a real-time
**React/Next.js dashboard**. Data flows SEC EDGAR → Python ingestion
microservices → **MongoDB** (raw SEC document store) + **Supabase/Postgres**
(primary relational store) → FinBERT anomaly engine → Next.js/React frontend
→ React D3/lightweight-charts visualizations. Redis queues the backtester;
Node.js runtime serves the Next.js app; Docker Compose + GitHub Actions CI
provided.

**One-line resume hook:** "Full MERN stack, production-shaped repo: MongoDB
raw-filing store, Node/Next.js + React dashboard, Express microservice,
Python FastAPI core (FinBERT anomaly scoring), Supabase + Redis, CI + Docker
Compose — seeded with real AAPL 10-Ks end-to-end."

---

## 2. Runtime & ports (the live truth on this machine)

| Process | Port | Tech |
|---------|------|------|
| Node.js runtime | — | Node v24.18.0 / npm 11.16.0 (`v24` verified) |
| Next.js dev server | **3000** | Next.js 16 (App Router), React 18+ |
| Express microservice ("E") | **8081** | Express 5, `services\mongo-api` |
| MongoDB ("M") | **27017** | MongoDB Server 8.3 Community (native Windows service) |
| API gateway (main) | **8000** | Python/FastAPI gateway |
| Ingestion-US | 8001 | Python/FastAPI |
| Ingestion-Market | 8002 | Python/FastAPI |
| NLP engine (FinBERT) | 8003 | Python/FastAPI |
| Backtester | 8004 | Python/FastAPI |
| Redis | — | Redis Cloud (Supabase-addressed), `REDIS_URL` |

Frontend env: `NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1` (points at
the gateway). Extension: `mongo-api` Express exposes raw SEC documents at
`:8081` — the dashboard can call it to show Mongo-backed raw filing
documents (proving the **M→E→R** loop in the browser).

---

## 3. Directory layout (where the frontend lives)

```
services/frontend/
  package.json          # Next.js 16, React 18, TypeScript, Tailwind, gsap, lenis
  src/app/              # Next.js App Router pages + layouts
    page.tsx            # dashboard home
    companies/          # company list + drill-down
    filings/            # SEC filing list + detail (real AAPL 10-Ks)
    anomalies/          # anomaly rows from FinBERT
    backtest/           # strategy backtest viewer
  src/lib/
    api.ts              # typed API client (gateway + mongo-api)
    hooks.ts            # SWR hooks (useFilings, useAnomalies, ...)
  src/components/
    PriceChart.tsx      # lightweight-charts candlestick/line
    ...                # hero, motion (gsap + lenis parallax), data tiles
```

---

## 4. Data model the dashboard renders (REAL AAPL proof)

The dashboard is **not mock data**. Two genuine AAPL 10-Ks are persisted and
rendered (each pulled live from SEC EDGAR into MongoDB + Supabase):

| Accession | Filing | Filing date | Size |
|-----------|--------|-------------|------|
| `0000320193-25-000079` | `aapl-20250927.htm` (10-K, fiscal 2025) | 2025-10-31 | ~1.5 MB |
| `0000320193-24-000123` | `aapl-20240928.htm` (10-K, fiscal 2024) | 2024-11-01 | ~1.5 MB |

- `GET /api/v1/filings?ticker=AAPL&limit=20` → gateway list; filings persist
  in Supabase with `total=2`.
- `GET :8081/api/v1/raw/stats` → Mongo-backed raw-doc stats (proves M→E→R).
- `POST /api/v1/anomalies/analyze/AAPL` → `{"filings_found": 2}`, then
  `GET /api/v1/anomalies?ticker=AAPL` → FinBERT-scored anomaly rows.

---

## 5. Pages & components (build this)

1. **Home / dashboard** — hero with gsap + lenis scroll/parallax; stat tiles
   (filings ingested, anomalies, raw docs in Mongo); "MERN online" status
   strip; links to AAPL filings & anomalies.
2. **Companies** — ticker cards with quiet data hover (gsap reveal).
3. **Filings** — list real AAPL 10-Ks; click → detail with document info +
   raw doc link from `mongo-api`.
4. **Anomalies** — FinBERT anomaly tiles: `anomaly_type`, `severity`, `score`,
   linked to filing; refresh via analyze.
5. **Backtester** — anomaly-signal backtest pane wired to gateway + Redis
   queue.
6. **PriceChart** — lightweight-charts, D3-flavored market candles.
7. Shared: Thin typed SWR client (`swr`, `clsx`), motion primitives
   (`gsap`, `@studio-freight/lenis`), Tailwind design (dark, premium).

---

## 6. The MERN framing (truthful, for your resume story)

- **M** — MongoDB native service on `:27017`; `raw_filings` collection seeded
  with the two real AAPL 10-Ks (via `scripts\seed_mongodb.py`, idempotent).
- **E** — Express microservice `services\mongo-api` (`:8081`) reading Mongo,
  CORS-enabled, `/api/v1/raw/*` routes.
- **R** — React 18 + Next.js 16 dashboard (this spec) on `:3000`.
- **N** — Node.js v24 runtime; npm workspaces + root scripts; Next.js served
  by Node.
- Plus: **Redis** Cloud, **Supabase/Postgres** primary store, **FinBERT**
  NLP, **Docker Compose + GitHub Actions CI**, `.env.example`,
  `.editorconfig`, Prettier/ESLint, LICENSE (MIT).

> Honesty guardrail: the original gateways/ingestors are **Python/FastAPI**
> (that's the real, interviewable core) — Next.js/React is the Node.js layer
> and Mongo is the document store. Say exactly that; it survives any
> follow-up question.

---

## 7. How to re-run / reproduce (from cold boot)

```powershell
# 1. Ensure MongoDB native service is running (27017)
# 2. Ensure gateway + services via start-dev.ps1
Set-Location "D:\Anomaly Engine"
.\start-dev.ps1                      # launches :8000-:8004 + :3000 (WMI detach)
Start-Service MongoDB                # if installed as service
npm install                          # MERN baseline
npm run seed                         # idempotent AAPL -> MongoDB seed
npm run dev                          # Next.js frontend on :3000
```

---

## 8. Gold rules that kept this repo healthy (keep them)

1. **Nothing I launch survives the shell** unless detached via **WMI with
   `CurrentDirectory` set** (the `start-dev.ps1` pattern). Express + Next.js
   must be launched with `CurrentDirectory` = service dir, else `No module
   named 'app'` / path-not-found failures.
2. SEC EDGAR requires `User-Agent`; accession dash-strip bug (`accn.replace("-","")`)
   was the single root cause of 0-filings → now returns both real 10-Ks.
3. Gateway client timeout default (30s) → 600s for heavy SEC ingests.
4. Mongo is additive/secondary — engine works without it; Mongo writes never
   block the SEC→Supabase→FinBERT core.
5. Resume = truthful: Python core + Next.js/React + Mongo/Express is a real,
   defensible full-stack story. Say that, not "NestJS gateway."

---

*Generated from the live Anomaly Engine repo, MERN baseline + real AAPL 10-K
data verified on this machine.*
