import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider } from '@/components/theme-provider';
import GuildRefCapture from '@/components/guild/GuildRefCapture';
import './globals.css';

const inter = Inter({ 
  subsets: ['latin'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: {
    default: 'Penworth - AI Document Writing Platform',
    template: '%s | Penworth',
  },
  description: 'From idea to final document in hours. Books, academic papers, business plans — Penworth transforms your expertise into professionally written, publication-ready documents with AI.',
  keywords: ['AI writing', 'document writing', 'book writing', 'business plan', 'academic writing', 'AI author', 'publish with AI'],
  authors: [{ name: 'Penworth' }],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://penworth.ai',
    siteName: 'Penworth',
    title: 'Penworth - AI Document Writing Platform',
    description: 'From idea to final document in hours. Write with AI.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Penworth - AI Document Writing Platform',
    description: 'From idea to final document in hours. Write with AI.',
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
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <GuildRefCapture />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
