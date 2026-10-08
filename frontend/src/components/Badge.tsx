import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'success' | 'warning' | 'error' | 'primary';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variants = {
    default: 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-color)]',
    success: 'bg-[var(--success-transparent)] text-[var(--success)] border border-[var(--success-transparent)] shadow-[0_0_10px_var(--success-transparent)]',
    warning: 'bg-[var(--warning-transparent)] text-[var(--warning)] border border-[var(--warning-transparent)] shadow-[0_0_10px_var(--warning-transparent)]',
    error: 'bg-[var(--error-transparent)] text-[var(--error)] border border-[var(--error-transparent)] shadow-[0_0_10px_var(--error-transparent)]',
    primary: 'bg-[var(--primary-transparent)] text-[var(--primary)] border border-[var(--primary-transparent)] shadow-[0_0_10px_var(--primary-transparent)]',
  };

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider transition-all',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
