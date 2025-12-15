import { Bot, Code, Database, Cpu, ArrowRight, Sparkles, Terminal } from 'lucide-react'
import { FadeIn } from '@/components/ui/FadeIn'
import Link from 'next/link'

const codeExample = `// Autonomous weather arbitrage strategy
import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

async function executeStrategy() {
  const api = await ApiPromise.create({ 
    provider: new WsProvider('wss://prmx.io') 
  });
  
  // Fetch all markets with rainfall probability data
  const markets = await api.query.prmxMarket.markets.entries();
  
  // Analyze orderbook for mispriced LP tokens
  const orders = await api.query.prmxPolicy.lpAskOrders.entries();
  
  // Find opportunities where price < expected value
  const opportunities = orders.filter(([_, order]) => {
    const price = order.priceUsdt.toNumber() / 1e6;
    const expectedValue = calculateEV(order.policyId, markets);
    return price < expectedValue * 0.95; // 5% margin
  });
  
  // Execute trades autonomously
  for (const opp of opportunities) {
    await api.tx.prmxPolicy
      .fillLpAsk(opp.orderId, quantity)
      .signAndSend(keypair);
  }
}`;

const features = [
  {
    icon: Database,
    title: 'On-Chain Data',
    description: 'All market data, historical triggers, and orderbook state available on-chain for model training.',
  },
  {
    icon: Cpu,
    title: 'Predictable Execution',
    description: 'Deterministic smart contract execution. No slippage on policy fills. MEV-resistant.',
  },
  {
    icon: Terminal,
    title: 'Substrate API',
    description: 'Full Polkadot.js API access. Subscribe to events, query state, submit extrinsics programmatically.',
  },
]

export function LPForAgents() {
  return (
    <section className="relative bg-white py-32 md:py-40 px-6 overflow-hidden">
      {/* Background elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-cyan-100/50 blur-[200px]" />
      </div>

      {/* Animated circuit lines */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-10">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="absolute h-px bg-gradient-to-r from-transparent via-brand-teal to-transparent"
            style={{
              top: `${15 + i * 12}%`,
              left: '-10%',
              right: '-10%',
              animationDelay: `${i * 0.3}s`,
            }}
          />
        ))}
      </div>

      <div className="relative max-w-7xl mx-auto">
        {/* Header */}
        <FadeIn>
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-100 border border-cyan-200 mb-8">
              <Bot size={16} className="text-cyan-600" />
              <span className="text-sm font-medium text-cyan-700 font-ui">
                Built for Automation
              </span>
            </div>

            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 leading-[1.1] font-display mb-6">
              Deploy your{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 via-blue-500 to-violet-500">
                AI agents.
              </span>
            </h2>

            <p className="text-xl text-slate-600 font-ui max-w-3xl mx-auto">
              Perfect for algorithmic hedge funds, prediction market protocols, and autonomous trading systems. 
              All data on-chain. Fully programmable.
            </p>
          </div>
        </FadeIn>

        <div className="grid lg:grid-cols-5 gap-8">
          {/* Code Preview - Takes 3 columns */}
          <FadeIn delay={100} className="lg:col-span-3">
            <div className="h-full rounded-[2rem] bg-slate-900 border border-slate-700 overflow-hidden shadow-2xl">
              {/* Terminal Header */}
              <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-700 bg-slate-800">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                </div>
                <span className="text-sm text-slate-400 font-mono ml-4">weather-arbitrage.ts</span>
                <div className="ml-auto flex items-center gap-2">
                  <Sparkles size={14} className="text-cyan-400" />
                  <span className="text-xs text-cyan-400 font-ui">AI-Ready</span>
                </div>
              </div>

              {/* Code Block */}
              <div className="p-6 overflow-x-auto">
                <pre className="text-sm font-mono leading-relaxed">
                  <code className="text-slate-300">
                    {codeExample.split('\n').map((line, i) => (
                      <div key={i} className="flex">
                        <span className="text-zinc-600 select-none w-8 flex-shrink-0 text-right pr-4">
                          {i + 1}
                        </span>
                        <span>
                          {line
                            .replace(/\/\/.*/g, (match) => `<span class="text-zinc-500">${match}</span>`)
                            .replace(/('.*?'|".*?")/g, '<span class="text-brand-teal">$1</span>')
                            .replace(/\b(const|async|await|function|for|import|from|return)\b/g, '<span class="text-brand-violet">$1</span>')
                            .replace(/\b(api|orders|markets|opportunities)\b/g, '<span class="text-brand-amber">$1</span>')
                            .split(/<span|<\/span>/)
                            .map((part, j) => {
                              if (part.startsWith(' class=')) {
                                const className = part.match(/class="([^"]+)"/)?.[1] || '';
                                const content = part.replace(/class="[^"]+">/,'');
                                return <span key={j} className={className}>{content}</span>;
                              }
                              return part;
                            })
                          }
                        </span>
                      </div>
                    ))}
                  </code>
                </pre>
              </div>
            </div>
          </FadeIn>

          {/* Features - Takes 2 columns */}
          <div className="lg:col-span-2 space-y-6">
            {features.map((feature, i) => (
              <FadeIn key={feature.title} delay={200 + i * 100}>
                <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 hover:border-cyan-300 transition-all group shadow-sm">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-cyan-100 border border-cyan-200 flex items-center justify-center flex-shrink-0 group-hover:bg-cyan-200 transition-colors">
                      <feature.icon size={24} className="text-cyan-600" />
                    </div>
                    <div>
                      <h4 className="text-lg font-semibold text-slate-900 font-display mb-2">
                        {feature.title}
                      </h4>
                      <p className="text-sm text-slate-600 font-ui leading-relaxed">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                </div>
              </FadeIn>
            ))}

            {/* CTA */}
            <FadeIn delay={500}>
              <Link 
                href="https://github.com/prmx-io/prmx-blockchain"
                target="_blank"
                className="flex items-center justify-between p-6 rounded-2xl bg-gradient-to-r from-cyan-50 to-violet-50 border border-cyan-200 hover:border-cyan-300 transition-all group shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <Code size={20} className="text-cyan-600" />
                  <span className="font-semibold text-slate-900 font-display">View Documentation</span>
                </div>
                <ArrowRight size={20} className="text-slate-400 group-hover:text-cyan-600 group-hover:translate-x-1 transition-all" />
              </Link>
            </FadeIn>
          </div>
        </div>

        {/* Use Cases */}
        <FadeIn delay={600}>
          <div className="mt-20 grid md:grid-cols-3 gap-6">
            {[
              {
                title: 'AI Hedge Funds',
                description: 'Train models on historical trigger data. Execute weather-correlated strategies.',
                gradient: 'from-brand-violet to-brand-magenta',
              },
              {
                title: 'Prediction Markets',
                description: 'Use PRMX as a pricing oracle for weather derivatives on other platforms.',
                gradient: 'from-brand-teal to-brand-violet',
              },
              {
                title: 'Automated Market Makers',
                description: 'Build custom LP strategies that rebalance based on weather forecasts.',
                gradient: 'from-brand-amber to-brand-teal',
              },
            ].map((useCase, i) => (
              <div key={useCase.title} className="p-6 rounded-2xl bg-slate-50 border border-slate-200 shadow-sm">
                <div className={`w-full h-1 rounded-full bg-gradient-to-r ${useCase.gradient} mb-4`} />
                <h4 className="text-lg font-semibold text-slate-900 font-display mb-2">
                  {useCase.title}
                </h4>
                <p className="text-sm text-slate-600 font-ui">
                  {useCase.description}
                </p>
              </div>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  )
}
