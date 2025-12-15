'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Menu, X, ArrowRight } from 'lucide-react'

export function Navbar() {
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
          ? 'bg-zinc-950/80 backdrop-blur-2xl border-b border-zinc-800/50'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <Image 
            src="/logo_white.png" 
            alt="PRMX" 
            width={120} 
            height={36} 
            className="h-9 w-auto object-contain"
          />
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center">
          {/* Nav Links - Pill Container */}
          <div className="flex items-center gap-1 px-2 py-1.5 rounded-full bg-zinc-900/50 border border-zinc-800/50 backdrop-blur-sm mr-6">
            {[
              { label: 'How it works', href: '#how-it-works' },
              { label: 'Coverage', href: '#coverage' },
              { label: 'FAQ', href: '#faq' },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800/50 rounded-full transition-all font-ui"
              >
                {link.label}
              </a>
            ))}
            <Link
              href="/provide-liquidity"
              className="px-4 py-2 text-sm text-sky-400 hover:text-white hover:bg-sky-400/10 rounded-full transition-all font-ui font-medium"
            >
              For LPs
            </Link>
          </div>

          {/* CTA Button */}
          <Link 
            href="/dashboard"
            className="group relative px-6 py-2.5 rounded-full bg-white text-zinc-900 text-sm font-semibold overflow-hidden transition-all hover:shadow-[0_0_30px_rgba(255,255,255,0.3)] font-ui"
          >
            <span className="relative z-10 flex items-center gap-2">
              Launch App
              <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
            </span>
          </Link>
        </div>

        {/* Mobile Toggle */}
        <button
          className="md:hidden relative w-10 h-10 flex items-center justify-center rounded-full bg-zinc-900/50 border border-zinc-800 text-white"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle menu"
        >
          <Menu size={20} className={`absolute transition-all ${mobileMenuOpen ? 'opacity-0 rotate-90' : 'opacity-100 rotate-0'}`} />
          <X size={20} className={`absolute transition-all ${mobileMenuOpen ? 'opacity-100 rotate-0' : 'opacity-0 -rotate-90'}`} />
        </button>
      </div>

      {/* Mobile Menu */}
      <div
        className={`absolute top-20 left-4 right-4 bg-zinc-900/95 backdrop-blur-2xl border border-zinc-800 rounded-2xl p-6 flex flex-col gap-2 md:hidden font-ui shadow-2xl transition-all duration-300 ${
          mobileMenuOpen
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 -translate-y-4 pointer-events-none'
        }`}
      >
        {[
          { label: 'How it works', href: '#how-it-works' },
          { label: 'Coverage', href: '#coverage' },
          { label: 'FAQ', href: '#faq' },
        ].map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="px-4 py-3 text-zinc-300 hover:text-white hover:bg-zinc-800/50 rounded-xl transition-all"
            onClick={() => setMobileMenuOpen(false)}
          >
            {link.label}
          </a>
        ))}
        <Link
          href="/provide-liquidity"
          className="px-4 py-3 text-sky-400 hover:text-white hover:bg-sky-400/10 rounded-xl transition-all font-medium"
          onClick={() => setMobileMenuOpen(false)}
        >
          For LPs
        </Link>
        <div className="h-px bg-zinc-800 my-2" />
        <Link 
          href="/dashboard"
          className="w-full py-3 rounded-xl bg-white text-zinc-900 font-semibold flex items-center justify-center gap-2"
          onClick={() => setMobileMenuOpen(false)}
        >
          Launch App
          <ArrowRight size={16} />
        </Link>
      </div>
    </nav>
  )
}

