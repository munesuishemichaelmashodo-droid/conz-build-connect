-- Adds a covering index for every foreign key flagged by the Supabase
-- performance advisor as missing one. An uncovered FK means Postgres
-- has to full-scan the referencing table for the common cases (joins,
-- and the DELETE/UPDATE-CASCADE checks these FKs already trigger), so
-- this matters more as job/message/wallet-transaction volume grows,
-- even though it isn't causing an active problem yet at current
-- (low) traffic. CREATE INDEX IF NOT EXISTS makes this safe to re-run.
CREATE INDEX IF NOT EXISTS idx_cancellation_events_job_id ON public.cancellation_events(job_id);
CREATE INDEX IF NOT EXISTS idx_chat_flags_job_id ON public.chat_flags(job_id);
CREATE INDEX IF NOT EXISTS idx_chat_flags_message_id ON public.chat_flags(message_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_sender_id ON public.conversation_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_by ON public.conversations(created_by);
CREATE INDEX IF NOT EXISTS idx_disputes_against ON public.disputes(against);
CREATE INDEX IF NOT EXISTS idx_disputes_job_id ON public.disputes(job_id);
CREATE INDEX IF NOT EXISTS idx_disputes_raised_by ON public.disputes(raised_by);
CREATE INDEX IF NOT EXISTS idx_disputes_resolved_by ON public.disputes(resolved_by);
CREATE INDEX IF NOT EXISTS idx_evidence_access_log_evidence_id ON public.evidence_access_log(evidence_id);
CREATE INDEX IF NOT EXISTS idx_job_evidence_superseded_by ON public.job_evidence(superseded_by);
CREATE INDEX IF NOT EXISTS idx_location_anomalies_job_id ON public.location_anomalies(job_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_mfa_recovery_grants_granted_by ON public.mfa_recovery_grants(granted_by);
CREATE INDEX IF NOT EXISTS idx_mfa_recovery_grants_user_id ON public.mfa_recovery_grants(user_id);
CREATE INDEX IF NOT EXISTS idx_mfa_recovery_log_actor_id ON public.mfa_recovery_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_mfa_recovery_log_target_user_id ON public.mfa_recovery_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_job_id ON public.notifications(job_id);
CREATE INDEX IF NOT EXISTS idx_payments_job_id ON public.payments(job_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON public.payments(user_id);
CREATE INDEX IF NOT EXISTS idx_ratings_customer_id ON public.ratings(customer_id);
CREATE INDEX IF NOT EXISTS idx_ratings_driver_id ON public.ratings(driver_id);
CREATE INDEX IF NOT EXISTS idx_referrals_decided_by ON public.referrals(decided_by);
CREATE INDEX IF NOT EXISTS idx_referrals_referred_credit_transaction_id ON public.referrals(referred_credit_transaction_id);
CREATE INDEX IF NOT EXISTS idx_referrals_reward_transaction_id ON public.referrals(reward_transaction_id);
CREATE INDEX IF NOT EXISTS idx_reports_job_id ON public.reports(job_id);
CREATE INDEX IF NOT EXISTS idx_reports_user_id ON public.reports(user_id);
CREATE INDEX IF NOT EXISTS idx_small_load_settings_updated_by ON public.small_load_settings(updated_by);
CREATE INDEX IF NOT EXISTS idx_system_settings_updated_by ON public.system_settings(updated_by);
CREATE INDEX IF NOT EXISTS idx_trucks_driver_id ON public.trucks(driver_id);
CREATE INDEX IF NOT EXISTS idx_wallet_topup_requests_decided_by ON public.wallet_topup_requests(decided_by);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_by ON public.wallet_transactions(created_by);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_job_id ON public.wallet_transactions(job_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_reversal_of_transaction_id ON public.wallet_transactions(reversal_of_transaction_id);
CREATE INDEX IF NOT EXISTS idx_wallet_withdrawal_requests_decided_by ON public.wallet_withdrawal_requests(decided_by);
