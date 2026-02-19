import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminTab } from "./AdminTab";
import { 
  Building2, 
  Users, 
  ClipboardList, 
  GraduationCap, 
  ClipboardCheck, 
  Settings, 
  Bell, 
  RotateCcw, 
  UserCog, 
  Wrench,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

const tabs = [
  { value: "organizations", icon: Building2, title: "Organizations", description: "Manage client facilities and companies" },
  { value: "user-management", icon: Users, title: "User Management", description: "Create, edit, and manage user accounts" },
  { value: "inspections", icon: ClipboardList, title: "Inspections", description: "View and manage all inspection reports" },
  { value: "trainings", icon: GraduationCap, title: "Training Reports", description: "View and manage training documentation" },
  { value: "daily-assessments", icon: ClipboardCheck, title: "Daily Assessments", description: "View daily operational assessments" },
  { value: "form-cms", icon: Settings, title: "Form CMS", description: "Customize form fields and options" },
  { value: "notifications", icon: Bell, title: "Notifications", description: "View notification history and logs" },
  { value: "data-recovery", icon: RotateCcw, title: "Data Recovery", description: "Recover deleted or corrupted data" },
  { value: "report-ownership", icon: UserCog, title: "Report Ownership", description: "Transfer report ownership between users" },
  { value: "maintenance", icon: Wrench, title: "Maintenance", description: "System maintenance and cleanup tools" },
];

interface AdminTabsSectionProps {
  children?: React.ReactNode;
}

export const AdminTabsSection = ({ children }: AdminTabsSectionProps) => {
  const { theme, setTheme } = useTheme();

  return (
    <TooltipProvider delayDuration={300}>
      <TabsList className="flex flex-col h-auto w-full items-stretch backdrop-blur-md bg-white/5 dark:bg-slate-900/30 border border-white/10 rounded-xl p-1">
        {tabs.map((tab) => (
          <AdminTab
            key={tab.value}
            value={tab.value}
            icon={tab.icon}
            title={tab.title}
            description={tab.description}
          />
        ))}
        
        {/* Dark/Light Mode Toggle */}
        <div className="mt-2 pt-2 border-t border-border/30 px-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </Button>
        </div>
      </TabsList>
    </TooltipProvider>
  );
};
