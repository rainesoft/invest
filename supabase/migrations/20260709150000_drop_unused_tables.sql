-- Drop unused tables to clean up schema
DROP TABLE IF EXISTS public.models CASCADE;
DROP TABLE IF EXISTS public.calendars CASCADE;
DROP TABLE IF EXISTS public.idempotency_keys CASCADE;
