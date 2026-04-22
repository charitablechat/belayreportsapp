import { useMemo } from 'react';
import { usePWA } from '@/hooks/usePWA';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, Signal, SignalHigh, SignalLow, SignalMedium } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type NetworkQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'offline' | 'unknown';

const getNetworkQuality = (
  isOnline: boolean,
  effectiveType: string | null,
  downlink: number | null,
  rtt: number | null
): NetworkQuality => {
  if (!isOnline) return 'offline';

  // Network Information API not available (Safari/iOS, some Firefox).
  // Browser says we're online — trust it instead of falsely reporting "Poor".
  if (effectiveType === null && downlink === null && rtt === null) {
    return 'unknown';
  }

  // Use effective type as primary indicator
  if (effectiveType === '4g' || (downlink && downlink > 5)) {
    return 'excellent';
  }
  
  if (effectiveType === '3g' || (downlink && downlink > 1.5)) {
    return 'good';
  }

  if (effectiveType === '2g' || (downlink && downlink > 0.5)) {
    return 'fair';
  }

  // Check RTT if available
  if (rtt !== null) {
    if (rtt < 100) return 'excellent';
    if (rtt < 300) return 'good';
    if (rtt < 500) return 'fair';
  }

  return 'poor';
};

const getQualityConfig = (quality: NetworkQuality) => {
  switch (quality) {
    case 'excellent':
      return {
        icon: SignalHigh,
        label: 'Excellent',
        variant: 'default' as const,
        color: 'text-green-500',
        description: 'Fast connection - optimal for uploads',
      };
    case 'good':
      return {
        icon: SignalMedium,
        label: 'Good',
        variant: 'default' as const,
        color: 'text-blue-500',
        description: 'Good connection - suitable for most tasks',
      };
    case 'fair':
      return {
        icon: SignalLow,
        label: 'Fair',
        variant: 'secondary' as const,
        color: 'text-yellow-500',
        description: 'Slower connection - uploads may take longer',
      };
    case 'poor':
      return {
        icon: Signal,
        label: 'Poor',
        variant: 'secondary' as const,
        color: 'text-orange-500',
        description: 'Very slow connection - consider waiting for better signal',
      };
    case 'offline':
      return {
        icon: WifiOff,
        label: 'Offline',
        variant: 'secondary' as const,
        color: 'text-muted-foreground',
        description: 'No connection - changes will sync when online',
      };
    case 'unknown':
      return {
        icon: Wifi,
        label: 'Online',
        variant: 'secondary' as const,
        color: 'text-muted-foreground',
        description: 'Connected. Detailed connection quality is unavailable on this browser.',
      };
  }
};

export const NetworkQualityIndicator = () => {
  const { isOnline, effectiveType, downlink, rtt } = usePWA();
  
  // Memoize quality calculation to avoid recalculating on every render
  const quality = useMemo(
    () => getNetworkQuality(isOnline, effectiveType, downlink, rtt),
    [isOnline, effectiveType, downlink, rtt]
  );
  
  // Memoize config lookup since it depends on quality
  const config = useMemo(
    () => getQualityConfig(quality),
    [quality]
  );
  
  const Icon = config.icon;

  // Hide entirely when status is uninteresting (unknown = online but no API detail).
  // Offline / fair / poor / good / excellent all still render.
  if (quality === 'unknown') {
    return null;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant={config.variant}
            className="gap-2 cursor-help"
          >
            <Icon className={`w-4 h-4 ${config.color}`} />
            <span className="hidden sm:inline">{config.label}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs space-y-1">
            <p className="font-semibold">{config.description}</p>
            {isOnline && effectiveType && (
              <p className="text-muted-foreground">Type: {effectiveType.toUpperCase()}</p>
            )}
            {downlink !== null && (
              <p className="text-muted-foreground">Speed: {downlink.toFixed(1)} Mbps</p>
            )}
            {rtt !== null && (
              <p className="text-muted-foreground">Latency: {rtt}ms</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
