module.exports = {
  apps: [
    {
      name: 'sokar-api',
      cwd: '/opt/sokar/apps/api',
      script: 'dist/main.js',
      node_args: '--env-file=.env',
      env: {
        NODE_ENV: 'production',
        PORT: '4000',
        HOST: '127.0.0.1',
      },
      watch: false,
      max_memory_restart: '500M',
      error_file: '/var/log/sokar/api-error.log',
      out_file: '/var/log/sokar/api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      // Health check readiness (P0 DEP-005) : PM2 attend le signal 'ready' de l'API.
      wait_ready: true,
      listen_timeout: 30000,
      kill_timeout: 8000,
      // Restart strategy : backoff exponentiel pour éviter les crash loops.
      exp_backoff_restart_delay: 4000,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'sokar-dashboard',
      cwd: '/opt/sokar/apps/dashboard',
      // Wrapper bin/run-dashboard.sh (pas `next start`) :
      //   - copie les static assets via apps/<app>/scripts/copy-static.sh
      //     (cf. pitfall #29 de la skill sokar-deployment — Next 14
      //     standalone ne copie PAS auto .next/static + public/)
      //   - lance le binaire standalone (node .next/standalone/.../server.js)
      // Aligné sur apps/connect/bin/run-connect.sh.
      script: 'bin/run-dashboard.sh',
      env: {
        NODE_ENV: 'production',
        // :: = dual-stack IPv4+IPv6. Next.js middleware proxy se connecte
        // via ::1 (IPv6 localhost) ; Nginx via 127.0.0.1 (IPv4). Les deux
        // fonctionnent car :: écoute sur toutes les interfaces.
        // 127.0.0.1 seul provoque un deadlock : le proxy interne tente ::1
        // qui est refusé (bug Next.js #524, IPv4/IPv6 mismatch).
        HOSTNAME: '::',
      },
      watch: false,
      max_memory_restart: '500M',
      error_file: '/var/log/sokar/dashboard-error.log',
      out_file: '/var/log/sokar/dashboard-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      listen_timeout: 30000,
      kill_timeout: 8000,
      exp_backoff_restart_delay: 4000,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'sokar-connect',
      cwd: '/opt/sokar/apps/connect',
      script: 'bin/run-connect.sh',
      env: {
        NODE_ENV: 'production',
        PORT: '4002',
        HOSTNAME: '127.0.0.1',
      },
      watch: false,
      max_memory_restart: '400M',
      error_file: '/var/log/sokar/connect-error.log',
      out_file: '/var/log/sokar/connect-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      listen_timeout: 30000,
      kill_timeout: 8000,
      exp_backoff_restart_delay: 4000,
      max_restarts: 10,
      min_uptime: '10s',
    },
  ],
};
