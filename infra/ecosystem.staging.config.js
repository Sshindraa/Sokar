// PM2 ecosystem pour l'environnement de STAGING Sokar.
//
// Services séparés de la prod (préfixe sokar-staging-*) sur ports décalés :
//   API      → 4100 (prod: 4000)
//   Dashboard → 3100 (prod: 3000)
//   Connect  → 4102 (prod: 4002)
//
// Isolement : DB sokar_staging, Redis db=2, Clerk staging keys,
// voice désactivée (STAGING_DISABLE_VOICE=true via .env).
module.exports = {
  apps: [
    {
      name: 'sokar-staging-api',
      cwd: '/opt/sokar-staging/apps/api',
      script: 'dist/main.js',
      node_args: '--env-file=.env',
      env: {
        NODE_ENV: 'production',
        PORT: '4100',
        HOST: '127.0.0.1',
      },
      watch: false,
      max_memory_restart: '500M',
      error_file: '/var/log/sokar/staging-api-error.log',
      out_file: '/var/log/sokar/staging-api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 4000,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'sokar-staging-dashboard',
      cwd: '/opt/sokar-staging/apps/dashboard',
      script: 'bin/run-dashboard.sh',
      env: {
        NODE_ENV: 'production',
        PORT: '3100',
        HOSTNAME: '::',
      },
      watch: false,
      max_memory_restart: '500M',
      error_file: '/var/log/sokar/staging-dashboard-error.log',
      out_file: '/var/log/sokar/staging-dashboard-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 4000,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'sokar-staging-connect',
      cwd: '/opt/sokar-staging/apps/connect',
      script: 'bin/run-connect.sh',
      env: {
        NODE_ENV: 'production',
        PORT: '4102',
        HOSTNAME: '127.0.0.1',
      },
      watch: false,
      max_memory_restart: '400M',
      error_file: '/var/log/sokar/staging-connect-error.log',
      out_file: '/var/log/sokar/staging-connect-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 4000,
      max_restarts: 10,
      min_uptime: '10s',
    },
  ],
};
