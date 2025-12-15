'use client'

import { useState } from 'react'
import { Wallet, ArrowRight, Coins, Sun, CloudRain, CheckCircle, XCircle, DollarSign } from 'lucide-react'
import { FadeIn } from '@/components/ui/FadeIn'

const steps = [
  {
    id: 1,
    icon: Wallet,
    title: 'Connect & Deposit',
    description: 'Connect your wallet and deposit USDT into the platform.',
    color: 'brand-amber',
  },
  {
    id: 2,
    icon: Coins,
    title: 'Purchase LP Tokens',
    description: 'Buy LP tokens from the orderbook. Each token represents $100 max payout exposure.',
    color: 'brand-violet',
  },
  {
    id: 3,
    icon: Sun,
    title: 'Earn Premiums',
    description: 'Your capital underwrites policies. The difference between purchase price and $100 payout is your potential profit.',
    color: 'brand-teal',
  },
  {
    id: 4,
    icon: DollarSign,
    title: 'Collect Returns',
    description: 'If no rain event triggers, you receive the full $100 per token. If it rains, policyholders get paid.',
    color: 'brand-magenta',
  },
]

export function LPMechanics() {
  const [hoveredStep, setHoveredStep] = useState<number | null>(null)
  const [scenario, setScenario] = useState<'sunny' | 'rainy'>('sunny')

  return (
    <section id="mechanics" className="relative bg-white py-32 md:py-40 px-6 overflow-hidden">
      {/* Background elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 right-1/4 w-[600px] h-[600px] rounded-full bg-violet-100/50 blur-[150px]" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[400px] rounded-full bg-sky-100/50 blur-[150px]" />
      </div>

      <div className="relative max-w-7xl mx-auto">
        {/* Header */}
        <FadeIn>
          <div className="text-center mb-20">
            <p className="text-violet-600 text-sm tracking-[0.3em] uppercase mb-6 font-ui">
              How It Works
            </p>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 leading-[1.1] font-display mb-6">
              Simple mechanics,{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-500 via-blue-500 to-cyan-500">
                clear returns.
              </span>
            </h2>
            <p className="text-xl text-slate-600 font-ui max-w-2xl mx-auto">
              Understand exactly how LP earnings work. No hidden complexity.
            </p>
          </div>
        </FadeIn>

        {/* Process Flow */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-20">
          {steps.map((step, index) => (
            <FadeIn key={step.id} delay={index * 100}>
              <div
                className={`relative p-6 rounded-2xl bg-white border border-slate-200 transition-all duration-300 cursor-pointer shadow-lg ${
                  hoveredStep === step.id ? 'border-sky-300 shadow-sky-100' : 'shadow-slate-100'
                }`}
                onMouseEnter={() => setHoveredStep(step.id)}
                onMouseLeave={() => setHoveredStep(null)}
              >
                {/* Step number */}
                <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-sky-500 border border-sky-400 flex items-center justify-center">
                  <span className="text-sm font-bold text-white font-mono">{step.id}</span>
                </div>

                {/* Arrow connector (hidden on mobile and last item) */}
                {index < steps.length - 1 && (
                  <div className="hidden lg:block absolute -right-3 top-1/2 -translate-y-1/2 z-10">
                    <ArrowRight size={24} className="text-slate-400" />
                  </div>
                )}

                <div className={`w-14 h-14 rounded-xl bg-${step.color}/20 border border-${step.color}/30 flex items-center justify-center mb-4`}
                  style={{
                    backgroundColor: step.color === 'brand-amber' ? 'rgba(255, 160, 0, 0.2)' :
                                    step.color === 'brand-violet' ? 'rgba(138, 74, 243, 0.2)' :
                                    step.color === 'brand-teal' ? 'rgba(0, 196, 140, 0.2)' :
                                    'rgba(255, 64, 129, 0.2)',
                    borderColor: step.color === 'brand-amber' ? 'rgba(255, 160, 0, 0.3)' :
                                 step.color === 'brand-violet' ? 'rgba(138, 74, 243, 0.3)' :
                                 step.color === 'brand-teal' ? 'rgba(0, 196, 140, 0.3)' :
                                 'rgba(255, 64, 129, 0.3)',
                  }}
                >
                  <step.icon size={28} style={{
                    color: step.color === 'brand-amber' ? '#FFA000' :
                           step.color === 'brand-violet' ? '#8A4AF3' :
                           step.color === 'brand-teal' ? '#00C48C' :
                           '#FF4081',
                  }} />
                </div>

                <h3 className="text-lg font-bold text-slate-900 mb-2 font-display">{step.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed font-ui">{step.description}</p>
              </div>
            </FadeIn>
          ))}
        </div>

        {/* Interactive Scenario */}
        <FadeIn delay={400}>
          <div className="max-w-4xl mx-auto">
            <div className="p-8 md:p-10 rounded-[2rem] bg-slate-50 border border-slate-200 shadow-lg">
              <h3 className="text-2xl font-bold text-slate-900 mb-6 font-display text-center">
                See Your Returns
              </h3>

              {/* Scenario Toggle */}
              <div className="flex justify-center gap-4 mb-8">
                <button
                  onClick={() => setScenario('sunny')}
                  className={`flex items-center gap-2 px-6 py-3 rounded-full font-semibold transition-all ${
                    scenario === 'sunny'
                      ? 'bg-sky-500 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:border-sky-300'
                  }`}
                >
                  <Sun size={20} />
                  No Rain Event
                </button>
                <button
                  onClick={() => setScenario('rainy')}
                  className={`flex items-center gap-2 px-6 py-3 rounded-full font-semibold transition-all ${
                    scenario === 'rainy'
                      ? 'bg-blue-500 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:border-blue-300'
                  }`}
                >
                  <CloudRain size={20} />
                  Rain Triggers
                </button>
              </div>

              {/* Scenario Visualization */}
              <div className="grid md:grid-cols-3 gap-6">
                {/* Investment */}
                <div className="p-6 rounded-xl bg-white border border-slate-200 text-center shadow-sm">
                  <p className="text-sm text-slate-500 mb-2 font-ui">Your Investment</p>
                  <p className="text-3xl font-bold text-slate-900 font-display">$85</p>
                  <p className="text-xs text-slate-500 mt-1 font-ui">per LP token</p>
                </div>

                {/* Arrow */}
                <div className="hidden md:flex items-center justify-center">
                  <div className={`w-full h-1 rounded-full ${
                    scenario === 'sunny' ? 'bg-gradient-to-r from-sky-300 to-emerald-300' : 'bg-gradient-to-r from-blue-300 to-red-300'
                  }`} />
                </div>

                {/* Outcome */}
                <div className={`p-6 rounded-xl border text-center transition-all duration-500 ${
                  scenario === 'sunny'
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-red-50 border-red-200'
                }`}>
                  <div className="flex items-center justify-center gap-2 mb-2">
                    {scenario === 'sunny' ? (
                      <CheckCircle size={20} className="text-emerald-600" />
                    ) : (
                      <XCircle size={20} className="text-red-500" />
                    )}
                    <p className="text-sm text-slate-500 font-ui">Your Return</p>
                  </div>
                  <p className={`text-3xl font-bold font-display ${
                    scenario === 'sunny' ? 'text-emerald-600' : 'text-red-500'
                  }`}>
                    {scenario === 'sunny' ? '+$15' : '-$85'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 font-ui">
                    {scenario === 'sunny' ? '+17.6% profit' : 'Capital to policyholder'}
                  </p>
                </div>
              </div>

              {/* Explanation */}
              <div className={`mt-6 p-4 rounded-xl transition-all duration-500 ${
                scenario === 'sunny'
                  ? 'bg-emerald-50 border border-emerald-200'
                  : 'bg-red-50 border border-red-200'
              }`}>
                <p className="text-sm text-slate-600 font-ui text-center">
                  {scenario === 'sunny' ? (
                    <>
                      <span className="text-emerald-600 font-semibold">Policy matures without event.</span>
                      {' '}You purchased the LP token at $85 and receive the full $100 payout. Your profit is $15 per token.
                    </>
                  ) : (
                    <>
                      <span className="text-red-600 font-semibold">Rainfall exceeds threshold.</span>
                      {' '}The smart contract automatically pays the policyholder. Your $85 investment is transferred as their payout.
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
        </FadeIn>

        {/* Key Insight */}
        <FadeIn delay={500}>
          <div className="mt-12 text-center">
            <p className="text-slate-500 font-ui max-w-2xl mx-auto">
              <span className="text-sky-600 font-semibold">Pro tip:</span> Historical data shows rain events trigger 
              less than 10% of the time in most markets. Research your markets to optimize returns.
            </p>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}
