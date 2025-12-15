'use client'

import { useState } from 'react'
import { Plus, Minus } from 'lucide-react'
import { FadeIn } from '@/components/ui/FadeIn'

const questions = [
  {
    q: 'What triggers a payout?',
    a: 'A payout is automatically triggered when the 24-hour rolling rainfall sum exceeds the strike threshold defined for your market. The oracle fetches rainfall data from AccuWeather hourly, and smart contracts handle settlement automatically — no claims forms, no adjusters, no delays.',
    category: 'Payouts',
  },
  {
    q: 'What data source is used?',
    a: 'We use AccuWeather precipitation data, fetched every hour by our Substrate Off-chain Worker. The data is submitted on-chain and verified cryptographically. This ensures objective, tamper-proof measurements that neither you nor we can manipulate.',
    category: 'Data',
  },
  {
    q: 'How does parametric coverage work?',
    a: "Unlike traditional insurance, parametric coverage pays based on the occurrence of a weather event — not actual losses. If rainfall exceeds the threshold, you receive the full payout automatically. This means faster payouts, complete transparency, and no claim disputes.",
    category: 'Coverage',
  },
  {
    q: 'What markets are available?',
    a: 'Markets are created by the DAO and each represents a geographic location with specific parameters (strike threshold, coordinates, timezone). You can see all available markets in the app — new regions are added based on demand and weather data availability.',
    category: 'Markets',
  },
  {
    q: 'How quickly do I receive my payout?',
    a: 'Payouts are instant and automatic. When the oracle detects rainfall exceeding the threshold, the smart contract immediately settles the policy and transfers USDT directly to your wallet. No waiting, no approval process.',
    category: 'Payouts',
  },
  {
    q: 'What currency is used?',
    a: 'All premiums and payouts are in USDT (Tether) stablecoin. You pay your premium in USDT, and if a payout is triggered, you receive USDT directly to your connected wallet.',
    category: 'Payments',
  },
  {
    q: 'How is the premium calculated?',
    a: 'Premiums are calculated on-chain based on historical rainfall probability for the market location, coverage amount, and a DAO margin. The quote system provides real-time pricing that reflects actual risk.',
    category: 'Pricing',
  },
  {
    q: 'What happens if rainfall doesn\'t exceed the threshold?',
    a: 'If the coverage period ends without rainfall exceeding the strike threshold, the policy matures naturally. The capital pool (minus premium) is returned to liquidity providers. You keep your coverage benefit for the period — it simply wasn\'t triggered.',
    category: 'Coverage',
  },
]

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <section id="faq" className="relative bg-[#050505] py-32 md:py-40 px-6 overflow-hidden">
      {/* Background elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-brand-violet/5 blur-[200px]" />
      </div>

      <div className="relative max-w-4xl mx-auto">
        {/* Header */}
        <FadeIn>
          <div className="text-center mb-16 md:mb-20">
            <p className="text-zinc-500 text-sm tracking-[0.3em] uppercase mb-6 font-ui">
              FAQ
            </p>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-[1.1] font-display mb-6">
              Questions?{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-zinc-400 to-zinc-600">
                Answers.
              </span>
            </h2>
            <p className="text-xl text-zinc-500 font-ui">
              Everything you need to know about parametric rain coverage.
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
                    ? 'bg-zinc-900/80 border-zinc-700/50' 
                    : 'bg-zinc-900/30 border-zinc-800/50 hover:border-zinc-700/50'
                }`}
              >
                <button
                  onClick={() => setOpenIndex(openIndex === i ? null : i)}
                  className="w-full py-6 flex justify-between items-center text-left px-6 md:px-8"
                >
                  <div className="flex items-center gap-4">
                    <span className="hidden md:inline-flex items-center justify-center px-3 py-1 rounded-full bg-zinc-800/50 text-xs text-zinc-500 font-medium">
                      {item.category}
                    </span>
                    <span className="text-lg md:text-xl text-white font-medium pr-4">
                      {item.q}
                    </span>
                  </div>
                  <div 
                    className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                      openIndex === i 
                        ? 'bg-white text-zinc-900' 
                        : 'bg-zinc-800 text-zinc-400 group-hover:bg-zinc-700'
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
                  <p className="text-zinc-400 px-6 md:px-8 pb-6 leading-relaxed md:pl-[120px]">
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
            <p className="text-zinc-500 font-ui mb-4">
              Still have questions?
            </p>
            <a 
              href="mailto:hello@prmx.io" 
              className="inline-flex items-center gap-2 text-white hover:text-brand-violet transition-colors font-medium"
            >
              Contact our team
              <span className="text-zinc-600">→</span>
            </a>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}
