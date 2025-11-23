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
          id: string
          is_active: boolean
          section_key: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          section_key: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          display_order?: number
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
      inspection_equipment: {
        Row: {
          comments: string | null
          created_at: string | null
          equipment_category: string
          equipment_type: string
          id: string
          inspection_id: string
          production_year: number | null
          quantity: number | null
          result: string
        }
        Insert: {
          comments?: string | null
          created_at?: string | null
          equipment_category: string
          equipment_type: string
          id?: string
          inspection_id: string
          production_year?: number | null
          quantity?: number | null
          result: string
        }
        Update: {
          comments?: string | null
          created_at?: string | null
          equipment_category?: string
          equipment_type?: string
          id?: string
          inspection_id?: string
          production_year?: number | null
          quantity?: number | null
          result?: string
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
          id: string
          inspection_id: string
          photo_section: string | null
          photo_url: string
        }
        Insert: {
          caption?: string | null
          created_at?: string | null
          id?: string
          inspection_id: string
          photo_section?: string | null
          photo_url: string
        }
        Update: {
          caption?: string | null
          created_at?: string | null
          id?: string
          inspection_id?: string
          photo_section?: string | null
          photo_url?: string
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
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_standards: {
        Row: {
          comments: string | null
          created_at: string | null
          has_documentation: boolean
          id: string
          inspection_id: string
          standard_name: string
        }
        Insert: {
          comments?: string | null
          created_at?: string | null
          has_documentation: boolean
          id?: string
          inspection_id: string
          standard_name: string
        }
        Update: {
          comments?: string | null
          created_at?: string | null
          has_documentation?: boolean
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
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_systems: {
        Row: {
          comments: string | null
          created_at: string | null
          id: string
          inspection_id: string
          name: string | null
          result: string
          system_name: string
        }
        Insert: {
          comments?: string | null
          created_at?: string | null
          id?: string
          inspection_id: string
          name?: string | null
          result: string
          system_name: string
        }
        Update: {
          comments?: string | null
          created_at?: string | null
          id?: string
          inspection_id?: string
          name?: string | null
          result?: string
          system_name?: string
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
          ead_result: string | null
          ead_system: string | null
          id: string
          inspection_id: string
          load_tension: number | null
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
          ead_result?: string | null
          ead_system?: string | null
          id?: string
          inspection_id: string
          load_tension?: number | null
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
          ead_result?: string | null
          ead_system?: string | null
          id?: string
          inspection_id?: string
          load_tension?: number | null
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
          course_history: string | null
          created_at: string | null
          id: string
          inspection_date: string
          inspector_id: string
          last_opened_at: string | null
          latitude: number | null
          location: string
          longitude: number | null
          onsite_contact: string | null
          organization: string
          organization_id: string | null
          previous_inspection_date: string | null
          previous_inspector: string | null
          status: string
          synced_at: string | null
          updated_at: string | null
        }
        Insert: {
          course_history?: string | null
          created_at?: string | null
          id?: string
          inspection_date?: string
          inspector_id: string
          last_opened_at?: string | null
          latitude?: number | null
          location: string
          longitude?: number | null
          onsite_contact?: string | null
          organization: string
          organization_id?: string | null
          previous_inspection_date?: string | null
          previous_inspector?: string | null
          status?: string
          synced_at?: string | null
          updated_at?: string | null
        }
        Update: {
          course_history?: string | null
          created_at?: string | null
          id?: string
          inspection_date?: string
          inspector_id?: string
          last_opened_at?: string | null
          latitude?: number | null
          location?: string
          longitude?: number | null
          onsite_contact?: string | null
          organization?: string
          organization_id?: string | null
          previous_inspection_date?: string | null
          previous_inspector?: string | null
          status?: string
          synced_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          id: string
          inspection_completed: boolean | null
          sync_conflicts: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          inspection_completed?: boolean | null
          sync_conflicts?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          inspection_completed?: boolean | null
          sync_conflicts?: boolean | null
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
          avatar_url: string | null
          created_at: string | null
          first_name: string | null
          id: string
          last_name: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          first_name?: string | null
          id?: string
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
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          organization_id?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      backup_table: {
        Args: { p_schema_name?: string; p_table_name: string }
        Returns: string
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
      get_or_create_organization: {
        Args: { org_name: string }
        Returns: string
      }
      get_service_role_key: { Args: never; Returns: string }
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
      is_super_admin: { Args: never; Returns: boolean }
      merge_organizations: {
        Args: {
          p_new_name?: string
          p_source_org_ids: string[]
          p_target_org_id: string
        }
        Returns: Json
      }
      restore_from_backup: {
        Args: {
          p_backup_table_name: string
          p_schema_name?: string
          p_target_table_name: string
        }
        Returns: number
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
      app_role: "super_admin" | "admin" | "inspector"
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
      app_role: ["super_admin", "admin", "inspector"],
    },
  },
} as const
