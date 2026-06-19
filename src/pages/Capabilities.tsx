import { useEffect, useState } from 'react';
import { SEO } from "@/components/SEO";
import { useNavigate } from 'react-router-dom';
import { goBack } from '@/lib/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import belayReportsLogoAsset from "@/assets/belay-reports-wide.gif.asset.json";
const belayReportsLogo = belayReportsLogoAsset.url;

interface Capability {
  name: string;
  description: string;
  supported: boolean | null;
  category: 'core' | 'media' | 'sensors' | 'storage' | 'network';
}

export default function Capabilities() {
  const navigate = useNavigate();
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const detectCapabilities = async () => {
      const detected: Capability[] = [
        // Core PWA Features
        {
          name: 'Service Worker',
          description: 'Enables offline functionality and background sync',
          supported: 'serviceWorker' in navigator,
          category: 'core',
        },
        {
          name: 'Install Prompt',
          description: 'Ability to install app to home screen',
          supported: 'BeforeInstallPromptEvent' in window || window.matchMedia('(display-mode: standalone)').matches,
          category: 'core',
        },
        {
          name: 'Push Notifications',
          description: 'Receive push notifications when app is closed',
          supported: 'PushManager' in window && 'Notification' in window,
          category: 'core',
        },
        {
          name: 'Background Sync',
          description: 'Sync data in the background',
          supported: 'serviceWorker' in navigator && 'SyncManager' in window,
          category: 'core',
        },
        
        // Media Features
        {
          name: 'Camera Access',
          description: 'Access device camera for photos and video',
          supported: 'mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices,
          category: 'media',
        },
        {
          name: 'Microphone Access',
          description: 'Access device microphone for audio recording',
          supported: 'mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices,
          category: 'media',
        },
        {
          name: 'Screen Capture',
          description: 'Capture screen content',
          supported: 'getDisplayMedia' in (navigator.mediaDevices || {}),
          category: 'media',
        },
        
        // Sensors & Hardware
        {
          name: 'Geolocation',
          description: 'Access device GPS location',
          supported: 'geolocation' in navigator,
          category: 'sensors',
        },
        {
          name: 'Device Orientation',
          description: 'Detect device tilt and rotation',
          supported: 'DeviceOrientationEvent' in window,
          category: 'sensors',
        },
        {
          name: 'Device Motion',
          description: 'Detect device acceleration and movement',
          supported: 'DeviceMotionEvent' in window,
          category: 'sensors',
        },
        {
          name: 'Vibration',
          description: 'Trigger device vibration',
          supported: 'vibrate' in navigator,
          category: 'sensors',
        },
        {
          name: 'Battery Status',
          description: 'Monitor device battery level',
          supported: 'getBattery' in navigator,
          category: 'sensors',
        },
        
        // Storage
        {
          name: 'Local Storage',
          description: 'Store data locally in browser',
          supported: 'localStorage' in window,
          category: 'storage',
        },
        {
          name: 'IndexedDB',
          description: 'Advanced local database storage',
          supported: 'indexedDB' in window,
          category: 'storage',
        },
        {
          name: 'Cache API',
          description: 'Cache resources for offline use',
          supported: 'caches' in window,
          category: 'storage',
        },
        {
          name: 'File System Access',
          description: 'Read and write local files',
          supported: 'showOpenFilePicker' in window,
          category: 'storage',
        },
        
        // Network
        {
          name: 'Online/Offline Detection',
          description: 'Detect network connectivity status',
          supported: 'onLine' in navigator,
          category: 'network',
        },
        {
          name: 'Network Information',
          description: 'Get network connection type and speed',
          supported: 'connection' in navigator || 'mozConnection' in navigator || 'webkitConnection' in navigator,
          category: 'network',
        },
        {
          name: 'Fetch API',
          description: 'Modern API for network requests',
          supported: 'fetch' in window,
          category: 'network',
        },
      ];

      setCapabilities(detected);
      setLoading(false);

      if (import.meta.env.DEV) {
        console.log('[Capabilities] Detection complete', {
          total: detected.length,
          supported: detected.filter(c => c.supported).length,
          unsupported: detected.filter(c => !c.supported).length,
        });
      }
    };

    detectCapabilities();
  }, []);

  const getCategoryTitle = (category: string) => {
    const titles = {
      core: 'Core PWA Features',
      media: 'Media & Camera',
      sensors: 'Sensors & Hardware',
      storage: 'Storage & Data',
      network: 'Network & Connectivity',
    };
    return titles[category as keyof typeof titles] || category;
  };

  const categories = ['core', 'media', 'sensors', 'storage', 'network'] as const;
  
  const getSupportedCount = (category: string) => {
    return capabilities.filter(c => c.category === category && c.supported).length;
  };

  const getTotalCount = (category: string) => {
    return capabilities.filter(c => c.category === category).length;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-white/20 bg-white/10 dark:bg-black/20 backdrop-blur-[12px] shadow-md shadow-black/5 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={belayReportsLogo} alt="Belay Reports" className="h-12 w-auto object-contain cursor-pointer hover:opacity-80 transition-opacity" onClick={() => navigate('/dashboard')} />
            <h1 className="text-2xl font-bold text-primary">Device Capabilities</h1>
          </div>
          <Button variant="ghost" onClick={() => goBack(navigate)}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-bold mb-2">PWA Feature Detection</h2>
            <p className="text-muted-foreground">
              Check which Progressive Web App features are supported on your device
            </p>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Detecting capabilities...</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6 text-center">
                    <div className="text-3xl font-bold text-primary">
                      {capabilities.filter(c => c.supported).length}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">Supported</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <div className="text-3xl font-bold text-destructive">
                      {capabilities.filter(c => !c.supported).length}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">Not Supported</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <div className="text-3xl font-bold">
                      {capabilities.length}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">Total Features</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <div className="text-3xl font-bold text-success">
                      {Math.round((capabilities.filter(c => c.supported).length / capabilities.length) * 100)}%
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">Compatible</div>
                  </CardContent>
                </Card>
              </div>

              {/* Capabilities by Category */}
              {categories.map(category => (
                <Card key={category}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>{getCategoryTitle(category)}</CardTitle>
                      <Badge variant="outline">
                        {getSupportedCount(category)} / {getTotalCount(category)}
                      </Badge>
                    </div>
                    <CardDescription>
                      {getSupportedCount(category) === getTotalCount(category) ? (
                        <span className="text-success flex items-center gap-1">
                          <CheckCircle2 className="w-4 h-4" />
                          All features supported
                        </span>
                      ) : getSupportedCount(category) === 0 ? (
                        <span className="text-destructive flex items-center gap-1">
                          <XCircle className="w-4 h-4" />
                          No features supported
                        </span>
                      ) : (
                        <span className="text-warning flex items-center gap-1">
                          <AlertCircle className="w-4 h-4" />
                          Partially supported
                        </span>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {capabilities
                        .filter(c => c.category === category)
                        .map((capability, index) => (
                          <div
                            key={index}
                            className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                          >
                            <div className="mt-0.5">
                              {capability.supported ? (
                                <CheckCircle2 className="w-5 h-5 text-success" />
                              ) : (
                                <XCircle className="w-5 h-5 text-destructive" />
                              )}
                            </div>
                            <div className="flex-1">
                              <div className="font-medium">{capability.name}</div>
                              <div className="text-sm text-muted-foreground">
                                {capability.description}
                              </div>
                            </div>
                            <Badge variant={capability.supported ? 'default' : 'secondary'}>
                              {capability.supported ? 'Supported' : 'Not Available'}
                            </Badge>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
              ))}

              {/* Device Info */}
              <Card>
                <CardHeader>
                  <CardTitle>Device Information</CardTitle>
                  <CardDescription>Details about your current device and browser</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="font-medium">User Agent:</span>
                      <p className="text-muted-foreground break-all">{navigator.userAgent}</p>
                    </div>
                    <div>
                      <span className="font-medium">Platform:</span>
                      <p className="text-muted-foreground">{navigator.platform}</p>
                    </div>
                    <div>
                      <span className="font-medium">Screen Size:</span>
                      <p className="text-muted-foreground">
                        {window.screen.width} × {window.screen.height}
                      </p>
                    </div>
                    <div>
                      <span className="font-medium">Display Mode:</span>
                      <p className="text-muted-foreground">
                        {window.matchMedia('(display-mode: standalone)').matches
                          ? 'Standalone (Installed)'
                          : 'Browser'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
