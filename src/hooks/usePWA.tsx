import { useContext } from 'react';
import { PWAContext } from '@/components/pwa/PWAProvider';

export const usePWA = () => {
  const context = useContext(PWAContext);
  
  if (!context) {
    throw new Error('usePWA must be used within PWAProvider');
  }
  
  return context;
};
