'use client'

import { FadeIn } from '@/components/ui/FadeIn'
import { Calendar, Droplets, Zap, ArrowRight } from 'lucide-react'

const steps = [
  {
    step: '01',
    title: 'Pick Your Date',
    desc: 'Select the date you need protection. Each policy covers a 24-hour window — simple and straightforward.',
    icon: Calendar,
    color: 'brand-violet',
  },
  {
    step: '02',
    title: 'Select Your Location',
    desc: 'Choose your coverage area. Each location has a predefined rainfall threshold based on historical weather patterns.',
    icon: Droplets,
    color: 'brand-teal',
  },
  {
    step: '03',
    title: 'Get Paid Automatically',
    desc: 'When our weather oracle detects rainfall above the predefined threshold, smart contracts trigger instant payment to your account.',
    icon: Zap,
    color: 'brand-magenta',
  },
]

function StepVisual({ step }: { step: string }) {
  if (step === '01') {
    return (
      <div className="inline-flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-800/50 border border-zinc-700/50">
        <div className="flex flex-col items-center px-3 py-2 rounded-lg bg-brand-violet/20 border border-brand-violet/30">
          <span className="text-xs text-brand-violet/70 uppercase">Dec</span>
          <span className="text-2xl font-bold text-brand-violet">15</span>
        </div>
        <div className="text-left">
          <p className="text-sm text-white font-medium">Sunday, 2025</p>
          <p className="text-xs text-zinc-500">24-hour coverage</p>
        </div>
      </div>
    )
  }
  
  if (step === '02') {
    return (
      <div className="space-y-2">
        {[
          { city: 'São Paulo', threshold: '50mm', selected: true },
          { city: 'Mumbai', threshold: '75mm', selected: false },
          { city: 'Lagos', threshold: '60mm', selected: false },
        ].map((location) => (
          <div
            key={location.city}
            className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
              location.selected
                ? 'bg-brand-teal/20 border border-brand-teal/30'
                : 'bg-zinc-800/50 border border-zinc-700/50'
            }`}
          >
            <span className={location.selected ? 'text-brand-teal font-medium' : 'text-zinc-500'}>
              {location.city}
            </span>
            <span className={`text-xs ${location.selected ? 'text-brand-teal/70' : 'text-zinc-600'}`}>
              {location.threshold}/24h
            </span>
          </div>
        ))}
      </div>
    )
  }
  
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-emerald-400 text-sm font-medium">Triggered</span>
      </div>
      <ArrowRight size={16} className="text-zinc-600" />
      <div className="px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
        <span className="text-white text-sm font-bold">$10,000</span>
      </div>
    </div>
  )
}

export function HowItWorks() {
  return (
    <section id="how-it-works" className="relative bg-[#050505] py-32 md:py-40 px-6 overflow-hidden">
      {/* Background grid */}
      <div 
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.3) 1px, transparent 0)`,
          backgroundSize: '48px 48px'
        }}
      />

      <div className="relative max-w-6xl mx-auto">
        {/* Header */}
        <FadeIn>
          <div className="text-center mb-20 md:mb-28">
            <p className="text-zinc-500 text-sm tracking-[0.3em] uppercase mb-6 font-ui">
              How it works
            </p>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-[1.1] font-display mb-6">
              Simple by design.
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-zinc-400 to-zinc-600">
                Powerful by default.
              </span>
            </h2>
            <p className="text-xl text-zinc-500 font-ui max-w-xl mx-auto">
              Complex actuarial math in the background. Three steps for you.
            </p>
          </div>
        </FadeIn>

        {/* Steps */}
        <div className="relative">
          {/* Connecting line */}
          <div className="absolute left-8 md:left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-zinc-800 via-zinc-700 to-zinc-800 hidden md:block" />

          <div className="space-y-8 md:space-y-0">
            {steps.map((item, i) => (
              <FadeIn key={i} delay={i * 150}>
                <div className={`relative md:grid md:grid-cols-2 md:gap-16 ${i !== 0 ? 'md:mt-24' : ''}`}>
                  {/* Step number - center line */}
                  <div className="hidden md:flex absolute left-1/2 top-0 -translate-x-1/2 z-20">
                    <div className={`w-16 h-16 rounded-2xl bg-${item.color}/20 border border-${item.color}/30 flex items-center justify-center backdrop-blur-sm`}
                      style={{
                        backgroundColor: item.color === 'brand-violet' ? 'rgba(138, 74, 243, 0.2)' : 
                                        item.color === 'brand-teal' ? 'rgba(0, 196, 140, 0.2)' : 
                                        'rgba(236, 72, 153, 0.2)',
                        borderColor: item.color === 'brand-violet' ? 'rgba(138, 74, 243, 0.3)' : 
                                    item.color === 'brand-teal' ? 'rgba(0, 196, 140, 0.3)' : 
                                    'rgba(236, 72, 153, 0.3)',
                      }}
                    >
                      <span className="text-xl font-bold text-white font-display">{item.step}</span>
                    </div>
                  </div>

                  {/* Content - alternating sides */}
                  <div className={`${i % 2 === 0 ? 'md:pr-24 md:text-right' : 'md:col-start-2 md:pl-24'}`}>
                    <div className={`relative p-8 rounded-[2rem] bg-zinc-900/50 border border-zinc-800/50 backdrop-blur-sm ${i % 2 === 0 ? 'md:mr-8' : 'md:ml-8'}`}>
                      {/* Mobile step number */}
                      <div className="flex md:hidden items-center gap-4 mb-6">
                        <div 
                          className="w-12 h-12 rounded-xl flex items-center justify-center"
                          style={{
                            backgroundColor: item.color === 'brand-violet' ? 'rgba(138, 74, 243, 0.2)' : 
                                            item.color === 'brand-teal' ? 'rgba(0, 196, 140, 0.2)' : 
                                            'rgba(236, 72, 153, 0.2)',
                          }}
                        >
                          <item.icon 
                            size={24} 
                            style={{
                              color: item.color === 'brand-violet' ? '#8A4AF3' : 
                                    item.color === 'brand-teal' ? '#00C48C' : 
                                    '#EC4899',
                            }}
                          />
                        </div>
                        <span className="text-sm text-zinc-500 font-ui">Step {item.step}</span>
                      </div>

                      {/* Desktop icon */}
                      <div className={`hidden md:flex items-center gap-4 mb-6 ${i % 2 === 0 ? 'justify-end' : ''}`}>
                        <div 
                          className="w-12 h-12 rounded-xl flex items-center justify-center"
                          style={{
                            backgroundColor: item.color === 'brand-violet' ? 'rgba(138, 74, 243, 0.2)' : 
                                            item.color === 'brand-teal' ? 'rgba(0, 196, 140, 0.2)' : 
                                            'rgba(236, 72, 153, 0.2)',
                          }}
                        >
                          <item.icon 
                            size={24} 
                            style={{
                              color: item.color === 'brand-violet' ? '#8A4AF3' : 
                                    item.color === 'brand-teal' ? '#00C48C' : 
                                    '#EC4899',
                            }}
                          />
                        </div>
                      </div>

                      <h3 className={`text-2xl md:text-3xl font-bold text-white mb-4 font-display ${i % 2 === 0 ? 'md:text-right' : ''}`}>
                        {item.title}
                      </h3>
                      <p className={`text-zinc-400 leading-relaxed font-ui mb-6 ${i % 2 === 0 ? 'md:text-right' : ''}`}>
                        {item.desc}
                      </p>

                      {/* Visual element */}
                      <div className={`${i % 2 === 0 ? 'md:flex md:justify-end' : ''}`}>
                        <StepVisual step={item.step} />
                      </div>
                    </div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

