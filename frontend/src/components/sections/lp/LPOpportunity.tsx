import { Globe, TrendingUp, Bot, Shield, ArrowUpRight } from 'lucide-react'
import { FadeIn } from '@/components/ui/FadeIn'

export function LPOpportunity() {
  return (
    <section className="relative bg-slate-100 py-32 md:py-40 px-6 overflow-hidden">
      {/* Background elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-sky-200/40 blur-[150px]" />
      </div>

      <div className="relative max-w-7xl mx-auto">
        {/* Header */}
        <FadeIn>
          <div className="max-w-3xl mb-20">
            <p className="text-sky-600 text-sm tracking-[0.3em] uppercase mb-6 font-ui">
              The Opportunity
            </p>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 leading-[1.1] font-display mb-6">
              A new asset class,{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-500 via-blue-500 to-cyan-500">
                uncorrelated.
              </span>
            </h2>
            <p className="text-xl text-slate-600 font-ui">
              Weather risk has zero correlation with traditional markets. 
              Diversify your portfolio with nature.
            </p>
          </div>
        </FadeIn>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* Card 1 - Featured - Market Size */}
          <FadeIn delay={100} className="lg:col-span-2">
            <div className="group relative h-full min-h-[360px] rounded-[2rem] bg-gradient-to-br from-sky-100 via-white to-white p-8 md:p-10 overflow-hidden border border-sky-200 hover:border-sky-300 transition-all duration-500 shadow-lg shadow-sky-100/50">
              {/* Animated gradient */}
              <div className="absolute top-0 right-0 w-96 h-96 bg-sky-200/40 rounded-full blur-[100px] opacity-50 group-hover:opacity-80 transition-opacity duration-700" />
              
              {/* Icon */}
              <div className="relative z-10 flex items-center justify-center w-16 h-16 rounded-2xl bg-sky-100 border border-sky-200 mb-8">
                <Globe size={32} className="text-sky-600" />
              </div>

              <div className="relative z-10">
                <h3 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4 font-display">
                  $12B+ Market
                </h3>
                <p className="text-lg text-slate-600 leading-relaxed max-w-lg font-ui mb-8">
                  The global parametric insurance market is projected to reach $29B by 2031. 
                  Be early. Capture yield from a rapidly expanding sector.
                </p>

                {/* Stats row */}
                <div className="flex flex-wrap gap-6">
                  <div className="px-4 py-3 rounded-xl bg-sky-50 border border-sky-200">
                    <p className="text-2xl font-bold text-slate-900 font-display">15%+</p>
                    <p className="text-sm text-slate-500 font-ui">CAGR Growth</p>
                  </div>
                  <div className="px-4 py-3 rounded-xl bg-sky-50 border border-sky-200">
                    <p className="text-2xl font-bold text-slate-900 font-display">Global</p>
                    <p className="text-sm text-slate-500 font-ui">Coverage reach</p>
                  </div>
                </div>
              </div>

              {/* Decorative arrow */}
              <div className="absolute bottom-8 right-8 w-12 h-12 rounded-full bg-sky-100 border border-sky-200 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <ArrowUpRight size={20} className="text-sky-600" />
              </div>
            </div>
          </FadeIn>

          {/* Card 2 - Uncorrelated */}
          <FadeIn delay={200}>
            <div className="group relative h-full min-h-[360px] rounded-[2rem] bg-white p-8 overflow-hidden border border-violet-200 hover:border-violet-300 transition-all duration-500 shadow-lg shadow-violet-100/50">
              {/* Top accent line */}
              <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-violet-300 to-transparent" />
              
              {/* Glow */}
              <div className="absolute -top-20 -right-20 w-40 h-40 bg-violet-200/40 rounded-full blur-[80px] opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

              <div className="relative z-10 h-full flex flex-col">
                <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-violet-100 border border-violet-200 mb-6">
                  <TrendingUp size={28} className="text-violet-600" />
                </div>

                <h3 className="text-2xl font-bold text-slate-900 mb-3 font-display">
                  Zero Correlation
                </h3>
                <p className="text-slate-600 leading-relaxed font-ui mb-auto">
                  Weather events are independent of stock markets, interest rates, or crypto volatility. 
                  True portfolio diversification.
                </p>

                {/* Visual element */}
                <div className="mt-8 pt-6 border-t border-slate-200">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 font-ui">vs S&P 500</span>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-2 rounded-full bg-slate-200 overflow-hidden">
                        <div className="h-full w-[5%] bg-violet-400 rounded-full" />
                      </div>
                      <span className="text-violet-600 font-mono">~0.02</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>

          {/* Card 3 - Programmatic */}
          <FadeIn delay={300}>
            <div className="group relative h-full min-h-[360px] rounded-[2rem] bg-white p-8 overflow-hidden border border-cyan-200 hover:border-cyan-300 transition-all duration-500 shadow-lg shadow-cyan-100/50">
              {/* Glow */}
              <div className="absolute -top-20 -left-20 w-40 h-40 bg-cyan-200/40 rounded-full blur-[80px] opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

              <div className="relative z-10 h-full flex flex-col">
                <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-cyan-100 border border-cyan-200 mb-6">
                  <Bot size={28} className="text-cyan-600" />
                </div>

                <h3 className="text-2xl font-bold text-slate-900 mb-3 font-display">
                  Programmatic
                </h3>
                <p className="text-slate-600 leading-relaxed font-ui mb-auto">
                  Deploy capital via API. Perfect for algorithmic strategies, AI agents, 
                  and automated portfolio management.
                </p>

                {/* Code preview */}
                <div className="mt-6 p-3 rounded-lg bg-slate-100 border border-slate-200 font-mono text-xs text-slate-600">
                  <span className="text-cyan-600">await</span> api.fillLpAsk(...)
                </div>
              </div>
            </div>
          </FadeIn>

          {/* Card 4 - Transparent */}
          <FadeIn delay={400}>
            <div className="group relative h-full min-h-[360px] rounded-[2rem] bg-white p-8 overflow-hidden border border-pink-200 hover:border-pink-300 transition-all duration-500 shadow-lg shadow-pink-100/50">
              {/* Top accent line */}
              <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-pink-300 to-transparent" />
              
              <div className="relative z-10 h-full flex flex-col">
                <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-pink-100 border border-pink-200 mb-6">
                  <Shield size={28} className="text-pink-600" />
                </div>

                <h3 className="text-2xl font-bold text-slate-900 mb-3 font-display">
                  Fully Auditable
                </h3>
                <p className="text-slate-600 leading-relaxed font-ui mb-auto">
                  Every policy, premium, and payout is recorded on-chain. 
                  Open source contracts. Verifiable risk parameters.
                </p>

                {/* Visual - blockchain blocks */}
                <div className="mt-6 flex items-center gap-2">
                  {[...Array(4)].map((_, i) => (
                    <div
                      key={i}
                      className="flex-1 h-8 rounded-lg bg-pink-50 border border-pink-200 flex items-center justify-center"
                      style={{ opacity: 1 - i * 0.15 }}
                    >
                      <div className="w-2 h-2 rounded bg-pink-400" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </FadeIn>

          {/* Card 5 - Full width bottom */}
          <FadeIn delay={500} className="lg:col-span-2">
            <div className="group relative rounded-[2rem] bg-gradient-to-r from-white via-white to-sky-50 p-8 md:p-10 overflow-hidden border border-sky-200 hover:border-sky-300 transition-all duration-500 shadow-lg shadow-sky-100/50">
              <div className="flex flex-col md:flex-row md:items-center gap-8">
                <div className="flex-1">
                  <h3 className="text-2xl md:text-3xl font-bold text-slate-900 mb-3 font-display">
                    Why Weather Risk?
                  </h3>
                  <p className="text-slate-600 leading-relaxed font-ui max-w-2xl">
                    Climate volatility is increasing, driving demand for parametric coverage. 
                    As traditional insurance struggles with climate change, on-chain solutions become essential.
                    Position yourself at the intersection of DeFi and real-world risk.
                  </p>
                </div>

                {/* Stats */}
                <div className="flex gap-4 flex-shrink-0">
                  <div className="p-4 rounded-xl bg-sky-50 border border-sky-200 text-center">
                    <p className="text-3xl font-bold text-sky-600 font-display">40%</p>
                    <p className="text-xs text-slate-500 font-ui mt-1">More extreme<br/>weather events</p>
                  </div>
                  <div className="p-4 rounded-xl bg-cyan-50 border border-cyan-200 text-center">
                    <p className="text-3xl font-bold text-cyan-600 font-display">$300B</p>
                    <p className="text-xs text-slate-500 font-ui mt-1">Annual climate<br/>losses globally</p>
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  )
}
