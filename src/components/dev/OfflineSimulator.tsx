import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { WifiOff, Wifi, Gauge, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
export const OfflineSimulator = () => {
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [networkSpeed, setNetworkSpeed] = useState<'fast' | 'slow'>('fast');

  // Load persisted state
  useEffect(() => {
    const saved = localStorage.getItem('offline-simulator-state');
    if (saved) {
      try {
        const state = JSON.parse(saved);
        setIsSimulating(state.isSimulating);
        setSimulatedOffline(state.simulatedOffline);
        setNetworkSpeed(state.networkSpeed);
      } catch (e) {
        console.error('Failed to load simulator state:', e);
      }
    }
  }, []);

  // Save state
  useEffect(() => {
    localStorage.setItem('offline-simulator-state', JSON.stringify({
      isSimulating,
      simulatedOffline,
      networkSpeed
    }));
  }, [isSimulating, simulatedOffline, networkSpeed]);

  // Keyboard shortcut: Ctrl+Shift+O
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'O') {
        e.preventDefault();
        setIsSimulating(prev => !prev);
        toast.info(isSimulating ? 'Simulator Disabled' : 'Simulator Enabled');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSimulating]);

  // H10: Hooks must run unconditionally on every render — production gate
  // lives AFTER all hook calls so React sees a stable hook order.
  if (!import.meta.env.DEV) return null;
  const handleToggleSimulation = (enabled: boolean) => {
    setIsSimulating(enabled);
    if (!enabled) {
      // Reset when disabled
      setSimulatedOffline(false);
      window.dispatchEvent(new Event('online'));
    }
    toast.info(enabled ? 'Offline Simulator Enabled' : 'Offline Simulator Disabled');
  };
  const handleToggleOffline = (offline: boolean) => {
    setSimulatedOffline(offline);

    // Dispatch events to simulate network change
    if (offline) {
      window.dispatchEvent(new Event('offline'));
      toast.warning('Simulating Offline Mode');
    } else {
      window.dispatchEvent(new Event('online'));
      toast.success('Simulating Online Mode');
    }
  };
  const handleToggleSpeed = () => {
    const newSpeed = networkSpeed === 'fast' ? 'slow' : 'fast';
    setNetworkSpeed(newSpeed);
    toast.info(`Network Speed: ${newSpeed === 'fast' ? 'Fast' : 'Slow 3G'}`);
  };
  const handleReset = () => {
    setIsSimulating(false);
    setSimulatedOffline(false);
    setNetworkSpeed('fast');
    window.dispatchEvent(new Event('online'));
    localStorage.removeItem('offline-simulator-state');
    toast.info('Simulator Reset');
  };
  return <div className="fixed bottom-4 right-4 z-50">
      {isSimulating && <Badge variant="destructive" className="absolute -top-2 -left-2 animate-pulse">
          DEV MODE
        </Badge>}
      
      
    </div>;
};