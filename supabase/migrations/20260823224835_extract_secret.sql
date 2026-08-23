CREATE TABLE IF NOT EXISTS public.temp_secret (secret text);
INSERT INTO public.temp_secret (secret) SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1;
