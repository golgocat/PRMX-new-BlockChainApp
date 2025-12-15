'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Shield, Zap, Code, Globe } from 'lucide-react'
import { FadeIn } from '@/components/ui/FadeIn'
import * as api from '@/lib/api'

export function FinalCTA() {
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
    <section className="relative py-32 md:py-40 px-6 bg-[#030303] overflow-hidden">
      {/* Aurora background effect */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full bg-brand-violet/30 blur-[150px] animate-pulse" />
        <div className="absolute top-1/4 right-1/4 w-[500px] h-[500px] rounded-full bg-brand-teal/20 blur-[150px]" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-brand-magenta/20 blur-[150px]" />
        
        {/* Grid overlay */}
        <div 
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
            backgroundSize: '64px 64px'
          }}
        />
      </div>

      <div className="relative max-w-5xl mx-auto">
        <FadeIn>
          <div className="text-center">
            {/* Headline */}
            <h2 className="text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-8 tracking-tight font-display leading-[1.1]">
              Ready to get
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-violet via-brand-magenta to-brand-teal">
                protected?
              </span>
            </h2>

            <p className="text-xl md:text-2xl text-zinc-400 font-ui mb-12 max-w-2xl mx-auto">
              Connect your wallet and get coverage in minutes. 
              No paperwork, no waiting, no middlemen.
            </p>

            {/* CTA Button */}
            <div className="flex justify-center mb-16 font-ui">
              <Link 
                href="/dashboard"
                className="group relative px-12 py-5 rounded-full bg-white text-zinc-900 text-lg font-semibold overflow-hidden transition-all hover:shadow-[0_0_60px_rgba(255,255,255,0.3)] hover:scale-105"
              >
                <span className="relative z-10 flex items-center justify-center gap-3">
                  Launch App
                  <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                </span>
              </Link>
            </div>

            {/* Feature highlights */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto">
              {[
                { icon: Globe, label: 'Live Markets', value: marketCount !== null ? marketCount.toString() : '...' },
                { icon: Zap, label: 'Payout Speed', value: 'Instant' },
                { icon: Code, label: 'Smart Contracts', value: 'Verified' },
                { icon: Shield, label: 'On-chain', value: 'Transparent' },
              ].map((item, i) => (
                <div 
                  key={i} 
                  className="p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800/50 text-center"
                >
                  <item.icon size={24} className="mx-auto mb-3 text-brand-teal" />
                  <p className="text-xl font-bold text-white font-display mb-1">
                    {item.value}
                  </p>
                  <p className="text-xs text-zinc-500 font-ui">{item.label}</p>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>
      </div>

      {/* Bottom gradient fade to footer */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#0a0a0a] to-transparent pointer-events-none" />
    </section>
  )
}
