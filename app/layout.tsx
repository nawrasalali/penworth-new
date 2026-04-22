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
    default: 'Penworth — Every person has one book.',
    template: '%s | Penworth',
  },
  description: 'The literary ecosystem. You speak your book once. Penworth shapes it with you — chapter by chapter, in your voice — then publishes it, produces the audiobook, renders the Cinematic Livebook, and places it in the hands of readers who were waiting for exactly this story.',
  keywords: ['write a book', 'publish a book', 'audiobook', 'Cinematic Livebook', 'literary ecosystem', 'Penworth Guild', 'self-publishing'],
  authors: [{ name: 'Penworth' }],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://penworth.ai',
    siteName: 'Penworth',
    title: 'Penworth — Every person has one book. Penworth is how yours gets written.',
    description: 'The literary ecosystem. Writers bring the ideas. Readers live the experience. Guildmembers connect them — and earn a craftsperson\'s living doing it.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Penworth — Every person has one book.',
    description: 'The literary ecosystem. Three doors. One house.',
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
