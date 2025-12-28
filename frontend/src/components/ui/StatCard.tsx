'use client';

import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { ReactNode } from 'react';

interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  iconColor?: string;
  className?: string;
}

export function StatCard({
  title,
  value,
  change,
  changeLabel,
  icon,
  trend = 'neutral',
  iconColor,
  className,
}: StatCardProps) {
  const trendColors = {
    up: 'text-success',
    down: 'text-error',
    neutral: 'text-text-secondary',
  };

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;

  return (
    <div className={cn('stat-card', className)}>
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs text-text-tertiary">{title}</span>
        {icon && (
          <div
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center',
              iconColor || 'bg-prmx-cyan/10 text-prmx-cyan'
            )}
          >
            {icon}
          </div>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-xl font-bold">{value}</p>
        {(change !== undefined || changeLabel) && (
          <div className="flex items-center gap-1">
            <TrendIcon className={cn('w-3 h-3', trendColors[trend])} />
            <span className={cn('text-xs font-medium', trendColors[trend])}>
              {change !== undefined && `${change > 0 ? '+' : ''}${change}%`}
            </span>
            {changeLabel && (
              <span className="text-xs text-text-tertiary">{changeLabel}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface MiniStatProps {
  label: string;
  value: string | number;
  className?: string;
}

export function MiniStat({ label, value, className }: MiniStatProps) {
  return (
    <div className={cn('text-center', className)}>
      <p className="text-xs text-text-tertiary mb-1">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}
