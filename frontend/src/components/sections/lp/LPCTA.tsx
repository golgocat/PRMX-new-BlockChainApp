'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Snowflake, TrendingUp, BarChart3, Code } from 'lucide-react'
import { FadeIn } from '@/components/ui/FadeIn'
import * as api from '@/lib/api'

export function LPCTA() {
  const [marketCount, setMarketCount] = useState<number | null>(null)

  useEffect(() => {
    async function fetchMarketCount() {
      try {
        const markets = await api.getMarkets()
        setMarketCount(markets.length)
      } catch (error) {
        console.error('Failed to fetch market count:', error)
      }
    }
    fetchMarketCount()
  }, [])

  return (
    <section className="relative py-32 md:py-40 px-6 bg-gradient-to-b from-slate-50 to-white overflow-hidden">
      {/* Aurora background effect - soft icy blue theme */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full bg-sky-200/40 blur-[150px] animate-pulse" />
        <div className="absolute top-1/4 right-1/4 w-[500px] h-[500px] rounded-full bg-cyan-100/40 blur-[150px]" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-blue-100/40 blur-[150px]" />
      </div>

      {/* Floating snowflakes animation */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(12)].map((_, i) => (
          <div
            key={i}
            className="absolute"
            style={{
              left: `${10 + (i * 8)}%`,
              top: `${15 + (i % 4) * 20}%`,
              animation: `float ${6 + (i % 4)}s ease-in-out infinite`,
              animationDelay: `${i * 0.5}s`,
            }}
          >
            <Snowflake 
              size={16 + (i % 4) * 6} 
              className="text-sky-300/30" 
              strokeWidth={1}
            />
          </div>
        ))}
      </div>

      {/* Subtle grid pattern */}
      <div 
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(rgba(0,0,0,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.1) 1px, transparent 1px)`,
          backgroundSize: '64px 64px'
        }}
      />

      <div className="relative max-w-5xl mx-auto">
        <FadeIn>
          <div className="text-center">
            {/* Headline */}
            <h2 className="text-4xl md:text-6xl lg:text-7xl font-bold text-slate-900 mb-8 tracking-tight font-display leading-[1.1]">
              Ready to{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-500 via-blue-500 to-cyan-500">
                earn?
              </span>
            </h2>

            <p className="text-xl md:text-2xl text-slate-600 font-ui mb-12 max-w-2xl mx-auto">
              Connect your wallet. Browse the orderbook. 
              Start earning from weather uncertainty.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-16 font-ui">
              <Link 
                href="/lp"
                className="group relative w-full sm:w-auto px-12 py-5 rounded-full bg-gradient-to-r from-sky-500 to-blue-500 text-white text-lg font-semibold overflow-hidden transition-all hover:shadow-[0_0_60px_rgba(14,165,233,0.4)] hover:scale-105"
              >
                <span className="relative z-10 flex items-center justify-center gap-3">
                  Start Earning
                  <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                </span>
              </Link>
              
              <Link
                href="https://github.com/prmx-io/prmx-blockchain"
                target="_blank"
                className="group w-full sm:w-auto px-10 py-5 rounded-full border border-slate-300 text-slate-700 text-lg font-semibold hover:border-slate-400 hover:bg-slate-50 transition-all flex items-center justify-center gap-3"
              >
                <Code size={20} />
                View Docs
              </Link>
            </div>

            {/* Feature highlights */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto">
              {[
                { icon: BarChart3, label: 'Markets', value: marketCount !== null ? marketCount.toString() : '...' },
                { icon: TrendingUp, label: 'Max Return', value: '~20%+' },
                { icon: Snowflake, label: 'Currency', value: 'USDT' },
                { icon: Code, label: 'API', value: 'Open' },
              ].map((item, i) => (
                <div 
                  key={i} 
                  className="p-4 rounded-2xl bg-white border border-sky-200 text-center shadow-sm"
                >
                  <item.icon size={24} className="mx-auto mb-3 text-sky-600" />
                  <p className="text-xl font-bold text-slate-900 font-display mb-1">
                    {item.value}
                  </p>
                  <p className="text-xs text-slate-500 font-ui">{item.label}</p>
                </div>
              ))}
            </div>

            {/* Trust line */}
            <FadeIn delay={200}>
              <p className="mt-12 text-sm text-slate-500 font-ui">
                Open source • On-chain transparent • Built for professionals
              </p>
            </FadeIn>
          </div>
        </FadeIn>
      </div>

      {/* Bottom gradient */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

      {/* CSS for floating animation */}
      <style jsx>{`
        @keyframes float {
          0%, 100% { transform: translateY(0) rotate(0deg); opacity: 0.2; }
          50% { transform: translateY(-20px) rotate(5deg); opacity: 0.4; }
        }
      `}</style>
    </section>
  )
}
