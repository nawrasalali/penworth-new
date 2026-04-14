import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';

const inter = Inter({ 
  subsets: ['latin'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: {
    default: 'Penworth - Knowledge, Verified',
    template: '%s | Penworth',
  },
  description: 'AI-powered knowledge platform that transforms expertise into verified, compliance-ready, publication-quality documents.',
  keywords: ['AI writing', 'knowledge platform', 'document automation', 'enterprise content'],
  authors: [{ name: 'Penworth' }],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://penworth.ai',
    siteName: 'Penworth',
    title: 'Penworth - Knowledge, Verified',
    description: 'AI-powered knowledge platform for verified, compliance-ready documents.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Penworth - Knowledge, Verified',
    description: 'AI-powered knowledge platform for verified, compliance-ready documents.',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
        <Toaster 
          position="bottom-right" 
          toastOptions={{
            style: {
              background: 'hsl(var(--background))',
              color: 'hsl(var(--foreground))',
              border: '1px solid hsl(var(--border))',
            },
          }}
        />
      </body>
    </html>
  );
}
