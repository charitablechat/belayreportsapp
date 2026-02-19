import { User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface UserAvatarProps {
  userEmail: string | null;
  avatarUrl?: string | null;
  isSuperAdmin?: boolean;
}

export const UserAvatar = ({ userEmail, avatarUrl, isSuperAdmin = false }: UserAvatarProps) => {
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
    <Avatar className={`h-9 w-9 ring-1 ring-white/20 shadow-inner ${isSuperAdmin ? 'ring-2 ring-amber-400 shadow-lg shadow-amber-500/50' : ''}`}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt="User avatar" />}
      <AvatarFallback className="bg-primary text-primary-foreground">
        {initials || <User className="h-4 w-4" />}
      </AvatarFallback>
    </Avatar>
  );
};
