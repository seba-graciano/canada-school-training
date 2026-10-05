-- RLS Policy Test Migration.
-- Run this after applying 0001_schema.sql to verify policies work correctly

-- 1. Check current grants on all tables
-- Run: SELECT grantee, table_name, privilege_type FROM information_schema.table_privileges WHERE table_schema = 'public' AND table_name IN ('alumnos','tutores','cuotas','pagos') ORDER BY table_name, grantee;

-- 2. Check RLS is enabled
-- Run: SELECT schemaname, tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('alumnos','tutores','cuotas','pagos');

-- 3. Check policies exist
-- Run: SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('alumnos','tutores','cuotas','pagos');

-- 4. Test helper function
-- SELECT current_user_role(); -- Should return 'anon' when run as anon

-- ============================================
-- MANUAL TEST INSTRUCTIONS (run in Supabase SQL Editor with different roles)
-- ============================================

-- TEST 1: ANON (unauthenticated) - Should see NOTHING
-- SET ROLE anon;
-- SELECT * FROM alumnos;           -- 0 rows
-- SELECT * FROM tutores;           -- 0 rows
-- SELECT * FROM cuotas;            -- 0 rows
-- SELECT * FROM pagos;             -- 0 rows
-- RESET ROLE;

-- TEST 2: AUTHENTICATED (no role claim) - Should see NOTHING (no policy matches)
-- SET ROLE authenticated;
-- SELECT * FROM alumnos;           -- 0 rows
-- SELECT * FROM tutores;           -- 0 rows
-- RESET ROLE;

-- TEST 3: ADMIN (role='admin' in JWT)
-- SET ROLE authenticated;
-- SET LOCAL jwt.claims.role = 'admin';
-- SELECT * FROM alumnos;           -- ALL rows
-- INSERT INTO alumnos (nombre, apellido, dni, nivel, curso, tutor_id, arancel_base) VALUES ('Test', 'Admin', '99999999', 'Primario', '1', 1, 1000); -- Should work
-- DELETE FROM alumnos WHERE dni = '99999999'; -- Should work
-- RESET ROLE;

-- TEST 4: SECRETARIA (role='secretaria' in JWT)
-- SET ROLE authenticated;
-- SET LOCAL jwt.claims.role = 'secretaria';
-- SELECT * FROM alumnos;           -- ALL rows
-- INSERT INTO alumnos (nombre, apellido, dni, nivel, curso, tutor_id, arancel_base) VALUES ('Test', 'Secretaria', '88888888', 'Primario', '1', 1, 1000); -- Should work
-- UPDATE alumnos SET nombre = 'Updated' WHERE dni = '88888888'; -- Should work
-- DELETE FROM alumnos WHERE dni = '88888888'; -- Should work
-- RESET ROLE;

-- TEST 5: TUTOR (role='tutor' + tutor_id in JWT)
-- SET ROLE authenticated;
-- SET LOCAL jwt.claims.role = 'tutor';
-- SET LOCAL jwt.claims.tutor_id = '1';
-- SELECT * FROM tutores;           -- Only tutor_id=1
-- SELECT * FROM alumnos;           -- Only alumnos with tutor_id=1
-- SELECT * FROM cuotas;            -- Only cuotas for those alumnos
-- SELECT * FROM pagos;             -- Only pagos for those cuotas
-- INSERT INTO alumnos ...;         -- Should FAIL (no INSERT policy for tutor)
-- UPDATE alumnos ...;              -- Should FAIL (no UPDATE policy for tutor)
-- DELETE FROM alumnos ...;         -- Should FAIL (no DELETE policy for tutor)
-- RESET ROLE;

-- TEST 6: TUTOR with different tutor_id (should not see other tutor's data)
-- SET ROLE authenticated;
-- SET LOCAL jwt.claims.role = 'tutor';
-- SET LOCAL jwt.claims.tutor_id = '2';
-- SELECT * FROM tutores;           -- Only tutor_id=2
-- SELECT * FROM alumnos;           -- Only alumnos with tutor_id=2
-- RESET ROLE;

-- TEST 7: Verify buscar_alumnos function respects RLS
-- SET ROLE authenticated;
-- SET LOCAL jwt.claims.role = 'tutor';
-- SET LOCAL jwt.claims.tutor_id = '1';
-- SELECT * FROM buscar_alumnos('Perez'); -- Should only return matching alumnos for tutor_id=1
-- RESET ROLE;

-- ============================================
-- GRANTS VERIFICATION (run as postgres/superuser)
-- ============================================

-- These are the default grants after RLS enable - should be NO direct table grants to anon/authenticated
-- RLS policies handle all access control

-- Verify no overly permissive grants exist:
-- SELECT * FROM information_schema.table_privileges
-- WHERE table_schema = 'public'
--   AND table_name IN ('alumnos','tutores','cuotas','pagos')
--   AND grantee IN ('anon','authenticated')
--   AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER');

-- If any rows returned above, revoke them:
-- REVOKE ALL ON alumnos, tutores, cuotas, pagos FROM anon, authenticated;
-- GRANT USAGE ON SCHEMA public TO anon, authenticated;
-- GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;