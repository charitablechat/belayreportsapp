import { useState } from "react";
import { useFormConfiguration, useFormManagement } from "@/hooks/useFormConfiguration";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Settings, 
  Languages, 
  Eye, 
  Save, 
  Plus, 
  Trash2,
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
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { DraggableSection } from "./DraggableSection";
import { DraggableField } from "./DraggableField";
import { DraggableOption } from "./DraggableOption";

export const FormCMSManager = () => {
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [selectedFormType, setSelectedFormType] = useState<'inspection' | 'daily_assessment' | 'training'>('inspection');
  const [editingField, setEditingField] = useState<string | null>(null);
  const { formConfig, isLoading } = useFormConfiguration(selectedLanguage, selectedFormType);
  const { 
    updateField, 
    updateTranslation, 
    createFieldOption, 
    deleteFieldOption,
    reorderSections,
    reorderFields,
    reorderOptions
  } = useFormManagement();

  const [newOptionDialog, setNewOptionDialog] = useState<{ open: boolean; fieldId: string | null }>({
    open: false,
    fieldId: null
  });
  const [newOptionKey, setNewOptionKey] = useState('');
  const [newOptionLabel, setNewOptionLabel] = useState('');
  const [localSections, setLocalSections] = useState(formConfig || []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Update local state when formConfig changes
  if (formConfig && formConfig !== localSections) {
    setLocalSections(formConfig);
  }

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

  const handleSectionDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = localSections.findIndex(s => s.id === active.id);
      const newIndex = localSections.findIndex(s => s.id === over.id);

      const newSections = arrayMove(localSections, oldIndex, newIndex);
      setLocalSections(newSections);

      // Update display_order in database
      const updates = newSections.map((section, index) => ({
        id: section.id,
        display_order: index
      }));
      reorderSections.mutate(updates);
    }
  };

  const handleFieldDragEnd = (sectionId: string) => (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const section = localSections.find(s => s.id === sectionId);
      if (!section || !section.fields) return;

      const oldIndex = section.fields.findIndex(f => f.id === active.id);
      const newIndex = section.fields.findIndex(f => f.id === over.id);

      const newFields = arrayMove(section.fields, oldIndex, newIndex);
      
      setLocalSections(prev =>
        prev.map(s =>
          s.id === sectionId ? { ...s, fields: newFields } : s
        )
      );

      // Update display_order in database
      const updates = newFields.map((field, index) => ({
        id: field.id,
        display_order: index
      }));
      reorderFields.mutate(updates);
    }
  };

  const handleOptionDragEnd = (fieldId: string) => (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      let targetField = null;
      let targetSection = null;

      for (const section of localSections) {
        const field = section.fields?.find(f => f.id === fieldId);
        if (field) {
          targetField = field;
          targetSection = section;
          break;
        }
      }

      if (!targetField || !targetField.options || targetField.options.length === 0) return;

      const oldIndex = targetField.options.findIndex(o => o.id === active.id);
      const newIndex = targetField.options.findIndex(o => o.id === over.id);

      if (oldIndex === -1 || newIndex === -1) return;

      const newOptions = arrayMove([...targetField.options], oldIndex, newIndex);

      setLocalSections(prev =>
        prev.map(s =>
          s.id === targetSection?.id
            ? {
                ...s,
                fields: s.fields?.map(f =>
                  f.id === fieldId ? { ...f, options: newOptions } : f
                )
              }
            : s
        )
      );

      // Update display_order in database
      const updates = newOptions.map((option, index) => ({
        id: option.id,
        display_order: index
      }));
      reorderOptions.mutate(updates);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Form CMS</h2>
          <p className="text-muted-foreground">
            Manage form fields, options, and translations for all form types
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={selectedFormType} onValueChange={(value: any) => setSelectedFormType(value)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inspection">Inspection Forms</SelectItem>
              <SelectItem value="daily_assessment">Daily Assessments</SelectItem>
              <SelectItem value="training">Training Reports</SelectItem>
            </SelectContent>
          </Select>
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
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleSectionDragEnd}
            >
              <SortableContext
                items={localSections.map(s => s.id)}
                strategy={verticalListSortingStrategy}
              >
                {localSections.map((section) => (
                  <DraggableSection key={section.id} section={section}>
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleFieldDragEnd(section.id)}
                    >
                      <SortableContext
                        items={section.fields?.map(f => f.id) || []}
                        strategy={verticalListSortingStrategy}
                      >
                        {section.fields?.map((field) => (
                          <DraggableField key={field.id} id={field.id}>
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
                                <DndContext
                                  sensors={sensors}
                                  collisionDetection={closestCenter}
                                  onDragEnd={handleOptionDragEnd(field.id)}
                                >
                                  <SortableContext
                                    items={field.options?.map(o => o.id) || []}
                                    strategy={verticalListSortingStrategy}
                                  >
                                    <div className="space-y-1">
                                      {field.options?.map((option) => (
                                        <DraggableOption
                                          key={option.id}
                                          id={option.id}
                                          label={option.label || option.option_key}
                                          onDelete={() => handleDeleteOption(option.id)}
                                        />
                                      ))}
                                    </div>
                                  </SortableContext>
                                </DndContext>
                              </div>
                            )}
                          </DraggableField>
                        ))}
                      </SortableContext>
                    </DndContext>
                  </DraggableSection>
                ))}
              </SortableContext>
            </DndContext>
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
