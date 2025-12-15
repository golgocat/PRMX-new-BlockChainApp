'use client'

import { useState } from 'react'
import { Plus, Minus } from 'lucide-react'
import { FadeIn } from '@/components/ui/FadeIn'

const questions = [
  {
    q: 'How are LP returns calculated?',
    a: 'When you purchase an LP token, you pay a price (e.g., $85). If no rain event triggers during the coverage period, you receive the full $100 payout per token. Your profit is the difference ($15 in this example, or ~17.6% return). If a rain event triggers, the $100 goes to the policyholder instead.',
    category: 'Returns',
  },
  {
    q: 'What happens if multiple policies trigger simultaneously?',
    a: 'Each LP token is tied to a specific policy. If multiple policies in your portfolio trigger, each one pays out independently. This is why diversification across markets is recommended - it reduces correlated event risk.',
    category: 'Risk',
  },
  {
    q: 'Can I withdraw my LP tokens before maturity?',
    a: 'LP tokens are tradeable on the orderbook. You can list your tokens for sale at any time before the policy settles. The price you receive depends on market demand and time remaining. Note: you cannot force immediate withdrawal - you need a buyer.',
    category: 'Trading',
  },
  {
    q: 'How do I connect my AI trading agent?',
    a: 'PRMX uses the standard Polkadot.js API. Your agent can subscribe to on-chain events, query market state, and submit transactions programmatically. See our GitHub repository for TypeScript examples and API documentation.',
    category: 'Technical',
  },
  {
    q: 'What is the DeFi yield strategy?',
    a: 'Capital pools are partially allocated to Hydration Stableswap to earn additional yield from trading fees. This means your capital earns from both LP premiums AND DeFi returns. The DAO treasury covers any DeFi losses when solvent.',
    category: 'Yield',
  },
  {
    q: 'How is weather data verified?',
    a: 'We use AccuWeather precipitation data fetched hourly by Substrate Off-chain Workers. The data is submitted on-chain and verified cryptographically. Multiple data points are aggregated to calculate 24-hour rolling rainfall sums.',
    category: 'Data',
  },
  {
    q: 'What are the fees?',
    a: 'There are no platform fees for LP trading. You pay only the standard blockchain transaction fees (gas). The DAO takes a margin on policy premiums, but this is already reflected in the LP token prices you see on the orderbook.',
    category: 'Fees',
  },
  {
    q: 'How do I get started?',
    a: 'Connect a Polkadot-compatible wallet, deposit USDT, and browse the LP orderbook. Find policies with attractive risk/return profiles, purchase LP tokens, and hold until maturity. Start small while you learn the system.',
    category: 'Getting Started',
  },
]

export function LPFAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <section id="lp-faq" className="relative bg-slate-50 py-32 md:py-40 px-6 overflow-hidden">
      {/* Background elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-violet-100/40 blur-[200px]" />
      </div>

      <div className="relative max-w-4xl mx-auto">
        {/* Header */}
        <FadeIn>
          <div className="text-center mb-16 md:mb-20">
            <p className="text-slate-500 text-sm tracking-[0.3em] uppercase mb-6 font-ui">
              LP FAQ
            </p>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 leading-[1.1] font-display mb-6">
              Questions?{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-500 via-blue-500 to-cyan-500">
                Answers.
              </span>
            </h2>
            <p className="text-xl text-slate-500 font-ui">
              Everything you need to know about providing liquidity.
            </p>
          </div>
        </FadeIn>

        {/* FAQ Items */}
        <div className="space-y-4 font-ui">
          {questions.map((item, i) => (
            <FadeIn key={i} delay={i * 50}>
              <div 
                className={`group rounded-2xl border transition-all duration-300 overflow-hidden ${
                  openIndex === i 
                    ? 'bg-white border-sky-200 shadow-lg' 
                    : 'bg-white border-slate-200 hover:border-slate-300 shadow-sm'
                }`}
              >
                <button
                  onClick={() => setOpenIndex(openIndex === i ? null : i)}
                  className="w-full py-6 flex justify-between items-center text-left px-6 md:px-8"
                >
                  <div className="flex items-center gap-4">
                    <span className="hidden md:inline-flex items-center justify-center px-3 py-1 rounded-full bg-slate-100 text-xs text-slate-600 font-medium">
                      {item.category}
                    </span>
                    <span className="text-lg md:text-xl text-slate-900 font-medium pr-4">
                      {item.q}
                    </span>
                  </div>
                  <div 
                    className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                      openIndex === i 
                        ? 'bg-sky-500 text-white' 
                        : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'
                    }`}
                  >
                    {openIndex === i ? <Minus size={18} /> : <Plus size={18} />}
                  </div>
                </button>
                <div
                  className={`overflow-hidden transition-all duration-300 ease-out ${
                    openIndex === i
                      ? 'max-h-64 opacity-100'
                      : 'max-h-0 opacity-0'
                  }`}
                >
                  <p className="text-slate-600 px-6 md:px-8 pb-6 leading-relaxed md:pl-[120px]">
                    {item.a}
                  </p>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>

        {/* Bottom CTA */}
        <FadeIn delay={400}>
          <div className="mt-16 text-center">
            <p className="text-slate-500 font-ui mb-4">
              Still have questions?
            </p>
            <a 
              href="mailto:lp@prmx.io" 
              className="inline-flex items-center gap-2 text-sky-600 hover:text-sky-700 transition-colors font-medium"
            >
              Contact LP Support
              <span className="text-slate-400">→</span>
            </a>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}
