'use client'

import { useState } from 'react'
import { Plus, Minus } from 'lucide-react'
import { FadeIn } from '@/components/ui/FadeIn'

const questions = [
  {
    q: 'What triggers a payout?',
    a: 'A payout is triggered when daily rainfall accumulation exceeds the predefined threshold for your location as reported by our weather oracle. The entire process is automated — no claims forms, no adjusters, no delays.',
    category: 'Payouts',
  },
  {
    q: 'What data source is used?',
    a: 'We use AccuWeather and local satellite telemetry data, fetched and verified using our Off Chain Worker solution. This ensures objective, tamper-proof measurements that neither you nor we can manipulate.',
    category: 'Data',
  },
  {
    q: 'Is this traditional insurance?',
    a: "No, this is parametric coverage. We don't indemnify specific losses; we pay based on the occurrence of the weather event itself. This means faster payouts and complete transparency.",
    category: 'Coverage',
  },
  {
    q: 'What areas are supported?',
    a: 'We currently support 12 markets across Southeast Asia, Latin America, and Africa. New regions are added regularly based on weather data availability and demand.',
    category: 'Coverage',
  },
  {
    q: 'How quickly do I receive my payout?',
    a: 'Payouts are instant. Once the trigger event is confirmed by our weather oracle, smart contracts automatically send funds directly to your registered bank account, crypto wallet, or preferred payment method.',
    category: 'Payouts',
  },
  {
    q: 'Can I cancel my policy?',
    a: 'Yes, you can cancel anytime before a trigger event occurs. A pro-rated refund will be calculated based on the remaining coverage period and returned to your original payment method.',
    category: 'Policy',
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
                      ? 'max-h-48 opacity-100'
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
        <FadeIn delay={300}>
          <div className="mt-16 text-center">
            <p className="text-zinc-500 font-ui mb-4">
              Still have questions?
            </p>
            <a 
              href="mailto:hello@prmx.ph" 
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

