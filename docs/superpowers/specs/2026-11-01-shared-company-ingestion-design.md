# Shared Company Ingestion Design

## Goal

Make the local demo's company-fetch flow reliably ingest SEC filings and expose
the same five companies to every browser profile: AAPL, MSFT, AMZN, NVDA, and
GOOGL. The profile remains a browser-local demo identity, not an authenticated
server account.

## Current behavior

- The signup UI stores a profile in browser local storage and explicitly says
  that it is not sent to a server.
- The Add Company modal posts to the gateway's company-ingest endpoint.
- When Supabase is unavailable, the gateway currently starts the Spark pipeline
  against existing local files rather than fetching the requested ticker. A
  ticker such as AMZN therefore cannot be added through that path.
- The SEC downloader supports a caller-supplied ticker list, but defaults to
  AAPL and MSFT. The current local snapshot contains those two companies.
- A browser `Failed to fetch` message only identifies a failed network request;
  it does not distinguish an unavailable gateway, a CORS/configuration issue,
  or a downstream SEC/provider failure.

## Chosen approach

Use the existing local SEC/JSON/Spark architecture as the source of truth for
the local demo. The company-fetch endpoint must resolve the requested ticker
against SEC's company ticker data, retrieve its requested filings, and persist
them to the shared local raw-filings directory. It must not substitute a Spark
run over unrelated existing input files for the fetch operation.

Seed the five agreed tickers in the shared company dataset. The same API and
artifact set serves every local browser profile; no per-profile ownership is
introduced. Keep Supabase behavior available where it is already configured,
but do not make Supabase a prerequisite for local ingestion.

After fetching, expose a real job result and status to the client. A pipeline
run remains a separate operation that processes the available shared snapshot.
Fetching and processing must not be reported as completed until their respective
operations actually complete.

## Failure handling and idempotency

- Normalize tickers and validate supported filing types and limits before work
  begins.
- Repeated requests for a ticker must reuse valid cached filing files and avoid
  duplicate company or filing records.
- Retry transient SEC throttling and server failures with bounded backoff.
  Do not retry invalid tickers or other permanent client errors indefinitely.
- Return meaningful HTTP errors for invalid/unknown tickers, empty filing
  results, exhausted provider retries, local write failures, and unavailable
  services. Preserve the underlying cause in server logs without exposing
  secrets.
- The UI must display a truthful queued/running/completed/failed state and the
  actionable error returned by the API. It must not turn a rejected request
  into a success message.
- A successful fetch does not imply the Spark pipeline has run. The UI must
  distinguish fetched filings from processed curated artifacts.

External services can still be unavailable. The reliability target is bounded
retries, safe repeated requests, clear failures, and no false success—not a
promise that network errors can never happen.

## Verification

Add focused tests for:

1. A previously unknown but valid ticker is resolved and its filing data is
   persisted in local mode.
2. Repeating the request reuses cached data and does not create duplicates.
3. Unknown tickers, empty SEC results, transient provider errors, and permanent
   provider errors produce the intended response and job state.
4. The shared company list contains the five agreed tickers and is independent
   of browser-local profile identity.
5. The frontend shows successful completion only after a completed response and
   shows API/network failures rather than success-shaped fallbacks.
6. Existing pipeline behavior still processes the stored filings and refreshes
   curated artifacts.

## Out of scope

- Real user authentication, cross-device accounts, and per-user watchlists.
- Automatic ingestion of the entire Fortune 500.
- Guaranteeing uptime or availability of SEC or other external providers.
