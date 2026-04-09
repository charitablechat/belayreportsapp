

# Glassmorphism Pulsating Green "Invoiced" Tab

## Change

### `src/components/dashboard/DashboardReportsSection.tsx` (line 425)

Update the Invoiced `TabsTrigger` className to add a glassmorphism style with a pulsating money-green glow:

```tsx
<TabsTrigger 
  value="invoiced" 
  className="flex items-center gap-2 backdrop-blur-md bg-emerald-500/10 border border-emerald-400/30 text-emerald-700 dark:text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.2)] animate-pulse-soft data-[state=active]:bg-emerald-500/20 data-[state=active]:shadow-[0_0_20px_rgba(16,185,129,0.35)] data-[state=active]:border-emerald-400/50"
>
```

This uses:
- `backdrop-blur-md` + `bg-emerald-500/10` for glassmorphism
- `border-emerald-400/30` for a subtle green glass border
- `shadow-[0_0_15px_...]` for the green glow
- `animate-pulse-soft` (already defined in tailwind config) for the pulsating effect
- Active state gets stronger glow and opacity

