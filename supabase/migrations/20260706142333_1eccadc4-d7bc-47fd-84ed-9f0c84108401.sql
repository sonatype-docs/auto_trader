
REVOKE EXECUTE ON FUNCTION public.claim_ownership() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_ownership() TO authenticated;
