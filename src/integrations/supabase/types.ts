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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alert_settings: {
        Row: {
          config: Json
          created_at: string
          id: string
          owner_id: string
          preferred_language: string
          updated_at: string
          voice_enabled: boolean
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          owner_id: string
          preferred_language?: string
          updated_at?: string
          voice_enabled?: boolean
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          owner_id?: string
          preferred_language?: string
          updated_at?: string
          voice_enabled?: boolean
        }
        Relationships: []
      }
      detections: {
        Row: {
          acknowledged: boolean
          bbox: Json | null
          confidence: number
          detected_at: string
          hazard_type: Database["public"]["Enums"]["hazard_type"]
          id: string
          message: string | null
          owner_id: string
          session_id: string
          severity: Database["public"]["Enums"]["severity"]
        }
        Insert: {
          acknowledged?: boolean
          bbox?: Json | null
          confidence?: number
          detected_at?: string
          hazard_type: Database["public"]["Enums"]["hazard_type"]
          id?: string
          message?: string | null
          owner_id: string
          session_id: string
          severity?: Database["public"]["Enums"]["severity"]
        }
        Update: {
          acknowledged?: boolean
          bbox?: Json | null
          confidence?: number
          detected_at?: string
          hazard_type?: Database["public"]["Enums"]["hazard_type"]
          id?: string
          message?: string | null
          owner_id?: string
          session_id?: string
          severity?: Database["public"]["Enums"]["severity"]
        }
        Relationships: [
          {
            foreignKeyName: "detections_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "monitoring_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      hazard_zones: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["zone_kind"]
          name: string
          owner_id: string
          polygon: Json
          session_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["zone_kind"]
          name: string
          owner_id: string
          polygon?: Json
          session_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["zone_kind"]
          name?: string
          owner_id?: string
          polygon?: Json
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hazard_zones_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "monitoring_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          confidence: number
          created_at: string
          detection_id: string | null
          hazard_type: Database["public"]["Enums"]["hazard_type"]
          id: string
          message: string | null
          occurred_at: string
          owner_id: string
          resolution_notes: string | null
          resolved: boolean
          session_id: string | null
          severity: Database["public"]["Enums"]["severity"]
          snapshot_path: string | null
          zone_label: string | null
        }
        Insert: {
          confidence?: number
          created_at?: string
          detection_id?: string | null
          hazard_type: Database["public"]["Enums"]["hazard_type"]
          id?: string
          message?: string | null
          occurred_at?: string
          owner_id: string
          resolution_notes?: string | null
          resolved?: boolean
          session_id?: string | null
          severity: Database["public"]["Enums"]["severity"]
          snapshot_path?: string | null
          zone_label?: string | null
        }
        Update: {
          confidence?: number
          created_at?: string
          detection_id?: string | null
          hazard_type?: Database["public"]["Enums"]["hazard_type"]
          id?: string
          message?: string | null
          occurred_at?: string
          owner_id?: string
          resolution_notes?: string | null
          resolved?: boolean
          session_id?: string | null
          severity?: Database["public"]["Enums"]["severity"]
          snapshot_path?: string | null
          zone_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incidents_detection_id_fkey"
            columns: ["detection_id"]
            isOneToOne: false
            referencedRelation: "detections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "monitoring_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      monitoring_sessions: {
        Row: {
          device_label: string | null
          ended_at: string | null
          frames_processed: number
          id: string
          label: string | null
          owner_id: string
          started_at: string
          status: Database["public"]["Enums"]["session_status"]
        }
        Insert: {
          device_label?: string | null
          ended_at?: string | null
          frames_processed?: number
          id?: string
          label?: string | null
          owner_id: string
          started_at?: string
          status?: Database["public"]["Enums"]["session_status"]
        }
        Update: {
          device_label?: string | null
          ended_at?: string | null
          frames_processed?: number
          id?: string
          label?: string | null
          owner_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["session_status"]
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          preferred_language: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          preferred_language?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          preferred_language?: string
          updated_at?: string
          user_id?: string
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
      hazard_type:
        | "unsafe_lift"
        | "ppe_missing"
        | "person_proximity"
        | "restricted_zone"
        | "blocked_exit"
        | "forklift_proximity"
        | "fall_risk"
      session_status: "active" | "ended"
      severity: "low" | "medium" | "high" | "critical"
      zone_kind: "restricted" | "exit" | "walkway"
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
      hazard_type: [
        "unsafe_lift",
        "ppe_missing",
        "person_proximity",
        "restricted_zone",
        "blocked_exit",
        "forklift_proximity",
        "fall_risk",
      ],
      session_status: ["active", "ended"],
      severity: ["low", "medium", "high", "critical"],
      zone_kind: ["restricted", "exit", "walkway"],
    },
  },
} as const
