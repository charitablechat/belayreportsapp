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
          result: string
          system_name: string
        }
        Insert: {
          comments?: string | null
          created_at?: string | null
          id?: string
          inspection_id: string
          result: string
          system_name: string
        }
        Update: {
          comments?: string | null
          created_at?: string | null
          id?: string
          inspection_id?: string
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
          latitude: number | null
          location: string
          longitude: number | null
          onsite_contact: string | null
          organization: string
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
          latitude?: number | null
          location: string
          longitude?: number | null
          onsite_contact?: string | null
          organization: string
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
          latitude?: number | null
          location?: string
          longitude?: number | null
          onsite_contact?: string | null
          organization?: string
          previous_inspection_date?: string | null
          previous_inspector?: string | null
          status?: string
          synced_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
