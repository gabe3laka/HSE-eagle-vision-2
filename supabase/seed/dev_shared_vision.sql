-- Idempotent dev seed: org "HSE Vision", link 0@test.com as owner/active,
-- leave 1@test.com with a pending join request (approval flow demonstrable).
-- Requires 0@test.com and 1@test.com to already exist in auth.users.

DO $$
DECLARE
  v_org_id uuid;
  v_owner_id uuid;
  v_member_id uuid;
BEGIN
  -- Look up user IDs by email
  SELECT id INTO v_owner_id FROM auth.users WHERE email = '0@test.com' LIMIT 1;
  SELECT id INTO v_member_id FROM auth.users WHERE email = '1@test.com' LIMIT 1;

  IF v_owner_id IS NULL THEN
    RAISE NOTICE 'Skipping seed: 0@test.com not found in auth.users';
    RETURN;
  END IF;

  -- Upsert the org
  INSERT INTO public.organizations (name, slug, created_by)
  VALUES ('HSE Vision', 'hse-vision', v_owner_id)
  ON CONFLICT (slug) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_org_id;

  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'hse-vision';
  END IF;

  -- Upsert owner membership
  INSERT INTO public.organization_members (org_id, user_id, role, status)
  VALUES (v_org_id, v_owner_id, 'owner', 'active')
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'owner', status = 'active';

  -- Pending join request for 1@test.com (if exists)
  IF v_member_id IS NOT NULL THEN
    INSERT INTO public.organization_join_requests (org_id, user_id, status, message)
    VALUES (v_org_id, v_member_id, 'pending', 'I would like to join the HSE Vision org.')
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;
