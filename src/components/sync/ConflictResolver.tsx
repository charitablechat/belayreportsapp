import { useConflicts, AutoResolveStrategy } from '@/hooks/useConflicts';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Check, Clock, MapPin, Building2, Loader2, Zap, Settings2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';

interface ConflictResolverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const strategyDescriptions: Record<AutoResolveStrategy, string> = {
  'manual': 'Review and choose which version to keep for each conflict',
  'last-write-wins': 'Automatically keep the most recently modified version',
  'local-wins': 'Always prefer changes made on this device',
  'remote-wins': 'Always prefer changes from the server/other devices',
};

export const ConflictResolver = ({ open, onOpenChange }: ConflictResolverProps) => {
  const { 
    conflicts, 
    isLoading, 
    resolveWithLocal, 
    resolveWithRemote, 
    isResolving,
    autoResolveStrategy,
    setAutoResolveStrategy,
    resolveAllWithStrategy,
  } = useConflicts();

  const handleResolve = (conflictId: string, inspectionId: string, useLocal: boolean) => {
    if (useLocal) {
      resolveWithLocal({ conflictId, inspectionId });
    } else {
      resolveWithRemote({ conflictId, inspectionId });
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Show loading state
  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading Conflicts
            </DialogTitle>
            <DialogDescription>
              Checking for sync conflicts...
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (conflicts.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Check className="w-5 h-5 text-green-500" />
              No Conflicts
            </DialogTitle>
            <DialogDescription>
              All your inspections are synced successfully. No conflicts to resolve.
            </DialogDescription>
          </DialogHeader>
          
          {/* Strategy Settings */}
          <div className="space-y-3 pt-4 border-t">
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Auto-Resolution Strategy</Label>
            </div>
            <Select value={autoResolveStrategy} onValueChange={(value) => setAutoResolveStrategy(value as AutoResolveStrategy)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual Resolution</SelectItem>
                <SelectItem value="last-write-wins">Last Write Wins</SelectItem>
                <SelectItem value="local-wins">Local Always Wins</SelectItem>
                <SelectItem value="remote-wins">Remote Always Wins</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {strategyDescriptions[autoResolveStrategy]}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] md:overflow-y-visible max-md:overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-yellow-500" />
            Sync Conflicts ({conflicts.length})
          </DialogTitle>
          <DialogDescription>
            Multiple versions of the same inspection exist. Choose which version to keep.
          </DialogDescription>
        </DialogHeader>

        {/* Auto-Resolution Strategy Card */}
        <Card className="bg-muted/50">
          <CardHeader className="py-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                <CardTitle className="text-sm">Auto-Resolution</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <Select value={autoResolveStrategy} onValueChange={(value) => setAutoResolveStrategy(value as AutoResolveStrategy)}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual Resolution</SelectItem>
                    <SelectItem value="last-write-wins">Last Write Wins</SelectItem>
                    <SelectItem value="local-wins">Local Always Wins</SelectItem>
                    <SelectItem value="remote-wins">Remote Always Wins</SelectItem>
                  </SelectContent>
                </Select>
                {autoResolveStrategy !== 'manual' && (
                  <Button 
                    size="sm" 
                    onClick={resolveAllWithStrategy}
                    disabled={isResolving}
                  >
                    {isResolving ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-1" />
                    ) : (
                      <Zap className="w-4 h-4 mr-1" />
                    )}
                    Resolve All
                  </Button>
                )}
              </div>
            </div>
            <CardDescription className="text-xs mt-1">
              {strategyDescriptions[autoResolveStrategy]}
            </CardDescription>
          </CardHeader>
        </Card>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Why did this happen?</AlertTitle>
          <AlertDescription>
            Conflicts occur when the same inspection is edited on multiple devices while offline, 
            or when changes are made before a previous sync completes.
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          {conflicts.map((conflict) => {
            const localTime = formatDate(conflict.local_updated_at);
            const remoteTime = formatDate(conflict.remote_updated_at);
            const inspectionData = conflict.inspection;
            const localIsNewer = new Date(conflict.local_updated_at).getTime() > new Date(conflict.remote_updated_at).getTime();

            return (
              <Card key={conflict.id} className="border-2 border-yellow-200 dark:border-yellow-800">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-lg">
                        {inspectionData?.organization || 'Unknown Organization'}
                      </CardTitle>
                      <CardDescription className="flex items-center gap-2">
                        {inspectionData?.location && (
                          <>
                            <MapPin className="w-3 h-3" />
                            {inspectionData.location}
                          </>
                        )}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      {localIsNewer ? (
                        <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                          Local is newer
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                          Remote is newer
                        </Badge>
                      )}
                      <Badge variant="destructive">Conflict</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid md:grid-cols-2 gap-4">
                    {/* Local Version */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Building2 className="w-4 h-4" />
                        Local Version (This Device)
                        {localIsNewer && (
                          <Badge variant="outline" className="text-xs">Newer</Badge>
                        )}
                      </div>
                      <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                          <Clock className="w-3 h-3" />
                          Modified: {localTime}
                        </div>
                        <Button
                          size="sm"
                          variant="default"
                          className="w-full"
                          onClick={() => handleResolve(conflict.id, conflict.inspection_id, true)}
                          disabled={isResolving}
                        >
                          Keep Local Version
                        </Button>
                      </div>
                    </div>

                    {/* Remote Version */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Building2 className="w-4 h-4" />
                        Remote Version (Server)
                        {!localIsNewer && (
                          <Badge variant="outline" className="text-xs">Newer</Badge>
                        )}
                      </div>
                      <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                          <Clock className="w-3 h-3" />
                          Modified: {remoteTime}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full"
                          onClick={() => handleResolve(conflict.id, conflict.inspection_id, false)}
                          disabled={isResolving}
                        >
                          Keep Remote Version
                        </Button>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground mt-4 text-center">
                    <strong>Tip:</strong> The local version is from this device. 
                    The remote version may include changes from other devices.
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};
