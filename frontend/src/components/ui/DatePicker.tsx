'use client';

import { useState, useRef, useEffect } from 'react';
import { DayPicker } from 'react-day-picker';
import { format, startOfDay } from 'date-fns';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DatePickerProps {
  label?: string;
  value?: Date;
  onChange: (date: Date | undefined) => void;
  minDate?: Date;
  maxDate?: Date;
  hint?: string;
  disabled?: boolean;
  placeholder?: string;
}

export function DatePicker({
  label,
  value,
  onChange,
  minDate,
  maxDate,
  hint,
  disabled = false,
  placeholder = 'Select a date',
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  const handleSelect = (date: Date | undefined) => {
    onChange(date);
    setIsOpen(false);
  };

  return (
    <div className="space-y-1.5" ref={containerRef}>
      {label && (
        <label className="block text-sm font-medium text-text-secondary">
          {label}
        </label>
      )}
      
      <div className="relative">
        {/* Input Button */}
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={cn(
            'w-full flex items-center justify-between gap-2 px-4 py-2.5',
            'rounded-lg border text-left transition-all',
            'bg-background-secondary border-border-secondary',
            'hover:border-prmx-cyan/50 focus:outline-none focus:ring-2 focus:ring-prmx-cyan/30',
            disabled && 'opacity-50 cursor-not-allowed',
            isOpen && 'border-prmx-cyan ring-2 ring-prmx-cyan/30'
          )}
        >
          <span className={cn(
            'text-sm',
            value ? 'text-text-primary' : 'text-text-tertiary'
          )}>
            {value ? format(value, 'MMMM d, yyyy') : placeholder}
          </span>
          <Calendar className="w-4 h-4 text-text-tertiary" />
        </button>

        {/* Calendar Dropdown */}
        {isOpen && (
          <div className={cn(
            'absolute z-50 mt-2 p-4',
            'rounded-xl border shadow-lg',
            'bg-background-secondary border-border-secondary'
          )}>
            <DayPicker
              mode="single"
              selected={value}
              onSelect={handleSelect}
              disabled={[
                { before: minDate || new Date() },
                ...(maxDate ? [{ after: maxDate }] : []),
              ]}
              defaultMonth={value || minDate || new Date()}
              showOutsideDays={false}
              className="prmx-rdp"
              components={{
                IconLeft: () => <ChevronLeft className="h-4 w-4" />,
                IconRight: () => <ChevronRight className="h-4 w-4" />,
              }}
            />
            
            {/* Quick select button */}
            <div className="mt-3 pt-3 border-t border-border-secondary">
              <button
                type="button"
                onClick={() => {
                  const today = startOfDay(new Date());
                  const effectiveMin = minDate ? startOfDay(minDate) : today;
                  if (today >= effectiveMin) {
                    handleSelect(today);
                  } else {
                    handleSelect(effectiveMin);
                  }
                }}
                className={cn(
                  'w-full px-3 py-1.5 text-sm rounded-lg',
                  'text-prmx-cyan hover:bg-prmx-cyan/10',
                  'transition-colors'
                )}
              >
                {minDate && startOfDay(new Date()) < startOfDay(minDate) 
                  ? `Earliest available: ${format(minDate, 'MMM d')}`
                  : 'Today'
                }
              </button>
            </div>
          </div>
        )}
      </div>

      {hint && (
        <p className="text-xs text-text-tertiary">{hint}</p>
      )}
    </div>
  );
}
