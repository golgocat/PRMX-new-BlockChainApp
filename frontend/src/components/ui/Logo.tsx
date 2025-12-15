'use client';

import { cn } from '@/lib/utils';
import { useThemeStore } from '@/stores/themeStore';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
}

export function Logo({ size = 'md', showText = true, className }: LogoProps) {
  const { theme } = useThemeStore();
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-14 h-14',
    xl: 'w-20 h-20',
  };

  const textSizeClasses = {
    sm: 'text-lg',
    md: 'text-xl',
    lg: 'text-2xl',
    xl: 'text-4xl',
  };

  return (
    <div className={cn('flex items-center gap-3', className)}>
      {/* Hexagonal Logo Icon */}
      <div className={cn('relative', sizeClasses[size])}>
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* Gradient definitions matching the brand */}
            <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#00E5FF" />
              <stop offset="50%" stopColor="#2196F3" />
              <stop offset="100%" stopColor="#9C27B0" />
            </linearGradient>
            <linearGradient id="grad2" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#E040FB" />
              <stop offset="50%" stopColor="#9C27B0" />
              <stop offset="100%" stopColor="#2196F3" />
            </linearGradient>
            <linearGradient id="grad3" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#00E5FF" />
              <stop offset="50%" stopColor="#5EFEEC" />
              <stop offset="100%" stopColor="#2196F3" />
            </linearGradient>
            <linearGradient id="grad4" x1="50%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%" stopColor="#BA68C8" />
              <stop offset="100%" stopColor="#E040FB" />
            </linearGradient>
          </defs>

          {/* Outer hexagon shape - left panel */}
          <path
            d="M15 35 L50 15 L50 50 L15 35 Z"
            fill="url(#grad1)"
            opacity="0.9"
          />
          {/* Top right panel */}
          <path
            d="M50 15 L85 35 L50 50 L50 15 Z"
            fill="url(#grad4)"
            opacity="0.9"
          />
          {/* Bottom right panel */}
          <path
            d="M85 35 L85 65 L50 85 L50 50 L85 35 Z"
            fill="url(#grad2)"
            opacity="0.9"
          />
          {/* Bottom left panel */}
          <path
            d="M15 65 L50 85 L50 50 L15 35 L15 65 Z"
            fill="url(#grad3)"
            opacity="0.9"
          />
          
          {/* Inner hexagon cutout (theme-aware) */}
          <path
            d="M35 42 L50 33 L65 42 L65 58 L50 67 L35 58 Z"
            fill={theme === 'light' ? '#f1f8ff' : '#0A0E17'}
          />
        </svg>
      </div>

      {/* Brand Text */}
      {showText && (
        <span className={cn('font-bold tracking-tight', textSizeClasses[size])}>
          PRMX
        </span>
      )}
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
