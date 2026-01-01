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
  Cloud,
  Code2,
  Zap,
  Book,
  ArrowRight,
  Github,
  FileText
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { cn } from '@/lib/utils';

// FAQ Data
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
        a: 'Coverage windows range from 1 to 7 days, depending on the market configuration.',
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
        a: 'Rainfall data is updated hourly through offchain workers. The 24-hour rolling sum is continuously calculated and stored on-chain.',
      },
      {
        q: 'Can the data be manipulated?',
        a: 'The oracle system includes safeguards against manipulation, including authorized providers, timestamp validation, and sanity checks on rainfall values.',
      },
    ],
  },
];

// Documentation sections
const docSections = [
  {
    title: 'Getting Started',
    icon: Zap,
    color: 'bg-prmx-cyan/10 text-prmx-cyan',
    items: [
      { title: 'Introduction to PRMX', description: 'Learn the basics of parametric insurance' },
      { title: 'Connecting Your Wallet', description: 'Set up your Polkadot wallet' },
      { title: 'Understanding Markets', description: 'Browse and analyze available markets' },
      { title: 'Your First Policy', description: 'Step-by-step coverage purchase guide' },
    ],
  },
  {
    title: 'Insurance Coverage',
    icon: Shield,
    color: 'bg-prmx-purple/10 text-prmx-purple-light',
    items: [
      { title: 'How Parametric Insurance Works', description: 'Smart contract-based automatic payouts' },
      { title: 'Coverage Windows', description: 'Understanding coverage periods' },
      { title: 'Strike Thresholds', description: '24h rolling rainfall triggers' },
      { title: 'Settlement Process', description: 'How policies are settled' },
    ],
  },
  {
    title: 'LP Trading',
    icon: Wallet,
    color: 'bg-success/10 text-success',
    items: [
      { title: 'Understanding LP Tokens', description: 'What LP tokens represent' },
      { title: 'Trading on the Orderbook', description: 'Buy and sell LP positions' },
      { title: 'Risk and Returns', description: 'Potential gains and risks' },
      { title: 'Distribution Mechanism', description: 'How profits are distributed' },
    ],
  },
  {
    title: 'Oracle System',
    icon: Cloud,
    color: 'bg-info/10 text-info',
    items: [
      { title: 'AccuWeather Integration', description: 'Real-time weather data source' },
      { title: 'Data Updates', description: 'Hourly data fetching process' },
      { title: 'Rolling 24h Calculation', description: 'How rainfall sums are computed' },
      { title: 'Data Verification', description: 'Verifying oracle data on-chain' },
    ],
  },
];

// Technical resources
const technicalResources = [
  { title: 'GitHub Repository', href: 'https://github.com/golgocat/PRMX-new-BlockChainApp', icon: Github },
  { title: 'Smart Contract Reference', href: '#', icon: Code2 },
  { title: 'API Documentation', href: '#', icon: FileText },
];

// Community resources
const communityResources = [
  { title: 'Discord Community', href: 'https://discord.gg', description: 'Join our community chat' },
  { title: 'Twitter Updates', href: 'https://twitter.com', description: 'Follow for announcements' },
  { title: 'Telegram Group', href: 'https://t.me', description: 'Connect with other users' },
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
  const [activeTab, setActiveTab] = useState('faq');
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
        <h1 className="text-3xl font-bold mb-2">Help & Resources</h1>
        <p className="text-text-secondary">
          Find answers, learn about PRMX, and access technical resources
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

      {/* Tabs */}
      <div className="flex justify-center">
        <Tabs defaultValue="faq" onChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="faq">Q&A</TabsTrigger>
            <TabsTrigger value="guides">Guides</TabsTrigger>
            <TabsTrigger value="resources">Resources</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* FAQ Tab */}
      {activeTab === 'faq' && (
        <>
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

          {/* FAQ Content */}
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
              <Card className="bg-gradient-to-br from-slate-900/50 via-slate-800/30 to-slate-900/50 border-prmx-cyan/20">
                <CardContent className="p-6 text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 border border-prmx-cyan/30 flex items-center justify-center">
                    <MessageCircle className="w-8 h-8 text-prmx-cyan" />
                  </div>
                  <h3 className="font-semibold mb-2">Still need help?</h3>
                  <p className="text-sm text-text-secondary mb-4">
                    Our support team is here to assist you
                  </p>
                  <Button fullWidth>
                    <Mail className="w-4 h-4 mr-2" />
                    Contact Support
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}

      {/* Guides Tab */}
      {activeTab === 'guides' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
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
                        <div
                          key={item.title}
                          className="flex items-center justify-between p-3 rounded-xl hover:bg-background-tertiary transition-colors group cursor-pointer"
                        >
                          <div>
                            <span className="text-text-primary group-hover:text-prmx-cyan transition-colors font-medium">
                              {item.title}
                            </span>
                            <p className="text-xs text-text-tertiary mt-0.5">{item.description}</p>
                          </div>
                          <ArrowRight className="w-4 h-4 text-text-tertiary group-hover:text-prmx-cyan transition-colors" />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Featured Article */}
          <div className="space-y-6">
            <Card className="bg-gradient-to-br from-slate-900/50 via-slate-800/30 to-slate-900/50 border-prmx-cyan/20">
              <CardContent className="p-6">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 border border-prmx-cyan/30 flex items-center justify-center mb-4">
                  <Book className="w-6 h-6 text-prmx-cyan" />
                </div>
                <h3 className="font-semibold mb-2">What is Parametric Insurance?</h3>
                <p className="text-sm text-text-secondary mb-4">
                  Learn how PRMX uses smart contracts and real-time weather data 
                  to provide automatic, transparent insurance coverage.
                </p>
                <Button variant="secondary" fullWidth>
                  Read Article <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <h3 className="font-semibold">Quick Tips</h3>
              </CardHeader>
              <CardContent className="pt-0 space-y-3 text-sm">
                <div className="p-3 rounded-lg bg-background-tertiary/50">
                  <p className="font-medium mb-1">💡 Check Oracle Data</p>
                  <p className="text-text-secondary text-xs">Always verify current rainfall levels before purchasing coverage.</p>
                </div>
                <div className="p-3 rounded-lg bg-background-tertiary/50">
                  <p className="font-medium mb-1">📊 Understand the Strike</p>
                  <p className="text-text-secondary text-xs">The 24h rolling sum must exceed the strike threshold for payout.</p>
                </div>
                <div className="p-3 rounded-lg bg-background-tertiary/50">
                  <p className="font-medium mb-1">⚠️ LP Risk Warning</p>
                  <p className="text-text-secondary text-xs">Only invest in LP tokens what you can afford to lose.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Resources Tab */}
      {activeTab === 'resources' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {/* Technical Resources */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-prmx-purple/10 flex items-center justify-center">
                  <Code2 className="w-5 h-5 text-prmx-purple-light" />
                </div>
                <h2 className="text-lg font-semibold">Technical Resources</h2>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {technicalResources.map((resource) => {
                const Icon = resource.icon;
                return (
                  <a
                    key={resource.title}
                    href={resource.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 rounded-xl hover:bg-background-tertiary transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="w-5 h-5 text-text-tertiary group-hover:text-prmx-cyan" />
                      <span className="text-text-secondary group-hover:text-text-primary">{resource.title}</span>
                    </div>
                    <ExternalLink className="w-4 h-4 text-text-tertiary" />
                  </a>
                );
              })}
            </CardContent>
          </Card>

          {/* Community Resources */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-success" />
                </div>
                <h2 className="text-lg font-semibold">Community</h2>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {communityResources.map((resource) => (
                <a
                  key={resource.title}
                  href={resource.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-background-tertiary transition-colors group"
                >
                  <div>
                    <span className="text-text-secondary group-hover:text-text-primary block">{resource.title}</span>
                    <span className="text-xs text-text-tertiary">{resource.description}</span>
                  </div>
                  <ExternalLink className="w-4 h-4 text-text-tertiary" />
                </a>
              ))}
            </CardContent>
          </Card>

          {/* Contact Support */}
          <Card className="lg:col-span-2 bg-gradient-to-r from-prmx-cyan/10 to-prmx-purple/10 border-prmx-cyan/20">
            <CardContent className="p-6">
              <div className="flex items-center gap-6">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 border border-prmx-cyan/30 flex items-center justify-center flex-shrink-0">
                  <Mail className="w-8 h-8 text-prmx-cyan" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg mb-1">Need Direct Support?</h3>
                  <p className="text-sm text-text-secondary mb-3">
                    Our team is available to help with technical issues, account questions, or general inquiries.
                  </p>
                  <Button>
                    Contact Support Team
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
