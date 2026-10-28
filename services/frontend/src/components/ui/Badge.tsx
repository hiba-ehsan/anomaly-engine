'use client';

import { HTMLAttributes, forwardRef } from 'react';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
}

const variants = {
  default: 'bg-gray-700 text-gray-200',
  success: 'bg-green-900/30 text-green-400 border border-green-800',
  warning: 'bg-yellow-900/30 text-yellow-400 border border-yellow-800',
  danger: 'bg-red-900/30 text-red-400 border border-red-800',
  info: 'bg-blue-900/30 text-blue-400 border border-blue-800',
};

const sizes = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className = '', variant = 'default', size = 'md', children, ...props }, ref) => (
    <span
      ref={ref}
      className={`
        inline-flex items-center font-medium rounded-full border
        ${variants[variant]} ${sizes[size]} ${className}
      `}
      {...props}
    >
      {children}
    </span>
  )
);

Badge.displayName = 'Badge';