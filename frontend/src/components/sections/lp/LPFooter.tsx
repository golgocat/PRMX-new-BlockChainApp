import Image from 'next/image'
import Link from 'next/link'
import { Twitter, Linkedin, Github, Mail } from 'lucide-react'

const footerLinks = {
  product: [
    { label: 'Home', href: '/' },
    { label: 'How it Works', href: '#mechanics' },
    { label: 'Dashboard', href: '/lp' },
    { label: 'FAQ', href: '#lp-faq' },
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
  { icon: Mail, href: 'mailto:lp@prmx.io', label: 'Email' },
]

export function LPFooter() {
  return (
    <footer className="bg-slate-50 border-t border-slate-200 pt-20 pb-10 px-6">
      <div className="max-w-7xl mx-auto">
        {/* Main footer content */}
        <div className="grid grid-cols-2 md:grid-cols-12 gap-10 md:gap-8 mb-16">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-4">
            <Link href="/" className="inline-flex items-center mb-6 group">
              <Image 
                src="/logo_black.png" 
                alt="PRMX" 
                width={120} 
                height={36} 
                className="h-9 w-auto object-contain"
              />
            </Link>
            <p className="text-slate-500 text-sm leading-relaxed mb-6 max-w-xs font-ui">
              Provide liquidity to parametric weather policies. 
              Earn premiums. Fully automated and transparent.
            </p>
            {/* Social links */}
            <div className="flex items-center gap-3">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  aria-label={social.label}
                  className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:border-slate-300 transition-all shadow-sm"
                >
                  <social.icon size={18} />
                </a>
              ))}
            </div>
          </div>

          {/* Product links */}
          <div className="col-span-1 md:col-span-2">
            <h4 className="text-slate-900 font-semibold mb-4 font-display">Product</h4>
            <ul className="space-y-3 font-ui">
              {footerLinks.product.map((link) => (
                <li key={link.label}>
                  <a 
                    href={link.href}
                    className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Company links */}
          <div className="col-span-1 md:col-span-2">
            <h4 className="text-slate-900 font-semibold mb-4 font-display">Company</h4>
            <ul className="space-y-3 font-ui">
              {footerLinks.company.map((link) => (
                <li key={link.label}>
                  <a 
                    href={link.href}
                    className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal links */}
          <div className="col-span-1 md:col-span-2">
            <h4 className="text-slate-900 font-semibold mb-4 font-display">Legal</h4>
            <ul className="space-y-3 font-ui">
              {footerLinks.legal.map((link) => (
                <li key={link.label}>
                  <a 
                    href={link.href}
                    className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Status */}
          <div className="col-span-1 md:col-span-2">
            <h4 className="text-slate-900 font-semibold mb-4 font-display">Status</h4>
            <div className="space-y-4 font-ui">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span className="text-sm text-slate-600">All systems operational</span>
              </div>
              <a 
                href="#" 
                className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
              >
                View status page →
              </a>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-slate-200">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-slate-500 text-sm font-ui">
              © {new Date().getFullYear()} PRMX. All rights reserved.
            </p>
            <div className="flex items-center gap-6 text-sm text-slate-500 font-ui">
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
