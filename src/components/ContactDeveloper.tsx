import { useState, useEffect } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePWA } from "@/hooks/usePWA";

interface ContactForm {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export default function ContactDeveloper() {
  const { isOnline } = usePWA();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<ContactForm>({
    name: "",
    email: "",
    subject: "",
    message: "",
  });

  useEffect(() => {
    // Auto-fill user data if authenticated
    const loadUserData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setForm(prev => ({
          ...prev,
          email: user.email || "",
        }));

        // Try to get profile data
        const { data: profile } = await supabase
          .from("profiles")
          .select("first_name, last_name")
          .eq("id", user.id)
          .single();

        if (profile) {
          setForm(prev => ({
            ...prev,
            name: `${profile.first_name || ""} ${profile.last_name || ""}`.trim(),
          }));
        }
      }
    };

    if (open) {
      loadUserData();
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.name || !form.email || !form.subject || !form.message) {
      toast.error("Please fill in all fields");
      return;
    }

    if (form.message.length > 1000) {
      toast.error("Message is too long (max 1000 characters)");
      return;
    }

    if (!isOnline) {
      toast.error("Please connect to the internet to send a message");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.functions.invoke("send-contact-email", {
        body: {
          name: form.name,
          email: form.email,
          subject: form.subject,
          message: form.message,
        },
      });

      if (error) throw error;

      toast.success("Message sent successfully!");
      setForm(prev => ({ ...prev, subject: "", message: "" }));
      setOpen(false);
    } catch (error: any) {
      console.error("Error sending message:", error);
      toast.error(error.message || "Failed to send message");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            size="icon"
            className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50 bg-primary hover:bg-primary/90"
            aria-label="Contact Developer"
          >
            <MessageCircle className="h-6 w-6" />
          </Button>
        </SheetTrigger>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Contact Developer</SheetTitle>
            <SheetDescription>
              Send a message to the developer. We'll get back to you as soon as possible.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-6">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Your name"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm(prev => ({ ...prev, email: e.target.value }))}
                placeholder="your.email@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Select
                value={form.subject}
                onValueChange={(value) => setForm(prev => ({ ...prev, subject: value }))}
                required
              >
                <SelectTrigger id="subject">
                  <SelectValue placeholder="Select a subject" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bug">Bug Report</SelectItem>
                  <SelectItem value="feature">Feature Request</SelectItem>
                  <SelectItem value="question">Question</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">Message</Label>
              <Textarea
                id="message"
                value={form.message}
                onChange={(e) => setForm(prev => ({ ...prev, message: e.target.value }))}
                placeholder="Describe your issue or question..."
                className="min-h-[150px] resize-none"
                maxLength={1000}
                required
              />
              <p className="text-xs text-muted-foreground text-right">
                {form.message.length}/1000 characters
              </p>
            </div>
            {!isOnline && (
              <p className="text-sm text-orange-500">
                You're offline. Connect to the internet to send your message.
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !isOnline}
            >
              {loading ? (
                <>Sending...</>
              ) : (
                <>
                  Send Message <Send className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
