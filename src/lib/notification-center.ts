/**
 * Notification Center - Aggregated, non-intrusive status tracking
 * Routes non-critical notifications to a centralized display
 */

export type NotificationType = 'sync' | 'save' | 'error' | 'info' | 'loading';
export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';
export type NotificationPriority = 'low' | 'medium' | 'high';
export type NotificationCategory = 'ERROR' | 'WARNING' | 'SUCCESS' | 'INFO' | 'SYNC';

export interface StatusNotification {
  id: string;
  type: NotificationType;
  category: NotificationCategory;
  message: string;
  timestamp: number;
  priority: NotificationPriority;
  read: boolean;
  expiresAt?: number;
}

// In-memory store for notifications
let notifications: StatusNotification[] = [];
let listeners: Set<() => void> = new Set();

// Maximum notifications to keep
const MAX_NOTIFICATIONS = 50;
const DEFAULT_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generate unique notification ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Derive category from notification type
 */
function deriveCategory(type: NotificationType): NotificationCategory {
  switch (type) {
    case 'error': return 'ERROR';
    case 'sync': return 'SYNC';
    case 'save': return 'SUCCESS';
    case 'loading': return 'INFO';
    case 'info':
    default: return 'INFO';
  }
}

/**
 * Subscribe to notification changes
 */
export function subscribeToNotifications(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Notify all subscribers of changes
 */
function notifyListeners(): void {
  listeners.forEach(listener => listener());
}

/**
 * Add a notification to the center
 */
export function addNotification(
  type: NotificationType,
  message: string,
  priority: NotificationPriority = 'low',
  expiryMs: number = DEFAULT_EXPIRY_MS
): string {
  const id = generateId();
  const now = Date.now();
  
  const notification: StatusNotification = {
    id,
    type,
    category: deriveCategory(type),
    message,
    timestamp: now,
    priority,
    read: false,
    expiresAt: now + expiryMs,
  };
  
  // Add to front of array
  notifications = [notification, ...notifications].slice(0, MAX_NOTIFICATIONS);
  
  // Clean up expired notifications
  cleanupExpired();
  
  notifyListeners();
  
  return id;
}

/**
 * Add a notification with explicit category
 */
export function addNotificationWithCategory(
  type: NotificationType,
  category: NotificationCategory,
  message: string,
  priority: NotificationPriority = 'low',
  expiryMs: number = DEFAULT_EXPIRY_MS
): string {
  const id = generateId();
  const now = Date.now();
  
  const notification: StatusNotification = {
    id,
    type,
    category,
    message,
    timestamp: now,
    priority,
    read: false,
    expiresAt: now + expiryMs,
  };
  
  notifications = [notification, ...notifications].slice(0, MAX_NOTIFICATIONS);
  cleanupExpired();
  notifyListeners();
  
  return id;
}

/**
 * Add a sync status notification (deduplicates frequent sync messages)
 */
let lastSyncMessage = '';
let syncMessageTimeout: ReturnType<typeof setTimeout> | null = null;

export function addSyncNotification(message: string): void {
  // Deduplicate rapid sync messages
  if (message === lastSyncMessage) {
    return;
  }
  
  lastSyncMessage = message;
  
  // Debounce sync messages to prevent spam
  if (syncMessageTimeout) {
    clearTimeout(syncMessageTimeout);
  }
  
  syncMessageTimeout = setTimeout(() => {
    addNotification('sync', message, 'low', 2 * 60 * 1000); // 2 min expiry
    syncMessageTimeout = null;
  }, 500);
}

/**
 * Add a save status notification (aggregates frequent save messages)
 */
let pendingSaveCount = 0;
let saveMessageTimeout: ReturnType<typeof setTimeout> | null = null;

export function addSaveNotification(message: string): void {
  pendingSaveCount++;
  
  // Debounce save messages
  if (saveMessageTimeout) {
    clearTimeout(saveMessageTimeout);
  }
  
  saveMessageTimeout = setTimeout(() => {
    if (pendingSaveCount > 1) {
      addNotification('save', `${pendingSaveCount} changes saved`, 'low', 60 * 1000);
    } else {
      addNotification('save', message, 'low', 60 * 1000);
    }
    pendingSaveCount = 0;
    saveMessageTimeout = null;
  }, 1000);
}

/**
 * Add an error notification (always shown immediately)
 */
export function addErrorNotification(message: string): void {
  addNotificationWithCategory('error', 'ERROR', message, 'high', 10 * 60 * 1000);
}

/**
 * Add a warning notification
 */
export function addWarningNotification(message: string): void {
  addNotificationWithCategory('info', 'WARNING', message, 'medium', 5 * 60 * 1000);
}

/**
 * Get all notifications
 */
export function getNotifications(): StatusNotification[] {
  cleanupExpired();
  return [...notifications];
}

/**
 * Get unread count
 */
export function getUnreadCount(): number {
  cleanupExpired();
  return notifications.filter(n => !n.read).length;
}

/**
 * Get recent activity summary for status indicator
 */
export function getRecentActivity(): { syncing: boolean; errors: number; lastActivity: string | null } {
  cleanupExpired();
  
  const now = Date.now();
  const recentWindow = 30 * 1000; // 30 seconds
  
  const recentNotifications = notifications.filter(n => now - n.timestamp < recentWindow);
  const syncing = recentNotifications.some(n => n.type === 'sync' && n.message.includes('Syncing'));
  const errors = recentNotifications.filter(n => n.type === 'error').length;
  
  const lastNotification = notifications[0];
  const lastActivity = lastNotification ? lastNotification.message : null;
  
  return { syncing, errors, lastActivity };
}

/**
 * Mark all notifications as read
 */
export function markAllAsRead(): void {
  notifications = notifications.map(n => ({ ...n, read: true }));
  notifyListeners();
}

/**
 * Mark a specific notification as read
 */
export function markAsRead(id: string): void {
  notifications = notifications.map(n => 
    n.id === id ? { ...n, read: true } : n
  );
  notifyListeners();
}

/**
 * Clear all notifications
 */
export function clearNotifications(): void {
  notifications = [];
  notifyListeners();
}

/**
 * Remove expired notifications
 */
function cleanupExpired(): void {
  const now = Date.now();
  const before = notifications.length;
  notifications = notifications.filter(n => !n.expiresAt || n.expiresAt > now);
  
  if (notifications.length !== before) {
    notifyListeners();
  }
}

/**
 * Get the latest status for the status indicator
 */
export function getLatestStatus(): { type: NotificationType; message: string } | null {
  const recent = notifications.find(n => Date.now() - n.timestamp < 5000);
  if (recent) {
    return { type: recent.type, message: recent.message };
  }
  return null;
}

/**
 * Route a toast message to the notification center
 * Maps toast types to notification types with appropriate priority and category
 */
export function routeToastToNotification(
  message: string, 
  type: ToastType
): void {
  switch (type) {
    case 'error':
      addErrorNotification(message);
      break;
    case 'warning':
      addWarningNotification(message);
      break;
    case 'success':
      // Categorize success messages based on content
      if (/sync/i.test(message)) {
        addSyncNotification(message);
      } else {
        addSaveNotification(message);
      }
      break;
    case 'loading':
      addNotificationWithCategory('sync', 'SYNC', message, 'low', 30000);
      break;
    case 'info':
    default:
      addNotificationWithCategory('info', 'INFO', message, 'low');
      break;
  }
}
