import { Zap, Activity, ShieldCheck, ArrowUpRight } from 'lucide-react'
import { FadeIn } from '@/components/ui/FadeIn'

export function Solutions() {
  return (
    <section id="coverage" className="relative bg-[#0a0a0a] py-32 md:py-40 px-6 overflow-hidden">
      {/* Background elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-brand-violet/5 blur-[150px]" />
      </div>

      <div className="relative max-w-7xl mx-auto">
        {/* Header */}
        <FadeIn>
          <div className="max-w-3xl mb-20">
            <p className="text-brand-teal text-sm tracking-[0.3em] uppercase mb-6 font-ui">
              The Solution
            </p>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-[1.1] font-display mb-6">
              Parametric insurance,{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-violet to-brand-teal">
                reimagined.
              </span>
            </h2>
            <p className="text-xl text-zinc-400 font-ui">
              Built on smart contracts. Powered by real-time weather data.
            </p>
          </div>
        </FadeIn>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* Card 1 - Featured */}
          <FadeIn delay={100} className="lg:col-span-2">
            <div className="group relative h-full min-h-[360px] rounded-[2rem] bg-gradient-to-br from-brand-violet/20 via-zinc-900 to-zinc-900 p-8 md:p-10 overflow-hidden border border-zinc-800/50 hover:border-brand-violet/30 transition-all duration-500">
              {/* Animated gradient */}
              <div className="absolute top-0 right-0 w-96 h-96 bg-brand-violet/20 rounded-full blur-[100px] opacity-50 group-hover:opacity-80 transition-opacity duration-700" />
              
              {/* Icon */}
              <div className="relative z-10 flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-violet/20 border border-brand-violet/30 mb-8">
                <Zap size={32} className="text-brand-violet" />
              </div>

              <div className="relative z-10">
                <h3 className="text-3xl md:text-4xl font-bold text-white mb-4 font-display">
                  Instant Payouts
                </h3>
                <p className="text-lg text-zinc-400 leading-relaxed max-w-lg font-ui mb-8">
                  No adjusters. No delays. When the weather threshold is met, the smart contract triggers payment automatically to your account.
                </p>

                {/* Stats row */}
                <div className="flex flex-wrap gap-6">
                  <div className="px-4 py-3 rounded-xl bg-zinc-800/50 border border-zinc-700/50">
                    <p className="text-2xl font-bold text-white font-display">Instant</p>
                    <p className="text-sm text-zinc-500 font-ui">Payout time</p>
                  </div>
                  <div className="px-4 py-3 rounded-xl bg-zinc-800/50 border border-zinc-700/50">
                    <p className="text-2xl font-bold text-white font-display">100%</p>
                    <p className="text-sm text-zinc-500 font-ui">Automated</p>
                  </div>
                </div>
              </div>

              {/* Decorative arrow */}
              <div className="absolute bottom-8 right-8 w-12 h-12 rounded-full bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <ArrowUpRight size={20} className="text-zinc-400" />
              </div>
            </div>
          </FadeIn>

          {/* Card 2 */}
          <FadeIn delay={200}>
            <div className="group relative h-full min-h-[360px] rounded-[2rem] bg-zinc-900 p-8 overflow-hidden border border-zinc-800/50 hover:border-brand-magenta/30 transition-all duration-500">
              {/* Top accent line */}
              <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-brand-magenta/50 to-transparent" />
              
              {/* Glow */}
              <div className="absolute -top-20 -right-20 w-40 h-40 bg-brand-magenta/20 rounded-full blur-[80px] opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

              <div className="relative z-10 h-full flex flex-col">
                <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-magenta/20 border border-brand-magenta/30 mb-6">
                  <Activity size={28} className="text-brand-magenta" />
                </div>

                <h3 className="text-2xl font-bold text-white mb-3 font-display">
                  Transparent Pricing
                </h3>
                <p className="text-zinc-400 leading-relaxed font-ui mb-auto">
                  Premiums calculated using decades of historical rainfall data, ensuring fair, objective rates for your specific risk.
                </p>

                {/* Visual element */}
                <div className="mt-8 pt-6 border-t border-zinc-800">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                      <div className="h-full w-3/4 bg-gradient-to-r from-brand-magenta to-brand-magenta/50 rounded-full" />
                    </div>
                    <span className="text-sm text-zinc-500 font-ui">40+ years data</span>
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>

          {/* Card 3 - Full width on mobile, 1 col on desktop */}
          <FadeIn delay={300} className="lg:col-span-3">
            <div className="group relative rounded-[2rem] bg-zinc-900 p-8 md:p-10 overflow-hidden border border-zinc-800/50 hover:border-brand-teal/30 transition-all duration-500">
              <div className="flex flex-col md:flex-row md:items-center gap-8">
                <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-teal/20 border border-brand-teal/30 flex-shrink-0">
                  <ShieldCheck size={32} className="text-brand-teal" />
                </div>

                <div className="flex-1">
                  <h3 className="text-2xl md:text-3xl font-bold text-white mb-3 font-display">
                    On-Chain Verification
                  </h3>
                  <p className="text-zinc-400 leading-relaxed font-ui max-w-2xl">
                    Every policy and payout is recorded on the blockchain for complete auditability and guaranteed liquidity. 
                    No hidden terms. No fine print. Just transparent, verifiable coverage.
                  </p>
                </div>

                {/* Visual element - blockchain blocks */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {[...Array(4)].map((_, i) => (
                    <div
                      key={i}
                      className="w-10 h-10 md:w-12 md:h-12 rounded-lg bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center"
                      style={{ opacity: 1 - i * 0.2 }}
                    >
                      <div className="w-3 h-3 rounded bg-brand-teal/50" />
                    </div>
                  ))}
                  <div className="text-zinc-600 text-xl">→</div>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  )
}

