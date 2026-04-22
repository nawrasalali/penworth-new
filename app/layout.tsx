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
    default: 'Penworth — The literary ecosystem',
    template: '%s | Penworth',
  },
  description: "The book inside you, finished this week. Tell your story once — Penworth writes it, publishes it, produces the audiobook and Cinematic Livebook, and puts it in front of readers who will want to read it, hear it, and see it come to life.",
  keywords: ['write a book', 'publish a book', 'audiobook', 'Cinematic Livebook', 'literary ecosystem', 'Penworth Guild', 'self-publishing'],
  authors: [{ name: 'Penworth' }],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://penworth.ai',
    siteName: 'Penworth',
    title: 'Penworth — The book inside you, finished this week.',
    description: 'The literary ecosystem. Writers bring the ideas. Readers live the experience. Guildmembers connect them — and earn a craftsperson\'s living doing it.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Penworth — The book inside you, finished this week.',
    description: 'The literary ecosystem. Writers bring the ideas. Readers live the experience.',
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
