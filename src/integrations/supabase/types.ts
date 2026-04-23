export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      admin_edit_snapshots: {
        Row: {
          created_at: string
          edited_by: string
          id: string
          original_owner_id: string
          report_id: string
          report_type: string
          snapshot_data: Json
        }
        Insert: {
          created_at?: string
          edited_by: string
          id?: string
          original_owner_id: string
          report_id: string
          report_type: string
          snapshot_data: Json
        }
        Update: {
          created_at?: string
          edited_by?: string
          id?: string
          original_owner_id?: string
          report_id?: string
          report_type?: string
          snapshot_data?: Json
        }
        Relationships: []
      }
      admin_settings: {
        Row: {
          id: string
          key: string
          updated_at: string | null
          updated_by: string | null
          value: string
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string | null
          updated_by?: string | null
          value: string
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string | null
          updated_by?: string | null
          value?: string
        }
        Relationships: []
      }
      app_announcements: {
        Row: {
          announcement_type: string
          content: string
          id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          announcement_type?: string
          content?: string
          id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          announcement_type?: string
          content?: string
          id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      app_version_policy: {
        Row: {
          enforce_hard_reload: boolean
          id: number
          message: string | null
          min_required_version: string | null
          recommended_version: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enforce_hard_reload?: boolean
          id?: number
          message?: string | null
          min_required_version?: string | null
          recommended_version?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enforce_hard_reload?: boolean
          id?: number
          message?: string | null
          min_required_version?: string | null
          recommended_version?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action_type: string
          created_at: string
          id: string
          ip_address: unknown
          metadata: Json | null
          new_values: Json | null
          old_values: Json | null
          record_id: string | null
          table_name: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action_type: string
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action_type?: string
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      backup_history: {
        Row: {
          created_at: string
          created_by: string | null
          file_path: string
          file_size_bytes: number | null
          id: string
          table_counts: Json | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          file_path: string
          file_size_bytes?: number | null
          id?: string
          table_counts?: Json | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          file_path?: string
          file_size_bytes?: number | null
          id?: string
          table_counts?: Json | null
        }
        Relationships: []
      }
      daily_assessment_beginning_of_day: {
        Row: {
          assessment_id: string
          comments: string | null
          created_at: string | null
          id: string
          is_complete: boolean
          item_key: string
        }
        Insert: {
          assessment_id: string
          comments?: string | null
          created_at?: string | null
          id?: string
          is_complete?: boolean
          item_key: string
        }
        Update: {
          assessment_id?: string
          comments?: string | null
          created_at?: string | null
          id?: string
          is_complete?: boolean
          item_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_assessment_beginning_of_day_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "daily_assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_assessment_end_of_day: {
        Row: {
          assessment_id: string
          comments: string | null
          created_at: string | null
          id: string
          is_complete: boolean
          item_key: string
        }
        Insert: {
          assessment_id: string
          comments?: string | null
          created_at?: string | null
          id?: string
          is_complete?: boolean
          item_key: string
        }
        Update: {
          assessment_id?: string
          comments?: string | null
          created_at?: string | null
          id?: string
          is_complete?: boolean
          item_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_assessment_end_of_day_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "daily_assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_assessment_environment_checks: {
        Row: {
          assessment_id: string
          comments: string | null
          created_at: string | null
          id: string
          is_checked: boolean
          item_key: string
        }
        Insert: {
          assessment_id: string
          comments?: string | null
          created_at?: string | null
          id?: string
          is_checked?: boolean
          item_key: string
        }
        Update: {
          assessment_id?: string
          comments?: string | null
          created_at?: string | null
          id?: string
          is_checked?: boolean
          item_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_assessment_environment_checks_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "daily_assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_assessment_equipment_checks: {
        Row: {
          assessment_id: string
          comments: string | null
          created_at: string | null
          id: string
          is_checked: boolean
          item_key: string
        }
        Insert: {
          assessment_id: string
          comments?: string | null
          created_at?: string | null
          id?: string
          is_checked?: boolean
          item_key: string
        }
        Update: {
          assessment_id?: string
          comments?: string | null
          created_at?: string | null
          id?: string
          is_checked?: boolean
          item_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_assessment_equipment_checks_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "daily_assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_assessment_operating_systems: {
        Row: {
          assessment_id: string
          created_at: string | null
          id: string
          other_description: string | null
          system_name: string
        }
        Insert: {
          assessment_id: string
          created_at?: string | null
          id?: string
          other_description?: string | null
          system_name: string
        }
        Update: {
          assessment_id?: string
          created_at?: string | null
          id?: string
          other_description?: string | null
          system_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_assessment_operating_systems_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "daily_assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_assessment_photos: {
        Row: {
          assessment_id: string
          caption: string | null
          created_at: string | null
          deleted_at: string | null
          display_order: number | null
          id: string
          photo_section: string | null
          photo_url: string
          retention_until: string | null
        }
        Insert: {
          assessment_id: string
          caption?: string | null
          created_at?: string | null
          deleted_at?: string | null
          display_order?: number | null
          id?: string
          photo_section?: string | null
          photo_url: string
          retention_until?: string | null
        }
        Update: {
          assessment_id?: string
          caption?: string | null
          created_at?: string | null
          deleted_at?: string | null
          display_order?: number | null
          id?: string
          photo_section?: string | null
          photo_url?: string
          retention_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_assessment_photos_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "daily_assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_assessment_structure_checks: {
        Row: {
          assessment_id: string
          comments: string | null
          created_at: string | null
          id: string
          is_checked: boolean
          item_key: string
        }
        Insert: {
          assessment_id: string
          comments?: string | null
          created_at?: string | null
          id?: string
          is_checked?: boolean
          item_key: string
        }
        Update: {
          assessment_id?: string
          comments?: string | null
          created_at?: string | null
          id?: string
          is_checked?: boolean
          item_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_assessment_structure_checks_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "daily_assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_assessments: {
        Row: {
          active_duration_seconds: number | null
          app_version_at_completion: string | null
          assessment_date: string
          attestation_ip: string | null
          attestation_signed_at: string | null
          attestation_signer_id: string | null
          attestation_signer_name: string | null
          attestation_text: string | null
          attestation_user_agent: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          environment_comments: string | null
          field_timestamps: Json
          id: string
          inspector_id: string | null
          last_modified_by: string | null
          last_opened_at: string | null
          last_sync_source: string | null
          latest_report_generated_at: string | null
          latest_report_html: string | null
          latitude: number | null
          longitude: number | null
          organization: string
          organization_id: string | null
          report_version: number | null
          retention_until: string | null
          site: string
          status: string
          structure_comments: string | null
          synced_at: string | null
          systems_comments: string | null
          trainer_of_record: string | null
          updated_at: string
        }
        Insert: {
          active_duration_seconds?: number | null
          app_version_at_completion?: string | null
          assessment_date?: string
          attestation_ip?: string | null
          attestation_signed_at?: string | null
          attestation_signer_id?: string | null
          attestation_signer_name?: string | null
          attestation_text?: string | null
          attestation_user_agent?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          environment_comments?: string | null
          field_timestamps?: Json
          id?: string
          inspector_id?: string | null
          last_modified_by?: string | null
          last_opened_at?: string | null
          last_sync_source?: string | null
          latest_report_generated_at?: string | null
          latest_report_html?: string | null
          latitude?: number | null
          longitude?: number | null
          organization?: string
          organization_id?: string | null
          report_version?: number | null
          retention_until?: string | null
          site?: string
          status?: string
          structure_comments?: string | null
          synced_at?: string | null
          systems_comments?: string | null
          trainer_of_record?: string | null
          updated_at?: string
        }
        Update: {
          active_duration_seconds?: number | null
          app_version_at_completion?: string | null
          assessment_date?: string
          attestation_ip?: string | null
          attestation_signed_at?: string | null
          attestation_signer_id?: string | null
          attestation_signer_name?: string | null
          attestation_text?: string | null
          attestation_user_agent?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          environment_comments?: string | null
          field_timestamps?: Json
          id?: string
          inspector_id?: string | null
          last_modified_by?: string | null
          last_opened_at?: string | null
          last_sync_source?: string | null
          latest_report_generated_at?: string | null
          latest_report_html?: string | null
          latitude?: number | null
          longitude?: number | null
          organization?: string
          organization_id?: string | null
          report_version?: number | null
          retention_until?: string | null
          site?: string
          status?: string
          structure_comments?: string | null
          synced_at?: string | null
          systems_comments?: string | null
          trainer_of_record?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_assessments_inspector_id_profiles_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_assessments_inspector_id_profiles_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_assessments_last_modified_by_fkey"
            columns: ["last_modified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_assessments_last_modified_by_fkey"
            columns: ["last_modified_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_assessments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      equipment_type_options: {
        Row: {
          created_at: string
          created_by: string | null
          display_order: number
          equipment_category: string
          id: string
          is_active: boolean
          label: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          display_order?: number
          equipment_category: string
          id?: string
          is_active?: boolean
          label: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          display_order?: number
          equipment_category?: string
          id?: string
          is_active?: boolean
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
      form_field_options: {
        Row: {
          created_at: string | null
          display_order: number
          field_id: string
          id: string
          is_active: boolean
          metadata: Json | null
          option_key: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          display_order?: number
          field_id: string
          id?: string
          is_active?: boolean
          metadata?: Json | null
          option_key: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          display_order?: number
          field_id?: string
          id?: string
          is_active?: boolean
          metadata?: Json | null
          option_key?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_field_options_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "form_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      form_fields: {
        Row: {
          created_at: string | null
          display_order: number
          field_key: string
          field_type: string
          id: string
          is_active: boolean
          is_required: boolean
          metadata: Json | null
          section_id: string
          updated_at: string | null
          validation_rules: Json | null
        }
        Insert: {
          created_at?: string | null
          display_order?: number
          field_key: string
          field_type: string
          id?: string
          is_active?: boolean
          is_required?: boolean
          metadata?: Json | null
          section_id: string
          updated_at?: string | null
          validation_rules?: Json | null
        }
        Update: {
          created_at?: string | null
          display_order?: number
          field_key?: string
          field_type?: string
          id?: string
          is_active?: boolean
          is_required?: boolean
          metadata?: Json | null
          section_id?: string
          updated_at?: string | null
          validation_rules?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "form_fields_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "form_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      form_sections: {
        Row: {
          created_at: string | null
          display_order: number
          form_type: string
          id: string
          is_active: boolean
          section_key: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          display_order?: number
          form_type?: string
          id?: string
          is_active?: boolean
          section_key: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          display_order?: number
          form_type?: string
          id?: string
          is_active?: boolean
          section_key?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      form_translations: {
        Row: {
          created_at: string | null
          entity_id: string
          entity_type: string
          id: string
          language_code: string
          translation_key: string
          translation_value: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          entity_id: string
          entity_type: string
          id?: string
          language_code?: string
          translation_key: string
          translation_value: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          language_code?: string
          translation_key?: string
          translation_value?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      form_versions: {
        Row: {
          configuration: Json
          created_at: string | null
          created_by: string | null
          id: string
          notes: string | null
          version_number: number
        }
        Insert: {
          configuration: Json
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          version_number: number
        }
        Update: {
          configuration?: Json
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          version_number?: number
        }
        Relationships: []
      }
      global_field_history: {
        Row: {
          created_at: string | null
          field_type: string
          id: string
          last_used_at: string | null
          usage_count: number | null
          value: string
        }
        Insert: {
          created_at?: string | null
          field_type: string
          id?: string
          last_used_at?: string | null
          usage_count?: number | null
          value: string
        }
        Update: {
          created_at?: string | null
          field_type?: string
          id?: string
          last_used_at?: string | null
          usage_count?: number | null
          value?: string
        }
        Relationships: []
      }
      inspection_equipment: {
        Row: {
          comments: string | null
          created_at: string | null
          display_order: number
          divider_text: string | null
          equipment_category: string
          equipment_type: string
          id: string
          inspection_id: string
          is_divider: boolean
          photo_url: string | null
          production_year: string | null
          quantity: string | null
          result: string
          rope_type: string | null
        }
        Insert: {
          comments?: string | null
          created_at?: string | null
          display_order?: number
          divider_text?: string | null
          equipment_category: string
          equipment_type: string
          id?: string
          inspection_id: string
          is_divider?: boolean
          photo_url?: string | null
          production_year?: string | null
          quantity?: string | null
          result: string
          rope_type?: string | null
        }
        Update: {
          comments?: string | null
          created_at?: string | null
          display_order?: number
          divider_text?: string | null
          equipment_category?: string
          equipment_type?: string
          id?: string
          inspection_id?: string
          is_divider?: boolean
          photo_url?: string | null
          production_year?: string | null
          quantity?: string | null
          result?: string
          rope_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspection_equipment_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_photos: {
        Row: {
          caption: string | null
          created_at: string | null
          deleted_at: string | null
          display_order: number | null
          id: string
          inspection_id: string
          photo_section: string | null
          photo_url: string
          retention_until: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string | null
          deleted_at?: string | null
          display_order?: number | null
          id?: string
          inspection_id: string
          photo_section?: string | null
          photo_url: string
          retention_until?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string | null
          deleted_at?: string | null
          display_order?: number | null
          id?: string
          inspection_id?: string
          photo_section?: string | null
          photo_url?: string
          retention_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspection_photos_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_reports: {
        Row: {
          file_size_bytes: number | null
          generated_at: string | null
          generated_by: string | null
          id: string
          inspection_id: string
          metadata: Json | null
          pdf_url: string
          version: number | null
        }
        Insert: {
          file_size_bytes?: number | null
          generated_at?: string | null
          generated_by?: string | null
          id?: string
          inspection_id: string
          metadata?: Json | null
          pdf_url: string
          version?: number | null
        }
        Update: {
          file_size_bytes?: number | null
          generated_at?: string | null
          generated_by?: string | null
          id?: string
          inspection_id?: string
          metadata?: Json | null
          pdf_url?: string
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inspection_reports_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: true
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_standards: {
        Row: {
          comments: string | null
          created_at: string | null
          has_documentation: boolean | null
          id: string
          inspection_id: string
          standard_name: string
        }
        Insert: {
          comments?: string | null
          created_at?: string | null
          has_documentation?: boolean | null
          id?: string
          inspection_id: string
          standard_name: string
        }
        Update: {
          comments?: string | null
          created_at?: string | null
          has_documentation?: boolean | null
          id?: string
          inspection_id?: string
          standard_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_standards_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_summary: {
        Row: {
          created_at: string | null
          critical_actions: string | null
          future_considerations: string | null
          id: string
          inspection_id: string
          next_inspection_date: string | null
          repairs_performed: string | null
        }
        Insert: {
          created_at?: string | null
          critical_actions?: string | null
          future_considerations?: string | null
          id?: string
          inspection_id: string
          next_inspection_date?: string | null
          repairs_performed?: string | null
        }
        Update: {
          created_at?: string | null
          critical_actions?: string | null
          future_considerations?: string | null
          id?: string
          inspection_id?: string
          next_inspection_date?: string | null
          repairs_performed?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspection_summary_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: true
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_systems: {
        Row: {
          comments: string | null
          created_at: string | null
          display_order: number
          divider_text: string | null
          id: string
          inspection_id: string
          is_divider: boolean
          name: string | null
          photo_url: string | null
          result: string | null
          system_name: string | null
        }
        Insert: {
          comments?: string | null
          created_at?: string | null
          display_order?: number
          divider_text?: string | null
          id?: string
          inspection_id: string
          is_divider?: boolean
          name?: string | null
          photo_url?: string | null
          result?: string | null
          system_name?: string | null
        }
        Update: {
          comments?: string | null
          created_at?: string | null
          display_order?: number
          divider_text?: string | null
          id?: string
          inspection_id?: string
          is_divider?: boolean
          name?: string | null
          photo_url?: string | null
          result?: string | null
          system_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspection_systems_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_ziplines: {
        Row: {
          braking_result: string | null
          braking_system: string | null
          cable_length: number | null
          cable_result: string | null
          cable_type: string | null
          comments: string | null
          created_at: string | null
          display_order: number
          ead_result: string | null
          ead_system: string | null
          id: string
          inspection_id: string
          load_tension: number | null
          photo_url: string | null
          result: string
          unload_tension: number | null
          zipline_name: string
        }
        Insert: {
          braking_result?: string | null
          braking_system?: string | null
          cable_length?: number | null
          cable_result?: string | null
          cable_type?: string | null
          comments?: string | null
          created_at?: string | null
          display_order?: number
          ead_result?: string | null
          ead_system?: string | null
          id?: string
          inspection_id: string
          load_tension?: number | null
          photo_url?: string | null
          result: string
          unload_tension?: number | null
          zipline_name: string
        }
        Update: {
          braking_result?: string | null
          braking_system?: string | null
          cable_length?: number | null
          cable_result?: string | null
          cable_type?: string | null
          comments?: string | null
          created_at?: string | null
          display_order?: number
          ead_result?: string | null
          ead_system?: string | null
          id?: string
          inspection_id?: string
          load_tension?: number | null
          photo_url?: string | null
          result?: string
          unload_tension?: number | null
          zipline_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_ziplines_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspections: {
        Row: {
          acct_number: string | null
          active_duration_seconds: number | null
          app_version_at_completion: string | null
          attestation_ip: string | null
          attestation_signed_at: string | null
          attestation_signer_id: string | null
          attestation_signer_name: string | null
          attestation_text: string | null
          attestation_user_agent: string | null
          course_history: string | null
          created_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          field_timestamps: Json
          id: string
          inspection_date: string
          inspector_id: string | null
          last_modified_by: string | null
          last_opened_at: string | null
          last_sync_source: string | null
          latest_report_generated_at: string | null
          latest_report_html: string | null
          latitude: number | null
          location: string
          longitude: number | null
          onsite_contact: string | null
          organization: string
          organization_id: string | null
          previous_inspection_date: string | null
          previous_inspector: string | null
          report_version: number | null
          retention_until: string | null
          started_at: string | null
          status: string
          synced_at: string | null
          updated_at: string | null
        }
        Insert: {
          acct_number?: string | null
          active_duration_seconds?: number | null
          app_version_at_completion?: string | null
          attestation_ip?: string | null
          attestation_signed_at?: string | null
          attestation_signer_id?: string | null
          attestation_signer_name?: string | null
          attestation_text?: string | null
          attestation_user_agent?: string | null
          course_history?: string | null
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          field_timestamps?: Json
          id?: string
          inspection_date?: string
          inspector_id?: string | null
          last_modified_by?: string | null
          last_opened_at?: string | null
          last_sync_source?: string | null
          latest_report_generated_at?: string | null
          latest_report_html?: string | null
          latitude?: number | null
          location: string
          longitude?: number | null
          onsite_contact?: string | null
          organization: string
          organization_id?: string | null
          previous_inspection_date?: string | null
          previous_inspector?: string | null
          report_version?: number | null
          retention_until?: string | null
          started_at?: string | null
          status?: string
          synced_at?: string | null
          updated_at?: string | null
        }
        Update: {
          acct_number?: string | null
          active_duration_seconds?: number | null
          app_version_at_completion?: string | null
          attestation_ip?: string | null
          attestation_signed_at?: string | null
          attestation_signer_id?: string | null
          attestation_signer_name?: string | null
          attestation_text?: string | null
          attestation_user_agent?: string | null
          course_history?: string | null
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          field_timestamps?: Json
          id?: string
          inspection_date?: string
          inspector_id?: string | null
          last_modified_by?: string | null
          last_opened_at?: string | null
          last_sync_source?: string | null
          latest_report_generated_at?: string | null
          latest_report_html?: string | null
          latitude?: number | null
          location?: string
          longitude?: number | null
          onsite_contact?: string | null
          organization?: string
          organization_id?: string | null
          previous_inspection_date?: string | null
          previous_inspector?: string | null
          report_version?: number | null
          retention_until?: string | null
          started_at?: string | null
          status?: string
          synced_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspections_inspector_id_profiles_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_inspector_id_profiles_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_last_modified_by_fkey"
            columns: ["last_modified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_last_modified_by_fkey"
            columns: ["last_modified_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoiced_reports: {
        Row: {
          id: string
          invoiced_at: string
          invoiced_by: string | null
          report_id: string
          report_type: string
        }
        Insert: {
          id?: string
          invoiced_at?: string
          invoiced_by?: string | null
          report_id: string
          report_type: string
        }
        Update: {
          id?: string
          invoiced_at?: string
          invoiced_by?: string | null
          report_id?: string
          report_type?: string
        }
        Relationships: []
      }
      migration_audit: {
        Row: {
          backup_table_name: string | null
          completed_at: string | null
          error_message: string | null
          id: string
          metadata: Json | null
          migration_name: string
          performed_by: string | null
          records_after: number | null
          records_before: number | null
          started_at: string
          status: string
          table_affected: string
        }
        Insert: {
          backup_table_name?: string | null
          completed_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          migration_name: string
          performed_by?: string | null
          records_after?: number | null
          records_before?: number | null
          started_at?: string
          status: string
          table_affected: string
        }
        Update: {
          backup_table_name?: string | null
          completed_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          migration_name?: string
          performed_by?: string | null
          records_after?: number | null
          records_before?: number | null
          started_at?: string
          status?: string
          table_affected?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string | null
          email_inspection_completed: boolean | null
          email_notifications_enabled: boolean | null
          email_report_overdue: boolean | null
          email_sync_conflicts: boolean | null
          email_training_completed: boolean | null
          id: string
          inspection_completed: boolean | null
          report_overdue: boolean | null
          sync_conflicts: boolean | null
          training_completed: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email_inspection_completed?: boolean | null
          email_notifications_enabled?: boolean | null
          email_report_overdue?: boolean | null
          email_sync_conflicts?: boolean | null
          email_training_completed?: boolean | null
          id?: string
          inspection_completed?: boolean | null
          report_overdue?: boolean | null
          sync_conflicts?: boolean | null
          training_completed?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          email_inspection_completed?: boolean | null
          email_notifications_enabled?: boolean | null
          email_report_overdue?: boolean | null
          email_sync_conflicts?: boolean | null
          email_training_completed?: boolean | null
          id?: string
          inspection_completed?: boolean | null
          report_overdue?: boolean | null
          sync_conflicts?: boolean | null
          training_completed?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      notifications_log: {
        Row: {
          body: string
          data: Json | null
          id: string
          notification_type: string
          sent_at: string | null
          status: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          data?: Json | null
          id?: string
          notification_type: string
          sent_at?: string | null
          status?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          data?: Json | null
          id?: string
          notification_type?: string
          sent_at?: string | null
          status?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      onboarding_progress: {
        Row: {
          completed_at: string
          id: string
          resource_id: string
          user_id: string
        }
        Insert: {
          completed_at?: string
          id?: string
          resource_id: string
          user_id: string
        }
        Update: {
          completed_at?: string
          id?: string
          resource_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_progress_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "onboarding_resources"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_resources: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          file_type: string
          file_url: string
          id: string
          is_published: boolean
          title: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          file_type: string
          file_url: string
          id?: string
          is_published?: boolean
          title: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          file_type?: string
          file_url?: string
          id?: string
          is_published?: boolean
          title?: string
          uploaded_by?: string
        }
        Relationships: []
      }
      organization_members: {
        Row: {
          created_at: string | null
          id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          acct_number: string | null
          avatar_url: string | null
          created_at: string | null
          first_name: string | null
          id: string
          is_active: boolean
          last_name: string | null
          updated_at: string | null
        }
        Insert: {
          acct_number?: string | null
          avatar_url?: string | null
          created_at?: string | null
          first_name?: string | null
          id: string
          is_active?: boolean
          last_name?: string | null
          updated_at?: string | null
        }
        Update: {
          acct_number?: string | null
          avatar_url?: string | null
          created_at?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean
          last_name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string | null
          endpoint: string
          id: string
          last_used_at: string | null
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string | null
          endpoint: string
          id?: string
          last_used_at?: string | null
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string | null
          endpoint?: string
          id?: string
          last_used_at?: string | null
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      report_cloud_backups: {
        Row: {
          created_at: string
          device: string
          facility: string | null
          id: string
          report_id: string
          report_type: string
          snapshot_data: Json
          snapshot_ts: number
          synced: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          device?: string
          facility?: string | null
          id?: string
          report_id: string
          report_type: string
          snapshot_data: Json
          snapshot_ts: number
          synced?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          device?: string
          facility?: string | null
          id?: string
          report_id?: string
          report_type?: string
          snapshot_data?: Json
          snapshot_ts?: number
          synced?: boolean
          user_id?: string
        }
        Relationships: []
      }
      report_deleted_items: {
        Row: {
          child_table: string
          deleted_at: string
          deleted_by: string | null
          deleted_item_data: Json
          deleted_item_id: string
          id: string
          report_id: string
          report_type: string
          restored_at: string | null
          restored_by: string | null
        }
        Insert: {
          child_table: string
          deleted_at?: string
          deleted_by?: string | null
          deleted_item_data: Json
          deleted_item_id: string
          id?: string
          report_id: string
          report_type: string
          restored_at?: string | null
          restored_by?: string | null
        }
        Update: {
          child_table?: string
          deleted_at?: string
          deleted_by?: string | null
          deleted_item_data?: Json
          deleted_item_id?: string
          id?: string
          report_id?: string
          report_type?: string
          restored_at?: string | null
          restored_by?: string | null
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      sync_conflicts: {
        Row: {
          created_at: string | null
          id: string
          inspection_id: string
          local_updated_at: string
          organization_id: string
          remote_updated_at: string
          resolved: boolean | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          inspection_id: string
          local_updated_at: string
          organization_id: string
          remote_updated_at: string
          resolved?: boolean | null
        }
        Update: {
          created_at?: string | null
          id?: string
          inspection_id?: string
          local_updated_at?: string
          organization_id?: string
          remote_updated_at?: string
          resolved?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_conflicts_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      training_delivery_approaches: {
        Row: {
          approach: string
          created_at: string | null
          id: string
          training_id: string
        }
        Insert: {
          approach: string
          created_at?: string | null
          id?: string
          training_id: string
        }
        Update: {
          approach?: string
          created_at?: string | null
          id?: string
          training_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_delivery_approaches_training_id_fkey"
            columns: ["training_id"]
            isOneToOne: false
            referencedRelation: "trainings"
            referencedColumns: ["id"]
          },
        ]
      }
      training_immediate_attention: {
        Row: {
          created_at: string | null
          id: string
          item: string
          training_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          item: string
          training_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          item?: string
          training_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_immediate_attention_training_id_fkey"
            columns: ["training_id"]
            isOneToOne: false
            referencedRelation: "trainings"
            referencedColumns: ["id"]
          },
        ]
      }
      training_operating_systems: {
        Row: {
          created_at: string | null
          id: string
          other_description: string | null
          system_name: string
          training_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          other_description?: string | null
          system_name: string
          training_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          other_description?: string | null
          system_name?: string
          training_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_operating_systems_training_id_fkey"
            columns: ["training_id"]
            isOneToOne: false
            referencedRelation: "trainings"
            referencedColumns: ["id"]
          },
        ]
      }
      training_photos: {
        Row: {
          caption: string | null
          created_at: string | null
          deleted_at: string | null
          display_order: number | null
          id: string
          photo_section: string | null
          photo_url: string
          retention_until: string | null
          training_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string | null
          deleted_at?: string | null
          display_order?: number | null
          id?: string
          photo_section?: string | null
          photo_url: string
          retention_until?: string | null
          training_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string | null
          deleted_at?: string | null
          display_order?: number | null
          id?: string
          photo_section?: string | null
          photo_url?: string
          retention_until?: string | null
          training_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_photos_training_id_fkey"
            columns: ["training_id"]
            isOneToOne: false
            referencedRelation: "trainings"
            referencedColumns: ["id"]
          },
        ]
      }
      training_reports: {
        Row: {
          file_size_bytes: number | null
          generated_at: string | null
          generated_by: string | null
          id: string
          metadata: Json | null
          pdf_url: string
          training_id: string
          version: number | null
        }
        Insert: {
          file_size_bytes?: number | null
          generated_at?: string | null
          generated_by?: string | null
          id?: string
          metadata?: Json | null
          pdf_url: string
          training_id: string
          version?: number | null
        }
        Update: {
          file_size_bytes?: number | null
          generated_at?: string | null
          generated_by?: string | null
          id?: string
          metadata?: Json | null
          pdf_url?: string
          training_id?: string
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "training_reports_training_id_fkey"
            columns: ["training_id"]
            isOneToOne: true
            referencedRelation: "trainings"
            referencedColumns: ["id"]
          },
        ]
      }
      training_summary: {
        Row: {
          created_at: string | null
          id: string
          observations: string | null
          person_submitting: string | null
          recommendations: string | null
          submission_date: string | null
          training_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          observations?: string | null
          person_submitting?: string | null
          recommendations?: string | null
          submission_date?: string | null
          training_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          observations?: string | null
          person_submitting?: string | null
          recommendations?: string | null
          submission_date?: string | null
          training_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_summary_training_id_fkey"
            columns: ["training_id"]
            isOneToOne: false
            referencedRelation: "trainings"
            referencedColumns: ["id"]
          },
        ]
      }
      training_systems_in_place: {
        Row: {
          created_at: string | null
          id: string
          system_item: string
          training_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          system_item: string
          training_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          system_item?: string
          training_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_systems_in_place_training_id_fkey"
            columns: ["training_id"]
            isOneToOne: false
            referencedRelation: "trainings"
            referencedColumns: ["id"]
          },
        ]
      }
      training_verifiable_items: {
        Row: {
          created_at: string | null
          id: string
          item: string
          training_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          item: string
          training_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          item?: string
          training_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_verifiable_items_training_id_fkey"
            columns: ["training_id"]
            isOneToOne: false
            referencedRelation: "trainings"
            referencedColumns: ["id"]
          },
        ]
      }
      trainings: {
        Row: {
          active_duration_seconds: number | null
          app_version_at_completion: string | null
          attestation_ip: string | null
          attestation_signed_at: string | null
          attestation_signer_id: string | null
          attestation_signer_name: string | null
          attestation_text: string | null
          attestation_user_agent: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          end_date: string
          field_timestamps: Json
          id: string
          inspector_id: string | null
          last_modified_by: string | null
          last_opened_at: string | null
          last_sync_source: string | null
          latest_report_generated_at: string | null
          latest_report_html: string | null
          latitude: number | null
          location: string
          longitude: number | null
          organization: string
          organization_id: string | null
          report_version: number | null
          retention_until: string | null
          start_date: string
          status: string
          synced_at: string | null
          trainee_names: string | null
          trainer_of_record: string | null
          updated_at: string
        }
        Insert: {
          active_duration_seconds?: number | null
          app_version_at_completion?: string | null
          attestation_ip?: string | null
          attestation_signed_at?: string | null
          attestation_signer_id?: string | null
          attestation_signer_name?: string | null
          attestation_text?: string | null
          attestation_user_agent?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          end_date?: string
          field_timestamps?: Json
          id?: string
          inspector_id?: string | null
          last_modified_by?: string | null
          last_opened_at?: string | null
          last_sync_source?: string | null
          latest_report_generated_at?: string | null
          latest_report_html?: string | null
          latitude?: number | null
          location?: string
          longitude?: number | null
          organization: string
          organization_id?: string | null
          report_version?: number | null
          retention_until?: string | null
          start_date?: string
          status?: string
          synced_at?: string | null
          trainee_names?: string | null
          trainer_of_record?: string | null
          updated_at?: string
        }
        Update: {
          active_duration_seconds?: number | null
          app_version_at_completion?: string | null
          attestation_ip?: string | null
          attestation_signed_at?: string | null
          attestation_signer_id?: string | null
          attestation_signer_name?: string | null
          attestation_text?: string | null
          attestation_user_agent?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          end_date?: string
          field_timestamps?: Json
          id?: string
          inspector_id?: string | null
          last_modified_by?: string | null
          last_opened_at?: string | null
          last_sync_source?: string | null
          latest_report_generated_at?: string | null
          latest_report_html?: string | null
          latitude?: number | null
          location?: string
          longitude?: number | null
          organization?: string
          organization_id?: string | null
          report_version?: number | null
          retention_until?: string | null
          start_date?: string
          status?: string
          synced_at?: string | null
          trainee_names?: string | null
          trainer_of_record?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trainings_inspector_id_profiles_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainings_inspector_id_profiles_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainings_last_modified_by_fkey"
            columns: ["last_modified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainings_last_modified_by_fkey"
            columns: ["last_modified_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_field_history: {
        Row: {
          created_at: string | null
          field_type: string
          id: string
          last_used_at: string | null
          usage_count: number | null
          user_id: string
          value: string
        }
        Insert: {
          created_at?: string | null
          field_type: string
          id?: string
          last_used_at?: string | null
          usage_count?: number | null
          user_id: string
          value: string
        }
        Update: {
          created_at?: string | null
          field_type?: string
          id?: string
          last_used_at?: string | null
          usage_count?: number | null
          user_id?: string
          value?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          organization_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          organization_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          organization_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      version_telemetry: {
        Row: {
          client_version: string
          created_at: string
          id: string
          is_standalone: boolean
          last_seen: string
          platform: string
          server_version: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          client_version: string
          created_at?: string
          id?: string
          is_standalone?: boolean
          last_seen?: string
          platform: string
          server_version?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          client_version?: string
          created_at?: string
          id?: string
          is_standalone?: boolean
          last_seen?: string
          platform?: string
          server_version?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      webhook_config: {
        Row: {
          created_at: string | null
          id: string
          key_name: string
          key_value: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          key_name: string
          key_value: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          key_name?: string
          key_value?: string
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      profiles_public: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          first_name: string | null
          id: string | null
          last_name: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          first_name?: string | null
          id?: string | null
          last_name?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          first_name?: string | null
          id?: string | null
          last_name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      align_synced_at: {
        Args: { p_record_id: string; p_table_name: string }
        Returns: Json
      }
      audit_resolve_users: {
        Args: { _user_ids: string[] }
        Returns: {
          first_name: string
          id: string
          last_name: string
        }[]
      }
      backup_table: {
        Args: { p_schema_name?: string; p_table_name: string }
        Returns: string
      }
      can_edit_report: {
        Args: { report_inspector_id: string }
        Returns: boolean
      }
      check_data_loss: {
        Args: {
          p_records_before: number
          p_schema_name?: string
          p_table_name: string
        }
        Returns: {
          alert_level: string
          has_data_loss: boolean
          loss_percentage: number
          records_after: number
          records_before: number
        }[]
      }
      check_record_status: {
        Args: { p_record_id: string; p_table_name: string }
        Returns: {
          deleted_at: string
          deleted_by: string
          is_deleted: boolean
          record_exists: boolean
          synced_at: string
          updated_at: string
        }[]
      }
      check_trigger_health: { Args: never; Returns: Json }
      cleanup_expired_deleted_records: {
        Args: never
        Returns: {
          daily_assessments_deleted: number
          inspections_deleted: number
          trainings_deleted: number
        }[]
      }
      complete_migration_audit: {
        Args: {
          p_audit_id: string
          p_error_message?: string
          p_status?: string
        }
        Returns: undefined
      }
      create_audit_log: {
        Args: {
          p_action_type: string
          p_metadata?: Json
          p_new_values?: Json
          p_old_values?: Json
          p_record_id: string
          p_table_name: string
          p_user_id: string
        }
        Returns: string
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      find_duplicate_organizations: {
        Args: never
        Returns: {
          group_key: string
          org_ids: string[]
          org_names: string[]
          total_inspections: number
          total_members: number
        }[]
      }
      get_deleted_records: {
        Args: { p_table_name?: string }
        Returns: {
          days_remaining: number
          deleted_at: string
          deleted_by: string
          deleter_name: string
          organization: string
          record_date: string
          record_id: string
          retention_until: string
          table_name: string
        }[]
      }
      get_or_create_organization: {
        Args: { org_name: string }
        Returns: string
      }
      get_table_record_count: {
        Args: { p_schema_name?: string; p_table_name: string }
        Returns: number
      }
      has_role: {
        Args: {
          _org_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      internal_get_webhook_secret: { Args: never; Returns: string }
      is_admin_or_above: { Args: never; Returns: boolean }
      is_backup_admin: { Args: never; Returns: boolean }
      is_report_owner: {
        Args: { report_inspector_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      merge_organizations: {
        Args: {
          p_new_name?: string
          p_source_org_ids: string[]
          p_target_org_id: string
        }
        Returns: Json
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      restore_deleted_record: {
        Args: { p_record_id: string; p_table_name: string }
        Returns: boolean
      }
      restore_from_backup: {
        Args: {
          p_backup_table_name: string
          p_schema_name?: string
          p_target_table_name: string
        }
        Returns: number
      }
      set_bulk_delete_opt_in: { Args: never; Returns: undefined }
      soft_delete_record: {
        Args: {
          p_deleted_by: string
          p_record_id: string
          p_retention_days?: number
          p_table_name: string
        }
        Returns: boolean
      }
      start_migration_audit: {
        Args: {
          p_metadata?: Json
          p_migration_name: string
          p_table_affected: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "admin"
        | "inspector"
        | "trainer"
        | "backup_operator"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "super_admin",
        "admin",
        "inspector",
        "trainer",
        "backup_operator",
      ],
    },
  },
} as const
