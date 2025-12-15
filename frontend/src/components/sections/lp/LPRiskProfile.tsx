import { AlertTriangle, CloudRain, Code, Layers, Shield, TrendingDown, CheckCircle } from 'lucide-react'
import { FadeIn } from '@/components/ui/FadeIn'

const risks = [
  {
    icon: CloudRain,
    title: 'Event Risk',
    description: 'If rainfall exceeds the strike threshold, your LP tokens pay out to policyholders. You lose your invested capital.',
    severity: 'high',
    mitigation: 'Diversify across multiple markets and policies. Research historical rainfall patterns before investing.',
  },
  {
    icon: Layers,
    title: 'Concentration Risk',
    description: 'Overexposure to a single market or region increases vulnerability to localized weather events.',
    severity: 'medium',
    mitigation: 'Spread capital across different geographies and time periods. Monitor your portfolio distribution.',
  },
  {
    icon: Code,
    title: 'Smart Contract Risk',
    description: 'All systems have inherent technical risks. Bugs or exploits could affect contract execution.',
    severity: 'low',
    mitigation: 'Contracts are open source and auditable. Start with smaller positions while evaluating the system.',
  },
  {
    icon: TrendingDown,
    title: 'DeFi Integration Risk',
    description: 'Capital allocated to Hydration Stableswap carries additional DeFi protocol risks.',
    severity: 'medium',
    mitigation: 'DAO treasury provides solvency backstop. Understand that DeFi losses may be covered by DAO when solvent.',
  },
]

const mitigations = [
  {
    icon: Shield,
    title: 'Open Source Contracts',
    description: 'All smart contracts are publicly auditable on GitHub. Verify the code yourself.',
  },
  {
    icon: CheckCircle,
    title: 'On-Chain Transparency',
    description: 'Every transaction, trigger, and payout is recorded on-chain. Full audit trail available.',
  },
  {
    icon: AlertTriangle,
    title: 'Clear Strike Parameters',
    description: 'Each market has well-defined strike thresholds based on historical data. No ambiguity.',
  },
]

export function LPRiskProfile() {
  return (
    <section className="relative bg-white py-32 md:py-40 px-6 overflow-hidden">
      {/* Background elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full bg-rose-100/40 blur-[200px]" />
      </div>

      <div className="relative max-w-7xl mx-auto">
        {/* Header */}
        <FadeIn>
          <div className="text-center mb-20">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-rose-100 border border-rose-200 mb-8">
              <AlertTriangle size={16} className="text-rose-600" />
              <span className="text-sm font-medium text-rose-700 font-ui">
                Risk Disclosure
              </span>
            </div>

            <h2 className="text-4xl md:text-5xl font-bold text-slate-900 leading-[1.1] font-display mb-6">
              Know your{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-500 to-orange-500">
                downside.
              </span>
            </h2>

            <p className="text-xl text-slate-600 font-ui max-w-2xl mx-auto">
              Transparency builds trust. We want you to understand exactly what you're investing in.
            </p>
          </div>
        </FadeIn>

        {/* Risk Cards */}
        <div className="grid md:grid-cols-2 gap-6 mb-16">
          {risks.map((risk, i) => (
            <FadeIn key={risk.title} delay={i * 100}>
              <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 hover:border-slate-300 transition-all shadow-sm">
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    risk.severity === 'high' ? 'bg-rose-100 border border-rose-200' :
                    risk.severity === 'medium' ? 'bg-amber-100 border border-amber-200' :
                    'bg-slate-100 border border-slate-200'
                  }`}>
                    <risk.icon size={24} className={
                      risk.severity === 'high' ? 'text-rose-600' :
                      risk.severity === 'medium' ? 'text-amber-600' :
                      'text-slate-500'
                    } />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h4 className="text-lg font-semibold text-slate-900 font-display">
                        {risk.title}
                      </h4>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        risk.severity === 'high' ? 'bg-rose-100 text-rose-700' :
                        risk.severity === 'medium' ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-200 text-slate-600'
                      }`}>
                        {risk.severity}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 font-ui leading-relaxed mb-4">
                      {risk.description}
                    </p>
                    <div className="p-3 rounded-xl bg-white border border-slate-200">
                      <p className="text-xs text-slate-600 font-ui">
                        <span className="text-cyan-600 font-semibold">Mitigation: </span>
                        {risk.mitigation}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>

        {/* Trust Section */}
        <FadeIn delay={400}>
          <div className="p-8 md:p-10 rounded-[2rem] bg-gradient-to-r from-slate-50 to-sky-50 border border-slate-200 shadow-lg">
            <h3 className="text-2xl font-bold text-slate-900 mb-8 font-display text-center">
              Built on Transparency
            </h3>
            
            <div className="grid md:grid-cols-3 gap-6">
              {mitigations.map((item, i) => (
                <div key={item.title} className="text-center">
                  <div className="w-14 h-14 rounded-xl bg-cyan-100 border border-cyan-200 flex items-center justify-center mx-auto mb-4">
                    <item.icon size={28} className="text-cyan-600" />
                  </div>
                  <h4 className="text-lg font-semibold text-slate-900 font-display mb-2">
                    {item.title}
                  </h4>
                  <p className="text-sm text-slate-600 font-ui">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>

        {/* Historical Data Visualization */}
        <FadeIn delay={500}>
          <div className="mt-12 p-6 rounded-2xl bg-slate-50 border border-slate-200 shadow-sm">
            <h4 className="text-lg font-semibold text-slate-900 font-display mb-4 text-center">
              Historical Event Probability by Region
            </h4>
            <div className="flex items-end justify-center gap-4 h-40">
              {[
                { region: 'SE Asia', rate: 8, color: 'violet' },
                { region: 'S. America', rate: 12, color: 'sky' },
                { region: 'Africa', rate: 6, color: 'cyan' },
                { region: 'India', rate: 15, color: 'blue' },
              ].map((data) => (
                <div key={data.region} className="flex flex-col items-center gap-2">
                  <div 
                    className="w-16 md:w-20 rounded-t-lg transition-all hover:opacity-80"
                    style={{
                      height: `${data.rate * 6}px`,
                      backgroundColor: data.color === 'violet' ? 'rgba(139, 92, 246, 0.7)' :
                                      data.color === 'sky' ? 'rgba(14, 165, 233, 0.7)' :
                                      data.color === 'cyan' ? 'rgba(6, 182, 212, 0.7)' :
                                      'rgba(59, 130, 246, 0.7)',
                    }}
                  />
                  <span className="text-xs text-slate-500 font-ui">{data.region}</span>
                  <span className="text-sm font-semibold text-slate-700 font-mono">{data.rate}%</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500 font-ui text-center mt-4">
              Based on historical rainfall data. Past performance does not guarantee future results.
            </p>
          </div>
        </FadeIn>

        {/* Disclaimer */}
        <FadeIn delay={600}>
          <div className="mt-8 p-4 rounded-xl bg-amber-50 border border-amber-200">
            <p className="text-xs text-amber-800 font-ui text-center">
              <span className="font-semibold">Important: </span>
              LP tokens are not guaranteed investments. You can lose your entire principal if a rain event triggers. 
              Only invest what you can afford to lose. This is not financial advice. DYOR.
            </p>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}
