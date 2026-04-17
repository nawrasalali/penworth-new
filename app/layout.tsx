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
    default: 'Penworth - AI Book Writing Platform',
    template: '%s | Penworth',
  },
  description: 'From idea to published book in 48 hours. Penworth transforms your expertise into professionally written, publication-ready books with AI.',
  keywords: ['AI writing', 'book writing', 'AI author', 'publish book', 'write book with AI'],
  authors: [{ name: 'Penworth' }],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://new.penworth.ai',
    siteName: 'Penworth',
    title: 'Penworth - AI Book Writing Platform',
    description: 'From idea to published book in 48 hours. Write your book with AI.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Penworth - AI Book Writing Platform',
    description: 'From idea to published book in 48 hours. Write your book with AI.',
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
