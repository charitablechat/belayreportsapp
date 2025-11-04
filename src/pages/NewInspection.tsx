import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, MapPin, Camera } from "lucide-react";
import { toast } from "sonner";
import ropeWorksLogo from "@/assets/rope-works-logo.png";

export default function NewInspection() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    organization: "",
    location: "",
    onsite_contact: "",
    previous_inspector: "",
    previous_inspection_date: "",
    course_history: "",
  });

  const getCurrentLocation = () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          toast.success("Location captured successfully");
        },
        (error) => {
          toast.error("Failed to get location: " + error.message);
        }
      );
    } else {
      toast.error("Geolocation is not supported");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("inspections")
        .insert({
          ...formData,
          inspector_id: user.id,
          status: "draft",
        })
        .select()
        .single();

      if (error) throw error;

      toast.success("Inspection created successfully");
      navigate(`/inspection/${data.id}`);
    } catch (error: any) {
      console.error("Error creating inspection:", error);
      toast.error(error.message || "Failed to create inspection");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
          <img src={ropeWorksLogo} alt="Rope Works" className="h-10 w-auto object-contain" />
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">New Inspection Report</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="organization">Organization *</Label>
                <Input
                  id="organization"
                  value={formData.organization}
                  onChange={(e) => setFormData({ ...formData, organization: e.target.value })}
                  required
                  placeholder="Enter organization name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="location">Location *</Label>
                <div className="flex gap-2">
                  <Input
                    id="location"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    required
                    placeholder="Enter location"
                    className="flex-1"
                  />
                  <Button type="button" variant="outline" onClick={getCurrentLocation}>
                    <MapPin className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="onsite_contact">Onsite Contact</Label>
                <Input
                  id="onsite_contact"
                  value={formData.onsite_contact}
                  onChange={(e) => setFormData({ ...formData, onsite_contact: e.target.value })}
                  placeholder="Enter contact name"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="previous_inspector">Previous Inspector</Label>
                  <Input
                    id="previous_inspector"
                    value={formData.previous_inspector}
                    onChange={(e) => setFormData({ ...formData, previous_inspector: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="previous_inspection_date">Previous Inspection Date</Label>
                  <Input
                    id="previous_inspection_date"
                    type="date"
                    value={formData.previous_inspection_date}
                    onChange={(e) => setFormData({ ...formData, previous_inspection_date: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="course_history">Known Course History</Label>
                <Textarea
                  id="course_history"
                  value={formData.course_history}
                  onChange={(e) => setFormData({ ...formData, course_history: e.target.value })}
                  rows={4}
                  placeholder="Enter any known history about this course..."
                />
              </div>

              <div className="flex gap-4">
                <Button type="submit" disabled={loading} className="flex-1">
                  {loading ? "Creating..." : "Create Inspection"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate("/dashboard")}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
