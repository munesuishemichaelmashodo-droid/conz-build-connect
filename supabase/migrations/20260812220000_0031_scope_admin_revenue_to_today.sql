-- 0031: Restrict non-super admins to today's wallet_transactions only.
-- Previously any 'admin' or 'super_admin' could read the full history of
-- wallet_transactions (all revenue/commission/top-up rows, forever).
-- Employee admins should only ever see today's activity; super_admin keeps
-- full historical access.

DROP POLICY IF EXISTS "Admins read tx" ON public.wallet_transactions;

CREATE POLICY "Super admins read all tx" ON public.wallet_transactions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Admins read today tx" ON public.wallet_transactions
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    AND created_at >= date_trunc('day', now())
  );
