'use client';

import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
}

/**
 * Base skeleton element with shimmer animation
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-lg bg-background-tertiary/50',
        className
      )}
    />
  );
}

/**
 * Skeleton for card content
 */
export function SkeletonCard({ className }: SkeletonProps) {
  return (
    <div className={cn('rounded-xl border border-border-secondary p-4 space-y-4', className)}>
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  );
}

/**
 * Skeleton for market card
 */
export function SkeletonMarketCard({ className }: SkeletonProps) {
  return (
    <div className={cn('rounded-xl border border-border-secondary p-4 space-y-3', className)}>
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-3 w-28" />
        </div>
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-8 rounded-lg" />
        <Skeleton className="h-8 rounded-lg" />
      </div>
    </div>
  );
}

/**
 * Skeleton for policy card
 */
export function SkeletonPolicyCard({ className }: SkeletonProps) {
  return (
    <div className={cn('rounded-xl border border-border-secondary p-4 space-y-3', className)}>
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="space-y-1">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <Skeleton className="h-10 w-full rounded-lg" />
    </div>
  );
}

/**
 * Skeleton for stats card
 */
export function SkeletonStatsCard({ className }: SkeletonProps) {
  return (
    <div className={cn('rounded-xl border border-border-secondary p-4 space-y-2', className)}>
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

/**
 * Skeleton for table row
 */
export function SkeletonTableRow({ columns = 4, className }: SkeletonProps & { columns?: number }) {
  return (
    <div className={cn('flex items-center gap-4 p-4', className)}>
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton 
          key={i} 
          className={cn(
            'h-4',
            i === 0 ? 'w-24' : i === columns - 1 ? 'w-16' : 'w-20'
          )} 
        />
      ))}
    </div>
  );
}

/**
 * Skeleton for full table
 */
export function SkeletonTable({ rows = 5, columns = 4, className }: SkeletonProps & { rows?: number; columns?: number }) {
  return (
    <div className={cn('rounded-xl border border-border-secondary overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-center gap-4 p-4 bg-background-tertiary/30 border-b border-border-secondary">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton 
            key={i} 
            className={cn(
              'h-3',
              i === 0 ? 'w-20' : i === columns - 1 ? 'w-14' : 'w-16'
            )} 
          />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div 
          key={i} 
          className={cn(
            'flex items-center gap-4 p-4',
            i < rows - 1 && 'border-b border-border-secondary'
          )}
        >
          {Array.from({ length: columns }).map((_, j) => (
            <Skeleton 
              key={j} 
              className={cn(
                'h-4',
                j === 0 ? 'w-24' : j === columns - 1 ? 'w-16' : 'w-20'
              )} 
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton for text lines
 */
export function SkeletonText({ lines = 3, className }: SkeletonProps & { lines?: number }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton 
          key={i} 
          className={cn(
            'h-4',
            i === lines - 1 ? 'w-2/3' : 'w-full'
          )} 
        />
      ))}
    </div>
  );
}

/**
 * Skeleton for monitor card (Oracle V2)
 */
export function SkeletonMonitorCard({ className }: SkeletonProps) {
  return (
    <div className={cn('rounded-xl border border-border-secondary p-4 space-y-4', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <div className="space-y-1">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <div className="space-y-2">
        <div className="flex justify-between">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
        <Skeleton className="h-3 w-full rounded-full" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="space-y-1">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="space-y-1">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
    </div>
  );
}

