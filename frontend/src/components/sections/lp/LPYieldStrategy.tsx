import { Layers, ArrowRight, TrendingUp, Shield, Zap, RefreshCw } from 'lucide-react'
import { FadeIn } from '@/components/ui/FadeIn'

export function LPYieldStrategy() {
  return (
    <section className="relative bg-slate-50 py-32 md:py-40 px-6 overflow-hidden">
      {/* Background elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-0 w-[600px] h-[600px] rounded-full bg-violet-100/50 blur-[200px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-cyan-100/50 blur-[150px]" />
      </div>

      <div className="relative max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left - Content */}
          <FadeIn>
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-100 border border-violet-200 mb-8">
                <Layers size={16} className="text-violet-600" />
                <span className="text-sm font-medium text-violet-600 font-ui">
                  DeFi Integration
                </span>
              </div>

              <h2 className="text-4xl md:text-5xl font-bold text-slate-900 leading-[1.1] font-display mb-6">
                Your capital{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-500 to-cyan-500">
                  works twice.
                </span>
              </h2>

              <p className="text-xl text-slate-600 font-ui mb-10 leading-relaxed">
                Policy capital pools are deployed to Hydration Stableswap for additional yield. 
                Earn LP premiums <span className="text-slate-900 font-medium">plus</span> DeFi returns simultaneously.
              </p>

              {/* Features */}
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-cyan-100 border border-cyan-200 flex items-center justify-center flex-shrink-0">
                    <TrendingUp size={24} className="text-cyan-600" />
                  </div>
                  <div>
                    <h4 className="text-lg font-semibold text-slate-900 font-display mb-1">
                      Dual Revenue Streams
                    </h4>
                    <p className="text-slate-600 font-ui">
                      Earn from policy premiums and stableswap trading fees. 
                      Capital efficiency maximized.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-sky-100 border border-sky-200 flex items-center justify-center flex-shrink-0">
                    <Shield size={24} className="text-sky-600" />
                  </div>
                  <div>
                    <h4 className="text-lg font-semibold text-slate-900 font-display mb-1">
                      DAO Solvency Backstop
                    </h4>
                    <p className="text-slate-600 font-ui">
                      The DAO treasury covers any DeFi losses when solvent. 
                      Your payout remains protected.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-violet-100 border border-violet-200 flex items-center justify-center flex-shrink-0">
                    <RefreshCw size={24} className="text-violet-600" />
                  </div>
                  <div>
                    <h4 className="text-lg font-semibold text-slate-900 font-display mb-1">
                      Automatic Rebalancing
                    </h4>
                    <p className="text-slate-600 font-ui">
                      Smart contracts handle allocation and withdrawal. 
                      No manual management required.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>

          {/* Right - Visual */}
          <FadeIn delay={200}>
            <div className="relative">
              {/* Flow Diagram */}
              <div className="p-8 rounded-[2rem] bg-white border border-slate-200 shadow-lg">
                {/* Capital Flow */}
                <div className="space-y-6">
                  {/* Input */}
                  <div className="flex items-center justify-center gap-4 p-4 rounded-xl bg-sky-50 border border-sky-200">
                    <div className="w-12 h-12 rounded-lg bg-sky-100 flex items-center justify-center">
                      <span className="text-xl font-bold text-sky-600">$</span>
                    </div>
                    <div className="text-left">
                      <p className="text-sm text-slate-500 font-ui">Your Capital</p>
                      <p className="text-lg font-bold text-slate-900 font-display">USDT Deposit</p>
                    </div>
                  </div>

                  {/* Arrow */}
                  <div className="flex justify-center">
                    <div className="w-px h-8 bg-gradient-to-b from-sky-400 to-violet-400" />
                  </div>

                  {/* Split */}
                  <div className="relative">
                    <div className="absolute left-1/2 -translate-x-1/2 -top-2 w-8 h-8 rounded-full bg-white border border-violet-200 flex items-center justify-center shadow-sm">
                      <Zap size={16} className="text-violet-600" />
                    </div>
                    <div className="grid grid-cols-2 gap-4 pt-6">
                      {/* Policy Pool */}
                      <div className="p-4 rounded-xl bg-violet-50 border border-violet-200">
                        <div className="flex items-center gap-2 mb-3">
                          <Shield size={16} className="text-violet-600" />
                          <span className="text-xs text-violet-600 font-ui uppercase tracking-wider">Policy Pool</span>
                        </div>
                        <p className="text-2xl font-bold text-slate-900 font-display mb-1">~30%</p>
                        <p className="text-xs text-slate-500 font-ui">Reserve for payouts</p>
                      </div>

                      {/* DeFi Pool */}
                      <div className="p-4 rounded-xl bg-cyan-50 border border-cyan-200">
                        <div className="flex items-center gap-2 mb-3">
                          <Layers size={16} className="text-cyan-600" />
                          <span className="text-xs text-cyan-600 font-ui uppercase tracking-wider">DeFi Yield</span>
                        </div>
                        <p className="text-2xl font-bold text-slate-900 font-display mb-1">~70%</p>
                        <p className="text-xs text-slate-500 font-ui">Hydration Stableswap</p>
                      </div>
                    </div>
                  </div>

                  {/* Arrow */}
                  <div className="flex justify-center">
                    <div className="w-px h-8 bg-gradient-to-b from-cyan-400 to-emerald-400" />
                  </div>

                  {/* Output */}
                  <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-50 to-cyan-50 border border-emerald-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-slate-500 font-ui">Combined Returns</p>
                        <p className="text-xl font-bold text-slate-900 font-display">Policy + DeFi Yield</p>
                      </div>
                      <div className="flex items-center gap-2 text-emerald-600">
                        <TrendingUp size={24} />
                        <span className="text-2xl font-bold font-display">+</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Additional Info */}
                <div className="mt-6 pt-6 border-t border-slate-200">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 font-ui">Powered by</span>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-700 font-medium">Hydration Protocol</span>
                      <ArrowRight size={14} className="text-slate-400" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Floating badge */}
              <div className="absolute -bottom-4 -right-4 px-4 py-2 rounded-full bg-cyan-100 border border-cyan-200 shadow-sm">
                <span className="text-sm font-medium text-cyan-700 font-ui">
                  Fully Automated
                </span>
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  )
}
