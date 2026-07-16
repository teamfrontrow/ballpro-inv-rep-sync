\set ON_ERROR_STOP on

-- Run as the RepSpark database owner (repspark) or a database superuser.
-- \password prompts without placing the new password in this file or shell history.
SELECT 'CREATE ROLE ballpro_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ballpro_ro')
\gexec

ALTER ROLE ballpro_ro WITH
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION;
ALTER ROLE ballpro_ro SET default_transaction_read_only = on;

\password ballpro_ro

-- Remove role memberships so ballpro_ro cannot SET ROLE into a more privileged
-- login retained from an earlier manual setup.
SELECT format('REVOKE %I FROM ballpro_ro', granted_role.rolname)
FROM pg_auth_members membership
JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
JOIN pg_roles member_role ON member_role.oid = membership.member
WHERE member_role.rolname = 'ballpro_ro'
\gexec

REVOKE ALL PRIVILEGES ON DATABASE repspark FROM ballpro_ro;
GRANT CONNECT ON DATABASE repspark TO ballpro_ro;
-- PostgreSQL privileges are additive. Remove the legacy PUBLIC create grant so
-- ballpro_ro cannot regain schema creation through PUBLIC membership.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM ballpro_ro;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ballpro_ro;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ballpro_ro;
GRANT USAGE ON SCHEMA public TO ballpro_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ballpro_ro;

-- RepSpark migrations run as role repspark. Repeat these default-privilege
-- grants for any other role that can own newly created source tables.
ALTER DEFAULT PRIVILEGES FOR ROLE repspark IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM ballpro_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE repspark IN SCHEMA public
  GRANT SELECT ON TABLES TO ballpro_ro;

-- These should return zero writable tables and false for role-creation powers.
SELECT
  count(*) FILTER (
    WHERE has_table_privilege('ballpro_ro', c.oid, 'SELECT')
  ) AS selectable_tables,
  count(*) FILTER (
    WHERE has_table_privilege('ballpro_ro', c.oid, 'INSERT')
       OR has_table_privilege('ballpro_ro', c.oid, 'UPDATE')
       OR has_table_privilege('ballpro_ro', c.oid, 'DELETE')
       OR has_table_privilege('ballpro_ro', c.oid, 'TRUNCATE')
  ) AS writable_tables
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p');

SELECT
  rolname,
  rolsuper,
  rolcreatedb,
  rolcreaterole,
  rolreplication,
  has_schema_privilege('ballpro_ro', 'public', 'CREATE') AS can_create_in_public
FROM pg_roles
WHERE rolname = 'ballpro_ro';

SELECT granted_role.rolname AS inherited_role
FROM pg_auth_members membership
JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
JOIN pg_roles member_role ON member_role.oid = membership.member
WHERE member_role.rolname = 'ballpro_ro';
