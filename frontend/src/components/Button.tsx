import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', ...props }, ref) => {
    const variants = {
      primary: 'bg-gradient-to-r from-[var(--primary)] to-indigo-500 text-white shadow-[0_0_15px_var(--primary-transparent)] hover:shadow-[0_0_25px_var(--primary-transparent)] hover:opacity-90',
      secondary: 'glass-panel text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]',
      danger: 'bg-gradient-to-r from-[var(--error)] to-red-500 text-white shadow-[0_0_15px_var(--error-transparent)] hover:shadow-[0_0_25px_var(--error-transparent)] hover:opacity-90',
      ghost: 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]',
    };

    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-300 disabled:opacity-50 disabled:pointer-events-none active:scale-95 cursor-pointer',
          variants[variant],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
