-- =============================================================================
-- OpenNote — permission-change NOTIFY helper (ticket 0010 decision #3).
-- =============================================================================
-- Mutating endpoints in apps/web (share create/delete, group membership change,
-- role change, page/folder delete) call this AFTER their transaction commits to
-- notify apps/realtime to close now-stale connections. apps/realtime LISTENs on
-- the perm_change channel (see apps/realtime/src/revocation.ts).
--
-- Postgres NOTIFY payloads are text; we send a compact JSON string. NOTIFY is
-- transactional — it fires only on commit, so the realtime server never kills a
-- connection for a change that didn't actually happen.

CREATE OR REPLACE FUNCTION notify_perm_change(
  p_user_ids text[] DEFAULT '{}',
  p_page_ids text[] DEFAULT '{}'
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify(
    'perm_change',
    json_build_object(
      'userIds', p_user_ids,
      'pageIds', p_page_ids
    )::text
  );
END;
$$;
