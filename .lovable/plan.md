

# Glassmorphism Pulsating Green "INVOICED" Watermark on Report Cards

## Summary
Apply a glassmorphism pulsating money-green style to the "INVOICED" watermark stamp on report cards, and revert the dashboard tab back to its default style. Also slow down the pulse animation for a calming effect.

## Changes

### 1. `src/components/dashboard/ReportCard.tsx` (line 168-171)
Replace the current red "INVOICED" watermark with a glassmorphism emerald style:
```tsx
{isAdmin && isInvoiced && (
  <span className="absolute backdrop-blur-sm bg-emerald-500/10 border border-emerald-400/30 rounded-lg px-4 py-2 text-emerald-600 dark:text-emerald-400 text-4xl md:text-5xl font-bold tracking-wider rotate-[25deg] select-none whitespace-nowrap shadow-[0_0_20px_rgba(16,185,129,0.25)] animate-pulse-calm">
    INVOICED
  </span>
)}
```

### 2. `src/components/dashboard/DashboardReportsSection.tsx` (line 425)
Revert the Invoiced tab trigger back to the default style (remove glassmorphism classes):
```tsx
<TabsTrigger value="invoiced" className="flex items-center gap-2">
```

### 3. `tailwind.config.ts`
Add a new slow, calming pulse animation:
```ts
// In keyframes:
"pulse-calm": {
  "0%, 100%": { opacity: "1" },
  "50%": { opacity: "0.6" },
}

// In animation:
"pulse-calm": "pulse-calm 4s ease-in-out infinite",
```
Uses a 4-second cycle (vs 2s for pulse-soft) for a slower, more calming feel.

