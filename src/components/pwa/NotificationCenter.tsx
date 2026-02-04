/**
 * NotificationCenter - Developer-focused notification viewer
 * Displays notification history with clear status badges
 */

import { useState } from 'react';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { cn } from '@/lib/utils';
import { 
  Bell, 
  Check, 
  Cloud, 
  AlertCircle, 
  AlertTriangle,
  Info, 
  Trash2, 
  CheckCheck,
  Filter
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useNotificationCenter } from '@/hooks/useNotificationCenter';
import { markAsRead, StatusNotification, NotificationCategory } from '@/lib/notification-center';

interface NotificationCenterProps {
  trigger?: React.ReactNode;
}

type FilterType = 'all' | 'errors' | 'sync' | 'success';

/**
 * Status badge component with developer-focused styling
 */
function StatusBadge({ category }: { category: NotificationCategory }) {
  const config: Record<NotificationCategory, { 
    label: string; 
    className: string; 
    icon: React.ReactNode;
  }> = {
    ERROR: { 
      label: 'ERROR', 
      className: 'bg-destructive text-destructive-foreground',
      icon: <AlertCircle className="h-3 w-3" />
    },
    WARNING: { 
      label: 'WARN', 
      className: 'bg-amber-500 text-white',
      icon: <AlertTriangle className="h-3 w-3" />
    },
    SUCCESS: { 
      label: 'OK', 
      className: 'bg-green-600 text-white',
      icon: <Check className="h-3 w-3" />
    },
    INFO: { 
      label: 'INFO', 
      className: 'bg-muted text-muted-foreground',
      icon: <Info className="h-3 w-3" />
    },
    SYNC: { 
      label: 'SYNC', 
      className: 'bg-blue-500 text-white',
      icon: <Cloud className="h-3 w-3" />
    },
  };

  const { label, className, icon } = config[category];

  return (
    <Badge 
      variant="secondary" 
      className={cn(
        'h-5 px-1.5 text-[10px] font-mono font-medium rounded gap-1',
        className
      )}
    >
      {icon}
      {label}
    </Badge>
  );
}

/**
 * Get time group label for notification
 */
function getTimeGroup(timestamp: number): string {
  const date = new Date(timestamp);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'MMM d');
}

/**
 * Individual notification item
 */
function NotificationItem({ notification }: { notification: StatusNotification }) {
  const handleClick = () => {
    if (!notification.read) {
      markAsRead(notification.id);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        'w-full text-left p-3 rounded-lg transition-colors border',
        notification.read
          ? 'bg-background border-transparent hover:bg-muted/50'
          : 'bg-muted/20 border-primary/20 hover:bg-muted/40'
      )}
    >
      <div className="flex items-start gap-3">
        <StatusBadge category={notification.category} />
        <div className="flex-1 min-w-0">
          <p className={cn(
            'text-sm leading-tight',
            !notification.read && 'font-medium'
          )}>
            {notification.message}
          </p>
          <p className="text-[11px] font-mono text-muted-foreground mt-1.5">
            {formatDistanceToNow(notification.timestamp, { addSuffix: true })}
          </p>
        </div>
      </div>
    </button>
  );
}

/**
 * Group notifications by time period
 */
function groupNotificationsByTime(notifications: StatusNotification[]): Map<string, StatusNotification[]> {
  const groups = new Map<string, StatusNotification[]>();
  
  notifications.forEach(notification => {
    const group = getTimeGroup(notification.timestamp);
    const existing = groups.get(group) || [];
    groups.set(group, [...existing, notification]);
  });
  
  return groups;
}

export function NotificationCenter({ trigger }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const { notifications, unreadCount, markAllAsRead, clearAll } = useNotificationCenter();

  // Apply filter
  const filteredNotifications = notifications.filter(n => {
    if (filter === 'all') return true;
    if (filter === 'errors') return n.category === 'ERROR';
    if (filter === 'sync') return n.category === 'SYNC';
    if (filter === 'success') return n.category === 'SUCCESS';
    return true;
  });

  const groupedNotifications = groupNotificationsByTime(filteredNotifications);

  const defaultTrigger = (
    <Button variant="ghost" size="icon" className="relative">
      <Bell className="h-5 w-5" />
      {unreadCount > 0 && (
        <Badge 
          variant="destructive" 
          className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
        >
          {unreadCount > 9 ? '9+' : unreadCount}
        </Badge>
      )}
    </Button>
  );

  const filterLabels: Record<FilterType, string> = {
    all: 'All',
    errors: 'Errors',
    sync: 'Sync',
    success: 'Success',
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger || defaultTrigger}
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2 font-mono">
              <Bell className="h-5 w-5" />
              Activity Log
            </SheetTitle>
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-xs gap-1">
                    <Filter className="h-3.5 w-3.5" />
                    {filterLabels[filter]}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setFilter('all')}>
                    All
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFilter('errors')}>
                    <AlertCircle className="h-4 w-4 mr-2 text-destructive" />
                    Errors
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFilter('sync')}>
                    <Cloud className="h-4 w-4 mr-2 text-blue-500" />
                    Sync
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFilter('success')}>
                    <Check className="h-4 w-4 mr-2 text-green-600" />
                    Success
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={markAllAsRead}
                  className="h-8 px-2 text-xs"
                >
                  <CheckCheck className="h-3.5 w-3.5 mr-1" />
                  Read
                </Button>
              )}
              {notifications.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAll}
                  className="h-8 px-2 text-xs text-muted-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
          <SheetDescription className="font-mono text-xs">
            {filteredNotifications.length} notification{filteredNotifications.length !== 1 ? 's' : ''}
            {filter !== 'all' && ` (${filterLabels[filter].toLowerCase()})`}
          </SheetDescription>
        </SheetHeader>
        
        <ScrollArea className="h-[calc(100vh-10rem)] mt-4 -mx-6 px-6">
          {filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-sm text-muted-foreground font-medium">No activity</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                {filter === 'all' 
                  ? 'Notifications will appear here'
                  : `No ${filterLabels[filter].toLowerCase()} notifications`
                }
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {Array.from(groupedNotifications.entries()).map(([group, items]) => (
                <div key={group}>
                  <h3 className="text-xs font-mono font-medium text-muted-foreground mb-2 px-1">
                    {group}
                  </h3>
                  <div className="space-y-1.5">
                    {items.map((notification) => (
                      <NotificationItem key={notification.id} notification={notification} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
