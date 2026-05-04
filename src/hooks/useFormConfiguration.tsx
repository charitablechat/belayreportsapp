import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface FormField {
  id: string;
  section_id: string;
  field_key: string;
  field_type: string;
  display_order: number;
  is_required: boolean;
  is_active: boolean;
  validation_rules?: any;
  metadata?: any;
  label?: string;
  placeholder?: string;
  help_text?: string;
  options?: FormFieldOption[];
}

export interface FormFieldOption {
  id: string;
  field_id: string;
  option_key: string;
  display_order: number;
  is_active: boolean;
  label?: string;
}

export interface FormSection {
  id: string;
  section_key: string;
  display_order: number;
  is_active: boolean;
  label?: string;
  fields?: FormField[];
}

export const useFormConfiguration = (languageCode: string = 'en', formType: 'inspection' | 'daily_assessment' | 'training' = 'inspection') => {
  const queryClient = useQueryClient();

  const { data: formConfig, isLoading, error } = useQuery({
    queryKey: ['form-configuration', languageCode, formType],
    queryFn: async () => {
      // Fetch sections filtered by form type
      const { data: sections, error: sectionsError } = await supabase
        .from('form_sections')
        .select('*')
        .eq('is_active', true)
        .eq('form_type', formType)
        .order('display_order');

      if (sectionsError) throw sectionsError;

      // Fetch fields
      const { data: fields, error: fieldsError } = await supabase
        .from('form_fields')
        .select('*')
        .eq('is_active', true)
        .order('display_order');

      if (fieldsError) throw fieldsError;

      // Fetch options
      const { data: options, error: optionsError } = await supabase
        .from('form_field_options')
        .select('*')
        .eq('is_active', true)
        .order('display_order');

      if (optionsError) throw optionsError;

      // Fetch translations
      const { data: translations, error: translationsError } = await supabase
        .from('form_translations')
        .select('*')
        .eq('language_code', languageCode);

      if (translationsError) throw translationsError;

      // Build translation map
      const translationMap = new Map<string, Map<string, string>>();
      translations?.forEach((t: any) => {
        const key = `${t.entity_type}_${t.entity_id}`;
        if (!translationMap.has(key)) {
          translationMap.set(key, new Map());
        }
        translationMap.get(key)?.set(t.translation_key, t.translation_value);
      });

      // Build options map
      const optionsMap = new Map<string, FormFieldOption[]>();
      options?.forEach((opt: any) => {
        if (!optionsMap.has(opt.field_id)) {
          optionsMap.set(opt.field_id, []);
        }
        const translations = translationMap.get(`option_${opt.id}`);
        optionsMap.get(opt.field_id)?.push({
          ...opt,
          label: translations?.get('label') || opt.option_key
        });
      });

      // Build fields map
      const fieldsMap = new Map<string, FormField[]>();
      fields?.forEach((field: any) => {
        if (!fieldsMap.has(field.section_id)) {
          fieldsMap.set(field.section_id, []);
        }
        const translations = translationMap.get(`field_${field.id}`);
        fieldsMap.get(field.section_id)?.push({
          ...field,
          label: translations?.get('label') || field.field_key,
          placeholder: translations?.get('placeholder'),
          help_text: translations?.get('help_text'),
          options: optionsMap.get(field.id) || []
        });
      });

      // Build final structure
      const formSections: FormSection[] = sections?.map((section: any) => {
        const translations = translationMap.get(`section_${section.id}`);
        return {
          ...section,
          label: translations?.get('label') || section.section_key,
          fields: fieldsMap.get(section.id) || []
        };
      }) || [];

      return formSections;
    }
  });

  return {
    formConfig,
    isLoading,
    error
  };
};

export const useFormManagement = () => {
  const queryClient = useQueryClient();

  const updateField = useMutation({
    mutationFn: async ({ fieldId, updates }: { fieldId: string; updates: Partial<FormField> }) => {
      const { error } = await supabase
        .from('form_fields')
        .update(updates as never)
        .eq('id', fieldId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-configuration'] });
    },
    onError: (error) => {
      console.error('Error updating field:', error);
    }
  });

  const updateTranslation = useMutation({
    mutationFn: async ({ 
      entityType, 
      entityId, 
      languageCode, 
      translationKey, 
      translationValue 
    }: { 
      entityType: string; 
      entityId: string; 
      languageCode: string; 
      translationKey: string; 
      translationValue: string; 
    }) => {
      const { error } = await supabase
        .from('form_translations')
        .upsert({
          entity_type: entityType,
          entity_id: entityId,
          language_code: languageCode,
          translation_key: translationKey,
          translation_value: translationValue
        }, {
          onConflict: 'entity_type,entity_id,language_code,translation_key'
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-configuration'] });
    },
    onError: (error) => {
      console.error('Error updating translation:', error);
    }
  });

  const createFieldOption = useMutation({
    mutationFn: async ({ fieldId, optionKey, label }: { fieldId: string; optionKey: string; label: string }) => {
      // Create option
      const { data: option, error: optionError } = await supabase
        .from('form_field_options')
        .insert({
          field_id: fieldId,
          option_key: optionKey,
          display_order: 999 // Will be sorted later
        })
        .select()
        .single();

      if (optionError) throw optionError;

      // Create translation
      const { error: translationError } = await supabase
        .from('form_translations')
        .insert({
          entity_type: 'option',
          entity_id: option.id,
          language_code: 'en',
          translation_key: 'label',
          translation_value: label
        });

      if (translationError) throw translationError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-configuration'] });
    },
    onError: (error) => {
      console.error('Error adding option:', error);
    }
  });

  const deleteFieldOption = useMutation({
    mutationFn: async (optionId: string) => {
      const { error } = await supabase
        .from('form_field_options')
        .delete()
        .eq('id', optionId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-configuration'] });
    },
    onError: (error) => {
      console.error('Error deleting option:', error);
    }
  });

  const reorderSections = useMutation({
    mutationFn: async (sections: { id: string; display_order: number }[]) => {
      const updates = sections.map(section => 
        supabase
          .from('form_sections')
          .update({ display_order: section.display_order })
          .eq('id', section.id)
      );

      const results = await Promise.all(updates);
      const errors = results.filter(r => r.error);
      if (errors.length > 0) throw errors[0].error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-configuration'] });
    },
    onError: (error) => {
      console.error('Error reordering sections:', error);
    }
  });

  const reorderFields = useMutation({
    mutationFn: async (fields: { id: string; display_order: number }[]) => {
      const updates = fields.map(field => 
        supabase
          .from('form_fields')
          .update({ display_order: field.display_order })
          .eq('id', field.id)
      );

      const results = await Promise.all(updates);
      const errors = results.filter(r => r.error);
      if (errors.length > 0) throw errors[0].error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-configuration'] });
    },
    onError: (error) => {
      console.error('Error reordering fields:', error);
    }
  });

  const reorderOptions = useMutation({
    mutationFn: async (options: { id: string; display_order: number }[]) => {
      const updates = options.map(option => 
        supabase
          .from('form_field_options')
          .update({ display_order: option.display_order })
          .eq('id', option.id)
      );

      const results = await Promise.all(updates);
      const errors = results.filter(r => r.error);
      if (errors.length > 0) throw errors[0].error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-configuration'] });
    },
    onError: (error) => {
      console.error('Error reordering options:', error);
    }
  });

  return {
    updateField,
    updateTranslation,
    createFieldOption,
    deleteFieldOption,
    reorderSections,
    reorderFields,
    reorderOptions
  };
};
