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
      ai_chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          parent_id: string
          role: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          parent_id: string
          role?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          parent_id?: string
          role?: string
        }
        Relationships: []
      }
      appointments: {
        Row: {
          created_at: string
          doctor_name: string
          id: string
          location: string | null
          notes: string | null
          parent_id: string
          scheduled_at: string
          specialty: string | null
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
          title: string
          appointment_date: string
          appointment_time: string | null
          reminder_enabled: boolean
        }
        Insert: {
          created_at?: string
          doctor_name: string
          id?: string
          location?: string | null
          notes?: string | null
          parent_id: string
          scheduled_at: string
          specialty?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
          title: string
          appointment_date: string
          appointment_time?: string | null
          reminder_enabled?: boolean
        }
        Update: {
          created_at?: string
          doctor_name?: string
          id?: string
          location?: string | null
          notes?: string | null
          parent_id?: string
          scheduled_at?: string
          specialty?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
          title?: string
          appointment_date?: string
          appointment_time?: string | null
          reminder_enabled?: boolean
        }
        Relationships: []
      }
      caregiver_bookings: {
        Row: {
          booking_date: string | null
          booking_time: string | null
          caregiver_id: string | null
          caregiver_name: string | null
          caregiver_type: Database["public"]["Enums"]["caregiver_type"]
          created_at: string
          duration_hours: number
          id: string
          notes: string | null
          parent_id: string
          requested_by: string
          scheduled_at: string
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
        }
        Insert: {
          booking_date?: string | null
          booking_time?: string | null
          caregiver_id?: string | null
          caregiver_name?: string | null
          caregiver_type: Database["public"]["Enums"]["caregiver_type"]
          created_at?: string
          duration_hours?: number
          id?: string
          notes?: string | null
          parent_id: string
          requested_by: string
          scheduled_at: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Update: {
          booking_date?: string | null
          booking_time?: string | null
          caregiver_id?: string | null
          caregiver_name?: string | null
          caregiver_type?: Database["public"]["Enums"]["caregiver_type"]
          created_at?: string
          duration_hours?: number
          id?: string
          notes?: string | null
          parent_id?: string
          requested_by?: string
          scheduled_at?: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Relationships: []
      }
      health_records: {
        Row: {
          created_at: string
          doctor_name: string | null
          file_url: string | null
          id: string
          notes: string | null
          parent_id: string
          record_date: string
          record_type: string
          title: string
          category: "blood_test" | "prescription" | "ecg"
          description: string | null
          file_path: string | null
          file_type: string | null
          file_size: number | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          doctor_name?: string | null
          file_url?: string | null
          id?: string
          notes?: string | null
          parent_id: string
          record_date?: string
          record_type?: string
          title: string
          category?: "blood_test" | "prescription" | "ecg"
          description?: string | null
          file_path?: string | null
          file_type?: string | null
          file_size?: number | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          doctor_name?: string | null
          file_url?: string | null
          id?: string
          notes?: string | null
          parent_id?: string
          record_date?: string
          record_type?: string
          title?: string
          category?: "blood_test" | "prescription" | "ecg"
          description?: string | null
          file_path?: string | null
          file_type?: string | null
          file_size?: number | null
          uploaded_by?: string | null
        }
        Relationships: []
      }
      health_risk_assessments: {
        Row: {
          activity_level: string | null
          age: number
          bp_diastolic: number | null
          bp_systolic: number | null
          created_at: string
          heart_rate: number | null
          id: string
          oxygen_level: number | null
          parent_id: string
          recommendations: string | null
          risk_level: Database["public"]["Enums"]["risk_level"]
          risk_score: number | null
          sugar_level: number | null
          summary: string | null
          weight: number | null
          wellness_data: string | null
        }
        Insert: {
          activity_level?: string | null
          age: number
          bp_diastolic?: number | null
          bp_systolic?: number | null
          created_at?: string
          heart_rate?: number | null
          id?: string
          oxygen_level?: number | null
          parent_id: string
          recommendations?: string | null
          risk_level?: Database["public"]["Enums"]["risk_level"]
          risk_score?: number | null
          sugar_level?: number | null
          summary?: string | null
          weight?: number | null
          wellness_data?: string | null
        }
        Update: {
          activity_level?: string | null
          age?: number
          bp_diastolic?: number | null
          bp_systolic?: number | null
          created_at?: string
          heart_rate?: number | null
          id?: string
          oxygen_level?: number | null
          parent_id?: string
          recommendations?: string | null
          risk_level?: Database["public"]["Enums"]["risk_level"]
          risk_score?: number | null
          sugar_level?: number | null
          summary?: string | null
          weight?: number | null
          wellness_data?: string | null
        }
        Relationships: []
      }
      medicine_logs: {
        Row: {
          created_at: string
          id: string
          log_date: string
          medicine_id: string
          parent_id: string
          taken_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          log_date?: string
          medicine_id: string
          parent_id: string
          taken_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          log_date?: string
          medicine_id?: string
          parent_id?: string
          taken_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medicine_logs_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
        ]
      }
      medicines: {
        Row: {
          active: boolean
          created_at: string
          dosage: string
          id: string
          name: string
          notes: string | null
          duration: string | null
          parent_id: string
          period: Database["public"]["Enums"]["med_period"]
          schedule_time: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          dosage?: string
          id?: string
          name: string
          notes?: string | null
          duration?: string | null
          parent_id: string
          period?: Database["public"]["Enums"]["med_period"]
          schedule_time?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          dosage?: string
          id?: string
          name?: string
          notes?: string | null
          duration?: string | null
          parent_id?: string
          period?: Database["public"]["Enums"]["med_period"]
          schedule_time?: string
          updated_at?: string
        }
        Relationships: []
      }
      parent_child_links: {
        Row: {
          child_id: string
          created_at: string
          id: string
          parent_id: string
        }
        Insert: {
          child_id: string
          created_at?: string
          id?: string
          parent_id: string
        }
        Update: {
          child_id?: string
          created_at?: string
          id?: string
          parent_id?: string
        }
        Relationships: []
      }
      parent_notifications: {
        Row: {
          id: string
          parent_id: string
          sender_id: string
          type: string
          notification_type: string | null
          message: string
          is_read: boolean
          metadata: Record<string, unknown> | null
          created_at: string
        }
        Insert: {
          id?: string
          parent_id: string
          sender_id: string
          type: string
          notification_type?: string | null
          message: string
          is_read?: boolean
          metadata?: Record<string, unknown> | null
          created_at?: string
        }
        Update: {
          id?: string
          parent_id?: string
          sender_id?: string
          type?: string
          notification_type?: string | null
          message?: string
          is_read?: boolean
          metadata?: Record<string, unknown> | null
          created_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: string | null
          avatar_url: string | null
          created_at: string
          date_of_birth: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          full_name: string
          id: string
          invite_code: string | null
          medical_conditions: string | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          email: string | null
        }
        Insert: {
          address?: string | null
          avatar_url?: string | null
          created_at?: string
          date_of_birth?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name?: string
          id: string
          invite_code?: string | null
          medical_conditions?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          email?: string | null
        }
        Update: {
          address?: string | null
          avatar_url?: string | null
          created_at?: string
          date_of_birth?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name?: string
          id?: string
          invite_code?: string | null
          medical_conditions?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          email?: string | null
        }
        Relationships: []
      }
      sos_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          address: string | null
          alert_timestamp: string
          alert_type: string
          created_at: string
          dedup_key: string | null
          id: string
          latitude: number | null
          longitude: number | null
          message: string | null
          parent_id: string
          parent_name: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["sos_status"]
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          address?: string | null
          alert_timestamp?: string
          alert_type?: string
          created_at?: string
          dedup_key?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          message?: string | null
          parent_id: string
          parent_name?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["sos_status"]
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          address?: string | null
          alert_timestamp?: string
          alert_type?: string
          created_at?: string
          dedup_key?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          message?: string | null
          parent_id?: string
          parent_name?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["sos_status"]
        }
        Relationships: []
      }
      transport_bookings: {
        Row: {
          created_at: string
          destination: string
          driver_id: string | null
          id: string
          notes: string | null
          parent_id: string
          pickup_address: string
          purpose: Database["public"]["Enums"]["transport_purpose"]
          requested_by: string
          scheduled_at: string
          special_assistance: string | null
          status: Database["public"]["Enums"]["booking_status"]
          transport_date: string | null
          transport_time: string | null
          trip_type: Database["public"]["Enums"]["trip_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          destination: string
          driver_id?: string | null
          id?: string
          notes?: string | null
          parent_id: string
          pickup_address: string
          purpose?: Database["public"]["Enums"]["transport_purpose"]
          requested_by: string
          scheduled_at: string
          special_assistance?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          transport_date?: string | null
          transport_time?: string | null
          trip_type?: Database["public"]["Enums"]["trip_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          destination?: string
          driver_id?: string | null
          id?: string
          notes?: string | null
          parent_id?: string
          pickup_address?: string
          purpose?: Database["public"]["Enums"]["transport_purpose"]
          requested_by?: string
          scheduled_at?: string
          special_assistance?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          transport_date?: string | null
          transport_time?: string | null
          trip_type?: Database["public"]["Enums"]["trip_type"]
          updated_at?: string
        }
        Relationships: []
      }
      video_consultations: {
        Row: {
          consultation_date: string | null
          consultation_reason: string | null
          consultation_time: string | null
          created_at: string
          doctor_name: string
          id: string
          meeting_url: string | null
          notes: string | null
          parent_id: string
          requested_by: string
          scheduled_at: string
          specialty: string | null
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
        }
        Insert: {
          consultation_date?: string | null
          consultation_reason?: string | null
          consultation_time?: string | null
          created_at?: string
          doctor_name: string
          id?: string
          meeting_url?: string | null
          notes?: string | null
          parent_id: string
          requested_by: string
          scheduled_at: string
          specialty?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Update: {
          consultation_date?: string | null
          consultation_reason?: string | null
          consultation_time?: string | null
          created_at?: string
          doctor_name?: string
          id?: string
          meeting_url?: string | null
          notes?: string | null
          parent_id?: string
          requested_by?: string
          scheduled_at?: string
          specialty?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Relationships: []
      }
      consultation_prescriptions: {
        Row: {
          created_at: string
          file_name: string | null
          file_path: string
          file_size: number | null
          file_type: string
          file_url: string | null
          id: string
          consultation_id: string
          parent_id: string
          uploaded_at: string
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          file_path: string
          file_size?: number | null
          file_type: string
          file_url?: string | null
          id?: string
          consultation_id: string
          parent_id: string
          uploaded_at?: string
        }
        Update: {
          created_at?: string
          file_name?: string | null
          file_path?: string
          file_size?: number | null
          file_type?: string
          file_url?: string | null
          id?: string
          consultation_id?: string
          parent_id?: string
          uploaded_at?: string
        }
        Relationships: []
      }
      wellbeing_checks: {
        Row: {
          ate_meals: boolean | null
          check_date: string
          created_at: string
          drank_water: boolean | null
          energy_level: string | null
          feeling: string | null
          id: string
          notes: string | null
          parent_id: string
          took_medicine: boolean | null
          sleep_quality: string | null
          pain_status: boolean | null
          pain_notes: string | null
          meals_logged: string | null
          water_intake: number | null
        }
        Insert: {
          ate_meals?: boolean | null
          check_date?: string
          created_at?: string
          drank_water?: boolean | null
          energy_level?: string | null
          feeling?: string | null
          id?: string
          notes?: string | null
          parent_id: string
          took_medicine?: boolean | null
          sleep_quality?: string | null
          pain_status?: boolean | null
          pain_notes?: string | null
          meals_logged?: string | null
          water_intake?: number | null
        }
        Update: {
          ate_meals?: boolean | null
          check_date?: string
          created_at?: string
          drank_water?: boolean | null
          energy_level?: string | null
          feeling?: string | null
          id?: string
          notes?: string | null
          parent_id?: string
          took_medicine?: boolean | null
          sleep_quality?: string | null
          pain_status?: boolean | null
          pain_notes?: string | null
          meals_logged?: string | null
          water_intake?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_view_parent: { Args: { _parent: string }; Returns: boolean }
      detect_care_issues: {
        Args: never
        Returns: {
          missed_medicine_alerts: number
          no_checkin_alerts: number
        }[]
      }
      is_linked_child: { Args: { _parent: string }; Returns: boolean }
      lookup_parent_by_invite_code: {
        Args: { _code: string }
        Returns: string | null
      }
    }
    Enums: {
      booking_status:
        | "pending"
        | "confirmed"
        | "completed"
        | "cancelled"
        | "assigned"
        | "in_progress"
        | "driver_assigned"
        | "en_route"
        | "arrived"
        | "scheduled"
        | "waiting"
      caregiver_type: "nurse" | "caretaker" | "physiotherapist" | "companion"
      med_period: "morning" | "noon" | "evening" | "night"
      risk_level: "low" | "medium" | "high"
      sos_status: "active" | "acknowledged" | "resolved"
      transport_purpose: "hospital" | "checkup" | "emergency"
      trip_type: "one_way" | "round_trip"
      user_role: "parent" | "child"
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
      booking_status: [
        "pending",
        "confirmed",
        "completed",
        "cancelled",
        "assigned",
        "in_progress",
        "driver_assigned",
        "en_route",
        "arrived",
        "scheduled",
        "waiting",
      ],
      caregiver_type: ["nurse", "caretaker", "physiotherapist", "companion"],
      med_period: ["morning", "noon", "evening", "night"],
      risk_level: ["low", "medium", "high"],
      sos_status: ["active", "acknowledged", "resolved"],
      transport_purpose: ["hospital", "checkup", "emergency"],
      trip_type: ["one_way", "round_trip"],
      user_role: ["parent", "child"],
    },
  },
} as const
