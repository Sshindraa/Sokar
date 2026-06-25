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
        HOST: '0.0.0.0',
      },
      watch: false,
      max_memory_restart: '500M',
      error_file: '/var/log/sokar/api-error.log',
      out_file: '/var/log/sokar/api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'sokar-dashboard',
      cwd: '/opt/sokar/apps/dashboard',
      // Wrapper bin/run-dashboard.sh (pas `next start`) :
      //   - copie les static assets via scripts/copy-static.sh
      //     (cf. pitfall #29 de la skill sokar-deployment — Next 14
      //     standalone ne copie PAS auto .next/static + public/)
      //   - lance le binaire standalone (node .next/standalone/.../server.js)
      // Aligné sur apps/canal-a/bin/run-canal-a.sh.
      script: 'bin/run-dashboard.sh',
      env: {
        NODE_ENV: 'production',
      },
      watch: false,
      max_memory_restart: '500M',
      error_file: '/var/log/sokar/dashboard-error.log',
      out_file: '/var/log/sokar/dashboard-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
