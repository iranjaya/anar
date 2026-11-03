export const migrationCoverageSql = `
SELECT c.relname FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND (
  NOT has_table_privilege('anar_app', c.oid, 'SELECT')
  OR NOT has_table_privilege('anar_app', c.oid, 'INSERT')
  OR has_table_privilege('anar_app', c.oid, 'DELETE') <> (c.relname = 'worker_heartbeats')
  OR has_table_privilege('anar_app', c.oid, 'TRUNCATE')
  OR has_table_privilege('anar_app', c.oid, 'REFERENCES')
  OR has_table_privilege('anar_app', c.oid, 'TRIGGER')
  OR has_table_privilege('anar_app', c.oid, 'UPDATE') <> (c.relname NOT IN ('audit_log', 'follow_ups'))
  OR EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = 0)
  OR (c.relname NOT IN ('agencies', 'audit_log', 'auth_rate_limits', 'invites',
      'otp_codes', 'push_endpoint_bindings', 'sessions', 'users', 'worker_heartbeats')
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity
      AND NOT EXISTS (
        SELECT 1 FROM (VALUES ('r'), ('a'), ('w')) AS command(kind)
        WHERE NOT EXISTS (
          SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polcmd IN (command.kind::"char", '*')
          AND (command.kind = 'a' OR pg_get_expr(p.polqual, p.polrelid) LIKE '%app.agency_id%')
          AND (command.kind = 'r' OR pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%app.agency_id%')
          AND (NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid
              AND a.attname = 'company_id' AND NOT a.attisdropped)
            OR ((command.kind = 'a' OR pg_get_expr(p.polqual, p.polrelid) LIKE '%app.company_id%')
              AND (command.kind = 'r' OR pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%app.company_id%')))
        )
      )
    )
  )
) ORDER BY c.relname`;
