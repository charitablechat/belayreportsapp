import { User } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface UserAvatarProps {
  userEmail: string | null;
}

export const UserAvatar = ({ userEmail }: UserAvatarProps) => {
  const getInitials = (email: string | null): string => {
    if (!email) return "";
    
    const parts = email.split("@")[0].split(".");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return email.substring(0, 2).toUpperCase();
  };

  const initials = getInitials(userEmail);

  return (
    <Avatar className="h-9 w-9">
      <AvatarFallback className="bg-primary text-primary-foreground">
        {initials || <User className="h-4 w-4" />}
      </AvatarFallback>
    </Avatar>
  );
};
