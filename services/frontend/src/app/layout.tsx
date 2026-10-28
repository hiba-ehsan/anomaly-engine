import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Anomaly Engine',
  description: 'SEC filing contradiction detection',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-navy-950 text-navy-50 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}