'use client';

import { useState } from 'react';
import { 
  HelpCircle, 
  MessageCircle, 
  Mail, 
  ChevronDown,
  Search,
  ExternalLink,
  FileQuestion,
  Shield,
  Wallet,
  Cloud
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

const faqs = [
  {
    category: 'General',
    icon: HelpCircle,
    questions: [
      {
        q: 'What is PRMX?',
        a: 'PRMX is a decentralized parametric rainfall insurance platform built on the Polkadot blockchain. It provides automated insurance coverage that pays out when rainfall exceeds a predetermined threshold.',
      },
      {
        q: 'How is PRMX different from traditional insurance?',
        a: 'Unlike traditional insurance that requires claims assessment, PRMX uses smart contracts and real-time weather data to automatically trigger payouts when conditions are met. No paperwork, no waiting.',
      },
      {
        q: 'What blockchain does PRMX use?',
        a: 'PRMX is built on the Polkadot ecosystem using the Substrate framework. It will be deployed as a Tanssi appchain for optimal performance and security.',
      },
    ],
  },
  {
    category: 'Coverage',
    icon: Shield,
    questions: [
      {
        q: 'How do I purchase coverage?',
        a: 'Connect your Polkadot wallet, select a market, choose your coverage dates and number of shares, request a quote, and apply coverage. The premium is automatically deducted from your USDT balance.',
      },
      {
        q: 'What determines if I receive a payout?',
        a: 'If the 24-hour rolling rainfall sum exceeds the strike threshold at any point during your coverage window, you automatically receive the full payout for your shares.',
      },
      {
        q: 'How long can coverage last?',
        a: 'Coverage windows range from 1 to 7 days, depending on the market. You must purchase coverage at least 21 days before the coverage start date.',
      },
      {
        q: 'What is the payout per share?',
        a: 'Each share provides 100 USDT of coverage. If you purchase 5 shares and the event occurs, you receive 500 USDT.',
      },
    ],
  },
  {
    category: 'LP Trading',
    icon: Wallet,
    questions: [
      {
        q: 'What are LP tokens?',
        a: 'LP (Liquidity Provider) tokens represent your share of the risk pool for a specific policy. They entitle you to a proportional share of the pool if no rainfall event occurs.',
      },
      {
        q: 'How do I earn as an LP?',
        a: 'When you hold LP tokens and the policy settles without a rainfall event, the entire pool (including premiums) is distributed to LP holders proportionally.',
      },
      {
        q: 'What are the risks of being an LP?',
        a: 'If a rainfall event occurs during the coverage period, the pool is paid to the policy holder and LP tokens become worthless. Only invest what you can afford to lose.',
      },
    ],
  },
  {
    category: 'Oracle & Data',
    icon: Cloud,
    questions: [
      {
        q: 'Where does the rainfall data come from?',
        a: 'PRMX uses AccuWeather\'s API to fetch real-time rainfall data. Each market is bound to a specific AccuWeather location for consistent data.',
      },
      {
        q: 'How often is data updated?',
        a: 'Rainfall data is updated regularly through offchain workers. The 24-hour rolling sum is continuously calculated and stored on-chain.',
      },
      {
        q: 'Can the data be manipulated?',
        a: 'The oracle system includes safeguards against manipulation, including authorized providers, timestamp validation, and sanity checks on rainfall values.',
      },
    ],
  },
];

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border-b border-border-secondary last:border-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-4 text-left hover:text-prmx-cyan transition-colors"
      >
        <span className="font-medium pr-4">{question}</span>
        <ChevronDown className={cn('w-5 h-5 flex-shrink-0 transition-transform', isOpen && 'rotate-180')} />
      </button>
      {isOpen && (
        <div className="pb-4 text-text-secondary text-sm">
          {answer}
        </div>
      )}
    </div>
  );
}

export default function HelpPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const filteredFaqs = faqs.map(category => ({
    ...category,
    questions: category.questions.filter(
      q => q.q.toLowerCase().includes(searchQuery.toLowerCase()) ||
           q.a.toLowerCase().includes(searchQuery.toLowerCase())
    ),
  })).filter(
    category => (!selectedCategory || category.category === selectedCategory) &&
                category.questions.length > 0
  );

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="text-center max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Help & Support</h1>
        <p className="text-text-secondary">
          Find answers to common questions or reach out to our team
        </p>
      </div>

      {/* Search */}
      <div className="max-w-xl mx-auto">
        <Input
          placeholder="Search for help..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          icon={<Search className="w-5 h-5" />}
          className="!py-4"
        />
      </div>

      {/* Category Filters */}
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          variant={selectedCategory === null ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setSelectedCategory(null)}
        >
          All Topics
        </Button>
        {faqs.map((category) => {
          const Icon = category.icon;
          return (
            <Button
              key={category.category}
              variant={selectedCategory === category.category ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setSelectedCategory(category.category)}
              icon={<Icon className="w-4 h-4" />}
            >
              {category.category}
            </Button>
          );
        })}
      </div>

      {/* FAQ Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {filteredFaqs.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileQuestion className="w-12 h-12 mx-auto mb-4 text-text-tertiary" />
                <h3 className="font-semibold mb-2">No results found</h3>
                <p className="text-text-secondary text-sm">
                  Try a different search term or browse categories
                </p>
              </CardContent>
            </Card>
          ) : (
            filteredFaqs.map((category) => {
              const Icon = category.icon;
              return (
                <Card key={category.category}>
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-prmx-cyan/10 flex items-center justify-center">
                        <Icon className="w-5 h-5 text-prmx-cyan" />
                      </div>
                      <h2 className="text-lg font-semibold">{category.category}</h2>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {category.questions.map((faq, index) => (
                      <FAQItem key={index} question={faq.q} answer={faq.a} />
                    ))}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* Contact Section */}
        <div className="space-y-6">
          <Card className="bg-gradient-to-br from-prmx-cyan/10 to-prmx-purple/10 border-prmx-cyan/20">
            <CardContent className="p-6 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-prmx-gradient flex items-center justify-center">
                <MessageCircle className="w-8 h-8 text-white" />
              </div>
              <h3 className="font-semibold mb-2">Still need help?</h3>
              <p className="text-sm text-text-secondary mb-4">
                Our support team is here to assist you with any questions
              </p>
              <Button fullWidth>
                <Mail className="w-4 h-4 mr-2" />
                Contact Support
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="font-semibold">Resources</h3>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <a
                href="/docs"
                className="flex items-center justify-between p-3 rounded-xl hover:bg-background-tertiary transition-colors"
              >
                <span className="text-sm">Documentation</span>
                <ExternalLink className="w-4 h-4 text-text-tertiary" />
              </a>
              <a
                href="https://discord.gg"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 rounded-xl hover:bg-background-tertiary transition-colors"
              >
                <span className="text-sm">Discord Community</span>
                <ExternalLink className="w-4 h-4 text-text-tertiary" />
              </a>
              <a
                href="https://twitter.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 rounded-xl hover:bg-background-tertiary transition-colors"
              >
                <span className="text-sm">Twitter Updates</span>
                <ExternalLink className="w-4 h-4 text-text-tertiary" />
              </a>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
