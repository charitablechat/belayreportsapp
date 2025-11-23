import { useState } from "react";
import { useFormConfiguration, useFormManagement } from "@/hooks/useFormConfiguration";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Settings, 
  Languages, 
  Eye, 
  Save, 
  Plus, 
  Trash2,
  GripVertical,
  AlertCircle
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const FormCMSManager = () => {
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [editingField, setEditingField] = useState<string | null>(null);
  const { formConfig, isLoading } = useFormConfiguration(selectedLanguage);
  const { updateField, updateTranslation, createFieldOption, deleteFieldOption } = useFormManagement();

  const [newOptionDialog, setNewOptionDialog] = useState<{ open: boolean; fieldId: string | null }>({
    open: false,
    fieldId: null
  });
  const [newOptionKey, setNewOptionKey] = useState('');
  const [newOptionLabel, setNewOptionLabel] = useState('');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading form configuration...</div>
      </div>
    );
  }

  const handleSaveFieldLabel = async (fieldId: string, sectionId: string, newLabel: string) => {
    await updateTranslation.mutateAsync({
      entityType: 'field',
      entityId: fieldId,
      languageCode: selectedLanguage,
      translationKey: 'label',
      translationValue: newLabel
    });
    setEditingField(null);
  };

  const handleToggleRequired = async (fieldId: string, currentValue: boolean) => {
    await updateField.mutateAsync({
      fieldId,
      updates: { is_required: !currentValue }
    });
  };

  const handleAddOption = async () => {
    if (!newOptionDialog.fieldId || !newOptionKey || !newOptionLabel) return;
    
    await createFieldOption.mutateAsync({
      fieldId: newOptionDialog.fieldId,
      optionKey: newOptionKey,
      label: newOptionLabel
    });

    setNewOptionDialog({ open: false, fieldId: null });
    setNewOptionKey('');
    setNewOptionLabel('');
  };

  const handleDeleteOption = async (optionId: string) => {
    if (confirm('Are you sure you want to delete this option?')) {
      await deleteFieldOption.mutateAsync(optionId);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Form CMS</h2>
          <p className="text-muted-foreground">
            Manage inspection form fields, options, and translations
          </p>
        </div>
        <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
          <SelectTrigger className="w-[180px]">
            <Languages className="w-4 h-4 mr-2" />
            <SelectValue placeholder="Language" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="es">Español</SelectItem>
            <SelectItem value="fr">Français</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Changes made here will affect all future inspections. Existing inspections will not be modified.
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="fields" className="space-y-4">
        <TabsList>
          <TabsTrigger value="fields">
            <Settings className="w-4 h-4 mr-2" />
            Fields & Options
          </TabsTrigger>
          <TabsTrigger value="translations">
            <Languages className="w-4 h-4 mr-2" />
            Translations
          </TabsTrigger>
          <TabsTrigger value="preview">
            <Eye className="w-4 h-4 mr-2" />
            Preview
          </TabsTrigger>
        </TabsList>

        <TabsContent value="fields" className="space-y-4">
          <ScrollArea className="h-[600px]">
            {formConfig?.map((section) => (
              <Card key={section.id} className="mb-4">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <GripVertical className="w-4 h-4 text-muted-foreground" />
                    {section.label}
                  </CardTitle>
                  <CardDescription>
                    Section Key: {section.section_key}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {section.fields?.map((field) => (
                    <div key={field.id} className="p-4 border rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1 flex-1">
                          {editingField === field.id ? (
                            <div className="flex items-center gap-2">
                              <Input
                                defaultValue={field.label}
                                onBlur={(e) => handleSaveFieldLabel(field.id, section.id, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    handleSaveFieldLabel(field.id, section.id, e.currentTarget.value);
                                  }
                                }}
                                autoFocus
                              />
                              <Button 
                                size="sm" 
                                onClick={() => setEditingField(null)}
                              >
                                <Save className="w-4 h-4" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Label className="text-base font-semibold cursor-pointer" onClick={() => setEditingField(field.id)}>
                                {field.label}
                              </Label>
                              <Badge variant="outline">{field.field_type}</Badge>
                              {field.is_required && <Badge variant="secondary">Required</Badge>}
                            </div>
                          )}
                          <p className="text-sm text-muted-foreground">
                            Field Key: {field.field_key}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={field.is_required}
                            onCheckedChange={() => handleToggleRequired(field.id, field.is_required)}
                          />
                          <Label className="text-sm">Required</Label>
                        </div>
                      </div>

                      {(field.field_type === 'select' || field.field_type === 'radio') && (
                        <div className="space-y-2 pl-4 border-l-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm font-medium">Options:</Label>
                            <Dialog 
                              open={newOptionDialog.open && newOptionDialog.fieldId === field.id}
                              onOpenChange={(open) => setNewOptionDialog({ open, fieldId: open ? field.id : null })}
                            >
                              <DialogTrigger asChild>
                                <Button size="sm" variant="outline">
                                  <Plus className="w-4 h-4 mr-1" />
                                  Add Option
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Add New Option</DialogTitle>
                                  <DialogDescription>
                                    Create a new option for this field
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4">
                                  <div>
                                    <Label>Option Key (internal)</Label>
                                    <Input
                                      value={newOptionKey}
                                      onChange={(e) => setNewOptionKey(e.target.value)}
                                      placeholder="e.g., excellent"
                                    />
                                  </div>
                                  <div>
                                    <Label>Display Label</Label>
                                    <Input
                                      value={newOptionLabel}
                                      onChange={(e) => setNewOptionLabel(e.target.value)}
                                      placeholder="e.g., Excellent"
                                    />
                                  </div>
                                  <Button onClick={handleAddOption} className="w-full">
                                    Add Option
                                  </Button>
                                </div>
                              </DialogContent>
                            </Dialog>
                          </div>
                          <div className="space-y-1">
                            {field.options?.map((option) => (
                              <div key={option.id} className="flex items-center justify-between p-2 bg-muted rounded">
                                <span className="text-sm">{option.label}</span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleDeleteOption(option.id)}
                                >
                                  <Trash2 className="w-4 h-4 text-destructive" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="translations" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Translation Management</CardTitle>
              <CardDescription>
                Edit translations for the selected language: {selectedLanguage}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  To edit translations, click on any field label in the "Fields & Options" tab while the desired language is selected.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Form Preview</CardTitle>
              <CardDescription>
                Preview how the form will look with current configuration
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Form preview will be displayed here. Navigate to the inspection form to see live changes.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
