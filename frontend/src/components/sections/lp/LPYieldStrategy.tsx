import { Layers, ArrowRight, TrendingUp, Shield, Zap, RefreshCw, ArrowDown, Clock } from 'lucide-react'
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

              <p className="text-xl text-slate-600 font-ui mb-4 leading-relaxed">
                When you provide liquidity, your capital is locked until the policy matures or settles. 
                But why let it sit idle?
              </p>
              <p className="text-lg text-slate-600 font-ui mb-10 leading-relaxed">
                PRMX deploys <span className="text-slate-900 font-medium">100% of locked capital</span> to{' '}
                <span className="text-violet-600 font-medium">Hydration Stableswap</span> — earning 
                trading fees while awaiting settlement. When a payout is needed, our{' '}
                <span className="text-cyan-600 font-medium">automated unwinding system</span> instantly 
                withdraws and settles — no manual intervention required.
              </p>

              {/* Features */}
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-cyan-100 border border-cyan-200 flex items-center justify-center flex-shrink-0">
                    <TrendingUp size={24} className="text-cyan-600" />
                  </div>
                  <div>
                    <h4 className="text-lg font-semibold text-slate-900 font-display mb-1">
                      100% Capital Utilization
                    </h4>
                    <p className="text-slate-600 font-ui">
                      Every dollar of locked capital is deployed to Hydration Stableswap, 
                      earning trading fees throughout the entire coverage period.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-violet-100 border border-violet-200 flex items-center justify-center flex-shrink-0">
                    <Zap size={24} className="text-violet-600" />
                  </div>
                  <div>
                    <h4 className="text-lg font-semibold text-slate-900 font-display mb-1">
                      Automated Unwinding
                    </h4>
                    <p className="text-slate-600 font-ui">
                      Smart contracts monitor policy status in real-time. When maturity or a trigger event occurs, 
                      capital is instantly withdrawn from DeFi and settled — all on-chain, all automatic.
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
                      If DeFi yields underperform or incur losses, the DAO treasury covers the difference 
                      when solvent. Your expected payout remains protected.
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
                <div className="space-y-4">
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

                  {/* Arrow with label */}
                  <div className="flex flex-col items-center gap-1">
                    <ArrowDown size={20} className="text-violet-400" />
                    <span className="text-xs text-violet-500 font-ui font-medium">100% Deployed</span>
                  </div>

                  {/* DeFi Pool - Full Width */}
                  <div className="p-5 rounded-xl bg-gradient-to-r from-violet-50 to-cyan-50 border border-violet-200">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Layers size={18} className="text-violet-600" />
                        <span className="text-sm text-violet-600 font-ui font-semibold">Hydration Stableswap</span>
                      </div>
                      <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 border border-emerald-200">
                        <TrendingUp size={12} className="text-emerald-600" />
                        <span className="text-xs text-emerald-700 font-medium">Earning Yield</span>
                      </div>
                    </div>
                    <p className="text-sm text-slate-600 font-ui">
                      Capital earns stableswap trading fees while locked during coverage period
                    </p>
                  </div>

                  {/* Unwinding Process */}
                  <div className="relative p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-white border border-cyan-200 shadow-sm">
                      <span className="text-xs text-cyan-600 font-ui font-semibold flex items-center gap-1">
                        <Zap size={12} />
                        Auto-Unwind Triggers
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-2">
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-200">
                        <Clock size={14} className="text-sky-500" />
                        <span className="text-xs text-slate-600 font-ui">Policy Maturity</span>
                      </div>
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-200">
                        <Shield size={14} className="text-amber-500" />
                        <span className="text-xs text-slate-600 font-ui">Rain Event Trigger</span>
                      </div>
                    </div>
                  </div>

                  {/* Arrow */}
                  <div className="flex flex-col items-center gap-1">
                    <ArrowDown size={20} className="text-emerald-400" />
                    <span className="text-xs text-emerald-500 font-ui font-medium">Instant Settlement</span>
                  </div>

                  {/* Output */}
                  <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-50 to-cyan-50 border border-emerald-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-slate-500 font-ui">You Receive</p>
                        <p className="text-lg font-bold text-slate-900 font-display">Principal + DeFi Yield</p>
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
                  Smart Contract Managed
                </span>
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  )
}
