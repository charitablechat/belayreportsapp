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

  // Only show in development mode
  if (!import.meta.env.DEV) return null;

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
      networkSpeed,
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

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {isSimulating && (
        <Badge 
          variant="destructive" 
          className="absolute -top-2 -left-2 animate-pulse"
        >
          DEV MODE
        </Badge>
      )}
      
      <Card className="w-80 shadow-lg border-2 border-purple-500">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Gauge className="h-4 w-4" />
            Offline Testing Simulator
            <Badge variant="outline" className="ml-auto">
              Ctrl+Shift+O
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Enable/Disable Simulator */}
          <div className="flex items-center justify-between">
            <Label htmlFor="enable-sim" className="text-sm">
              Enable Simulator
            </Label>
            <Switch
              id="enable-sim"
              checked={isSimulating}
              onCheckedChange={handleToggleSimulation}
            />
          </div>

          {isSimulating && (
            <>
              <div className="h-px bg-border" />

              {/* Offline Toggle */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="offline-toggle" className="text-sm">
                    Simulate Offline
                  </Label>
                  <Switch
                    id="offline-toggle"
                    checked={simulatedOffline}
                    onCheckedChange={handleToggleOffline}
                  />
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {simulatedOffline ? (
                    <>
                      <WifiOff className="h-3 w-3 text-red-500" />
                      <span>App thinks it's offline</span>
                    </>
                  ) : (
                    <>
                      <Wifi className="h-3 w-3 text-green-500" />
                      <span>App thinks it's online</span>
                    </>
                  )}
                </div>
              </div>

              {/* Network Speed */}
              <div className="space-y-2">
                <Label className="text-sm">Network Speed</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleToggleSpeed}
                  className="w-full justify-start"
                  disabled={simulatedOffline}
                >
                  <Gauge className="h-3 w-3 mr-2" />
                  {networkSpeed === 'fast' ? 'Fast Connection' : 'Slow 3G'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {networkSpeed === 'slow' 
                    ? 'Simulates slow network (visual only)'
                    : 'Normal network speed'
                  }
                </p>
              </div>

              <div className="h-px bg-border" />

              {/* Quick Actions */}
              <div className="space-y-2">
                <Label className="text-sm">Quick Actions</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggleOffline(true)}
                  >
                    <WifiOff className="h-3 w-3 mr-1" />
                    Go Offline
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggleOffline(false)}
                  >
                    <Wifi className="h-3 w-3 mr-1" />
                    Go Online
                  </Button>
                </div>
              </div>

              {/* Reset */}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="w-full"
              >
                <RotateCcw className="h-3 w-3 mr-2" />
                Reset Simulator
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
