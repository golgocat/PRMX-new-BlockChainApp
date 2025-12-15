import { Plus_Jakarta_Sans, Inter } from 'next/font/google';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

export default function LandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${plusJakarta.variable} ${inter.variable} bg-white min-h-screen text-zinc-900 font-ui selection:bg-purple-100 selection:text-purple-900 antialiased`}>
      {children}
    </div>
  );
}
