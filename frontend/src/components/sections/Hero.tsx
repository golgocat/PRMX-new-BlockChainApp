import Link from 'next/link'
import { ArrowRight, Droplets, Shield, Zap } from 'lucide-react'
import { FadeIn } from '@/components/ui/FadeIn'
import { RainEffect } from '@/components/ui/RainEffect'

export function Hero() {
  return (
    <section className="relative min-h-screen flex items-center overflow-hidden bg-[#030303]">
      {/* Background Video with dark overlay */}
      <div className="absolute inset-0">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover opacity-40"
        >
          <source src="/hero-video.mp4" type="video/mp4" />
        </video>
        
        {/* Gradient overlays */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#030303] via-transparent to-[#030303]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#030303] via-transparent to-transparent" />
      </div>

      {/* Rain animation effect */}
      <RainEffect />

      {/* Animated gradient orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] rounded-full bg-brand-violet/20 blur-[150px] animate-pulse" />
        <div className="absolute bottom-1/4 right-1/3 w-[500px] h-[500px] rounded-full bg-brand-teal/15 blur-[150px]" />
        <div className="absolute top-1/2 right-1/4 w-[400px] h-[400px] rounded-full bg-brand-magenta/10 blur-[120px]" />
      </div>

      {/* Grid pattern overlay */}
      <div 
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '64px 64px'
        }}
      />

      {/* Main content */}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-6 py-32 md:py-40">
        <div className="max-w-3xl">
          {/* Main content */}
          <div>
            <FadeIn>
              <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm mb-8">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span className="text-sm font-medium text-zinc-300 font-ui">
                  Now Live
                </span>
                <span className="text-xs text-zinc-500">•</span>
                <span className="text-sm text-zinc-400 font-ui">
                  12 markets worldwide
                </span>
              </div>
            </FadeIn>

            <FadeIn delay={100}>
              <h1 className="text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-bold tracking-tight text-white leading-[1.05] font-display mb-8">
                Rain falls.
                <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-violet via-brand-magenta to-brand-teal">
                  You get paid.
                </span>
              </h1>
            </FadeIn>

            <FadeIn delay={200}>
              <p className="text-xl md:text-2xl text-zinc-400 max-w-xl leading-relaxed font-ui mb-10">
                Parametric weather insurance, globally. 
                <span className="text-zinc-300"> No claims. No adjusters. No waiting.</span>
              </p>
            </FadeIn>

            <FadeIn delay={300}>
              <div className="flex flex-col sm:flex-row items-start gap-4 font-ui">
                <Link 
                  href="/dashboard"
                  className="group relative px-8 py-4 rounded-full bg-white text-zinc-900 font-semibold text-lg overflow-hidden transition-all hover:scale-105 hover:shadow-[0_0_40px_rgba(255,255,255,0.3)]"
                >
                  <span className="relative z-10 flex items-center gap-2">
                    Launch App
                    <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                  </span>
                </Link>
              </div>
            </FadeIn>

            {/* Trust indicators */}
            <FadeIn delay={400}>
              <div className="flex flex-wrap items-center gap-8 mt-16 pt-8 border-t border-zinc-800">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-brand-violet/20">
                    <Shield size={20} className="text-brand-violet" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-white font-display">$10M+</p>
                    <p className="text-sm text-zinc-500 font-ui">Coverage deployed</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-brand-teal/20">
                    <Zap size={20} className="text-brand-teal" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-white font-display">Instant</p>
                    <p className="text-sm text-zinc-500 font-ui">Payout speed</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-brand-magenta/20">
                    <Droplets size={20} className="text-brand-magenta" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-white font-display">100%</p>
                    <p className="text-sm text-zinc-500 font-ui">Claims paid</p>
                  </div>
                </div>
              </div>
            </FadeIn>
          </div>

        </div>
      </div>

      {/* Bottom gradient fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#0a0a0a] to-transparent pointer-events-none" />

      {/* Scroll indicator */}
      <FadeIn delay={600}>
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
          <span className="text-xs text-zinc-500 font-ui uppercase tracking-wider">Scroll</span>
          <div className="w-5 h-8 rounded-full border border-zinc-700 flex items-start justify-center p-1">
            <div className="w-1 h-2 rounded-full bg-zinc-500 animate-bounce" />
          </div>
        </div>
      </FadeIn>
    </section>
  )
}

