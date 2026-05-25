import { useState } from "react";
import { MessageCircle, Send, X, Upload, Image as ImageIcon } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { usePWA } from "@/hooks/usePWA";

interface ContactForm {
  subject: string;
  message: string;
  website: string; // Honeypot field - should always be empty
}

export default function ContactDeveloper() {
  const { isOnline } = usePWA();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<ContactForm>({
    subject: "",
    message: "",
    website: "", // Honeypot field
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      return;
    }

    setImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.subject || !form.message) {
      return;
    }

    if (form.message.length > 1000) {
      return;
    }

    if (!isOnline) {
      return;
    }

    setLoading(true);

    try {
      let attachmentPath: string | undefined;

      // Upload image if selected
      if (imageFile) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("You must be signed in to attach files.");
        const fileName = `${user.id}/${Date.now()}_${imageFile.name}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("contact-attachments")
          .upload(fileName, imageFile, {
            cacheControl: "3600",
            upsert: false,
          });

        if (uploadError) throw uploadError;
        attachmentPath = uploadData.path;
      }

      const { error } = await supabase.functions.invoke("send-contact-email", {
        body: {
          name: "Kale Dabling",
          email: "kale@myaisummit.dev",
          subject: form.subject,
          message: form.message,
          attachmentPath,
          attachmentName: imageFile?.name,
          attachmentType: imageFile?.type,
          website: form.website,
        },
      });

      if (error) throw error;

      toast.success("Message sent successfully!");
      setForm({ subject: "", message: "", website: "" });
      clearImage();
      setOpen(false);
    } catch (error: any) {
      console.error("Error sending message:", error);
      toast.error("Failed to send message. Please try again.");
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
              <Label htmlFor="name">Developer Name</Label>
              <Input
                id="name"
                value="Kale Dabling"
                disabled
                className="bg-muted cursor-not-allowed"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Developer Email</Label>
              <Input
                id="email"
                type="email"
                value="kale@myaisummit.dev"
                disabled
                className="bg-muted cursor-not-allowed"
              />
            </div>
            {/* Honeypot field - hidden from real users, bots will fill it */}
            <div className="absolute -left-[9999px]" aria-hidden="true">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                name="website"
                type="text"
                value={form.website}
                onChange={(e) => setForm(prev => ({ ...prev, website: e.target.value }))}
                tabIndex={-1}
                autoComplete="off"
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
            <div className="space-y-2">
              <Label htmlFor="image">Attach Image (Optional)</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => document.getElementById("image")?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {imageFile ? imageFile.name : "Choose Image"}
                </Button>
                <Input
                  id="image"
                  type="file"
                  accept="image/*,image/heic,image/heif,.heic,.heif"
                  onChange={handleImageSelect}
                  className="hidden"
                />
                {imageFile && (
                  <Button 
                    type="button" 
                    variant="ghost" 
                    size="icon"
                    onClick={clearImage}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {imagePreview && (
                <div className="relative mt-2 rounded border bg-muted p-2">
                  <ImageIcon className="h-4 w-4 absolute top-3 left-3 text-muted-foreground" />
                  <img 
                    src={imagePreview} 
                    alt="Preview" 
                    className="w-full h-auto max-h-48 object-contain rounded"
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Max file size: 5MB. Formats: JPG, PNG, GIF, WebP
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
