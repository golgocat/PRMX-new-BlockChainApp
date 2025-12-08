'use client';

import { 
  FileText, 
  Book, 
  Code2, 
  Zap,
  Shield,
  Wallet,
  Cloud,
  ArrowRight,
  ExternalLink
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';

const docSections = [
  {
    title: 'Getting Started',
    icon: Zap,
    color: 'bg-prmx-cyan/10 text-prmx-cyan',
    items: [
      { title: 'Introduction to PRMX', href: '#intro' },
      { title: 'Connecting Your Wallet', href: '#wallet' },
      { title: 'Understanding Markets', href: '#markets' },
      { title: 'Your First Policy', href: '#first-policy' },
    ],
  },
  {
    title: 'Insurance Coverage',
    icon: Shield,
    color: 'bg-prmx-purple/10 text-prmx-purple-light',
    items: [
      { title: 'How Parametric Insurance Works', href: '#parametric' },
      { title: 'Coverage Windows', href: '#windows' },
      { title: 'Strike Thresholds', href: '#strike' },
      { title: 'Settlement Process', href: '#settlement' },
    ],
  },
  {
    title: 'LP Trading',
    icon: Wallet,
    color: 'bg-success/10 text-success',
    items: [
      { title: 'Understanding LP Tokens', href: '#lp-tokens' },
      { title: 'Trading on the Orderbook', href: '#trading' },
      { title: 'Risk and Returns', href: '#risk' },
      { title: 'Distribution Mechanism', href: '#distribution' },
    ],
  },
  {
    title: 'Oracle System',
    icon: Cloud,
    color: 'bg-info/10 text-info',
    items: [
      { title: 'AccuWeather Integration', href: '#accuweather' },
      { title: 'Data Updates', href: '#updates' },
      { title: 'Rolling 24h Calculation', href: '#rolling' },
      { title: 'Data Verification', href: '#verification' },
    ],
  },
];

export default function DocsPage() {
  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold">Documentation</h1>
        <p className="text-text-secondary mt-1">Learn how to use the PRMX platform</p>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {docSections.map((section) => {
          const Icon = section.icon;
          return (
            <Card key={section.title} hover className="cursor-pointer">
              <CardContent className="p-4">
                <div className={`w-10 h-10 rounded-xl ${section.color} flex items-center justify-center mb-3`}>
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-semibold mb-1">{section.title}</h3>
                <p className="text-sm text-text-secondary">{section.items.length} articles</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Documentation Sections */}
        <div className="lg:col-span-2 space-y-6">
          {docSections.map((section) => {
            const Icon = section.icon;
            return (
              <Card key={section.title}>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl ${section.color} flex items-center justify-center`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <h2 className="text-lg font-semibold">{section.title}</h2>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-2">
                    {section.items.map((item) => (
                      <a
                        key={item.title}
                        href={item.href}
                        className="flex items-center justify-between p-3 rounded-xl hover:bg-background-tertiary transition-colors group"
                      >
                        <span className="text-text-secondary group-hover:text-text-primary transition-colors">
                          {item.title}
                        </span>
                        <ArrowRight className="w-4 h-4 text-text-tertiary group-hover:text-prmx-cyan transition-colors" />
                      </a>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Featured Article */}
          <Card className="bg-gradient-to-br from-prmx-cyan/10 to-prmx-purple/10 border-prmx-cyan/20">
            <CardContent className="p-6">
              <h3 className="font-semibold mb-2">What is Parametric Insurance?</h3>
              <p className="text-sm text-text-secondary mb-4">
                Learn how PRMX uses smart contracts and real-time weather data 
                to provide automatic, transparent insurance coverage.
              </p>
              <a href="#parametric" className="text-prmx-cyan hover:text-prmx-cyan-light flex items-center gap-1 text-sm">
                Read more <ArrowRight className="w-4 h-4" />
              </a>
            </CardContent>
          </Card>

          {/* Technical Resources */}
          <Card>
            <CardHeader>
              <h3 className="font-semibold flex items-center gap-2">
                <Code2 className="w-5 h-5" />
                Technical Resources
              </h3>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 rounded-xl hover:bg-background-tertiary transition-colors"
              >
                <span className="text-sm">GitHub Repository</span>
                <ExternalLink className="w-4 h-4 text-text-tertiary" />
              </a>
              <a
                href="#"
                className="flex items-center justify-between p-3 rounded-xl hover:bg-background-tertiary transition-colors"
              >
                <span className="text-sm">API Documentation</span>
                <ExternalLink className="w-4 h-4 text-text-tertiary" />
              </a>
              <a
                href="#"
                className="flex items-center justify-between p-3 rounded-xl hover:bg-background-tertiary transition-colors"
              >
                <span className="text-sm">Smart Contract Reference</span>
                <ExternalLink className="w-4 h-4 text-text-tertiary" />
              </a>
            </CardContent>
          </Card>

          {/* FAQ */}
          <Card>
            <CardHeader>
              <h3 className="font-semibold">Frequently Asked Questions</h3>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              <div>
                <p className="font-medium text-sm mb-1">How are premiums calculated?</p>
                <p className="text-xs text-text-secondary">
                  Premiums are based on historical rainfall probability data using our R-based pricing model.
                </p>
              </div>
              <div>
                <p className="font-medium text-sm mb-1">When do I receive my payout?</p>
                <p className="text-xs text-text-secondary">
                  Payouts are automatic when the strike threshold is exceeded during your coverage window.
                </p>
              </div>
              <div>
                <p className="font-medium text-sm mb-1">What happens if no event occurs?</p>
                <p className="text-xs text-text-secondary">
                  The pool is distributed to LP token holders proportionally.
                </p>
              </div>
              <Link href="/help" className="text-prmx-cyan hover:text-prmx-cyan-light flex items-center gap-1 text-sm mt-4">
                View all FAQs <ArrowRight className="w-4 h-4" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
