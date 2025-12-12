import type { Metadata } from 'next';
import { Toaster } from 'react-hot-toast';
import './globals.css';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { WalletProvider } from '@/components/features/WalletProvider';
import { ThemeProvider } from '@/components/features/ThemeProvider';

export const metadata: Metadata = {
  title: 'PRMX - Parametric Rainfall Insurance',
  description: 'Decentralized parametric rainfall insurance on the blockchain. Protect your assets with automated, transparent coverage.',
  keywords: ['insurance', 'blockchain', 'rainfall', 'parametric', 'DeFi', 'Polkadot'],
  authors: [{ name: 'PRMX Team' }],
  openGraph: {
    title: 'PRMX - Parametric Rainfall Insurance',
    description: 'Decentralized parametric rainfall insurance on the blockchain',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-background-primary">
        <ThemeProvider>
          <WalletProvider>
            <div className="flex min-h-screen">
              <Sidebar />
              <div className="flex-1 flex flex-col ml-64">
                <Header />
                <main className="flex-1 p-8 pt-24">
                  {children}
                </main>
              </div>
            </div>
            <Toaster
              position="bottom-right"
              toastOptions={{
                className: 'glass-card !bg-background-card !text-text-primary',
                duration: 4000,
              }}
            />
          </WalletProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
