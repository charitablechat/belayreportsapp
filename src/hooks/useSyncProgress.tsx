import { useState, useEffect, useCallback } from 'react';

export interface SyncProgress {
  total: number;
  current: number;
  currentItem: string;
  phase: 'inspections' | 'photos' | 'complete' | 'idle';
  errors: Array<{ id: string; error: string }>;
}

export type SyncProgressCallback = (progress: SyncProgress) => void;

// Global event emitter for sync progress
class SyncProgressEmitter {
  private listeners: Set<SyncProgressCallback> = new Set();

  subscribe(callback: SyncProgressCallback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  emit(progress: SyncProgress) {
    this.listeners.forEach(listener => listener(progress));
  }
}

export const syncProgressEmitter = new SyncProgressEmitter();

export const useSyncProgress = () => {
  const [progress, setProgress] = useState<SyncProgress>({
    total: 0,
    current: 0,
    currentItem: '',
    phase: 'idle',
    errors: [],
  });

  useEffect(() => {
    const unsubscribe = syncProgressEmitter.subscribe(setProgress);
    return () => {
      unsubscribe();
    };
  }, []);

  const resetProgress = useCallback(() => {
    setProgress({
      total: 0,
      current: 0,
      currentItem: '',
      phase: 'idle',
      errors: [],
    });
  }, []);

  return {
    progress,
    resetProgress,
  };
};
