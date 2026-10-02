-- Meal Prep: run the reminder function every 15 minutes.
-- Before running:
--   * Database > Extensions: enable pg_cron and pg_net (or run the two lines below).
--   * Deploy the meal-reminders Edge Function and set its secrets (see README).
--   * Replace the two placeholder values below.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'mp_project_url');
select vault.create_secret('PASTE-THE-SAME-CRON_SECRET-YOU-SET-ON-THE-FUNCTION', 'mp_cron_secret');

select cron.schedule(
  'meal-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'mp_project_url') || '/functions/v1/meal-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mp_cron_secret')
    ),
    body := '{"mode":"cron"}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);

-- Useful checks:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 10;
--   select * from net._http_response order by created desc limit 10;
-- To stop it:  select cron.unschedule('meal-reminders');
