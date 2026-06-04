-- Security hardening (advisors 0028/0029): handle_new_user() is a SECURITY
-- DEFINER trigger that auto-creates a profile row on signup. It is fired by the
-- on_auth_user_created trigger and must never be callable as a PostgREST RPC
-- (/rest/v1/rpc/handle_new_user). Revoking EXECUTE from the API roles removes
-- that exposure; the trigger still fires normally because trigger execution does
-- not depend on the invoking role holding EXECUTE on the function.
revoke execute on function public.handle_new_user() from anon, authenticated, public;
