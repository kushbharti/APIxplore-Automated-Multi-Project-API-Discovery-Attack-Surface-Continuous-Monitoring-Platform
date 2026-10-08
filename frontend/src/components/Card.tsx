import React from 'react';
import { cn } from '../utils/cn';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const Card = ({ children, className, ...props }: CardProps) => {
  return (
    <div
      className={cn(
        "rounded-xl glass-panel text-[var(--text-primary)] p-6 transition-all duration-300",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};
