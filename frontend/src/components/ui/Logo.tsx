'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useThemeStore } from '@/stores/themeStore';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
}

export function Logo({ size = 'md', showText = false, className }: LogoProps) {
  const { theme } = useThemeStore();
  
  const sizeConfig = {
    sm: { width: 100, height: 30, heightClass: 'h-7' },
    md: { width: 140, height: 42, heightClass: 'h-10' },
    lg: { width: 180, height: 54, heightClass: 'h-14' },
    xl: { width: 220, height: 66, heightClass: 'h-16' },
  };

  const logoSrc = theme === 'light' ? '/logo_black.png' : '/logo_white.png';

  return (
    <div className={cn('flex items-center', className)}>
      <Image 
        src={logoSrc}
        alt="PRMX" 
        width={sizeConfig[size].width}
        height={sizeConfig[size].height}
        className={cn(sizeConfig[size].heightClass, 'w-auto object-contain')}
        priority
      />
    </div>
  );
}

// Animated version for loading states
export function LogoAnimated({ size = 'lg', className }: Omit<LogoProps, 'showText'>) {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-14 h-14',
    xl: 'w-20 h-20',
  };

  return (
    <div className={cn('relative animate-pulse-slow', sizeClasses[size], className)}>
      <svg
        viewBox="0 0 100 100"
        className="w-full h-full animate-spin"
        style={{ animationDuration: '8s' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="gradAnim" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00E5FF">
              <animate
                attributeName="stop-color"
                values="#00E5FF;#2196F3;#9C27B0;#E040FB;#00E5FF"
                dur="4s"
                repeatCount="indefinite"
              />
            </stop>
            <stop offset="100%" stopColor="#E040FB">
              <animate
                attributeName="stop-color"
                values="#E040FB;#00E5FF;#2196F3;#9C27B0;#E040FB"
                dur="4s"
                repeatCount="indefinite"
              />
            </stop>
          </linearGradient>
        </defs>

        {/* Outer hexagon */}
        <path
          d="M50 5 L93 27.5 L93 72.5 L50 95 L7 72.5 L7 27.5 Z"
          fill="none"
          stroke="url(#gradAnim)"
          strokeWidth="3"
        />
        
        {/* Inner hexagon */}
        <path
          d="M50 25 L75 38.5 L75 61.5 L50 75 L25 61.5 L25 38.5 Z"
          fill="url(#gradAnim)"
          opacity="0.3"
        />
      </svg>
    </div>
  );
}
