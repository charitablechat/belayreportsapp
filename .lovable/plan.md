
## Mobile Tab Description Tooltips

### Overview
Add tap-to-reveal functionality on mobile so users can see the full tab descriptions that are currently truncated. On desktop, descriptions will show in a tooltip on hover.

### Approach
Follow the existing pattern from `StatCard.tsx`:
- **Desktop**: Use `Tooltip` component for hover-to-reveal
- **Mobile**: Use `Popover` for tap-to-reveal (lighter than Sheet for simple text)

### Implementation Steps

**1. Add Required Imports**
```typescript
// Add to existing imports
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
```

**2. Create Tab Item Component**
Extract the tab logic into a reusable component that handles mobile/desktop differently:

```typescript
interface AdminTabProps {
  value: string;
  icon: React.ElementType;
  title: string;
  description: string;
}

const AdminTab = ({ value, icon: Icon, title, description }: AdminTabProps) => {
  const isMobile = useIsMobile();
  
  const tabContent = (
    <TabsTrigger value={value} className="justify-start gap-3 w-full overflow-hidden group hover:bg-accent/50 data-[state=active]:bg-accent">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary group-data-[state=active]:text-primary" />
      <span className="shrink-0">{title}</span>
      <span className="text-xs text-muted-foreground font-normal truncate">— {description}</span>
    </TabsTrigger>
  );

  if (isMobile) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <div className="w-full">{tabContent}</div>
        </PopoverTrigger>
        <PopoverContent side="top" className="w-auto max-w-xs text-sm">
          <p className="font-medium">{title}</p>
          <p className="text-muted-foreground text-xs mt-1">{description}</p>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {tabContent}
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs">
        <p>{description}</p>
      </TooltipContent>
    </Tooltip>
  );
};
```

**3. Wrap TabsList with TooltipProvider**
```tsx
<TooltipProvider delayDuration={300}>
  <TabsList className="flex flex-col h-auto w-full items-stretch">
    <AdminTab value="organizations" icon={Building2} title="Organizations" description="Manage client facilities and companies" />
    <AdminTab value="user-management" icon={Users} title="User Management" description="Create, edit, and manage user accounts" />
    {/* ... remaining 8 tabs */}
  </TabsList>
</TooltipProvider>
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/pages/SuperAdminDashboard.tsx` | Add imports, create AdminTab component, refactor TabsList |

### Result
- **Mobile**: Tap any tab to see a popover with the full description
- **Desktop**: Hover over any tab to see a tooltip with the full description
- Both interactions are consistent with existing patterns in the app
