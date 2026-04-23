import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { PasswordStrengthMeter } from "@/components/ui/password-strength-meter";
import { evaluatePassword } from "@/lib/password-strength";

interface UserFormData {
  email: string;
  password?: string;
  firstName: string;
  lastName: string;
  organizationId?: string;
  role?: 'admin' | 'inspector' | 'trainer';
}

interface UserManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  user?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    currentRole?: string;
  };
  organizations: Array<{ id: string; name: string }>;
  onSubmit: (data: UserFormData) => Promise<void>;
}

export function UserManagementDialog({
  open,
  onOpenChange,
  mode,
  user,
  organizations,
  onSubmit,
}: UserManagementDialogProps) {
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [formData, setFormData] = useState<UserFormData>({
    email: user?.email || '',
    password: '',
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    organizationId: '',
    role: 'inspector',
  });

  useEffect(() => {
    if (open) {
      if (mode === 'edit' && user) {
        setFormData({
          email: user.email,
          password: '',
          firstName: user.firstName,
          lastName: user.lastName,
          organizationId: '',
          role: (user.currentRole as 'admin' | 'inspector') || 'inspector',
        });
      } else if (mode === 'create') {
        setFormData({
          email: '',
          password: '',
          firstName: '',
          lastName: '',
          organizationId: '',
          role: 'inspector',
        });
      }
    }
  }, [open, mode, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');

    // Validate password client-side
    const trimmedPassword = (formData.password || '').trim();
    if (mode === 'create' && trimmedPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }
    if (mode === 'edit' && trimmedPassword.length > 0 && trimmedPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }

    const submitData = {
      ...formData,
      password: trimmedPassword || undefined,
    };

    setLoading(true);
    try {
      await onSubmit(submitData);
      onOpenChange(false);
      // Reset form
      setFormData({
        email: '',
        password: '',
        firstName: '',
        lastName: '',
        organizationId: '',
        role: 'inspector',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{mode === 'create' ? 'Add New User' : 'Edit User'}</DialogTitle>
            <DialogDescription>
              {mode === 'create' 
                ? 'Create a new user account. They will be able to sign in with the provided credentials.'
                : 'Update user information. Leave password blank to keep current password.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
                placeholder="user@example.com"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="password">
                Password {mode === 'edit' && '(leave blank to keep current)'}
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => {
                    setFormData({ ...formData, password: e.target.value });
                    setPasswordError('');
                  }}
                  required={mode === 'create'}
                  placeholder={mode === 'edit' ? 'Enter new password' : 'Min. 6 characters'}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                </Button>
              </div>
              {passwordError && (
                <p className="text-sm text-destructive">{passwordError}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  placeholder="John"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  placeholder="Doe"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="role">Role</Label>
              <Select
                value={formData.role}
                onValueChange={(value: 'inspector' | 'trainer' | 'admin') => setFormData({ ...formData, role: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inspector">Inspector</SelectItem>
                  <SelectItem value="trainer">Trainer</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === 'create' ? 'Create User' : 'Update User'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
