'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Menu, X, ArrowRight } from 'lucide-react'

export function LPNavbar() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <nav
      className={`fixed top-0 w-full z-50 transition-all duration-500 ${
        scrolled
          ? 'bg-white/80 backdrop-blur-2xl border-b border-slate-200/50 shadow-sm'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <Image 
            src="/logo_black.png" 
            alt="PRMX" 
            width={120} 
            height={36} 
            className="h-9 w-auto object-contain"
          />
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center">
          {/* Nav Links - Pill Container */}
          <div className="flex items-center gap-1 px-2 py-1.5 rounded-full bg-slate-100/80 border border-slate-200/50 backdrop-blur-sm mr-6">
            <Link
              href="/"
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 hover:bg-white rounded-full transition-all font-ui"
            >
              Home
            </Link>
            <a
              href="#mechanics"
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 hover:bg-white rounded-full transition-all font-ui"
            >
              How it works
            </a>
            <a
              href="#lp-faq"
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 hover:bg-white rounded-full transition-all font-ui"
            >
              FAQ
            </a>
          </div>

          {/* CTA Button */}
          <Link 
            href="/lp"
            className="group relative px-6 py-2.5 rounded-full bg-gradient-to-r from-sky-500 to-blue-500 text-white text-sm font-semibold overflow-hidden transition-all hover:shadow-[0_0_30px_rgba(14,165,233,0.4)] font-ui"
          >
            <span className="relative z-10 flex items-center gap-2">
              Start Earning
              <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
            </span>
          </Link>
        </div>

        {/* Mobile Toggle */}
        <button
          className="md:hidden relative w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 border border-slate-200 text-slate-700"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle menu"
        >
          <Menu size={20} className={`absolute transition-all ${mobileMenuOpen ? 'opacity-0 rotate-90' : 'opacity-100 rotate-0'}`} />
          <X size={20} className={`absolute transition-all ${mobileMenuOpen ? 'opacity-100 rotate-0' : 'opacity-0 -rotate-90'}`} />
        </button>
      </div>

      {/* Mobile Menu */}
      <div
        className={`absolute top-20 left-4 right-4 bg-white/95 backdrop-blur-2xl border border-slate-200 rounded-2xl p-6 flex flex-col gap-2 md:hidden font-ui shadow-2xl transition-all duration-300 ${
          mobileMenuOpen
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 -translate-y-4 pointer-events-none'
        }`}
      >
        <Link
          href="/"
          className="px-4 py-3 text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-all"
          onClick={() => setMobileMenuOpen(false)}
        >
          Home
        </Link>
        <a
          href="#mechanics"
          className="px-4 py-3 text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-all"
          onClick={() => setMobileMenuOpen(false)}
        >
          How it works
        </a>
        <a
          href="#lp-faq"
          className="px-4 py-3 text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-all"
          onClick={() => setMobileMenuOpen(false)}
        >
          FAQ
        </a>
        <div className="h-px bg-slate-200 my-2" />
        <Link 
          href="/lp"
          className="w-full py-3 rounded-xl bg-gradient-to-r from-sky-500 to-blue-500 text-white font-semibold flex items-center justify-center gap-2"
          onClick={() => setMobileMenuOpen(false)}
        >
          Start Earning
          <ArrowRight size={16} />
        </Link>
      </div>
    </nav>
  )
}
