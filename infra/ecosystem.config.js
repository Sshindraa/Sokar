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
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
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
