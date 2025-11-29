import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SafeAreaWrapperProps {
  children: ReactNode;
  className?: string;
  top?: boolean;
  bottom?: boolean;
  left?: boolean;
  right?: boolean;
}

/**
 * Wrapper component that applies safe area insets selectively
 * Use this for pages/sections that need safe area padding
 * Prevents global safe area padding from breaking modals, sheets, etc.
 */
export function SafeAreaWrapper({
  children,
  className,
  top = true,
  bottom = true,
  left = true,
  right = true,
}: SafeAreaWrapperProps) {
  return (
    <div
      className={cn(
        top && 'pt-[env(safe-area-inset-top)]',
        bottom && 'pb-[env(safe-area-inset-bottom)]',
        left && 'pl-[env(safe-area-inset-left)]',
        right && 'pr-[env(safe-area-inset-right)]',
        className
      )}
    >
      {children}
    </div>
  );
}
