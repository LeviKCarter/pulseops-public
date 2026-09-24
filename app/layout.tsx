import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import PhoneManifest from './PhoneManifest';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

const siteOrigin = process.env.SITE_ORIGIN ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: 'Levi Ops — Agent Operations Center',
  description: 'A private command center for Levi’s collaborative research sheets and LeviAgent queue.',
  robots: { index: false, follow: false },
  // The icon a phone uses for a home-screen shortcut (apple-touch-icon on iOS, the manifest on Android) and a browser tab.
  // The manifest link itself is added by PhoneManifest, on phones only.
  icons: {
    // PNG only: Chrome on Android prefers an SVG ("any" size) for a home-screen shortcut but cannot use it, and shows a placeholder.
    icon: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { url: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: { capable: true, title: 'Levi Ops', statusBarStyle: 'black-translucent' },
  openGraph: {
    title: 'Levi Ops',
    description: 'Sheets + agent queue, together.',
    type: 'website',
    images: [{ url: '/og.png', width: 1727, height: 911, alt: 'Levi Ops dark operations dashboard — Sheets and agent queue, together.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Levi Ops',
    description: 'Sheets + agent queue, together.',
    images: ['/og.png'],
  },
};

export const viewport: Viewport = { themeColor: '#090e0c' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}><PhoneManifest />{children}</body>
    </html>
  );
}
