'use client';

import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface TableProps {
  children: ReactNode;
  className?: string;
}

export function Table({ children, className }: TableProps) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full">{children}</table>
    </div>
  );
}

interface TableHeadProps {
  children: ReactNode;
  className?: string;
}

export function TableHead({ children, className }: TableHeadProps) {
  return (
    <thead className={cn('border-b border-border-secondary', className)}>
      {children}
    </thead>
  );
}

interface TableBodyProps {
  children: ReactNode;
  className?: string;
}

export function TableBody({ children, className }: TableBodyProps) {
  return <tbody className={className}>{children}</tbody>;
}

interface TableRowProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  clickable?: boolean;
}

export function TableRow({ children, className, onClick, clickable = false }: TableRowProps) {
  return (
    <tr
      className={cn(
        'table-row',
        clickable && 'cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

interface TableHeaderCellProps {
  children: ReactNode;
  className?: string;
  align?: 'left' | 'center' | 'right';
}

export function TableHeaderCell({ children, className, align = 'left' }: TableHeaderCellProps) {
  return (
    <th
      className={cn(
        'table-header',
        align === 'center' && 'text-center',
        align === 'right' && 'text-right',
        className
      )}
    >
      {children}
    </th>
  );
}

interface TableCellProps {
  children: ReactNode;
  className?: string;
  align?: 'left' | 'center' | 'right';
}

export function TableCell({ children, className, align = 'left' }: TableCellProps) {
  return (
    <td
      className={cn(
        'table-cell',
        align === 'center' && 'text-center',
        align === 'right' && 'text-right',
        className
      )}
    >
      {children}
    </td>
  );
}

// Empty state component for tables
interface TableEmptyProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function TableEmpty({ icon, title, description, action }: TableEmptyProps) {
  return (
    <tr>
      <td colSpan={100} className="py-16 text-center">
        {icon && (
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-background-tertiary flex items-center justify-center text-text-tertiary">
            {icon}
          </div>
        )}
        <h3 className="text-lg font-semibold mb-1">{title}</h3>
        {description && (
          <p className="text-text-secondary mb-4 max-w-md mx-auto">{description}</p>
        )}
        {action}
      </td>
    </tr>
  );
}
