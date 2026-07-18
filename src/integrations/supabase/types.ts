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
      activity_log: {
        Row: {
          context: Json | null
          created_at: string
          id: string
          message: string
          severity: string
        }
        Insert: {
          context?: Json | null
          created_at?: string
          id?: string
          message: string
          severity?: string
        }
        Update: {
          context?: Json | null
          created_at?: string
          id?: string
          message?: string
          severity?: string
        }
        Relationships: []
      }
      live_runners: {
        Row: {
          created_at: string
          exec_preset: string
          id: string
          label: string
          last_tick_at: string | null
          last_tick_error: string | null
          leverage: number
          lookback_days: number
          risk_usd: number
          running: boolean
          source: string
          started_at: string | null
          strategy_preset: string
          symbol: string
          timeframe: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          exec_preset: string
          id?: string
          label: string
          last_tick_at?: string | null
          last_tick_error?: string | null
          leverage?: number
          lookback_days?: number
          risk_usd?: number
          running?: boolean
          source?: string
          started_at?: string | null
          strategy_preset: string
          symbol: string
          timeframe: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          exec_preset?: string
          id?: string
          label?: string
          last_tick_at?: string | null
          last_tick_error?: string | null
          leverage?: number
          lookback_days?: number
          risk_usd?: number
          running?: boolean
          source?: string
          started_at?: string | null
          strategy_preset?: string
          symbol?: string
          timeframe?: string
          updated_at?: string
        }
        Relationships: []
      }
      live_trades: {
        Row: {
          client_order_id: string | null
          created_at: string
          dedup_key: string
          direction: string
          entry_price: number
          entry_ts: string
          error: string | null
          exit_client_order_id: string | null
          exit_price: number | null
          exit_reason: string | null
          exit_ts: string | null
          fees: number | null
          fill_price: number | null
          fill_ts: string | null
          gross_pnl: number | null
          id: string
          net_pnl: number | null
          qty: number
          raw_place: Json | null
          rr: number | null
          runner_id: string
          status: string
          stop_price: number
          strategy_preset: string
          symbol: string
          target_price: number
          timeframe: string
          updated_at: string
        }
        Insert: {
          client_order_id?: string | null
          created_at?: string
          dedup_key: string
          direction: string
          entry_price: number
          entry_ts: string
          error?: string | null
          exit_client_order_id?: string | null
          exit_price?: number | null
          exit_reason?: string | null
          exit_ts?: string | null
          fees?: number | null
          fill_price?: number | null
          fill_ts?: string | null
          gross_pnl?: number | null
          id?: string
          net_pnl?: number | null
          qty: number
          raw_place?: Json | null
          rr?: number | null
          runner_id: string
          status?: string
          stop_price: number
          strategy_preset: string
          symbol: string
          target_price: number
          timeframe: string
          updated_at?: string
        }
        Update: {
          client_order_id?: string | null
          created_at?: string
          dedup_key?: string
          direction?: string
          entry_price?: number
          entry_ts?: string
          error?: string | null
          exit_client_order_id?: string | null
          exit_price?: number | null
          exit_reason?: string | null
          exit_ts?: string | null
          fees?: number | null
          fill_price?: number | null
          fill_ts?: string | null
          gross_pnl?: number | null
          id?: string
          net_pnl?: number | null
          qty?: number
          raw_place?: Json | null
          rr?: number | null
          runner_id?: string
          status?: string
          stop_price?: number
          strategy_preset?: string
          symbol?: string
          target_price?: number
          timeframe?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_trades_runner_id_fkey"
            columns: ["runner_id"]
            isOneToOne: false
            referencedRelation: "live_runners"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          error: string | null
          exchange_order_id: string | null
          filled_at: string | null
          filled_price: number | null
          id: string
          order_type: string
          paper: boolean
          price: number | null
          qty: number
          side: string
          status: string
          symbol: string
          webhook_event_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          exchange_order_id?: string | null
          filled_at?: string | null
          filled_price?: number | null
          id?: string
          order_type?: string
          paper?: boolean
          price?: number | null
          qty: number
          side: string
          status?: string
          symbol: string
          webhook_event_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          exchange_order_id?: string | null
          filled_at?: string | null
          filled_price?: number | null
          id?: string
          order_type?: string
          paper?: boolean
          price?: number | null
          qty?: number
          side?: string
          status?: string
          symbol?: string
          webhook_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_webhook_event_id_fkey"
            columns: ["webhook_event_id"]
            isOneToOne: false
            referencedRelation: "webhook_events"
            referencedColumns: ["id"]
          },
        ]
      }
      owner: {
        Row: {
          created_at: string
          id: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          id?: boolean
          user_id?: string
        }
        Relationships: []
      }
      paper_positions: {
        Row: {
          direction: string
          entry_price: number
          entry_ts: string
          last_price: number
          runner_id: string
          stop_price: number
          strategy_preset: string
          symbol: string
          target_price: number
          timeframe: string
          units: number
          unrealized_pnl: number
          updated_at: string
        }
        Insert: {
          direction: string
          entry_price: number
          entry_ts: string
          last_price: number
          runner_id: string
          stop_price: number
          strategy_preset: string
          symbol: string
          target_price: number
          timeframe: string
          units: number
          unrealized_pnl?: number
          updated_at?: string
        }
        Update: {
          direction?: string
          entry_price?: number
          entry_ts?: string
          last_price?: number
          runner_id?: string
          stop_price?: number
          strategy_preset?: string
          symbol?: string
          target_price?: number
          timeframe?: string
          units?: number
          unrealized_pnl?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_positions_runner_id_fkey"
            columns: ["runner_id"]
            isOneToOne: true
            referencedRelation: "paper_runners"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_runners: {
        Row: {
          created_at: string
          exec_preset: string
          id: string
          label: string
          last_tick_at: string | null
          last_tick_error: string | null
          lookback_days: number
          risk_usd: number
          running: boolean
          score: number | null
          source: string
          started_at: string | null
          strategy_preset: string
          symbol: string
          timeframe: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          exec_preset?: string
          id?: string
          label: string
          last_tick_at?: string | null
          last_tick_error?: string | null
          lookback_days?: number
          risk_usd?: number
          running?: boolean
          score?: number | null
          source?: string
          started_at?: string | null
          strategy_preset: string
          symbol: string
          timeframe: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          exec_preset?: string
          id?: string
          label?: string
          last_tick_at?: string | null
          last_tick_error?: string | null
          lookback_days?: number
          risk_usd?: number
          running?: boolean
          score?: number | null
          source?: string
          started_at?: string | null
          strategy_preset?: string
          symbol?: string
          timeframe?: string
          updated_at?: string
        }
        Relationships: []
      }
      paper_trades: {
        Row: {
          created_at: string
          dedup_key: string
          direction: string
          entry_price: number
          entry_ts: string
          exit_price: number
          exit_reason: string
          exit_ts: string
          fees: number
          fill_price: number
          gross_pnl: number
          id: string
          net_pnl: number
          rr: number
          runner_id: string
          stop_price: number
          strategy_preset: string
          symbol: string
          target_price: number
          timeframe: string
          units: number
        }
        Insert: {
          created_at?: string
          dedup_key: string
          direction: string
          entry_price: number
          entry_ts: string
          exit_price: number
          exit_reason: string
          exit_ts: string
          fees?: number
          fill_price: number
          gross_pnl?: number
          id?: string
          net_pnl?: number
          rr?: number
          runner_id: string
          stop_price: number
          strategy_preset: string
          symbol: string
          target_price: number
          timeframe: string
          units?: number
        }
        Update: {
          created_at?: string
          dedup_key?: string
          direction?: string
          entry_price?: number
          entry_ts?: string
          exit_price?: number
          exit_reason?: string
          exit_ts?: string
          fees?: number
          fill_price?: number
          gross_pnl?: number
          id?: string
          net_pnl?: number
          rr?: number
          runner_id?: string
          stop_price?: number
          strategy_preset?: string
          symbol?: string
          target_price?: number
          timeframe?: string
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "paper_trades_runner_id_fkey"
            columns: ["runner_id"]
            isOneToOne: false
            referencedRelation: "paper_runners"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_runs: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          log: Json
          matrix: Json
          progress: Json
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          log?: Json
          matrix: Json
          progress?: Json
          started_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          log?: Json
          matrix?: Json
          progress?: Json
          started_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      positions: {
        Row: {
          avg_entry_price: number
          opened_at: string
          paper: boolean
          qty: number
          symbol: string
          updated_at: string
        }
        Insert: {
          avg_entry_price?: number
          opened_at?: string
          paper?: boolean
          qty?: number
          symbol: string
          updated_at?: string
        }
        Update: {
          avg_entry_price?: number
          opened_at?: string
          paper?: boolean
          qty?: number
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      research_bookmarks: {
        Row: {
          created_at: string
          id: string
          label: string | null
          tags: string[]
          target_id: string
          target_kind: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string | null
          tags?: string[]
          target_id: string
          target_kind: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string | null
          tags?: string[]
          target_id?: string
          target_kind?: string
        }
        Relationships: []
      }
      research_changelog: {
        Row: {
          created_at: string
          event_type: string
          experiment_id: string | null
          id: string
          payload: Json
          project_id: string | null
          summary: string
        }
        Insert: {
          created_at?: string
          event_type: string
          experiment_id?: string | null
          id?: string
          payload?: Json
          project_id?: string | null
          summary: string
        }
        Update: {
          created_at?: string
          event_type?: string
          experiment_id?: string | null
          id?: string
          payload?: Json
          project_id?: string | null
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_changelog_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "research_experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_changelog_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "research_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      research_experiments: {
        Row: {
          ai_findings: Json
          backtest_snapshot: Json
          created_at: string
          data_source: string | null
          dataset_version: string | null
          date_from: string | null
          date_to: string | null
          decision: string
          decision_reason: string | null
          id: string
          kind: string
          metrics: Json
          notes: string | null
          optimizer_snapshot: Json
          project_id: string | null
          strategy_id: string | null
          strategy_snapshot: Json
          strategy_version: string | null
          symbol: string | null
          tags: string[]
          timeframe: string | null
          timezone: string | null
          title: string
          updated_at: string
        }
        Insert: {
          ai_findings?: Json
          backtest_snapshot?: Json
          created_at?: string
          data_source?: string | null
          dataset_version?: string | null
          date_from?: string | null
          date_to?: string | null
          decision?: string
          decision_reason?: string | null
          id?: string
          kind?: string
          metrics?: Json
          notes?: string | null
          optimizer_snapshot?: Json
          project_id?: string | null
          strategy_id?: string | null
          strategy_snapshot?: Json
          strategy_version?: string | null
          symbol?: string | null
          tags?: string[]
          timeframe?: string | null
          timezone?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          ai_findings?: Json
          backtest_snapshot?: Json
          created_at?: string
          data_source?: string | null
          dataset_version?: string | null
          date_from?: string | null
          date_to?: string | null
          decision?: string
          decision_reason?: string | null
          id?: string
          kind?: string
          metrics?: Json
          notes?: string | null
          optimizer_snapshot?: Json
          project_id?: string | null
          strategy_id?: string | null
          strategy_snapshot?: Json
          strategy_version?: string | null
          symbol?: string | null
          tags?: string[]
          timeframe?: string | null
          timezone?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_experiments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "research_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      research_hypotheses: {
        Row: {
          conclusion: string | null
          confidence: number | null
          created_at: string
          evidence: string | null
          id: string
          project_id: string | null
          statement: string
          status: string
          supporting_experiment_ids: string[]
          tags: string[]
          updated_at: string
        }
        Insert: {
          conclusion?: string | null
          confidence?: number | null
          created_at?: string
          evidence?: string | null
          id?: string
          project_id?: string | null
          statement: string
          status?: string
          supporting_experiment_ids?: string[]
          tags?: string[]
          updated_at?: string
        }
        Update: {
          conclusion?: string | null
          confidence?: number | null
          created_at?: string
          evidence?: string | null
          id?: string
          project_id?: string | null
          statement?: string
          status?: string
          supporting_experiment_ids?: string[]
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_hypotheses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "research_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      research_notes: {
        Row: {
          attachments: Json
          body_md: string
          created_at: string
          experiment_id: string | null
          id: string
          project_id: string | null
          tags: string[]
          title: string | null
          updated_at: string
        }
        Insert: {
          attachments?: Json
          body_md?: string
          created_at?: string
          experiment_id?: string | null
          id?: string
          project_id?: string | null
          tags?: string[]
          title?: string | null
          updated_at?: string
        }
        Update: {
          attachments?: Json
          body_md?: string
          created_at?: string
          experiment_id?: string | null
          id?: string
          project_id?: string | null
          tags?: string[]
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_notes_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "research_experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_notes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "research_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      research_projects: {
        Row: {
          archived: boolean
          created_at: string
          description: string | null
          goals: string | null
          id: string
          name: string
          priority: string
          status: string
          tags: string[]
          updated_at: string
          version: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          description?: string | null
          goals?: string | null
          id?: string
          name: string
          priority?: string
          status?: string
          tags?: string[]
          updated_at?: string
          version?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          description?: string | null
          goals?: string | null
          id?: string
          name?: string
          priority?: string
          status?: string
          tags?: string[]
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      research_tasks: {
        Row: {
          created_at: string
          deadline: string | null
          description: string | null
          id: string
          priority: string
          project_id: string | null
          status: string
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deadline?: string | null
          description?: string | null
          id?: string
          priority?: string
          project_id?: string | null
          status?: string
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deadline?: string | null
          description?: string | null
          id?: string
          priority?: string
          project_id?: string | null
          status?: string
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "research_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          allowed_symbols: string[]
          id: boolean
          kill_switch: boolean
          max_daily_loss_usd: number
          max_open_positions: number
          max_position_usd: number
          paper_mode: boolean
          paper_starting_equity: number
          updated_at: string
        }
        Insert: {
          allowed_symbols?: string[]
          id?: boolean
          kill_switch?: boolean
          max_daily_loss_usd?: number
          max_open_positions?: number
          max_position_usd?: number
          paper_mode?: boolean
          paper_starting_equity?: number
          updated_at?: string
        }
        Update: {
          allowed_symbols?: string[]
          id?: boolean
          kill_switch?: boolean
          max_daily_loss_usd?: number
          max_open_positions?: number
          max_position_usd?: number
          paper_mode?: boolean
          paper_starting_equity?: number
          updated_at?: string
        }
        Relationships: []
      }
      strategy_presets: {
        Row: {
          created_at: string
          id: string
          name: string
          rr: number
          sl_risk_usd: number
          symbol: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          rr: number
          sl_risk_usd: number
          symbol?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          rr?: number
          sl_risk_usd?: number
          symbol?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      strategy_sessions: {
        Row: {
          break_close_price: number | null
          break_detected_at: string | null
          break_side: string | null
          created_at: string
          fib_25: number
          fib_75: number
          ist_date: string
          symbol: string
          updated_at: string
          zone_high: number
          zone_low: number
        }
        Insert: {
          break_close_price?: number | null
          break_detected_at?: string | null
          break_side?: string | null
          created_at?: string
          fib_25: number
          fib_75: number
          ist_date: string
          symbol: string
          updated_at?: string
          zone_high: number
          zone_low: number
        }
        Update: {
          break_close_price?: number | null
          break_detected_at?: string | null
          break_side?: string | null
          created_at?: string
          fib_25?: number
          fib_75?: number
          ist_date?: string
          symbol?: string
          updated_at?: string
          zone_high?: number
          zone_low?: number
        }
        Relationships: []
      }
      strategy_settings: {
        Row: {
          adaptive_deep_depth: number
          adaptive_shallow_depth: number
          adaptive_strong_break_pct: number
          ai_auto_retrain: boolean
          ai_grading_enabled: boolean
          ai_grading_model: Json | null
          ai_last_retrain_at: string | null
          ai_min_grade: string
          ai_retrain_days: number
          ai_risk_multipliers: Json
          data_source: string
          enabled: boolean
          entry_depth_pct: number
          entry_mode: string
          fee_usd_per_order: number
          id: boolean
          max_reprice_attempts: number
          retest_sl_r: number
          rr: number
          session_start_ist: string
          skip_weekdays: number[]
          skip_weekends: boolean
          sl_depth_pct: number
          sl_risk_usd: number
          symbol: string
          trail_activate_r: number
          trail_enabled: boolean
          trail_step_r: number
          updated_at: string
          zone_source: string
        }
        Insert: {
          adaptive_deep_depth?: number
          adaptive_shallow_depth?: number
          adaptive_strong_break_pct?: number
          ai_auto_retrain?: boolean
          ai_grading_enabled?: boolean
          ai_grading_model?: Json | null
          ai_last_retrain_at?: string | null
          ai_min_grade?: string
          ai_retrain_days?: number
          ai_risk_multipliers?: Json
          data_source?: string
          enabled?: boolean
          entry_depth_pct?: number
          entry_mode?: string
          fee_usd_per_order?: number
          id?: boolean
          max_reprice_attempts?: number
          retest_sl_r?: number
          rr?: number
          session_start_ist?: string
          skip_weekdays?: number[]
          skip_weekends?: boolean
          sl_depth_pct?: number
          sl_risk_usd?: number
          symbol?: string
          trail_activate_r?: number
          trail_enabled?: boolean
          trail_step_r?: number
          updated_at?: string
          zone_source?: string
        }
        Update: {
          adaptive_deep_depth?: number
          adaptive_shallow_depth?: number
          adaptive_strong_break_pct?: number
          ai_auto_retrain?: boolean
          ai_grading_enabled?: boolean
          ai_grading_model?: Json | null
          ai_last_retrain_at?: string | null
          ai_min_grade?: string
          ai_retrain_days?: number
          ai_risk_multipliers?: Json
          data_source?: string
          enabled?: boolean
          entry_depth_pct?: number
          entry_mode?: string
          fee_usd_per_order?: number
          id?: boolean
          max_reprice_attempts?: number
          retest_sl_r?: number
          rr?: number
          session_start_ist?: string
          skip_weekdays?: number[]
          skip_weekends?: boolean
          sl_depth_pct?: number
          sl_risk_usd?: number
          symbol?: string
          trail_activate_r?: number
          trail_enabled?: boolean
          trail_step_r?: number
          updated_at?: string
          zone_source?: string
        }
        Relationships: []
      }
      strategy_setup_events: {
        Row: {
          created_at: string
          event_type: string
          exchange_order_id: string | null
          id: string
          leverage: number | null
          payload: Json | null
          price: number | null
          qty: number | null
          reason: string | null
          setup_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          exchange_order_id?: string | null
          id?: string
          leverage?: number | null
          payload?: Json | null
          price?: number | null
          qty?: number | null
          reason?: string | null
          setup_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          exchange_order_id?: string | null
          id?: string
          leverage?: number | null
          payload?: Json | null
          price?: number | null
          qty?: number | null
          reason?: string | null
          setup_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strategy_setup_events_setup_id_fkey"
            columns: ["setup_id"]
            isOneToOne: false
            referencedRelation: "strategy_setups"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_setups: {
        Row: {
          ai_grade: string | null
          ai_risk_mult: number | null
          ai_score: number | null
          close_order_id: string | null
          close_reason: string | null
          closed_at: string | null
          created_at: string
          entry_price: number
          exchange_order_id: string | null
          filled_at: string | null
          id: string
          initial_sl_price: number | null
          ist_date: string
          order_id: string | null
          peak_r: number
          placement_at: string | null
          placement_attempts: number | null
          placement_capped: boolean | null
          placement_error: string | null
          placement_leverage: number | null
          placement_status: string | null
          pnl_usd: number | null
          qty: number
          reprice_count: number
          requested_qty: number | null
          side: string
          sl_child_order_id: string | null
          sl_price: number
          status: string
          symbol: string
          tp_child_order_id: string | null
          tp_price: number
          updated_at: string
        }
        Insert: {
          ai_grade?: string | null
          ai_risk_mult?: number | null
          ai_score?: number | null
          close_order_id?: string | null
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          entry_price: number
          exchange_order_id?: string | null
          filled_at?: string | null
          id?: string
          initial_sl_price?: number | null
          ist_date: string
          order_id?: string | null
          peak_r?: number
          placement_at?: string | null
          placement_attempts?: number | null
          placement_capped?: boolean | null
          placement_error?: string | null
          placement_leverage?: number | null
          placement_status?: string | null
          pnl_usd?: number | null
          qty: number
          reprice_count?: number
          requested_qty?: number | null
          side: string
          sl_child_order_id?: string | null
          sl_price: number
          status?: string
          symbol: string
          tp_child_order_id?: string | null
          tp_price: number
          updated_at?: string
        }
        Update: {
          ai_grade?: string | null
          ai_risk_mult?: number | null
          ai_score?: number | null
          close_order_id?: string | null
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          entry_price?: number
          exchange_order_id?: string | null
          filled_at?: string | null
          id?: string
          initial_sl_price?: number | null
          ist_date?: string
          order_id?: string | null
          peak_r?: number
          placement_at?: string | null
          placement_attempts?: number | null
          placement_capped?: boolean | null
          placement_error?: string | null
          placement_leverage?: number | null
          placement_status?: string | null
          pnl_usd?: number | null
          qty?: number
          reprice_count?: number
          requested_qty?: number | null
          side?: string
          sl_child_order_id?: string | null
          sl_price?: number
          status?: string
          symbol?: string
          tp_child_order_id?: string | null
          tp_price?: number
          updated_at?: string
        }
        Relationships: []
      }
      trade_intelligence: {
        Row: {
          actual_rr: number | null
          breakout: Json
          commission: number | null
          created_at: string
          custom: Json
          direction: string
          duration: Json
          duration_ms: number | null
          entry_price: number
          entry_quality: Json
          entry_time: string
          entry_type: string | null
          exit_price: number
          exit_reason: string | null
          exit_time: string
          fees: number | null
          fill_price: number | null
          fill_time: string | null
          filters: Json
          gross_pnl: number | null
          holding_bars: number | null
          id: string
          liquidity: Json
          mae: number | null
          mfe: number | null
          month: number | null
          net_pnl: number
          news: Json
          order_time: string | null
          performance: Json
          pnl_pct: number | null
          pnl_r: number | null
          position_size: number | null
          price: Json
          quarter: number | null
          raw: Json
          regime: Json
          risk: Json
          risk_pct: number | null
          risk_usd: number | null
          session: string | null
          signal_time: string | null
          slippage: number | null
          smart_money: Json
          spread_cost: number | null
          status: string
          stop: Json
          stop_price: number | null
          stop_type: string | null
          strategy_id: string
          strategy_version: string | null
          structure: Json
          symbol: string
          tags: string[]
          target: Json
          target_price: number | null
          target_type: string | null
          timeframe: string | null
          trade_id: string
          trade_type: string | null
          trend: Json
          updated_at: string
          volatility: Json
          volume_profile: Json
          week_number: number | null
          weekday: number | null
          year: number | null
        }
        Insert: {
          actual_rr?: number | null
          breakout?: Json
          commission?: number | null
          created_at?: string
          custom?: Json
          direction: string
          duration?: Json
          duration_ms?: number | null
          entry_price: number
          entry_quality?: Json
          entry_time: string
          entry_type?: string | null
          exit_price: number
          exit_reason?: string | null
          exit_time: string
          fees?: number | null
          fill_price?: number | null
          fill_time?: string | null
          filters?: Json
          gross_pnl?: number | null
          holding_bars?: number | null
          id?: string
          liquidity?: Json
          mae?: number | null
          mfe?: number | null
          month?: number | null
          net_pnl: number
          news?: Json
          order_time?: string | null
          performance?: Json
          pnl_pct?: number | null
          pnl_r?: number | null
          position_size?: number | null
          price?: Json
          quarter?: number | null
          raw?: Json
          regime?: Json
          risk?: Json
          risk_pct?: number | null
          risk_usd?: number | null
          session?: string | null
          signal_time?: string | null
          slippage?: number | null
          smart_money?: Json
          spread_cost?: number | null
          status?: string
          stop?: Json
          stop_price?: number | null
          stop_type?: string | null
          strategy_id: string
          strategy_version?: string | null
          structure?: Json
          symbol: string
          tags?: string[]
          target?: Json
          target_price?: number | null
          target_type?: string | null
          timeframe?: string | null
          trade_id: string
          trade_type?: string | null
          trend?: Json
          updated_at?: string
          volatility?: Json
          volume_profile?: Json
          week_number?: number | null
          weekday?: number | null
          year?: number | null
        }
        Update: {
          actual_rr?: number | null
          breakout?: Json
          commission?: number | null
          created_at?: string
          custom?: Json
          direction?: string
          duration?: Json
          duration_ms?: number | null
          entry_price?: number
          entry_quality?: Json
          entry_time?: string
          entry_type?: string | null
          exit_price?: number
          exit_reason?: string | null
          exit_time?: string
          fees?: number | null
          fill_price?: number | null
          fill_time?: string | null
          filters?: Json
          gross_pnl?: number | null
          holding_bars?: number | null
          id?: string
          liquidity?: Json
          mae?: number | null
          mfe?: number | null
          month?: number | null
          net_pnl?: number
          news?: Json
          order_time?: string | null
          performance?: Json
          pnl_pct?: number | null
          pnl_r?: number | null
          position_size?: number | null
          price?: Json
          quarter?: number | null
          raw?: Json
          regime?: Json
          risk?: Json
          risk_pct?: number | null
          risk_usd?: number | null
          session?: string | null
          signal_time?: string | null
          slippage?: number | null
          smart_money?: Json
          spread_cost?: number | null
          status?: string
          stop?: Json
          stop_price?: number | null
          stop_type?: string | null
          strategy_id?: string
          strategy_version?: string | null
          structure?: Json
          symbol?: string
          tags?: string[]
          target?: Json
          target_price?: number | null
          target_type?: string | null
          timeframe?: string | null
          trade_id?: string
          trade_type?: string | null
          trend?: Json
          updated_at?: string
          volatility?: Json
          volume_profile?: Json
          week_number?: number | null
          weekday?: number | null
          year?: number | null
        }
        Relationships: []
      }
      trade_intelligence_archive: {
        Row: {
          actual_rr: number | null
          breakout: Json
          commission: number | null
          created_at: string
          custom: Json
          direction: string
          duration: Json
          duration_ms: number | null
          entry_price: number
          entry_quality: Json
          entry_time: string
          entry_type: string | null
          exit_price: number
          exit_reason: string | null
          exit_time: string
          fees: number | null
          fill_price: number | null
          fill_time: string | null
          filters: Json
          gross_pnl: number | null
          holding_bars: number | null
          id: string
          liquidity: Json
          mae: number | null
          mfe: number | null
          month: number | null
          net_pnl: number
          news: Json
          order_time: string | null
          performance: Json
          pnl_pct: number | null
          pnl_r: number | null
          position_size: number | null
          price: Json
          quarter: number | null
          raw: Json
          regime: Json
          risk: Json
          risk_pct: number | null
          risk_usd: number | null
          session: string | null
          signal_time: string | null
          slippage: number | null
          smart_money: Json
          snapshot_name: string
          spread_cost: number | null
          status: string
          stop: Json
          stop_price: number | null
          stop_type: string | null
          strategy_id: string
          strategy_version: string | null
          structure: Json
          symbol: string
          tags: string[]
          target: Json
          target_price: number | null
          target_type: string | null
          timeframe: string | null
          trade_id: string
          trade_type: string | null
          trend: Json
          updated_at: string
          volatility: Json
          volume_profile: Json
          week_number: number | null
          weekday: number | null
          year: number | null
        }
        Insert: {
          actual_rr?: number | null
          breakout?: Json
          commission?: number | null
          created_at?: string
          custom?: Json
          direction: string
          duration?: Json
          duration_ms?: number | null
          entry_price: number
          entry_quality?: Json
          entry_time: string
          entry_type?: string | null
          exit_price: number
          exit_reason?: string | null
          exit_time: string
          fees?: number | null
          fill_price?: number | null
          fill_time?: string | null
          filters?: Json
          gross_pnl?: number | null
          holding_bars?: number | null
          id?: string
          liquidity?: Json
          mae?: number | null
          mfe?: number | null
          month?: number | null
          net_pnl: number
          news?: Json
          order_time?: string | null
          performance?: Json
          pnl_pct?: number | null
          pnl_r?: number | null
          position_size?: number | null
          price?: Json
          quarter?: number | null
          raw?: Json
          regime?: Json
          risk?: Json
          risk_pct?: number | null
          risk_usd?: number | null
          session?: string | null
          signal_time?: string | null
          slippage?: number | null
          smart_money?: Json
          snapshot_name?: string
          spread_cost?: number | null
          status?: string
          stop?: Json
          stop_price?: number | null
          stop_type?: string | null
          strategy_id: string
          strategy_version?: string | null
          structure?: Json
          symbol: string
          tags?: string[]
          target?: Json
          target_price?: number | null
          target_type?: string | null
          timeframe?: string | null
          trade_id: string
          trade_type?: string | null
          trend?: Json
          updated_at?: string
          volatility?: Json
          volume_profile?: Json
          week_number?: number | null
          weekday?: number | null
          year?: number | null
        }
        Update: {
          actual_rr?: number | null
          breakout?: Json
          commission?: number | null
          created_at?: string
          custom?: Json
          direction?: string
          duration?: Json
          duration_ms?: number | null
          entry_price?: number
          entry_quality?: Json
          entry_time?: string
          entry_type?: string | null
          exit_price?: number
          exit_reason?: string | null
          exit_time?: string
          fees?: number | null
          fill_price?: number | null
          fill_time?: string | null
          filters?: Json
          gross_pnl?: number | null
          holding_bars?: number | null
          id?: string
          liquidity?: Json
          mae?: number | null
          mfe?: number | null
          month?: number | null
          net_pnl?: number
          news?: Json
          order_time?: string | null
          performance?: Json
          pnl_pct?: number | null
          pnl_r?: number | null
          position_size?: number | null
          price?: Json
          quarter?: number | null
          raw?: Json
          regime?: Json
          risk?: Json
          risk_pct?: number | null
          risk_usd?: number | null
          session?: string | null
          signal_time?: string | null
          slippage?: number | null
          smart_money?: Json
          snapshot_name?: string
          spread_cost?: number | null
          status?: string
          stop?: Json
          stop_price?: number | null
          stop_type?: string | null
          strategy_id?: string
          strategy_version?: string | null
          structure?: Json
          symbol?: string
          tags?: string[]
          target?: Json
          target_price?: number | null
          target_type?: string | null
          timeframe?: string | null
          trade_id?: string
          trade_type?: string | null
          trend?: Json
          updated_at?: string
          volatility?: Json
          volume_profile?: Json
          week_number?: number | null
          weekday?: number | null
          year?: number | null
        }
        Relationships: []
      }
      trade_snapshot_stats: {
        Row: {
          last_updated: string
          name: string
          trade_count: number
        }
        Insert: {
          last_updated?: string
          name: string
          trade_count?: number
        }
        Update: {
          last_updated?: string
          name?: string
          trade_count?: number
        }
        Relationships: []
      }
      trades: {
        Row: {
          closed_at: string
          entry_price: number
          exit_price: number
          id: string
          opened_at: string
          paper: boolean
          pnl_usd: number
          qty: number
          side: string
          symbol: string
        }
        Insert: {
          closed_at?: string
          entry_price: number
          exit_price: number
          id?: string
          opened_at: string
          paper?: boolean
          pnl_usd: number
          qty: number
          side: string
          symbol: string
        }
        Update: {
          closed_at?: string
          entry_price?: number
          exit_price?: number
          id?: string
          opened_at?: string
          paper?: boolean
          pnl_usd?: number
          qty?: number
          side?: string
          symbol?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          alert_id: string | null
          id: string
          raw_payload: Json
          reason: string | null
          received_at: string
          status: string
        }
        Insert: {
          alert_id?: string | null
          id?: string
          raw_payload: Json
          reason?: string | null
          received_at?: string
          status?: string
        }
        Update: {
          alert_id?: string | null
          id?: string
          raw_payload?: Json
          reason?: string | null
          received_at?: string
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_ownership: { Args: never; Returns: boolean }
      is_owner: { Args: never; Returns: boolean }
      list_trade_snapshots: {
        Args: never
        Returns: {
          count: number
          last_updated: string
          name: string
        }[]
      }
      refresh_trade_snapshot_stat: {
        Args: { _name: string }
        Returns: undefined
      }
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
