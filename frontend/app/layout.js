import './globals.css';
import { Geist_Mono } from 'next/font/google';
import Script from 'next/script';
import Navigation from '../components/Navigation';
import { AuthProvider } from '../lib/AuthContext';

// Monospace body: the single cogs voice across the estate (adopted
// 2026-08-13 after the fantasy-nfl trial; see the cogs-brand skill).
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
});

export const metadata = {
  metadataBase: new URL('https://plpicker.cogs.tech'),
  title: 'PL Picker',
  description: 'Premier League Last Man Standing',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={geistMono.variable}>
      <body>
        {process.env.NEXT_PUBLIC_ADSENSE_PUB_ID && (
          <Script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${process.env.NEXT_PUBLIC_ADSENSE_PUB_ID}`}
            crossOrigin="anonymous"
            strategy="afterInteractive"
          />
        )}
        <AuthProvider>
          <Navigation />
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
