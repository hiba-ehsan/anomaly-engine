'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await login(email, password);
    setLoading(false);
    if (res.success) {
      router.push('/');
    } else {
      setError(res.error || 'Could not sign in');
    }
  };

  return (
    <div className="min-h-screen bg-ground flex flex-col justify-between text-ink relative overflow-hidden">
      {/* Hairline grid pattern background */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: 'linear-gradient(to right, #303139 1px, transparent 1px), linear-gradient(to bottom, #303139 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Top Bar */}
      <header className="relative z-10 border-b border-line px-6 py-4 flex items-center justify-between bg-ground/80 backdrop-blur-sm">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 bg-accent text-ground flex items-center justify-center font-bold font-mono text-sm group-hover:bg-accent-warm transition-colors">
            AE
          </div>
          <div>
            <span className="font-bold tracking-tight text-ink uppercase text-sm block">Anomaly Engine</span>
            <span className="text-[10px] font-mono text-ink-dim block tracking-widest uppercase">SEC filing change detector</span>
          </div>
        </Link>
        <div className="flex items-center gap-4 text-xs font-mono">
          <Link href="/signup" className="text-accent hover:text-accent-warm font-semibold uppercase tracking-wider text-xs">
            Create account →
          </Link>
        </div>
      </header>

      {/* Main Authentication Matrix */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 border border-line bg-panel shadow-2xl">
          
          {/* Left Kinetic Statement Column */}
          <div className="lg:col-span-5 p-8 bg-ground-tint border-b lg:border-b-0 lg:border-r border-line flex flex-col justify-between">
            <div>
              <div className="inline-block px-2 py-0.5 border border-line text-[10px] font-mono text-accent uppercase tracking-widest mb-6">
                SEC Filings · Plain English
              </div>
              <h1 className="text-4xl sm:text-5xl font-black text-white uppercase tracking-tighter leading-none mb-4">
                Spot <br />
                <span className="text-accent">Changes</span> <br />
                In Filings
              </h1>
              <p className="text-xs text-ink-muted leading-relaxed mb-6 font-sans">
                This app reads company reports filed with the US SEC and shows where the
                wording changed the most.
              </p>
            </div>

            <div className="space-y-3 pt-6 border-t border-line">
              <div className="text-[10px] font-mono text-ink-dim uppercase tracking-wider">Local demo</div>
              <p className="text-xs text-ink-muted leading-relaxed font-sans">
                There is no real login server in this build. Any email and password opens
                a local session; nothing is sent anywhere.
              </p>
            </div>
          </div>

          {/* Right Login Form Column */}
          <div className="lg:col-span-7 p-8 sm:p-10 flex flex-col justify-center">
            <div className="mb-6">
              <h2 className="text-2xl font-bold uppercase tracking-tight text-white mb-1">
                Sign in
              </h2>
              <p className="text-xs text-ink-muted">
                Enter any email and password to open the local demo.
              </p>
            </div>

            {error && (
              <div className="mb-5 p-3 border border-red-500/50 bg-red-950/20 text-red-400 text-xs font-mono flex items-center gap-2">
                <span className="font-bold">Problem:</span> {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[11px] font-mono text-ink-muted uppercase tracking-widest mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="analyst@firm.com"
                  className="input-field font-mono"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[11px] font-mono text-ink-muted uppercase tracking-widest">
                    Password
                  </label>
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="input-field font-mono"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-kinetic w-full py-3.5 text-sm font-bold flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <span>Signing in…</span>
                  ) : (
                    <>
                      <span>Open dashboard</span>
                      <span className="text-base font-mono">→</span>
                    </>
                  )}
                </button>
              </div>
            </form>

            <div className="mt-8 pt-6 border-t border-line flex items-center justify-between text-xs">
              <span className="text-ink-dim">No account needed for the demo.</span>
              <Link href="/signup" className="text-value hover:underline font-mono">
                Create a profile →
              </Link>
            </div>
          </div>

        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-line px-6 py-4 flex flex-col sm:flex-row items-center justify-between text-[11px] font-mono text-ink-dim bg-ground">
        <div>ANOMALY ENGINE · SEC FILING CHANGE DETECTOR</div>
        <div className="flex items-center gap-4 mt-2 sm:mt-0">
          <span>LOCAL DEMO</span>
          <span>DATA: LOCAL FILES</span>
        </div>
      </footer>
    </div>
  );
}

