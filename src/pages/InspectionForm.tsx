import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Save, CheckCircle, FileDown } from "lucide-react";
import { toast } from "sonner";
import ResultSelect from "@/components/ResultSelect";
import PhotoCapture from "@/components/PhotoCapture";
import { Checkbox } from "@/components/ui/checkbox";

export default function InspectionForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inspection, setInspection] = useState<any>(null);
  const [systems, setSystems] = useState<any[]>([]);
  const [equipment, setEquipment] = useState<any[]>([]);
  const [standards, setStandards] = useState<any[]>([
    { standard_name: "Local Written Operations Procedures", has_documentation: false },
    { standard_name: "Local Written Emergency Action Plan", has_documentation: false },
    { standard_name: "Minimum Annual Training", has_documentation: false },
    { standard_name: "Written Pre-Use Inspection in Use", has_documentation: false },
    { standard_name: "Inventory Tracking System in Use", has_documentation: false },
    { standard_name: "Operational Review Every 5 Years", has_documentation: false },
  ]);
  const [summary, setSummary] = useState({
    repairs_performed: "",
    critical_actions: "",
    future_considerations: "",
    next_inspection_date: "",
  });

  useEffect(() => {
    loadInspection();
  }, [id]);

  const loadInspection = async () => {
    try {
      const { data, error } = await supabase
        .from("inspections")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      setInspection(data);

      // Load related data
      const { data: systemsData } = await supabase
        .from("inspection_systems")
        .select("*")
        .eq("inspection_id", id);
      if (systemsData) setSystems(systemsData);

      const { data: equipmentData } = await supabase
        .from("inspection_equipment")
        .select("*")
        .eq("inspection_id", id);
      if (equipmentData) setEquipment(equipmentData);

      const { data: standardsData } = await supabase
        .from("inspection_standards")
        .select("*")
        .eq("inspection_id", id);
      if (standardsData && standardsData.length > 0) {
        setStandards(standardsData);
      }

      const { data: summaryData } = await supabase
        .from("inspection_summary")
        .select("*")
        .eq("inspection_id", id)
        .single();
      if (summaryData) setSummary(summaryData);
    } catch (error: any) {
      console.error("Error loading inspection:", error);
      toast.error("Failed to load inspection");
    } finally {
      setLoading(false);
    }
  };

  const saveProgress = async () => {
    setSaving(true);
    try {
      // Save systems
      for (const system of systems) {
        if (system.id) {
          await supabase
            .from("inspection_systems")
            .update(system)
            .eq("id", system.id);
        } else {
          await supabase
            .from("inspection_systems")
            .insert({ ...system, inspection_id: id });
        }
      }

      // Save equipment
      for (const item of equipment) {
        if (item.id) {
          await supabase
            .from("inspection_equipment")
            .update(item)
            .eq("id", item.id);
        } else {
          await supabase
            .from("inspection_equipment")
            .insert({ ...item, inspection_id: id });
        }
      }

      // Save standards
      await supabase.from("inspection_standards").delete().eq("inspection_id", id);
      await supabase.from("inspection_standards").insert(
        standards.map((s) => ({ ...s, inspection_id: id }))
      );

      // Save or update summary
      const { data: existingSummary } = await supabase
        .from("inspection_summary")
        .select("id")
        .eq("inspection_id", id)
        .single();

      if (existingSummary) {
        await supabase
          .from("inspection_summary")
          .update(summary)
          .eq("inspection_id", id);
      } else {
        await supabase
          .from("inspection_summary")
          .insert({ ...summary, inspection_id: id });
      }

      toast.success("Progress saved");
    } catch (error: any) {
      console.error("Save error:", error);
      toast.error("Failed to save progress");
    } finally {
      setSaving(false);
    }
  };

  const completeInspection = async () => {
    await saveProgress();
    try {
      const { error } = await supabase
        .from("inspections")
        .update({ status: "completed" })
        .eq("id", id);

      if (error) throw error;
      toast.success("Inspection completed!");
      navigate("/dashboard");
    } catch (error: any) {
      toast.error("Failed to complete inspection");
    }
  };

  const addSystem = () => {
    setSystems([...systems, { system_name: "", result: "Pass", comments: "" }]);
  };

  const addEquipment = (category: string) => {
    setEquipment([
      ...equipment,
      { equipment_category: category, equipment_type: "", production_year: null, quantity: null, result: "Pass", comments: "" },
    ]);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>Loading inspection...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={saveProgress} disabled={saving}>
              <Save className="w-4 h-4 mr-2" />
              {saving ? "Saving..." : "Save Progress"}
            </Button>
            <Button onClick={completeInspection}>
              <CheckCircle className="w-4 h-4 mr-2" />
              Complete
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Inspection Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Organization</Label>
                <p className="font-medium">{inspection?.organization}</p>
              </div>
              <div>
                <Label>Location</Label>
                <p className="font-medium">{inspection?.location}</p>
              </div>
              <div>
                <Label>Inspection Date</Label>
                <p className="font-medium">
                  {new Date(inspection?.inspection_date).toLocaleDateString()}
                </p>
              </div>
              <div>
                <Label>Status</Label>
                <p className="font-medium capitalize">{inspection?.status}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="systems" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="systems">Operating Systems</TabsTrigger>
            <TabsTrigger value="equipment">Equipment</TabsTrigger>
            <TabsTrigger value="standards">Standards</TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
          </TabsList>

          <TabsContent value="systems" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Operating Systems</CardTitle>
                  <Button onClick={addSystem}>Add System</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {systems.map((system, index) => (
                  <Card key={index}>
                    <CardContent className="pt-6 space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>System Name</Label>
                          <Input
                            value={system.system_name}
                            onChange={(e) => {
                              const updated = [...systems];
                              updated[index].system_name = e.target.value;
                              setSystems(updated);
                            }}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Result</Label>
                          <ResultSelect
                            value={system.result}
                            onChange={(value) => {
                              const updated = [...systems];
                              updated[index].result = value;
                              setSystems(updated);
                            }}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Comments</Label>
                        <Textarea
                          value={system.comments || ""}
                          onChange={(e) => {
                            const updated = [...systems];
                            updated[index].comments = e.target.value;
                            setSystems(updated);
                          }}
                        />
                      </div>
                      <PhotoCapture
                        inspectionId={id!}
                        section={`system-${index}`}
                        onPhotoAdded={loadInspection}
                      />
                    </CardContent>
                  </Card>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="equipment" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Equipment Inspection</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {["harnesses", "helmets", "lanyards", "connectors", "rope", "belay", "trolleys", "other"].map((category) => (
                  <div key={category} className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold capitalize">{category}</h3>
                      <Button size="sm" onClick={() => addEquipment(category)}>Add {category}</Button>
                    </div>
                    {equipment
                      .filter((item) => item.equipment_category === category)
                      .map((item, index) => (
                        <Card key={index}>
                          <CardContent className="pt-6 space-y-4">
                            <div className="grid grid-cols-4 gap-4">
                              <div className="space-y-2">
                                <Label>Type</Label>
                                <Input
                                  value={item.equipment_type}
                                  onChange={(e) => {
                                    const updated = [...equipment];
                                    const idx = equipment.indexOf(item);
                                    updated[idx].equipment_type = e.target.value;
                                    setEquipment(updated);
                                  }}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Year</Label>
                                <Input
                                  type="number"
                                  value={item.production_year || ""}
                                  onChange={(e) => {
                                    const updated = [...equipment];
                                    const idx = equipment.indexOf(item);
                                    updated[idx].production_year = parseInt(e.target.value) || null;
                                    setEquipment(updated);
                                  }}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Quantity</Label>
                                <Input
                                  type="number"
                                  value={item.quantity || ""}
                                  onChange={(e) => {
                                    const updated = [...equipment];
                                    const idx = equipment.indexOf(item);
                                    updated[idx].quantity = parseInt(e.target.value) || null;
                                    setEquipment(updated);
                                  }}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Result</Label>
                                <ResultSelect
                                  value={item.result}
                                  onChange={(value) => {
                                    const updated = [...equipment];
                                    const idx = equipment.indexOf(item);
                                    updated[idx].result = value;
                                    setEquipment(updated);
                                  }}
                                  includeNA
                                />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label>Comments</Label>
                              <Textarea
                                value={item.comments || ""}
                                onChange={(e) => {
                                  const updated = [...equipment];
                                  const idx = equipment.indexOf(item);
                                  updated[idx].comments = e.target.value;
                                  setEquipment(updated);
                                }}
                              />
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="standards" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>ACCT Operations Standards Criteria</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {standards.map((standard, index) => (
                  <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-4">
                      <Checkbox
                        checked={standard.has_documentation}
                        onCheckedChange={(checked) => {
                          const updated = [...standards];
                          updated[index].has_documentation = checked as boolean;
                          setStandards(updated);
                        }}
                      />
                      <Label className="text-base">{standard.standard_name}</Label>
                    </div>
                    <span className="text-sm font-medium">
                      {standard.has_documentation ? "YES" : "NO"}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="summary" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Report Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Repairs & Alterations Performed During Inspection</Label>
                  <Textarea
                    rows={4}
                    value={summary.repairs_performed}
                    onChange={(e) => setSummary({ ...summary, repairs_performed: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Critical Actions Required</Label>
                  <Textarea
                    rows={4}
                    value={summary.critical_actions}
                    onChange={(e) => setSummary({ ...summary, critical_actions: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Future Considerations</Label>
                  <Textarea
                    rows={4}
                    value={summary.future_considerations}
                    onChange={(e) => setSummary({ ...summary, future_considerations: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Next Inspection Date</Label>
                  <Input
                    type="date"
                    value={summary.next_inspection_date}
                    onChange={(e) => setSummary({ ...summary, next_inspection_date: e.target.value })}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
