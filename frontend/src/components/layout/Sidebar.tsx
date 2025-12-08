'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Globe2, 
  Shield, 
  Wallet, 
  Cloud,
  Settings,
  HelpCircle,
  FileText
} from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { cn } from '@/lib/utils';
import { useUserRole, UserRole } from '@/stores/walletStore';

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: UserRole[]; // If undefined, show for all roles
};

const mainNavItems: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/markets', label: 'Markets', icon: Globe2, roles: ['dao', 'customer'] },
  { href: '/policies', label: 'My Policies', icon: Shield, roles: ['dao', 'customer'] },
  { href: '/lp', label: 'LP Trading', icon: Wallet, roles: ['dao', 'lp'] },
  { href: '/oracle', label: 'Oracle Data', icon: Cloud },
];

const secondaryNavItems: NavItem[] = [
  { href: '/docs', label: 'Documentation', icon: FileText },
  { href: '/help', label: 'Help & Support', icon: HelpCircle },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const userRole = useUserRole();

  const filteredMainNav = mainNavItems.filter(item => 
    !item.roles || item.roles.includes(userRole)
  );

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 bg-background-secondary border-r border-border-secondary">
      <div className="flex h-full flex-col">
        {/* Logo Section */}
        <div className="flex items-center gap-2 px-6 py-5 border-b border-border-secondary">
          <Logo size="md" />
        </div>

        {/* Main Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
          <div className="mb-2 px-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              Main Menu
            </span>
          </div>
          
          {filteredMainNav.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
            const Icon = item.icon;
            
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  isActive ? 'nav-link-active' : 'nav-link'
                )}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}

          <div className="my-4 border-t border-border-secondary" />

          <div className="mb-2 px-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              Support
            </span>
          </div>

          {secondaryNavItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  isActive ? 'nav-link-active' : 'nav-link'
                )}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer - Show different CTAs based on role */}
        <div className="border-t border-border-secondary p-4">
          {userRole === 'customer' && (
            <div className="glass-card p-4 bg-gradient-to-br from-prmx-cyan/10 to-prmx-purple/10">
              <h4 className="font-semibold text-sm mb-1">Need Coverage?</h4>
              <p className="text-xs text-text-secondary mb-3">
                Protect your assets with parametric rainfall insurance
              </p>
              <Link
                href="/policies/new"
                className="btn-primary w-full text-center text-sm py-2"
              >
                Get Quote
              </Link>
            </div>
          )}
          {userRole === 'lp' && (
            <div className="glass-card p-4 bg-gradient-to-br from-prmx-purple/10 to-prmx-magenta/10">
              <h4 className="font-semibold text-sm mb-1">LP Opportunities</h4>
              <p className="text-xs text-text-secondary mb-3">
                Trade LP tokens and earn yields
              </p>
              <Link
                href="/lp"
                className="btn-primary w-full text-center text-sm py-2"
              >
                View Orders
              </Link>
            </div>
          )}
          {userRole === 'dao' && (
            <div className="glass-card p-4 bg-gradient-to-br from-prmx-blue/10 to-prmx-cyan/10">
              <h4 className="font-semibold text-sm mb-1">DAO Admin</h4>
              <p className="text-xs text-text-secondary mb-3">
                Manage markets and settle policies
              </p>
              <Link
                href="/markets"
                className="btn-primary w-full text-center text-sm py-2"
              >
                Manage Markets
              </Link>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
