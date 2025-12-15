import Link from 'next/link'
import { ArrowRight, Sparkles } from 'lucide-react'
import { FadeIn } from '@/components/ui/FadeIn'

export function FinalCTA() {
  return (
    <section className="relative py-32 md:py-40 px-6 bg-[#030303] overflow-hidden">
      {/* Aurora background effect */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {/* Primary aurora */}
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
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm mb-10">
              <Sparkles size={16} className="text-brand-violet" />
              <span className="text-sm text-zinc-300 font-ui">
                Join 40+ businesses already protected
              </span>
            </div>

            {/* Headline */}
            <h2 className="text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-8 tracking-tight font-display leading-[1.1]">
              Coverage that moves
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-violet via-brand-magenta to-brand-teal">
                at the speed of weather.
              </span>
            </h2>

            <p className="text-xl md:text-2xl text-zinc-400 font-ui mb-12 max-w-2xl mx-auto">
              Stop waiting months for claims. Get protected in minutes, 
              paid in hours.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-16 font-ui">
              <Link 
                href="/dashboard"
                className="group relative w-full sm:w-auto px-10 py-5 rounded-full bg-white text-zinc-900 text-lg font-semibold overflow-hidden transition-all hover:shadow-[0_0_60px_rgba(255,255,255,0.3)] hover:scale-105"
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  Launch App
                  <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                </span>
              </Link>
              
              <div className="relative w-full sm:w-auto">
                <input
                  type="email"
                  placeholder="Enter your email"
                  className="w-full sm:w-80 px-6 py-5 bg-zinc-900/50 border border-zinc-700 text-white rounded-full focus:outline-none focus:border-zinc-500 transition-colors placeholder:text-zinc-500 pr-28"
                />
                <button className="absolute right-2 top-2 bottom-2 bg-zinc-800 hover:bg-zinc-700 text-white px-5 rounded-full text-sm font-medium transition-colors border border-zinc-700">
                  Subscribe
                </button>
              </div>
            </div>

            {/* Trust badges */}
            <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12">
              {[
                { value: '$10M+', label: 'Coverage Deployed' },
                { value: 'Instant', label: 'Payout Time' },
                { value: '100%', label: 'Claims Paid' },
                { value: '4.9★', label: 'Customer Rating' },
              ].map((stat, i) => (
                <div key={i} className="text-center">
                  <p className="text-2xl md:text-3xl font-bold text-white font-display mb-1">
                    {stat.value}
                  </p>
                  <p className="text-sm text-zinc-500 font-ui">{stat.label}</p>
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

