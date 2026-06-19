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
      bids: {
        Row: {
          created_at: string
          delivery_date: string | null
          driver_id: string
          id: string
          job_id: string
          message: string | null
          price: number
          status: Database["public"]["Enums"]["bid_status"]
        }
        Insert: {
          created_at?: string
          delivery_date?: string | null
          driver_id: string
          id?: string
          job_id: string
          message?: string | null
          price: number
          status?: Database["public"]["Enums"]["bid_status"]
        }
        Update: {
          created_at?: string
          delivery_date?: string | null
          driver_id?: string
          id?: string
          job_id?: string
          message?: string | null
          price?: number
          status?: Database["public"]["Enums"]["bid_status"]
        }
        Relationships: [
          {
            foreignKeyName: "bids_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      disputes: {
        Row: {
          against: string | null
          created_at: string
          id: string
          job_id: string
          raised_by: string
          reason: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["dispute_status"]
        }
        Insert: {
          against?: string | null
          created_at?: string
          id?: string
          job_id: string
          raised_by: string
          reason: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["dispute_status"]
        }
        Update: {
          against?: string | null
          created_at?: string
          id?: string
          job_id?: string
          raised_by?: string
          reason?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["dispute_status"]
        }
        Relationships: [
          {
            foreignKeyName: "disputes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_locations: {
        Row: {
          accuracy: number | null
          driver_id: string
          heading: number | null
          job_id: string
          lat: number
          lng: number
          updated_at: string
        }
        Insert: {
          accuracy?: number | null
          driver_id: string
          heading?: number | null
          job_id: string
          lat: number
          lng: number
          updated_at?: string
        }
        Update: {
          accuracy?: number | null
          driver_id?: string
          heading?: number | null
          job_id?: string
          lat?: number
          lng?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_locations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_profiles: {
        Row: {
          created_at: string
          jobs_completed: number
          level: Database["public"]["Enums"]["driver_level"]
          national_id: string | null
          national_id_url: string | null
          rating_avg: number
          rating_count: number
          selfie_url: string | null
          updated_at: string
          user_id: string
          verification_notes: string | null
          verification_status: Database["public"]["Enums"]["verification_status"]
        }
        Insert: {
          created_at?: string
          jobs_completed?: number
          level?: Database["public"]["Enums"]["driver_level"]
          national_id?: string | null
          national_id_url?: string | null
          rating_avg?: number
          rating_count?: number
          selfie_url?: string | null
          updated_at?: string
          user_id: string
          verification_notes?: string | null
          verification_status?: Database["public"]["Enums"]["verification_status"]
        }
        Update: {
          created_at?: string
          jobs_completed?: number
          level?: Database["public"]["Enums"]["driver_level"]
          national_id?: string | null
          national_id_url?: string | null
          rating_avg?: number
          rating_count?: number
          selfie_url?: string | null
          updated_at?: string
          user_id?: string
          verification_notes?: string | null
          verification_status?: Database["public"]["Enums"]["verification_status"]
        }
        Relationships: []
      }
      jobs: {
        Row: {
          accepted_bid_id: string | null
          budget: number
          commission: number | null
          created_at: string
          custom_material: string | null
          customer_id: string
          delivery_address: string
          driver_id: string | null
          final_price: number | null
          id: string
          material: Database["public"]["Enums"]["material_category"]
          notes: string | null
          preferred_date: string | null
          quantity_m3: number
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        Insert: {
          accepted_bid_id?: string | null
          budget: number
          commission?: number | null
          created_at?: string
          custom_material?: string | null
          customer_id: string
          delivery_address: string
          driver_id?: string | null
          final_price?: number | null
          id?: string
          material: Database["public"]["Enums"]["material_category"]
          notes?: string | null
          preferred_date?: string | null
          quantity_m3: number
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Update: {
          accepted_bid_id?: string | null
          budget?: number
          commission?: number | null
          created_at?: string
          custom_material?: string | null
          customer_id?: string
          delivery_address?: string
          driver_id?: string | null
          final_price?: number | null
          id?: string
          material?: Database["public"]["Enums"]["material_category"]
          notes?: string | null
          preferred_date?: string | null
          quantity_m3?: number
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Relationships: []
      }
      material_prices: {
        Row: {
          enforced: boolean
          label: string
          material: Database["public"]["Enums"]["material_category"]
          max_price: number
          min_price: number
          unit: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enforced?: boolean
          label: string
          material: Database["public"]["Enums"]["material_category"]
          max_price: number
          min_price: number
          unit?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enforced?: boolean
          label?: string
          material?: Database["public"]["Enums"]["material_category"]
          max_price?: number
          min_price?: number
          unit?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string | null
          created_at: string
          id: string
          image_url: string | null
          job_id: string
          sender_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          job_id: string
          sender_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          job_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          job_id: string | null
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          job_id?: string | null
          read?: boolean
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          job_id?: string | null
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          phone: string | null
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id: string
          phone?: string | null
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Relationships: []
      }
      ratings: {
        Row: {
          comment: string | null
          communication: number
          created_at: string
          customer_id: string
          delivery_time: number
          driver_id: string
          id: string
          job_id: string
          quality: number
          reliability: number
        }
        Insert: {
          comment?: string | null
          communication: number
          created_at?: string
          customer_id: string
          delivery_time: number
          driver_id: string
          id?: string
          job_id: string
          quality: number
          reliability: number
        }
        Update: {
          comment?: string | null
          communication?: number
          created_at?: string
          customer_id?: string
          delivery_time?: number
          driver_id?: string
          id?: string
          job_id?: string
          quality?: number
          reliability?: number
        }
        Relationships: [
          {
            foreignKeyName: "ratings_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      trucks: {
        Row: {
          capacity_m3: number
          created_at: string
          driver_id: string
          id: string
          photo_url: string | null
          registration: string
        }
        Insert: {
          capacity_m3: number
          created_at?: string
          driver_id: string
          id?: string
          photo_url?: string | null
          registration: string
        }
        Update: {
          capacity_m3?: number
          created_at?: string
          driver_id?: string
          id?: string
          photo_url?: string | null
          registration?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          created_by: string | null
          id: string
          job_id: string | null
          note: string | null
          type: Database["public"]["Enums"]["tx_type"]
          user_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          created_by?: string | null
          id?: string
          job_id?: string | null
          note?: string | null
          type: Database["public"]["Enums"]["tx_type"]
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          created_by?: string | null
          id?: string
          job_id?: string | null
          note?: string | null
          type?: Database["public"]["Enums"]["tx_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          balance: number
          limited: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          limited?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          limited?: boolean
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
      accept_bid: {
        Args: { _bid_id: string }
        Returns: {
          accepted_bid_id: string | null
          budget: number
          commission: number | null
          created_at: string
          custom_material: string | null
          customer_id: string
          delivery_address: string
          driver_id: string | null
          final_price: number | null
          id: string
          material: Database["public"]["Enums"]["material_category"]
          notes: string | null
          preferred_date: string | null
          quantity_m3: number
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_credit_wallet: {
        Args: { _amount: number; _note: string; _user_id: string }
        Returns: {
          balance: number
          limited: boolean
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "wallets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_grant_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      admin_revoke_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      admin_set_commission: { Args: { _rate: number }; Returns: Json }
      admin_set_user_status: {
        Args: {
          _status: Database["public"]["Enums"]["account_status"]
          _user_id: string
        }
        Returns: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          phone: string | null
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_super_admin: { Args: never; Returns: undefined }
      complete_job: {
        Args: { _job_id: string }
        Returns: {
          accepted_bid_id: string | null
          budget: number
          commission: number | null
          created_at: string
          custom_material: string | null
          customer_id: string
          delivery_address: string
          driver_id: string | null
          final_price: number | null
          id: string
          material: Database["public"]["Enums"]["material_category"]
          notes: string | null
          preferred_date: string | null
          quantity_m3: number
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      account_status: "active" | "suspended" | "banned"
      app_role: "customer" | "driver" | "admin" | "super_admin"
      bid_status: "pending" | "accepted" | "rejected" | "withdrawn"
      dispute_status: "open" | "investigating" | "resolved" | "rejected"
      driver_level: "bronze" | "silver" | "gold" | "platinum"
      job_status:
        | "open"
        | "accepted"
        | "in_progress"
        | "completed"
        | "cancelled"
      material_category:
        | "river_sand"
        | "pit_sand"
        | "quarry_dust"
        | "crusher_run"
        | "gravel"
        | "stones"
        | "top_soil"
        | "filling_soil"
        | "custom"
      tx_type: "topup" | "commission" | "refund" | "adjustment"
      verification_status: "pending" | "verified" | "rejected"
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
      account_status: ["active", "suspended", "banned"],
      app_role: ["customer", "driver", "admin", "super_admin"],
      bid_status: ["pending", "accepted", "rejected", "withdrawn"],
      dispute_status: ["open", "investigating", "resolved", "rejected"],
      driver_level: ["bronze", "silver", "gold", "platinum"],
      job_status: ["open", "accepted", "in_progress", "completed", "cancelled"],
      material_category: [
        "river_sand",
        "pit_sand",
        "quarry_dust",
        "crusher_run",
        "gravel",
        "stones",
        "top_soil",
        "filling_soil",
        "custom",
      ],
      tx_type: ["topup", "commission", "refund", "adjustment"],
      verification_status: ["pending", "verified", "rejected"],
    },
  },
} as const
