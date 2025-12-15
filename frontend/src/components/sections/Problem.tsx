import { FadeIn } from '@/components/ui/FadeIn'

export function Problem() {
  return (
    <section className="relative bg-[#0a0a0a] py-32 md:py-40 px-6 overflow-hidden">
      {/* Animated grain texture overlay */}
      <div className="absolute inset-0 opacity-[0.015] pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PC9maWx0ZXI+PHJlY3Qgd2lkdGg9IjMwMCIgaGVpZ2h0PSIzMDAiIGZpbHRlcj0idXJsKCNhKSIgb3BhY2l0eT0iMSIvPjwvc3ZnPg==')]" />

      <div className="relative max-w-6xl mx-auto">
        {/* Editorial header */}
        <FadeIn>
          <div className="mb-20 md:mb-28">
            <p className="text-zinc-500 text-sm tracking-[0.3em] uppercase mb-6 font-ui">
              Why this matters
            </p>
            <h2 className="text-4xl md:text-6xl lg:text-7xl font-bold text-white leading-[1.1] font-display max-w-4xl">
              Traditional insurance
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-zinc-400 to-zinc-600">
                wasn't built for this.
              </span>
            </h2>
          </div>
        </FadeIn>

        {/* Bento grid layout */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-5 font-ui">
          {/* Card 1 - Large */}
          <FadeIn delay={100} className="md:col-span-7">
            <div className="group relative h-full min-h-[320px] md:min-h-[380px] rounded-[2rem] bg-gradient-to-br from-zinc-900 to-zinc-950 p-8 md:p-10 overflow-hidden border border-zinc-800/50 hover:border-zinc-700/50 transition-colors duration-500">
              {/* Animated gradient orb */}
              <div className="absolute -top-32 -right-32 w-64 h-64 rounded-full bg-gradient-to-br from-rose-500/20 to-orange-500/20 blur-3xl group-hover:scale-150 transition-transform duration-700" />
              
              {/* Large decorative text */}
              <span className="absolute -bottom-8 -right-4 text-[12rem] md:text-[16rem] font-bold text-zinc-900 font-display select-none leading-none pointer-events-none">
                01
              </span>

              <div className="relative z-10 h-full flex flex-col">
                <div className="flex items-center gap-3 mb-6">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                  <span className="text-rose-400 text-xs font-medium tracking-wider uppercase">
                    Critical
                  </span>
                </div>

                <h3 className="text-3xl md:text-4xl font-bold text-white mb-4 font-display">
                  Disruption
                </h3>
                
                <p className="text-zinc-400 text-lg leading-relaxed max-w-md">
                  Flooding stops business. Supply chains break. Income halts. 
                  <span className="text-zinc-500"> Every hour of delay costs you money.</span>
                </p>

                <div className="mt-auto pt-8">
                  <div className="flex items-center gap-4 text-sm">
                    <div className="px-3 py-1.5 rounded-full bg-zinc-800/80 text-zinc-400">
                      $500K avg. loss per event
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>

          {/* Card 2 - Stacked right */}
          <FadeIn delay={200} className="md:col-span-5">
            <div className="group relative h-full min-h-[320px] md:min-h-[380px] rounded-[2rem] bg-zinc-900 p-8 md:p-10 overflow-hidden border border-zinc-800/50 hover:border-zinc-700/50 transition-colors duration-500">
              {/* Gradient accent line */}
              <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
              
              <div className="relative z-10 h-full flex flex-col">
                <span className="text-7xl md:text-8xl font-bold text-zinc-800 font-display mb-4">
                  02
                </span>

                <h3 className="text-2xl md:text-3xl font-bold text-white mb-3 font-display">
                  Delays
                </h3>
                
                <p className="text-zinc-400 leading-relaxed">
                  Traditional claims take months. Forms, adjusters, disputes. 
                  You're left waiting when you need help most.
                </p>

                {/* Visual element - timeline */}
                <div className="mt-auto pt-8">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full bg-zinc-800 overflow-hidden">
                      <div className="w-1/4 h-full bg-gradient-to-r from-amber-500 to-amber-600 rounded-full" />
                    </div>
                    <span className="text-xs text-zinc-500 font-medium">90+ days typical</span>
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>

          {/* Card 3 - Full width bottom */}
          <FadeIn delay={300} className="md:col-span-12">
            <div className="group relative rounded-[2rem] bg-gradient-to-r from-zinc-900 via-zinc-900 to-zinc-950 p-8 md:p-10 overflow-hidden border border-zinc-800/50 hover:border-zinc-700/50 transition-colors duration-500">
              <div className="flex flex-col md:flex-row md:items-center gap-8">
                <div className="flex-1">
                  <div className="flex items-center gap-6 mb-4">
                    <span className="text-5xl md:text-6xl font-bold text-zinc-800 font-display">
                      03
                    </span>
                    <h3 className="text-2xl md:text-3xl font-bold text-white font-display">
                      Uncertainty
                    </h3>
                  </div>
                  
                  <p className="text-zinc-400 leading-relaxed max-w-xl">
                    Will you get paid? How much? The fine print is unclear. 
                    Traditional policies are designed to minimize payouts, not help you recover.
                  </p>
                </div>

                {/* Visual element - question marks */}
                <div className="flex items-center gap-3 md:pr-8">
                  {[...Array(3)].map((_, i) => (
                    <div 
                      key={i}
                      className="w-12 h-12 md:w-16 md:h-16 rounded-2xl bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center"
                      style={{ opacity: 1 - i * 0.3 }}
                    >
                      <span className="text-2xl md:text-3xl text-zinc-600">?</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </FadeIn>
        </div>

        {/* Bottom statement */}
        <FadeIn delay={400}>
          <div className="mt-16 md:mt-20 text-center">
            <p className="text-zinc-500 text-lg font-ui">
              There's a better way.{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-violet to-brand-teal font-medium">
                Parametric insurance.
              </span>
            </p>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}

