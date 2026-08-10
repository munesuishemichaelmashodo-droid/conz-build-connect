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
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: string
          meta: Json
          reason: string | null
          target_id: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          id?: string
          meta?: Json
          reason?: string | null
          target_id?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: string
          meta?: Json
          reason?: string | null
          target_id?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
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
      cancellation_events: {
        Row: {
          created_at: string
          id: string
          job_id: string | null
          reason: string | null
          role: string
          stage: string
          user_id: string
          waive_reason: string | null
          waived_at: string | null
          waived_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          job_id?: string | null
          reason?: string | null
          role: string
          stage: string
          user_id: string
          waive_reason?: string | null
          waived_at?: string | null
          waived_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string | null
          reason?: string | null
          role?: string
          stage?: string
          user_id?: string
          waive_reason?: string | null
          waived_at?: string | null
          waived_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cancellation_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_members: {
        Row: {
          conversation_id: string
          joined_at: string
          role: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          joined_at?: string
          role?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          joined_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_messages: {
        Row: {
          body: string
          conversation_id: string
          edited_at: string | null
          id: string
          sender_id: string
          sent_at: string
        }
        Insert: {
          body: string
          conversation_id: string
          edited_at?: string | null
          id?: string
          sender_id: string
          sent_at?: string
        }
        Update: {
          body?: string
          conversation_id?: string
          edited_at?: string | null
          id?: string
          sender_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          created_by: string
          id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
        }
        Relationships: []
      }
      customer_ratings: {
        Row: {
          comment: string | null
          communication: number
          created_at: string
          customer_id: string
          driver_id: string
          id: string
          job_id: string
          overall: number
          payment: number
          punctuality: number
        }
        Insert: {
          comment?: string | null
          communication: number
          created_at?: string
          customer_id: string
          driver_id: string
          id?: string
          job_id: string
          overall: number
          payment: number
          punctuality: number
        }
        Update: {
          comment?: string | null
          communication?: number
          created_at?: string
          customer_id?: string
          driver_id?: string
          id?: string
          job_id?: string
          overall?: number
          payment?: number
          punctuality?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_ratings_job_id_fkey"
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
          category: Database["public"]["Enums"]["dispute_category"]
          created_at: string
          escalated_at: string | null
          id: string
          job_id: string
          outcome: Database["public"]["Enums"]["dispute_outcome"] | null
          raised_by: string
          reason: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          review_due_at: string | null
          status: Database["public"]["Enums"]["dispute_status"]
        }
        Insert: {
          against?: string | null
          category?: Database["public"]["Enums"]["dispute_category"]
          created_at?: string
          escalated_at?: string | null
          id?: string
          job_id: string
          outcome?: Database["public"]["Enums"]["dispute_outcome"] | null
          raised_by: string
          reason: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          review_due_at?: string | null
          status?: Database["public"]["Enums"]["dispute_status"]
        }
        Update: {
          against?: string | null
          category?: Database["public"]["Enums"]["dispute_category"]
          created_at?: string
          escalated_at?: string | null
          id?: string
          job_id?: string
          outcome?: Database["public"]["Enums"]["dispute_outcome"] | null
          raised_by?: string
          reason?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          review_due_at?: string | null
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
          certificate_of_fitness_url: string | null
          created_at: string
          first_job_free_used: boolean
          git_insurance_url: string | null
          jobs_completed: number
          level: Database["public"]["Enums"]["driver_level"]
          license_url: string | null
          national_id: string | null
          national_id_url: string | null
          nationality: string | null
          operator_license_url: string | null
          rating_avg: number
          rating_count: number
          selfie_url: string | null
          tipper_photo_url: string | null
          updated_at: string
          user_id: string
          verification_notes: string | null
          verification_status: Database["public"]["Enums"]["verification_status"]
          withdrawal_pin_hash: string | null
          zinara_url: string | null
        }
        Insert: {
          certificate_of_fitness_url?: string | null
          created_at?: string
          first_job_free_used?: boolean
          git_insurance_url?: string | null
          jobs_completed?: number
          level?: Database["public"]["Enums"]["driver_level"]
          license_url?: string | null
          national_id?: string | null
          national_id_url?: string | null
          nationality?: string | null
          operator_license_url?: string | null
          rating_avg?: number
          rating_count?: number
          selfie_url?: string | null
          tipper_photo_url?: string | null
          updated_at?: string
          user_id: string
          verification_notes?: string | null
          verification_status?: Database["public"]["Enums"]["verification_status"]
          withdrawal_pin_hash?: string | null
          zinara_url?: string | null
        }
        Update: {
          certificate_of_fitness_url?: string | null
          created_at?: string
          first_job_free_used?: boolean
          git_insurance_url?: string | null
          jobs_completed?: number
          level?: Database["public"]["Enums"]["driver_level"]
          license_url?: string | null
          national_id?: string | null
          national_id_url?: string | null
          nationality?: string | null
          operator_license_url?: string | null
          rating_avg?: number
          rating_count?: number
          selfie_url?: string | null
          tipper_photo_url?: string | null
          updated_at?: string
          user_id?: string
          verification_notes?: string | null
          verification_status?: Database["public"]["Enums"]["verification_status"]
          withdrawal_pin_hash?: string | null
          zinara_url?: string | null
        }
        Relationships: []
      }
      evidence_access_log: {
        Row: {
          created_at: string
          evidence_id: string | null
          id: string
          job_id: string | null
          purpose: string | null
          viewer_id: string
        }
        Insert: {
          created_at?: string
          evidence_id?: string | null
          id?: string
          job_id?: string | null
          purpose?: string | null
          viewer_id: string
        }
        Update: {
          created_at?: string
          evidence_id?: string | null
          id?: string
          job_id?: string | null
          purpose?: string | null
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_access_log_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "job_evidence"
            referencedColumns: ["id"]
          },
        ]
      }
      job_dispatch_offers: {
        Row: {
          created_at: string
          driver_id: string
          expires_at: string
          id: string
          job_id: string
          offered_at: string
          responded_at: string | null
          status: Database["public"]["Enums"]["dispatch_offer_status"]
          wave: number
        }
        Insert: {
          created_at?: string
          driver_id: string
          expires_at?: string
          id?: string
          job_id: string
          offered_at?: string
          responded_at?: string | null
          status?: Database["public"]["Enums"]["dispatch_offer_status"]
          wave?: number
        }
        Update: {
          created_at?: string
          driver_id?: string
          expires_at?: string
          id?: string
          job_id?: string
          offered_at?: string
          responded_at?: string | null
          status?: Database["public"]["Enums"]["dispatch_offer_status"]
          wave?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_dispatch_offers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_evidence: {
        Row: {
          device_accuracy_m: number | null
          device_lat: number | null
          device_lng: number | null
          file_size: number | null
          id: string
          job_id: string
          kind: string
          location_status: string
          mime_type: string | null
          notes: string | null
          storage_path: string
          superseded_at: string | null
          superseded_by: string | null
          uploaded_at: string
          uploaded_by: string
        }
        Insert: {
          device_accuracy_m?: number | null
          device_lat?: number | null
          device_lng?: number | null
          file_size?: number | null
          id?: string
          job_id: string
          kind: string
          location_status?: string
          mime_type?: string | null
          notes?: string | null
          storage_path: string
          superseded_at?: string | null
          superseded_by?: string | null
          uploaded_at?: string
          uploaded_by: string
        }
        Update: {
          device_accuracy_m?: number | null
          device_lat?: number | null
          device_lng?: number | null
          file_size?: number | null
          id?: string
          job_id?: string
          kind?: string
          location_status?: string
          mime_type?: string | null
          notes?: string | null
          storage_path?: string
          superseded_at?: string | null
          superseded_by?: string | null
          uploaded_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_evidence_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_evidence_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "job_evidence"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          accepted_bid_id: string | null
          budget: number
          cancellation_reason: string | null
          cancellation_stage: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commission: number | null
          completed_at: string | null
          created_at: string
          custom_material: string | null
          customer_id: string
          delivered_quantity_m3: number | null
          delivery_address: string
          delivery_lat: number | null
          delivery_lng: number | null
          delivery_photo_taken_at: string | null
          delivery_photo_url: string | null
          driver_id: string | null
          dropoff_address: string | null
          dropoff_lat: number | null
          dropoff_lng: number | null
          expires_at: string | null
          final_price: number | null
          held_commission: number | null
          id: string
          material: Database["public"]["Enums"]["material_category"]
          notes: string | null
          pickup_address: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_photo_taken_at: string | null
          pickup_photo_url: string | null
          preferred_date: string | null
          quantity_m3: number
          receiver_name: string | null
          status: Database["public"]["Enums"]["job_status"]
          tracking_token: string
          updated_at: string
        }
        Insert: {
          accepted_bid_id?: string | null
          budget: number
          cancellation_reason?: string | null
          cancellation_stage?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          commission?: number | null
          completed_at?: string | null
          created_at?: string
          custom_material?: string | null
          customer_id: string
          delivered_quantity_m3?: number | null
          delivery_address: string
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_photo_taken_at?: string | null
          delivery_photo_url?: string | null
          driver_id?: string | null
          dropoff_address?: string | null
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          expires_at?: string | null
          final_price?: number | null
          held_commission?: number | null
          id?: string
          material: Database["public"]["Enums"]["material_category"]
          notes?: string | null
          pickup_address?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_photo_taken_at?: string | null
          pickup_photo_url?: string | null
          preferred_date?: string | null
          quantity_m3: number
          receiver_name?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tracking_token?: string
          updated_at?: string
        }
        Update: {
          accepted_bid_id?: string | null
          budget?: number
          cancellation_reason?: string | null
          cancellation_stage?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          commission?: number | null
          completed_at?: string | null
          created_at?: string
          custom_material?: string | null
          customer_id?: string
          delivered_quantity_m3?: number | null
          delivery_address?: string
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_photo_taken_at?: string | null
          delivery_photo_url?: string | null
          driver_id?: string | null
          dropoff_address?: string | null
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          expires_at?: string | null
          final_price?: number | null
          held_commission?: number | null
          id?: string
          material?: Database["public"]["Enums"]["material_category"]
          notes?: string | null
          pickup_address?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_photo_taken_at?: string | null
          pickup_photo_url?: string | null
          preferred_date?: string | null
          quantity_m3?: number
          receiver_name?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tracking_token?: string
          updated_at?: string
        }
        Relationships: []
      }
      material_prices: {
        Row: {
          demand_multiplier: number
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
          demand_multiplier?: number
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
          demand_multiplier?: number
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
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          job_id: string | null
          method: string | null
          paynow_poll_url: string | null
          paynow_reference: string | null
          status: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          job_id?: string | null
          method?: string | null
          paynow_poll_url?: string | null
          paynow_reference?: string | null
          status?: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          job_id?: string | null
          method?: string | null
          paynow_poll_url?: string | null
          paynow_reference?: string | null
          status?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      pin_attempts: {
        Row: {
          fail_count: number
          locked_until: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          fail_count?: number
          locked_until?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          fail_count?: number
          locked_until?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          cancellation_strikes: number
          created_at: string
          email: string | null
          full_name: string
          id: string
          phone: string | null
          restricted_until: string | null
          restriction_reason: string | null
          status: Database["public"]["Enums"]["account_status"]
          terms_accepted_at: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          cancellation_strikes?: number
          created_at?: string
          email?: string | null
          full_name: string
          id: string
          phone?: string | null
          restricted_until?: string | null
          restriction_reason?: string | null
          status?: Database["public"]["Enums"]["account_status"]
          terms_accepted_at?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          cancellation_strikes?: number
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          restricted_until?: string | null
          restriction_reason?: string | null
          status?: Database["public"]["Enums"]["account_status"]
          terms_accepted_at?: string | null
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
      reports: {
        Row: {
          admin_notes: string | null
          created_at: string
          description: string
          id: string
          job_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          description: string
          id?: string
          job_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          description?: string
          id?: string
          job_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
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
      thread_summaries: {
        Row: {
          conversation_id: string
          summarized_at: string
          summary: string
          summary_prompt: Json
          updated_at: string
        }
        Insert: {
          conversation_id: string
          summarized_at?: string
          summary: string
          summary_prompt?: Json
          updated_at?: string
        }
        Update: {
          conversation_id?: string
          summarized_at?: string
          summary?: string
          summary_prompt?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_summaries_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
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
      wallet_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          meta: Json
          user_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          meta?: Json
          user_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          meta?: Json
          user_id?: string
        }
        Relationships: []
      }
      wallet_topup_requests: {
        Row: {
          amount: number
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          method: string
          note: string | null
          reference: string | null
          reject_reason: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          method: string
          note?: string | null
          reference?: string | null
          reject_reason?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          method?: string
          note?: string | null
          reference?: string | null
          reject_reason?: string | null
          status?: string
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
      wallet_withdrawal_requests: {
        Row: {
          amount: number
          created_at: string
          decided_at: string | null
          decided_by: string | null
          destination: string
          id: string
          method: string
          note: string | null
          reject_reason: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          destination: string
          id?: string
          method: string
          note?: string | null
          reject_reason?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          destination?: string
          id?: string
          method?: string
          note?: string | null
          reject_reason?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          balance: number
          held: number
          limited: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          held?: number
          limited?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          held?: number
          limited?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      driver_public_profiles: {
        Row: {
          jobs_completed: number | null
          level: Database["public"]["Enums"]["driver_level"] | null
          rating_avg: number | null
          rating_count: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_bid: {
        Args: { _bid_id: string }
        Returns: {
          accepted_bid_id: string | null
          budget: number
          cancellation_reason: string | null
          cancellation_stage: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commission: number | null
          completed_at: string | null
          created_at: string
          custom_material: string | null
          customer_id: string
          delivered_quantity_m3: number | null
          delivery_address: string
          delivery_lat: number | null
          delivery_lng: number | null
          delivery_photo_taken_at: string | null
          delivery_photo_url: string | null
          driver_id: string | null
          dropoff_address: string | null
          dropoff_lat: number | null
          dropoff_lng: number | null
          expires_at: string | null
          final_price: number | null
          held_commission: number | null
          id: string
          material: Database["public"]["Enums"]["material_category"]
          notes: string | null
          pickup_address: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_photo_taken_at: string | null
          pickup_photo_url: string | null
          preferred_date: string | null
          quantity_m3: number
          receiver_name: string | null
          status: Database["public"]["Enums"]["job_status"]
          tracking_token: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      accept_dispatch_offer: { Args: { _offer_id: string }; Returns: string }
      admin_approve_topup: {
        Args: { _id: string }
        Returns: {
          balance: number
          held: number
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
      admin_approve_withdrawal: {
        Args: { _id: string }
        Returns: {
          balance: number
          held: number
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
      admin_credit_wallet: {
        Args: { _amount: number; _note: string; _user_id: string }
        Returns: {
          balance: number
          held: number
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
      admin_evidence_paths: {
        Args: { _job_id: string }
        Returns: {
          evidence_id: string
          kind: string
          storage_path: string
        }[]
      }
      admin_grant_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      admin_job_evidence: { Args: { _job_id: string }; Returns: Json }
      admin_job_investigation: { Args: { _job_id: string }; Returns: Json }
      admin_material_prices: { Args: never; Returns: Json }
      admin_reject_topup: {
        Args: { _id: string; _reason: string }
        Returns: {
          amount: number
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          method: string
          note: string | null
          reference: string | null
          reject_reason: string | null
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "wallet_topup_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_reject_withdrawal: {
        Args: { _id: string; _reason: string }
        Returns: {
          amount: number
          created_at: string
          decided_at: string | null
          decided_by: string | null
          destination: string
          id: string
          method: string
          note: string | null
          reject_reason: string | null
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "wallet_withdrawal_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_revoke_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      admin_set_commission: { Args: { _rate: number }; Returns: Json }
      admin_set_demand_multiplier: {
        Args: { _multiplier: number; _reason: string }
        Returns: number
      }
      admin_set_driver_verification: {
        Args: { _notes?: string; _status: string; _user_id: string }
        Returns: {
          certificate_of_fitness_url: string | null
          created_at: string
          first_job_free_used: boolean
          git_insurance_url: string | null
          jobs_completed: number
          level: Database["public"]["Enums"]["driver_level"]
          license_url: string | null
          national_id: string | null
          national_id_url: string | null
          nationality: string | null
          operator_license_url: string | null
          rating_avg: number
          rating_count: number
          selfie_url: string | null
          tipper_photo_url: string | null
          updated_at: string
          user_id: string
          verification_notes: string | null
          verification_status: Database["public"]["Enums"]["verification_status"]
          withdrawal_pin_hash: string | null
          zinara_url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "driver_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_material_price:
        | {
            Args: {
              _demand_multiplier?: number
              _enforced?: boolean
              _label?: string
              _material: Database["public"]["Enums"]["material_category"]
              _max_price: number
              _min_price: number
              _reason?: string
            }
            Returns: {
              demand_multiplier: number
              enforced: boolean
              label: string
              material: Database["public"]["Enums"]["material_category"]
              max_price: number
              min_price: number
              unit: string
              updated_at: string
              updated_by: string | null
            }
            SetofOptions: {
              from: "*"
              to: "material_prices"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              _enforced: boolean
              _material: string
              _max_price: number
              _min_price: number
              _reason: string
            }
            Returns: undefined
          }
      admin_set_user_status: {
        Args: {
          _status: Database["public"]["Enums"]["account_status"]
          _user_id: string
        }
        Returns: {
          avatar_url: string | null
          cancellation_strikes: number
          created_at: string
          email: string | null
          full_name: string
          id: string
          phone: string | null
          restricted_until: string | null
          restriction_reason: string | null
          status: Database["public"]["Enums"]["account_status"]
          terms_accepted_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_waive_strike: {
        Args: { _event_id: string; _reason: string }
        Returns: Json
      }
      cancel_job: {
        Args: { _job_id: string; _reason?: string }
        Returns: {
          accepted_bid_id: string | null
          budget: number
          cancellation_reason: string | null
          cancellation_stage: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commission: number | null
          completed_at: string | null
          created_at: string
          custom_material: string | null
          customer_id: string
          delivered_quantity_m3: number | null
          delivery_address: string
          delivery_lat: number | null
          delivery_lng: number | null
          delivery_photo_taken_at: string | null
          delivery_photo_url: string | null
          driver_id: string | null
          dropoff_address: string | null
          dropoff_lat: number | null
          dropoff_lng: number | null
          expires_at: string | null
          final_price: number | null
          held_commission: number | null
          id: string
          material: Database["public"]["Enums"]["material_category"]
          notes: string | null
          pickup_address: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_photo_taken_at: string | null
          pickup_photo_url: string | null
          preferred_date: string | null
          quantity_m3: number
          receiver_name: string | null
          status: Database["public"]["Enums"]["job_status"]
          tracking_token: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_topup: {
        Args: { _id: string }
        Returns: {
          amount: number
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          method: string
          note: string | null
          reference: string | null
          reject_reason: string | null
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "wallet_topup_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_withdrawal: {
        Args: { _id: string }
        Returns: {
          amount: number
          created_at: string
          decided_at: string | null
          decided_by: string | null
          destination: string
          id: string
          method: string
          note: string | null
          reject_reason: string | null
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "wallet_withdrawal_requests"
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
          cancellation_reason: string | null
          cancellation_stage: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commission: number | null
          completed_at: string | null
          created_at: string
          custom_material: string | null
          customer_id: string
          delivered_quantity_m3: number | null
          delivery_address: string
          delivery_lat: number | null
          delivery_lng: number | null
          delivery_photo_taken_at: string | null
          delivery_photo_url: string | null
          driver_id: string | null
          dropoff_address: string | null
          dropoff_lat: number | null
          dropoff_lng: number | null
          expires_at: string | null
          final_price: number | null
          held_commission: number | null
          id: string
          material: Database["public"]["Enums"]["material_category"]
          notes: string | null
          pickup_address: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_photo_taken_at: string | null
          pickup_photo_url: string | null
          preferred_date: string | null
          quantity_m3: number
          receiver_name: string | null
          status: Database["public"]["Enums"]["job_status"]
          tracking_token: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      compute_material_offer: {
        Args: {
          _distance_km: number
          _material: Database["public"]["Enums"]["material_category"]
          _quantity: number
        }
        Returns: Json
      }
      count_available_verified_drivers: {
        Args: { _job_id: string }
        Returns: number
      }
      create_dispatch_wave: {
        Args: { _job_id: string; _limit?: number }
        Returns: number
      }
      credit_wallet_from_payment: {
        Args: { _payment_id: string }
        Returns: {
          balance: number
          held: number
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
      driver_active_jobs: {
        Args: never
        Returns: {
          accepted_at: string
          custom_material: string
          customer_name: string
          customer_phone: string
          delivery_address: string
          delivery_lat: number
          delivery_lng: number
          delivery_photo_url: string
          final_price: number
          held_commission: number
          id: string
          material: string
          notes: string
          pickup_photo_url: string
          preferred_date: string
          quantity_m3: number
          status: string
        }[]
      }
      driver_available_jobs: {
        Args: { _limit?: number; _offset?: number }
        Returns: {
          bid_count: number
          budget: number
          can_afford: boolean
          commission_due: number
          created_at: string
          custom_material: string
          delivery_address: string
          delivery_lat: number
          delivery_lng: number
          expires_at: string
          id: string
          material: string
          my_bid_id: string
          my_bid_price: number
          my_offer_id: string
          notes: string
          offer_expires_at: string
          preferred_date: string
          quantity_m3: number
        }[]
      }
      driver_can_accept: { Args: { _job_id: string }; Returns: Json }
      driver_can_accept_for: {
        Args: { _driver_id: string; _job_id: string }
        Returns: Json
      }
      driver_dashboard_summary: { Args: never; Returns: Json }
      driver_job_history: {
        Args: { _limit?: number; _offset?: number }
        Returns: {
          cancellation_reason: string
          cancelled_at: string
          cancelled_by_me: boolean
          commission: number
          completed_at: string
          custom_material: string
          customer_name: string
          delivery_address: string
          final_price: number
          id: string
          material: string
          net_earned: number
          pod_token: string
          quantity_m3: number
          status: string
          total_count: number
        }[]
      }
      enforce_customer_strikes: {
        Args: {
          _job_id: string
          _reason: string
          _stage: string
          _user_id: string
        }
        Returns: Json
      }
      escalate_overdue_disputes: { Args: never; Returns: number }
      evidence_distance_m: {
        Args: { _job_id: string; _kind: string }
        Returns: number
      }
      expire_stale_accepted_jobs: { Args: never; Returns: number }
      expire_stale_dispatch_offers: {
        Args: { _job_id: string }
        Returns: number
      }
      expire_stale_open_jobs: { Args: never; Returns: number }
      get_public_tracking: { Args: { _token: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hold_job_commission: { Args: { _job_id: string }; Returns: number }
      log_admin_action: {
        Args: {
          _action: string
          _meta?: Json
          _reason?: string
          _target_id?: string
          _target_user?: string
        }
        Returns: undefined
      }
      log_evidence_access: {
        Args: { _evidence_id: string; _purpose?: string }
        Returns: string
      }
      raise_dispute: {
        Args: {
          _against: string
          _category: string
          _job_id: string
          _reason: string
        }
        Returns: {
          against: string | null
          category: Database["public"]["Enums"]["dispute_category"]
          created_at: string
          id: string
          job_id: string
          outcome: Database["public"]["Enums"]["dispute_outcome"] | null
          raised_by: string
          reason: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          review_due_at: string | null
          status: Database["public"]["Enums"]["dispute_status"]
        }
        SetofOptions: {
          from: "*"
          to: "disputes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recent_cancellation_strikes: {
        Args: { _user_id: string }
        Returns: number
      }
      record_job_evidence: {
        Args: {
          _accuracy_m?: number
          _file_size?: number
          _job_id: string
          _kind: string
          _lat?: number
          _lng?: number
          _location_status?: string
          _mime_type?: string
          _storage_path: string
        }
        Returns: {
          device_accuracy_m: number | null
          device_lat: number | null
          device_lng: number | null
          file_size: number | null
          id: string
          job_id: string
          kind: string
          location_status: string
          mime_type: string | null
          notes: string | null
          storage_path: string
          superseded_at: string | null
          superseded_by: string | null
          uploaded_at: string
          uploaded_by: string
        }
        SetofOptions: {
          from: "*"
          to: "job_evidence"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_job_commission: { Args: { _job_id: string }; Returns: number }
      request_topup: {
        Args: { _amount: number; _method: string; _reference: string }
        Returns: {
          amount: number
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          method: string
          note: string | null
          reference: string | null
          reject_reason: string | null
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "wallet_topup_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_withdrawal: {
        Args: {
          _amount: number
          _destination: string
          _method: string
          _pin: string
        }
        Returns: {
          amount: number
          created_at: string
          decided_at: string | null
          decided_by: string | null
          destination: string
          id: string
          method: string
          note: string | null
          reject_reason: string | null
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "wallet_withdrawal_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_dispute: {
        Args: { _dispute_id: string; _outcome: string; _resolution: string }
        Returns: {
          against: string | null
          category: Database["public"]["Enums"]["dispute_category"]
          created_at: string
          id: string
          job_id: string
          outcome: Database["public"]["Enums"]["dispute_outcome"] | null
          raised_by: string
          reason: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          review_due_at: string | null
          status: Database["public"]["Enums"]["dispute_status"]
        }
        SetofOptions: {
          from: "*"
          to: "disputes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_withdrawal_pin: { Args: { _pin: string }; Returns: undefined }
      start_trip: {
        Args: { _job_id: string }
        Returns: {
          accepted_bid_id: string | null
          budget: number
          cancellation_reason: string | null
          cancellation_stage: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commission: number | null
          completed_at: string | null
          created_at: string
          custom_material: string | null
          customer_id: string
          delivered_quantity_m3: number | null
          delivery_address: string
          delivery_lat: number | null
          delivery_lng: number | null
          delivery_photo_taken_at: string | null
          delivery_photo_url: string | null
          driver_id: string | null
          dropoff_address: string | null
          dropoff_lat: number | null
          dropoff_lng: number | null
          expires_at: string | null
          final_price: number | null
          held_commission: number | null
          id: string
          material: Database["public"]["Enums"]["material_category"]
          notes: string | null
          pickup_address: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_photo_taken_at: string | null
          pickup_photo_url: string | null
          preferred_date: string | null
          quantity_m3: number
          receiver_name: string | null
          status: Database["public"]["Enums"]["job_status"]
          tracking_token: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sweep_stalled_dispatch_offers: { Args: never; Returns: undefined }
      wallet_available: { Args: { _user_id: string }; Returns: number }
    }
    Enums: {
      account_status: "active" | "suspended" | "banned"
      app_role: "customer" | "driver" | "admin" | "super_admin"
      bid_status: "pending" | "accepted" | "rejected" | "withdrawn"
      dispatch_offer_status:
        | "pending"
        | "accepted"
        | "expired"
        | "superseded"
        | "rejected"
      dispute_category:
        | "wrong_quantity"
        | "damage"
        | "no_show"
        | "payment_issue"
        | "conduct"
        | "other"
      dispute_outcome:
        | "refund"
        | "fee_waived"
        | "strike_issued"
        | "no_action"
        | "account_suspended"
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
      tx_type: "topup" | "commission" | "refund" | "adjustment" | "withdrawal"
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
      dispatch_offer_status: [
        "pending",
        "accepted",
        "expired",
        "superseded",
        "rejected",
      ],
      dispute_category: [
        "wrong_quantity",
        "damage",
        "no_show",
        "payment_issue",
        "conduct",
        "other",
      ],
      dispute_outcome: [
        "refund",
        "fee_waived",
        "strike_issued",
        "no_action",
        "account_suspended",
      ],
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
      tx_type: ["topup", "commission", "refund", "adjustment", "withdrawal"],
      verification_status: ["pending", "verified", "rejected"],
    },
  },
} as const
