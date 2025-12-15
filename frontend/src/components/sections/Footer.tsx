import Image from 'next/image'
import { Twitter, Linkedin, Github, Mail } from 'lucide-react'

const footerLinks = {
  product: [
    { label: 'How it Works', href: '#how-it-works' },
    { label: 'Coverage', href: '#coverage' },
    { label: 'Pricing', href: '#' },
    { label: 'FAQ', href: '#faq' },
  ],
  company: [
    { label: 'About', href: '#' },
    { label: 'Blog', href: '#' },
    { label: 'Careers', href: '#' },
    { label: 'Press', href: '#' },
  ],
  legal: [
    { label: 'Privacy Policy', href: '#' },
    { label: 'Terms of Service', href: '#' },
    { label: 'Cookie Policy', href: '#' },
  ],
}

const socialLinks = [
  { icon: Twitter, href: '#', label: 'Twitter' },
  { icon: Linkedin, href: '#', label: 'LinkedIn' },
  { icon: Github, href: '#', label: 'GitHub' },
  { icon: Mail, href: 'mailto:hello@prmx.ph', label: 'Email' },
]

export function Footer() {
  return (
    <footer className="bg-[#0a0a0a] border-t border-zinc-800/50 pt-20 pb-10 px-6">
      <div className="max-w-7xl mx-auto">
        {/* Main footer content */}
        <div className="grid grid-cols-2 md:grid-cols-12 gap-10 md:gap-8 mb-16">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-4">
            <a href="#" className="inline-flex items-center mb-6 group">
              <Image 
                src="/logo.png" 
                alt="PRMX" 
                width={120} 
                height={36} 
                className="h-9 w-auto object-contain"
              />
            </a>
            <p className="text-zinc-500 text-sm leading-relaxed mb-6 max-w-xs font-ui">
              Parametric weather insurance, globally. 
              Transparent, instant, and built on smart contracts.
            </p>
            {/* Social links */}
            <div className="flex items-center gap-3">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  aria-label={social.label}
                  className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 hover:text-white hover:border-zinc-700 transition-all"
                >
                  <social.icon size={18} />
                </a>
              ))}
            </div>
          </div>

          {/* Product links */}
          <div className="col-span-1 md:col-span-2">
            <h4 className="text-white font-semibold mb-4 font-display">Product</h4>
            <ul className="space-y-3 font-ui">
              {footerLinks.product.map((link) => (
                <li key={link.label}>
                  <a 
                    href={link.href}
                    className="text-sm text-zinc-500 hover:text-white transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Company links */}
          <div className="col-span-1 md:col-span-2">
            <h4 className="text-white font-semibold mb-4 font-display">Company</h4>
            <ul className="space-y-3 font-ui">
              {footerLinks.company.map((link) => (
                <li key={link.label}>
                  <a 
                    href={link.href}
                    className="text-sm text-zinc-500 hover:text-white transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal links */}
          <div className="col-span-1 md:col-span-2">
            <h4 className="text-white font-semibold mb-4 font-display">Legal</h4>
            <ul className="space-y-3 font-ui">
              {footerLinks.legal.map((link) => (
                <li key={link.label}>
                  <a 
                    href={link.href}
                    className="text-sm text-zinc-500 hover:text-white transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Status */}
          <div className="col-span-1 md:col-span-2">
            <h4 className="text-white font-semibold mb-4 font-display">Status</h4>
            <div className="space-y-4 font-ui">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span className="text-sm text-zinc-400">All systems operational</span>
              </div>
              <a 
                href="#" 
                className="text-sm text-zinc-500 hover:text-white transition-colors"
              >
                View status page →
              </a>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-zinc-800/50">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-zinc-600 text-sm font-ui">
              © {new Date().getFullYear()} PRMX. All rights reserved.
            </p>
            <div className="flex items-center gap-6 text-sm text-zinc-600 font-ui">
              <span>Made with ☔️ for the world</span>
              <span className="hidden md:inline">•</span>
              <span className="hidden md:inline">Backed by real weather data</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}

