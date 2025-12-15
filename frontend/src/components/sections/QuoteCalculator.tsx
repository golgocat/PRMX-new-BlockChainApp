'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Droplets, ArrowRight, Shield, Zap, Wallet, MapPin, RefreshCw } from 'lucide-react'
import { FadeIn } from '@/components/ui/FadeIn'
import * as api from '@/lib/api'
import type { Market } from '@/types'

const benefits = [
  { icon: Shield, text: 'No paperwork or claims process' },
  { icon: Zap, text: 'Instant payout when triggered' },
  { icon: Wallet, text: 'Pay & receive in USDT' },
]

export function QuoteCalculator() {
  const router = useRouter()
  const [coverage, setCoverage] = useState(100000)
  const [markets, setMarkets] = useState<Market[]>([])
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null)
  const [loading, setLoading] = useState(true)

  // Fetch markets from the API
  useEffect(() => {
    async function fetchMarkets() {
      try {
        const data = await api.getMarkets()
        // Filter to only show Open markets
        const openMarkets = data.filter(m => m.status === 'Open')
        setMarkets(openMarkets)
        if (openMarkets.length > 0) {
          setSelectedMarket(openMarkets[0])
        }
      } catch (error) {
        console.error('Failed to fetch markets:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchMarkets()
  }, [])

  // Calculate premium as 1% of coverage
  const premium = Math.floor(coverage * 0.01)
  const coveragePercent = ((coverage - 10000) / (500000 - 10000)) * 100

  const handleGetQuote = () => {
    // Redirect to policies/new page with selected market
    const params = new URLSearchParams()
    if (selectedMarket) {
      params.set('marketId', selectedMarket.id.toString())
    }
    params.set('coverage', coverage.toString())
    router.push(`/policies/new?${params.toString()}`)
  }

  return (
    <section id="coverage" className="relative bg-[#0a0a0a] py-32 md:py-40 px-6 overflow-hidden">
      {/* Background elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 right-1/4 w-[600px] h-[600px] rounded-full bg-brand-violet/10 blur-[150px]" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[400px] rounded-full bg-brand-teal/10 blur-[120px]" />
      </div>

      <div className="relative max-w-6xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-16 lg:gap-20 items-center">
          {/* Left content */}
          <FadeIn>
            <div>
              <p className="text-brand-violet text-sm tracking-[0.3em] uppercase mb-6 font-ui">
                Quote Calculator
              </p>
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-[1.1] font-display mb-6">
                Estimate your{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-violet to-brand-teal">
                  protection.
                </span>
              </h2>
              <p className="text-xl text-zinc-400 font-ui mb-10 max-w-lg">
                Select your location and coverage amount to get an instant quote. 
                Smart contracts handle the rest.
              </p>

              {/* Benefits */}
              <div className="space-y-4 font-ui">
                {benefits.map((benefit, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-4 p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800/50"
                  >
                    <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-brand-teal/20">
                      <benefit.icon size={20} className="text-brand-teal" />
                    </div>
                    <span className="text-zinc-300">{benefit.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>

          {/* Calculator card */}
          <FadeIn delay={200}>
            <div className="relative">
              {/* Glow effect */}
              <div className="absolute -inset-4 bg-gradient-to-r from-brand-violet/20 to-brand-teal/20 rounded-[3rem] blur-2xl opacity-50" />
              
              <div className="relative bg-zinc-900 border border-zinc-800 rounded-[2rem] p-8 md:p-10 font-ui">
                {/* Header */}
                <div className="flex items-center justify-between mb-10">
                  <div>
                    <p className="text-sm text-zinc-500 mb-1">Policy Quote</p>
                    <p className="text-lg font-semibold text-white">Customize Your Coverage</p>
                  </div>
                  <div className="px-4 py-2 rounded-full bg-gradient-to-r from-brand-violet/20 to-brand-teal/20 border border-brand-violet/30">
                    <span className="text-sm font-medium text-transparent bg-clip-text bg-gradient-to-r from-brand-violet to-brand-teal">
                      Instant Quote
                    </span>
                  </div>
                </div>

                {/* Input 1: Coverage */}
                <div className="mb-8">
                  <div className="flex justify-between mb-4">
                    <label className="text-sm font-medium text-zinc-400">
                      Coverage Amount
                    </label>
                    <span className="text-white font-mono font-bold text-lg">
                      ${coverage.toLocaleString()}
                    </span>
                  </div>
                  <div className="relative h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div 
                      className="absolute h-full bg-gradient-to-r from-brand-violet to-brand-violet/70 rounded-full transition-all"
                      style={{ width: `${coveragePercent}%` }}
                    />
                  </div>
                  <input
                    type="range"
                    min="10000"
                    max="500000"
                    step="5000"
                    value={coverage}
                    onChange={(e) => setCoverage(parseInt(e.target.value))}
                    className="absolute w-full h-2 opacity-0 cursor-pointer"
                    style={{ marginTop: '-8px' }}
                  />
                  <div className="flex justify-between text-xs text-zinc-600 mt-3">
                    <span>$10,000</span>
                    <span>$500,000</span>
                  </div>
                </div>

                {/* Input 2: Location - Markets from API */}
                <div className="mb-8">
                  <div className="flex justify-between mb-4">
                    <label className="text-sm font-medium text-zinc-400">
                      Select Market
                    </label>
                    <span className="text-white font-mono font-bold text-lg flex items-center gap-2">
                      <MapPin size={16} className="text-brand-teal" />
                      {selectedMarket?.name || 'Select...'}
                    </span>
                  </div>
                  
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <RefreshCw className="w-6 h-6 animate-spin text-zinc-500" />
                    </div>
                  ) : markets.length === 0 ? (
                    <div className="p-4 rounded-xl bg-zinc-800/30 border border-zinc-700/50 text-center">
                      <p className="text-zinc-500 text-sm">No markets available</p>
                      <p className="text-zinc-600 text-xs mt-1">Connect to blockchain to see live markets</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                      {markets.map((market) => (
                        <button
                          key={market.id}
                          onClick={() => setSelectedMarket(market)}
                          className={`p-3 rounded-xl text-left transition-all ${
                            selectedMarket?.id === market.id
                              ? 'bg-brand-teal/20 border border-brand-teal/30'
                              : 'bg-zinc-800/50 border border-zinc-700/50 hover:border-zinc-600'
                          }`}
                        >
                          <p className={`text-sm font-medium ${
                            selectedMarket?.id === market.id ? 'text-brand-teal' : 'text-white'
                          }`}>
                            {market.name}
                          </p>
                          <p className="text-xs text-zinc-500">Strike: {market.strikeValue}mm</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Threshold Info */}
                {selectedMarket && (
                  <div className="mb-10 p-4 rounded-xl bg-zinc-800/30 border border-zinc-700/50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Droplets size={18} className="text-brand-teal" />
                        <span className="text-sm text-zinc-400">Rainfall Threshold</span>
                      </div>
                      <span className="text-white font-mono font-bold">
                        {selectedMarket.strikeValue}mm / 24h
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 mt-2">
                      Payout triggers when 24-hour rainfall exceeds this threshold in {selectedMarket.name}
                    </p>
                  </div>
                )}

                {/* Result */}
                <div className="bg-zinc-800/50 rounded-2xl p-6 border border-zinc-700/50 mb-6">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2">
                        Estimated Premium
                      </p>
                      <p className="text-4xl font-bold text-white font-display">
                        ${premium.toLocaleString()}
                      </p>
                      <p className="text-xs text-zinc-500 mt-1">1% of coverage</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2">
                        Max Payout
                      </p>
                      <p className="text-2xl font-bold text-brand-teal font-display">
                        ${coverage.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={handleGetQuote}
                  disabled={!selectedMarket}
                  className="group w-full py-4 rounded-xl bg-white text-zinc-900 font-semibold text-lg flex items-center justify-center gap-2 hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Get Your Quote
                  <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                </button>
                
                <p className="text-center text-xs text-zinc-600 mt-4">
                  *Estimate only. Final quote calculated on-chain based on market parameters.
                </p>
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  )
}
