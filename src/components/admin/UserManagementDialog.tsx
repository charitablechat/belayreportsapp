import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

interface UserFormData {
  email: string;
  password?: string;
  firstName: string;
  lastName: string;
  organizationId?: string;
  role?: 'admin' | 'inspector' | 'trainer' | 'super_admin';
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
          role: (user.currentRole as 'admin' | 'inspector' | 'super_admin') || 'inspector',
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
    setLoading(true);
    try {
      await onSubmit(formData);
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
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required={mode === 'create'}
                placeholder={mode === 'edit' ? 'Enter new password' : 'Min. 6 characters'}
                minLength={6}
              />
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
                onValueChange={(value: 'inspector' | 'trainer' | 'admin' | 'super_admin') => setFormData({ ...formData, role: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inspector">Inspector</SelectItem>
                  <SelectItem value="trainer">Trainer</SelectItem>
                  <SelectItem value="super_admin">Admin</SelectItem>
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
