'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, TrendingUp, Wallet, BarChart3, Snowflake } from 'lucide-react'
import { FadeIn } from '@/components/ui/FadeIn'
import * as api from '@/lib/api'
import { formatUSDT } from '@/lib/utils'

export function LPHero() {
  const [stats, setStats] = useState({
    marketCount: 0,
    orderCount: 0,
    totalValue: BigInt(0),
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      try {
        const [markets, orders] = await Promise.all([
          api.getMarkets(),
          api.getLpOrders(),
        ])
        
        const totalValue = orders.reduce(
          (sum, o) => sum + o.remaining * o.priceUsdt,
          BigInt(0)
        )
        
        setStats({
          marketCount: markets.length,
          orderCount: orders.length,
          totalValue,
        })
      } catch (error) {
        console.error('Failed to fetch LP stats:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
  }, [])

  return (
    <section className="relative min-h-screen flex items-center overflow-hidden bg-gradient-to-b from-slate-50 via-sky-50 to-white">
      {/* Animated gradient orbs - soft icy blue theme */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] rounded-full bg-sky-200/40 blur-[150px] animate-pulse" />
        <div className="absolute bottom-1/4 right-1/3 w-[500px] h-[500px] rounded-full bg-blue-200/30 blur-[150px]" />
        <div className="absolute top-1/2 right-1/4 w-[400px] h-[400px] rounded-full bg-cyan-100/40 blur-[120px]" />
        <div className="absolute top-0 left-1/2 w-[300px] h-[300px] rounded-full bg-white/60 blur-[100px]" />
      </div>

      {/* Snowflake falling animation */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(30)].map((_, i) => {
          const size = 10 + (i % 5) * 5;
          const left = (i * 3.5) % 100;
          const delay = (i * 0.6) % 15;
          const duration = 10 + (i % 6) * 2;
          const opacity = 0.3 + (i % 4) * 0.15;
          
          return (
            <div
              key={i}
              className="absolute snowflake"
              style={{
                left: `${left}%`,
                top: '-5%',
                animationDelay: `${delay}s`,
                animationDuration: `${duration}s`,
                opacity,
              }}
            >
              <Snowflake 
                size={size} 
                className="text-sky-400" 
                strokeWidth={1}
              />
            </div>
          );
        })}
      </div>

      {/* Grid pattern overlay */}
      <div 
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(0,0,0,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.1) 1px, transparent 1px)`,
          backgroundSize: '64px 64px'
        }}
      />

      {/* Main content */}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-6 py-32 md:py-40">
        <div className="max-w-4xl">
          <FadeIn>
            <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-sky-500/10 border border-sky-400/30 backdrop-blur-sm mb-8">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-500 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500" />
              </span>
              <span className="text-sm font-medium text-sky-600 font-ui">
                Liquidity Providers
              </span>
              <span className="text-xs text-slate-400">•</span>
              <span className="text-sm text-slate-500 font-ui">
                Earn from weather uncertainty
              </span>
            </div>
          </FadeIn>

          <FadeIn delay={100}>
            <h1 className="text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-bold tracking-tight text-slate-900 leading-[1.05] font-display mb-8">
              Become the
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-500 via-blue-500 to-cyan-500">
                House.
              </span>
            </h1>
          </FadeIn>

          <FadeIn delay={200}>
            <p className="text-xl md:text-2xl text-slate-600 max-w-2xl leading-relaxed font-ui mb-10">
              Provide liquidity to parametric weather policies. 
              <span className="text-sky-600 font-medium"> Earn premiums when skies are clear. </span>
              Fully automated. Fully transparent.
            </p>
          </FadeIn>

          <FadeIn delay={300}>
            <div className="flex flex-col sm:flex-row items-start gap-4 font-ui">
              <Link 
                href="/lp"
                className="group relative px-8 py-4 rounded-full bg-gradient-to-r from-sky-500 to-blue-500 text-white font-semibold text-lg overflow-hidden transition-all hover:scale-105 hover:shadow-[0_0_40px_rgba(14,165,233,0.4)]"
              >
                <span className="relative z-10 flex items-center gap-2">
                  Start Earning
                  <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                </span>
              </Link>
              <a 
                href="#mechanics"
                className="group px-8 py-4 rounded-full border border-sky-300 text-sky-600 font-semibold text-lg hover:border-sky-400 hover:bg-sky-50 transition-all"
              >
                <span className="flex items-center gap-2">
                  Learn How It Works
                  <TrendingUp size={20} className="group-hover:translate-y-[-2px] transition-transform" />
                </span>
              </a>
            </div>
          </FadeIn>

          {/* Live Stats */}
          <FadeIn delay={400}>
            <div className="flex flex-wrap items-center gap-6 md:gap-10 mt-16 pt-8 border-t border-sky-200">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-sky-100 border border-sky-200">
                  <BarChart3 size={24} className="text-sky-600" />
                </div>
                <div>
                  <p className="text-2xl md:text-3xl font-bold text-slate-900 font-display">
                    {loading ? '...' : stats.marketCount}
                  </p>
                  <p className="text-sm text-slate-500 font-ui">Active Markets</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-cyan-100 border border-cyan-200">
                  <TrendingUp size={24} className="text-cyan-600" />
                </div>
                <div>
                  <p className="text-2xl md:text-3xl font-bold text-slate-900 font-display">
                    {loading ? '...' : stats.orderCount}
                  </p>
                  <p className="text-sm text-slate-500 font-ui">Open Orders</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-100 border border-blue-200">
                  <Wallet size={24} className="text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl md:text-3xl font-bold text-slate-900 font-display">
                    {loading ? '...' : formatUSDT(stats.totalValue)}
                  </p>
                  <p className="text-sm text-slate-500 font-ui">Order Volume</p>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </div>

      {/* Bottom gradient fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-slate-100 to-transparent pointer-events-none" />

      {/* CSS for snowflake falling animation */}
      <style jsx>{`
        @keyframes snowfall {
          0% {
            transform: translateY(-10vh) translateX(0) rotate(0deg);
          }
          25% {
            transform: translateY(25vh) translateX(15px) rotate(90deg);
          }
          50% {
            transform: translateY(50vh) translateX(-10px) rotate(180deg);
          }
          75% {
            transform: translateY(75vh) translateX(20px) rotate(270deg);
          }
          100% {
            transform: translateY(110vh) translateX(-5px) rotate(360deg);
          }
        }
        .snowflake {
          animation: snowfall 10s linear infinite;
        }
      `}</style>
    </section>
  )
}
