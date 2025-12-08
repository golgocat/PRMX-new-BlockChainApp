'use client';

import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple' | 'cyan';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
  dot?: boolean;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-background-tertiary text-text-secondary',
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
  info: 'badge-info',
  purple: 'badge-purple',
  cyan: 'badge-cyan',
};

export function Badge({ children, variant = 'default', className, dot = false }: BadgeProps) {
  return (
    <span className={cn('badge', variantClasses[variant], className)}>
      {dot && (
        <span className={cn('w-1.5 h-1.5 rounded-full mr-1.5', {
          'bg-success': variant === 'success',
          'bg-warning': variant === 'warning',
          'bg-error': variant === 'error',
          'bg-info': variant === 'info',
          'bg-prmx-purple': variant === 'purple',
          'bg-prmx-cyan': variant === 'cyan',
          'bg-text-tertiary': variant === 'default',
        })} />
      )}
      {children}
    </span>
  );
}

interface StatusBadgeProps {
  status: string | Record<string, unknown>;
  className?: string;
}

/**
 * Normalize status from chain enum format to string
 * Chain returns: { Active: null } or { Open: null }
 * We need: "Active" or "Open"
 */
function normalizeStatus(status: string | Record<string, unknown>): string {
  if (typeof status === 'string') {
    return status;
  }
  
  if (typeof status === 'object' && status !== null) {
    // Handle chain enum format like { Active: null }
    const keys = Object.keys(status);
    if (keys.length > 0) {
      return keys[0];
    }
  }
  
  return 'Unknown';
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const normalizedStatus = normalizeStatus(status);
  
  const getVariant = (status: string): BadgeVariant => {
    switch (status.toLowerCase()) {
      case 'active':
      case 'open':
        return 'success';
      case 'expired':
      case 'closed':
        return 'warning';
      case 'settled':
        return 'info';
      case 'cancelled':
        return 'error';
      case 'pending':
        return 'purple';
      default:
        return 'default';
    }
  };

  return (
    <Badge variant={getVariant(normalizedStatus)} dot className={className}>
      {normalizedStatus}
    </Badge>
  );
}
