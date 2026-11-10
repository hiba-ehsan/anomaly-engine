'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function SignupPage() {
  const router = useRouter();
  const { signup } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Analyst');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name || !email || !password) {
      setError('Please fill in all the fields.');
      return;
    }
    setLoading(true);
    const res = await signup(name, email, password, role);
    setLoading(false);
    if (res.success) {
      router.push('/');
    } else {
      setError(res.error || 'Could not create the profile.');
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
          <span className="text-ink-dim">Already have a profile?</span>
          <Link href="/login" className="text-accent hover:text-accent-warm font-semibold uppercase tracking-wider text-xs">
            Sign in →
          </Link>
        </div>
      </header>

      {/* Main Authentication Matrix */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 border border-line bg-panel shadow-2xl">
          
          {/* Left Kinetic Statement Column */}
          <div className="lg:col-span-5 p-8 bg-ground-tint border-b lg:border-b-0 lg:border-r border-line flex flex-col justify-between">
            <div>
              <div className="inline-block px-2 py-0.5 border border-line text-[10px] font-mono text-value uppercase tracking-widest mb-6">
                Local profile
              </div>
              <h1 className="text-4xl sm:text-5xl font-black text-white uppercase tracking-tighter leading-none mb-4">
                Create <br />
                <span className="text-accent">Your</span> <br />
                Profile
              </h1>
              <p className="text-xs text-ink-muted leading-relaxed mb-6 font-sans">
                Your profile is stored in this browser only. It is not sent to a server.
              </p>
            </div>

            <div className="space-y-4 pt-6 border-t border-line text-xs font-mono">
              <div className="flex items-center gap-2 text-ink-muted">
                <span className="text-accent font-bold">01</span>
                <span>Reads real SEC filings</span>
              </div>
              <div className="flex items-center gap-2 text-ink-muted">
                <span className="text-accent font-bold">02</span>
                <span>Compares wording over time</span>
              </div>
              <div className="flex items-center gap-2 text-ink-muted">
                <span className="text-accent font-bold">03</span>
                <span>Shows the words that changed</span>
              </div>
            </div>
          </div>

          {/* Right Signup Form Column */}
          <div className="lg:col-span-7 p-8 sm:p-10 flex flex-col justify-center">
            <div className="mb-6">
              <h2 className="text-2xl font-bold uppercase tracking-tight text-white mb-1">
                New profile
              </h2>
              <p className="text-xs text-ink-muted">
                This is a local demo. Nothing is verified or sent anywhere.
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
                  Your name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Jordan Price"
                  className="input-field font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-ink-muted uppercase tracking-widest mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="input-field font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-ink-muted uppercase tracking-widest mb-1.5">
                  What you do
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="input-field font-mono cursor-pointer"
                >
                  <option value="Analyst">Analyst</option>
                  <option value="Portfolio manager">Portfolio manager</option>
                  <option value="Compliance">Compliance</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-ink-muted uppercase tracking-widest mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
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
                    <span>Creating profile…</span>
                  ) : (
                    <>
                      <span>Create profile and open dashboard</span>
                      <span className="text-base font-mono">→</span>
                    </>
                  )}
                </button>
              </div>
            </form>

            <div className="mt-8 pt-6 border-t border-line flex items-center justify-between text-xs">
              <span className="text-ink-dim">Already have a profile?</span>
              <Link href="/login" className="text-accent hover:underline font-mono">
                Sign in →
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
          <span>PROFILE STORED IN BROWSER</span>
        </div>
      </footer>
    </div>
  );
}

