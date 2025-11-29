import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ReportCardSkeleton() {
  return (
    <Card 
      className="relative overflow-hidden" 
      role="status" 
      aria-busy="true" 
      aria-label="Loading report card"
    >
      <CardContent className="p-4 md:p-6">
        <div className="flex items-start justify-between gap-2 mb-4">
          <div className="flex items-center gap-2 flex-1">
            <Skeleton className="w-5 h-5" />
            <Skeleton className="h-5 flex-1 max-w-[200px]" />
          </div>
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>

        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          
          <div className="flex items-center gap-2 pt-2">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
