export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type TableDefinition<Row, Insert = Row, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  moons: {
    Tables: {
      activity_log: TableDefinition<
        {
          id: string;
          owner_user_id: string | null;
          run_id: string | null;
          event_type: string;
          payload: Json;
          created_at: string;
        },
        {
          id?: string;
          owner_user_id?: string | null;
          run_id?: string | null;
          event_type: string;
          payload?: Json;
          created_at?: string;
        }
      >;
      brand_learning: TableDefinition<
        {
          id: string;
          client_id: string;
          polarity: "working" | "avoid";
          note: string;
          source_run_id: string | null;
          created_at: string;
        },
        {
          id?: string;
          client_id: string;
          polarity: "working" | "avoid";
          note: string;
          source_run_id?: string | null;
          created_at?: string;
        }
      >;
      brand_analysis_jobs: TableDefinition<
        {
          id: string;
          client_id: string;
          status:
            | "queued"
            | "validating_source"
            | "scraping_facebook_posts"
            | "scraping_facebook_ads"
            | "searching_fallback"
            | "mirroring_images"
            | "analyzing_visuals"
            | "analyzing_brand"
            | "writing_memory"
            | "ready"
            | "needs_review"
            | "failed";
          current_step: string;
          source_status: Json;
          error_message: string | null;
          trace_id: string | null;
          created_by: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          client_id: string;
          status?:
            | "queued"
            | "validating_source"
            | "scraping_facebook_posts"
            | "scraping_facebook_ads"
            | "searching_fallback"
            | "mirroring_images"
            | "analyzing_visuals"
            | "analyzing_brand"
            | "writing_memory"
            | "ready"
            | "needs_review"
            | "failed";
          current_step?: string;
          source_status?: Json;
          error_message?: string | null;
          trace_id?: string | null;
          created_by?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      brand_library: TableDefinition<
        {
          id: string;
          client_id: string;
          section: "brand" | "products" | "docs" | "refs";
          title: string;
          description: string;
          asset_url: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          client_id: string;
          section: "brand" | "products" | "docs" | "refs";
          title: string;
          description?: string;
          asset_url?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        }
      >;
      brand_documents: TableDefinition<
        {
          id: string;
          client_id: string;
          title: string;
          document_type:
            | "brand_guideline"
            | "product_factsheet"
            | "campaign_brief"
            | "claim_support"
            | "reference"
            | "report"
            | "other";
          file_url: string | null;
          storage_path: string | null;
          mime_type: string | null;
          extracted_text: string | null;
          processing_status:
            | "uploaded"
            | "processing"
            | "ready_for_ai"
            | "failed";
          usable_for_ai: boolean;
          uploaded_by: string | null;
          uploaded_at: string;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          client_id: string;
          title: string;
          document_type?:
            | "brand_guideline"
            | "product_factsheet"
            | "campaign_brief"
            | "claim_support"
            | "reference"
            | "report"
            | "other";
          file_url?: string | null;
          storage_path?: string | null;
          mime_type?: string | null;
          extracted_text?: string | null;
          processing_status?:
            | "uploaded"
            | "processing"
            | "ready_for_ai"
            | "failed";
          usable_for_ai?: boolean;
          uploaded_by?: string | null;
          uploaded_at?: string;
          created_at?: string;
          updated_at?: string;
        }
      >;
      brand_products: TableDefinition<
        {
          id: string;
          client_id: string;
          name: string;
          description: string;
          key_benefit: string | null;
          audience: string | null;
          offer: string | null;
          price: string | null;
          landing_url: string | null;
          claim_notes: string | null;
          is_active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          client_id: string;
          name: string;
          description?: string;
          key_benefit?: string | null;
          audience?: string | null;
          offer?: string | null;
          price?: string | null;
          landing_url?: string | null;
          claim_notes?: string | null;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        }
      >;
      brand_references: TableDefinition<
        {
          id: string;
          client_id: string;
          title: string;
          reference_type:
            | "inspiration"
            | "avoid"
            | "competitor"
            | "past_winner"
            | "other";
          asset_url: string | null;
          source_url: string | null;
          note: string;
          tags: string[];
          is_approved: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          client_id: string;
          title: string;
          reference_type:
            | "inspiration"
            | "avoid"
            | "competitor"
            | "past_winner"
            | "other";
          asset_url?: string | null;
          source_url?: string | null;
          note?: string;
          tags?: string[];
          is_approved?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        }
      >;
      clients: TableDefinition<
        {
          id: string;
          name: string;
          category: string;
          initials: string;
          source: string;
          is_active: boolean;
          facebook_url: string | null;
          ingestion_status:
            | "not_started"
            | "draft"
            | "queued"
            | "validating_source"
            | "scraping_facebook_posts"
            | "scraping_facebook_ads"
            | "searching_fallback"
            | "mirroring_images"
            | "analyzing_visuals"
            | "analyzing_brand"
            | "writing_memory"
            | "ready"
            | "needs_review"
            | "failed";
          ingestion_error: string | null;
          last_ingested_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id: string;
          name: string;
          category: string;
          initials: string;
          source?: string;
          is_active?: boolean;
          facebook_url?: string | null;
          ingestion_status?:
            | "not_started"
            | "draft"
            | "queued"
            | "validating_source"
            | "scraping_facebook_posts"
            | "scraping_facebook_ads"
            | "searching_fallback"
            | "mirroring_images"
            | "analyzing_visuals"
            | "analyzing_brand"
            | "writing_memory"
            | "ready"
            | "needs_review"
            | "failed";
          ingestion_error?: string | null;
          last_ingested_at?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      brand_sources: TableDefinition<
        {
          id: string;
          client_id: string;
          job_id: string | null;
          source_type:
            | "facebook_posts"
            | "facebook_ads_library"
            | "google_search"
            | "manual_input";
          source_url: string | null;
          status: "succeeded" | "partial" | "failed";
          raw_payload: Json;
          error_message: string | null;
          collected_at: string;
          created_at: string;
        },
        {
          id?: string;
          client_id: string;
          job_id?: string | null;
          source_type:
            | "facebook_posts"
            | "facebook_ads_library"
            | "google_search"
            | "manual_input";
          source_url?: string | null;
          status: "succeeded" | "partial" | "failed";
          raw_payload?: Json;
          error_message?: string | null;
          collected_at?: string;
          created_at?: string;
        }
      >;
      brand_social_posts: TableDefinition<
        {
          id: string;
          client_id: string;
          source_id: string;
          post_url: string;
          text: string;
          likes: number;
          shares: number;
          comments: number;
          media_count: number;
          image_count: number;
          raw_payload: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          client_id: string;
          source_id: string;
          post_url: string;
          text?: string;
          likes?: number;
          shares?: number;
          comments?: number;
          media_count?: number;
          image_count?: number;
          raw_payload?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      brand_ad_library_items: TableDefinition<
        {
          id: string;
          client_id: string;
          source_id: string;
          ad_archive_id: string;
          page_id: string | null;
          page_name: string | null;
          ad_library_url: string | null;
          page_url: string | null;
          is_active: boolean;
          started_at: string | null;
          ended_at: string | null;
          platforms: string[];
          display_format: string | null;
          body_text: string;
          title: string | null;
          caption: string | null;
          cta_text: string | null;
          cta_type: string | null;
          link_url: string | null;
          image_count: number;
          raw_payload: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          client_id: string;
          source_id: string;
          ad_archive_id: string;
          page_id?: string | null;
          page_name?: string | null;
          ad_library_url?: string | null;
          page_url?: string | null;
          is_active?: boolean;
          started_at?: string | null;
          ended_at?: string | null;
          platforms?: string[];
          display_format?: string | null;
          body_text?: string;
          title?: string | null;
          caption?: string | null;
          cta_text?: string | null;
          cta_type?: string | null;
          link_url?: string | null;
          image_count?: number;
          raw_payload?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      brand_visual_assets: TableDefinition<
        {
          id: string;
          client_id: string;
          source_id: string | null;
          social_post_id: string | null;
          ad_item_id: string | null;
          source_type: "facebook_post" | "facebook_ad" | "google_search";
          source_url: string | null;
          source_item_id: string | null;
          media_kind: "image";
          original_url_hash: string | null;
          asset_bucket: string;
          asset_storage_path: string;
          asset_url: string | null;
          caption_context: string;
          ocr_text: string | null;
          analysis_status: "pending" | "analyzing" | "completed" | "failed";
          visual_summary: Json;
          raw_vision_output: Json;
          error_message: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          client_id: string;
          source_id?: string | null;
          social_post_id?: string | null;
          ad_item_id?: string | null;
          source_type: "facebook_post" | "facebook_ad" | "google_search";
          source_url?: string | null;
          source_item_id?: string | null;
          media_kind?: "image";
          original_url_hash?: string | null;
          asset_bucket?: string;
          asset_storage_path: string;
          asset_url?: string | null;
          caption_context?: string;
          ocr_text?: string | null;
          analysis_status?: "pending" | "analyzing" | "completed" | "failed";
          visual_summary?: Json;
          raw_vision_output?: Json;
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      client_review_items: TableDefinition<
        {
          id: string;
          review_link_id: string;
          output_id: string;
          status: "sent" | "approved" | "revision";
          revision_round: number;
          comment: string | null;
          decided_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          review_link_id: string;
          output_id: string;
          status?: "sent" | "approved" | "revision";
          revision_round?: number;
          comment?: string | null;
          decided_at?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      client_review_links: TableDefinition<
        {
          id: string;
          run_id: string;
          token_hash: string;
          status: "active" | "expired" | "revoked";
          expires_at: string | null;
          created_by: string | null;
          created_at: string;
          revoked_at: string | null;
        },
        {
          id?: string;
          run_id: string;
          token_hash: string;
          status?: "active" | "expired" | "revoked";
          expires_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          revoked_at?: string | null;
        }
      >;
      creative_directions: TableDefinition<
        {
          id: string;
          run_id: string;
          job_id: string | null;
          position: number;
          hook: string;
          concept: string;
          why: string;
          visual: string;
          cta: string;
          caption: string;
          citations: Json;
          ranking_score: number | null;
          selected: boolean;
          provider: string | null;
          model: string | null;
          generation_version: string | null;
          raw_output: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          run_id: string;
          job_id?: string | null;
          position: number;
          hook: string;
          concept?: string;
          why?: string;
          visual?: string;
          cta?: string;
          caption?: string;
          citations?: Json;
          ranking_score?: number | null;
          selected?: boolean;
          provider?: string | null;
          model?: string | null;
          generation_version?: string | null;
          raw_output?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      selected_hook_learning_candidates: TableDefinition<
        {
          id: string;
          client_id: string;
          workspace_run_id: string;
          direction_id: string;
          output_id: string;
          service: string;
          artwork_mode: string;
          hook_text: string;
          concept: string;
          rationale: string;
          visual_direction: string;
          cta: string;
          caption: string;
          hook_payload: Json;
          image_url: string | null;
          asset_bucket: string;
          asset_storage_path: string;
          provider: string | null;
          model: string | null;
          created_by: string | null;
          selected_at: string;
          generated_at: string;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          client_id: string;
          workspace_run_id: string;
          direction_id: string;
          output_id: string;
          service: string;
          artwork_mode: string;
          hook_text: string;
          concept?: string;
          rationale?: string;
          visual_direction?: string;
          cta?: string;
          caption?: string;
          hook_payload?: Json;
          image_url?: string | null;
          asset_bucket: string;
          asset_storage_path: string;
          provider?: string | null;
          model?: string | null;
          created_by?: string | null;
          selected_at?: string;
          generated_at?: string;
          created_at?: string;
          updated_at?: string;
        }
      >;
      exports: TableDefinition<
        {
          id: string;
          run_id: string;
          job_id: string | null;
          format: "csv" | "pptx";
          file_url: string | null;
          status: "queued" | "processing" | "completed" | "failed";
          error_message: string | null;
          created_by: string | null;
          created_at: string;
          completed_at: string | null;
        },
        {
          id?: string;
          run_id: string;
          job_id?: string | null;
          format: "csv" | "pptx";
          file_url?: string | null;
          status?: "queued" | "processing" | "completed" | "failed";
          error_message?: string | null;
          created_by?: string | null;
          created_at?: string;
          completed_at?: string | null;
        }
      >;
      internal_reviews: TableDefinition<
        {
          id: string;
          run_id: string;
          output_id: string | null;
          role: "gd" | "cs" | "pm";
          status: "pending" | "approved" | "rejected";
          reviewer_user_id: string | null;
          reviewer_name: string | null;
          comment: string | null;
          replacement_asset_url: string | null;
          reviewed_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          run_id: string;
          output_id?: string | null;
          role: "gd" | "cs" | "pm";
          status: "pending" | "approved" | "rejected";
          reviewer_user_id?: string | null;
          reviewer_name?: string | null;
          comment?: string | null;
          replacement_asset_url?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      jobs: TableDefinition<
        {
          id: string;
          owner_user_id: string;
          run_id: string | null;
          type: "hooks" | "artwork" | "caption" | "qa" | "export";
          status: "queued" | "processing" | "completed" | "failed" | "cancelled";
          progress: number;
          idempotency_key: string;
          provider: string | null;
          model: string | null;
          input: Json;
          output: Json;
          error_message: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          owner_user_id: string;
          run_id?: string | null;
          type: "hooks" | "artwork" | "caption" | "qa" | "export";
          status: "queued" | "processing" | "completed" | "failed" | "cancelled";
          progress?: number;
          idempotency_key: string;
          provider?: string | null;
          model?: string | null;
          input?: Json;
          output?: Json;
          error_message?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      outputs: TableDefinition<
        {
          id: string;
          run_id: string;
          direction_id: string;
          format: string;
          status: string;
          client_status: string;
          revision_count: number;
          asset_url: string | null;
          asset_bucket: string | null;
          asset_storage_path: string | null;
          provider: string | null;
          model: string | null;
          payload: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          run_id: string;
          direction_id: string;
          format: string;
          status: string;
          client_status: string;
          revision_count?: number;
          asset_url?: string | null;
          asset_bucket?: string | null;
          asset_storage_path?: string | null;
          provider?: string | null;
          model?: string | null;
          payload?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      qa_results: TableDefinition<
        {
          id: string;
          output_id: string;
          job_id: string | null;
          status: "pass" | "moons_fixed_it" | "needs_revise";
          issues: Json;
          fix_applied: boolean;
          fix_summary: string | null;
          checked_by: string;
          checked_at: string;
          created_at: string;
        },
        {
          id?: string;
          output_id: string;
          job_id?: string | null;
          status: "pass" | "moons_fixed_it" | "needs_revise";
          issues?: Json;
          fix_applied?: boolean;
          fix_summary?: string | null;
          checked_by?: string;
          checked_at?: string;
          created_at?: string;
        }
      >;
      runs: TableDefinition<
        {
          id: string;
          owner_user_id: string;
          client_id: string | null;
          workspace_run_id: string | null;
          snapshot: Json | null;
          current_owner_user_id: string;
          status: "active" | "completed" | "archived";
          version: number;
          updated_by: string | null;
          completed_at: string | null;
          stage: string;
          service: string;
          quantity: number;
          brief: string;
          is_pitching: boolean;
          pitching_save_name: string | null;
          expires_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          owner_user_id: string;
          client_id?: string | null;
          workspace_run_id?: string | null;
          snapshot?: Json | null;
          current_owner_user_id: string;
          status?: "active" | "completed" | "archived";
          version?: number;
          updated_by?: string | null;
          completed_at?: string | null;
          stage: string;
          service: string;
          quantity: number;
          brief?: string;
          is_pitching?: boolean;
          pitching_save_name?: string | null;
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      run_checkpoints: TableDefinition<
        {
          id: string;
          run_id: string;
          reason: "regenerate" | "replace-image" | "send-to-qc";
          snapshot: Json;
          source_version: number;
          created_by: string;
          created_at: string;
        },
        {
          id?: string;
          run_id: string;
          reason: "regenerate" | "replace-image" | "send-to-qc";
          snapshot: Json;
          source_version: number;
          created_by: string;
          created_at?: string;
        }
      >;
      run_handoffs: TableDefinition<
        {
          id: string;
          run_id: string;
          from_user_id: string;
          to_user_id: string;
          from_department: string;
          to_department: string;
          note: string | null;
          version: number;
          created_by: string;
          created_at: string;
        },
        {
          id?: string;
          run_id: string;
          from_user_id: string;
          to_user_id: string;
          from_department: string;
          to_department: string;
          note?: string | null;
          version: number;
          created_by: string;
          created_at?: string;
        }
      >;
      client_memberships: TableDefinition<
        {
          client_id: string;
          user_id: string;
          role: "member" | "lead" | "admin";
          created_by: string | null;
          created_at: string;
        },
        {
          client_id: string;
          user_id: string;
          role?: "member" | "lead" | "admin";
          created_by?: string | null;
          created_at?: string;
        }
      >;
      team_profiles: TableDefinition<
        {
          user_id: string;
          email: string;
          display_name: string;
          department: "cs" | "gd" | "pm" | "admin" | "unassigned";
          is_admin: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          user_id: string;
          email: string;
          display_name: string;
          department?: "cs" | "gd" | "pm" | "admin" | "unassigned";
          is_admin?: boolean;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        }
      >;
      workspaces: TableDefinition<
        {
          id: string;
          owner_user_id: string;
          schema_version: number;
          snapshot: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          owner_user_id: string;
          schema_version: number;
          snapshot: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      is_convert_cake_user: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      handoff_run: {
        Args: {
          p_workspace_run_id: string;
          p_to_user_id: string;
          p_expected_version: number;
          p_note?: string | null;
        };
        Returns: {
          workspace_run_id: string;
          current_owner_user_id: string;
          version: number;
          updated_at: string;
        }[];
      };
      restore_run_checkpoint: {
        Args: {
          p_checkpoint_id: string;
          p_workspace_run_id: string;
          p_expected_version: number;
        };
        Returns: {
          workspace_run_id: string;
          current_owner_user_id: string;
          version: number;
          snapshot: Json;
          updated_at: string;
        }[];
      };
      set_client_pic: {
        Args: {
          p_client_id: string;
          p_user_id: string;
        };
        Returns: {
          client_id: string;
          user_id: string;
          role: "member" | "lead" | "admin";
        }[];
      };
      claim_next_brand_analysis_job: {
        Args: Record<string, never>;
        Returns: {
          job_id: string;
          client_id: string;
          client_name: string;
          facebook_url: string | null;
        }[];
      };
      queue_brand_analysis: {
        Args: {
          p_client_id: string;
          p_facebook_url: string;
        };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
