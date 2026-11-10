'use client';

import React, { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

interface AddCompanyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const EXAMPLE_TICKERS = ['AAPL', 'MSFT', 'AMZN', 'NVDA', 'GOOGL'];
const INGEST_POLL_INTERVAL_MS = 1500;
const INGEST_TIMEOUT_MS = 20 * 60 * 1000;
const PIPELINE_TIMEOUT_MS = 30 * 60 * 1000;

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function AddCompanyModal({ isOpen, onClose, onSuccess }: AddCompanyModalProps) {
  const [ticker, setTicker] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const runId = useRef(0);

  useEffect(() => {
    if (!isOpen) {
      runId.current += 1;
      setLoading(false);
      setStatusMessage(null);
      setError(null);
      setCompleted(false);
    }
    return () => {
      runId.current += 1;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    runId.current += 1;
    setLoading(false);
    setStatusMessage(null);
    setCompleted(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedTicker = ticker.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(normalizedTicker)) {
      setError('Enter a valid ticker symbol (1–10 letters, numbers, dots, or hyphens).');
      return;
    }
    const activeRunId = ++runId.current;
    const deadline = Date.now() + INGEST_TIMEOUT_MS;
    let jobId = '';
    let consecutiveStatusErrors = 0;
    setError(null);
    setCompleted(false);
    setLoading(true);
    setStatusMessage(`Starting SEC filing fetch for ${normalizedTicker}…`);

    try {
      const started = await api.companies.ingest(normalizedTicker, {
        filing_types: ['10-K', '10-Q'],
        max_filings: 5,
      });
      jobId = started.job_id;
      let job = started;

      while (runId.current === activeRunId) {
        if (Date.now() >= deadline) {
          throw new Error(
            `Timed out waiting for ${normalizedTicker}. Job ${jobId} may still be running; check its status before starting another fetch.`
          );
        }
        if (job.status === 'completed') {
          const fetched = job.filings_ingested;
          const warnings = Array.isArray(job.warnings) ? job.warnings : [];
          setStatusMessage(
            `Downloaded ${fetched} filing(s) for ${normalizedTicker}. Rebuilding all results now…`
          );

          // Downloading is only half the job: the dashboard reads the files
          // produced by the Spark pipeline.  Start it for the complete raw
          // snapshot and wait so the new company actually appears.
          const pipeline = await api.pipeline.run(undefined, false);
          const pipelineDeadline = Date.now() + PIPELINE_TIMEOUT_MS;
          let pipelineJob = pipeline;
          while (runId.current === activeRunId) {
            if (pipelineJob.status === 'completed') {
              setStatusMessage(
                `Done. ${fetched} filing(s) for ${normalizedTicker} were added and the results were rebuilt.` +
                  (warnings.length ? ` Note: ${warnings[0]}` : '')
              );
              setCompleted(true);
              setLoading(false);
              runId.current += 1;
              onSuccess?.();
              return;
            }
            if (pipelineJob.status === 'failed') {
              throw new Error(
                `The filings were downloaded, but rebuilding the results failed: ${
                  pipelineJob.error || 'unknown pipeline error'
                }`
              );
            }
            if (Date.now() >= pipelineDeadline) {
              throw new Error(
                `The filings were downloaded, but the results are still rebuilding. Check the Data pipeline page in a few minutes.`
              );
            }
            setStatusMessage(
              `Downloaded ${fetched} filing(s) for ${normalizedTicker}. Rebuilding all results…`
            );
            await delay(INGEST_POLL_INTERVAL_MS);
            if (runId.current !== activeRunId) return;
            pipelineJob = await api.pipeline.status(pipeline.job_id);
          }
          return;
        }
        if (job.status === 'failed') {
          throw new Error(job.error || `SEC filing fetch failed for ${normalizedTicker}.`);
        }

        setStatusMessage(
          job.status === 'queued'
            ? `Queued SEC filing fetch for ${normalizedTicker}…`
            : `Fetched ${job.filings_ingested} of ${job.filings_found} filing(s) for ${normalizedTicker}…`
        );
        await delay(INGEST_POLL_INTERVAL_MS);
        if (runId.current !== activeRunId) return;
        try {
          job = await api.companies.ingestStatus(started.job_id);
          consecutiveStatusErrors = 0;
        } catch (statusError) {
          consecutiveStatusErrors += 1;
          if (consecutiveStatusErrors >= 3) throw statusError;
          setStatusMessage(
            `Temporary connection issue while checking ${normalizedTicker}; retrying…`
          );
        }
      }
    } catch (err) {
      if (runId.current !== activeRunId) return;
      setError(err instanceof Error ? err.message : String(err));
      setStatusMessage(null);
      setLoading(false);
      runId.current += 1;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ground/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg bg-panel border border-line shadow-2xl relative overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-ground-tint">
          <div>
            <span className="text-[10px] font-mono text-accent uppercase tracking-widest block">Companies</span>
            <h2 className="text-xl font-bold uppercase tracking-tight text-white">Add a company</h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center text-ink-muted hover:text-white hover:bg-line/40 transition-colors font-mono text-lg"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 border border-red-500/40 bg-red-950/20 text-red-400 text-xs font-mono">
              <span className="font-bold">Problem:</span> {error}
            </div>
          )}

          {statusMessage && (
            <div
              aria-live="polite"
              className="p-3 border border-value/40 bg-ground text-value text-xs font-mono flex items-center gap-2"
            >
              <span className={`w-2 h-2 rounded-full bg-value ${loading ? 'animate-ping' : ''}`} />
              <span>{statusMessage}</span>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-mono text-ink-dim uppercase tracking-wider mb-2">
              Examples:
            </label>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_TICKERS.map((example) => (
                <button
                  key={example}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setTicker(example);
                    setCompleted(false);
                    setStatusMessage(null);
                    setError(null);
                  }}
                  className="px-2.5 py-1 text-xs font-mono bg-ground border border-line hover:border-accent text-ink-muted hover:text-white transition-colors"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-mono text-ink-muted uppercase tracking-widest mb-1.5">
              Ticker symbol *
            </label>
            <input
              type="text"
              required
              disabled={loading}
              maxLength={10}
              pattern="[A-Za-z0-9][A-Za-z0-9.-]{0,9}"
              value={ticker}
              onChange={(e) => {
                setTicker(e.target.value.toUpperCase());
                setCompleted(false);
                setStatusMessage(null);
                setError(null);
              }}
              placeholder="e.g. NVDA"
              className="input-field font-mono uppercase"
            />
          </div>

          <p className="text-xs text-ink-dim leading-relaxed">
            This downloads the company&apos;s latest 10-K and 10-Q filings from the SEC, then
            rebuilds the results for every company. It can take several minutes.
            Closing this window does not cancel work already in progress.
          </p>

          <div className="pt-4 border-t border-line flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="btn-secondary !px-4 !py-2.5"
            >
              {completed ? 'Close' : 'Cancel'}
            </button>
            <button
              type={completed ? 'button' : 'submit'}
              onClick={completed ? handleClose : undefined}
              disabled={loading}
              className="btn-kinetic !px-5 !py-2.5 flex items-center gap-2"
            >
              {loading ? (
                <span>Fetching…</span>
              ) : (
                <>
                  <span>{completed ? 'Done' : 'Fetch filings'}</span>
                  <span className="font-mono">{completed ? '✓' : '→'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
