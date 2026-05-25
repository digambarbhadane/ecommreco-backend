/**
 * PM2 — EcommReco API
 *
 * Prerequisites:
 *   npm ci --include=dev
 *   npm run build
 *   .env.development or .env.production in this directory
 *
 * Start:
 *   pm2 start ecosystem.config.js
 *   pm2 logs api-dev
 *   pm2 save && pm2 startup
 */
module.exports = {
  apps: [
    {
      name: 'api-dev',
      cwd: __dirname,
      script: 'start-dist.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '600M',
      env: {
        NODE_ENV: 'development',
        PORT: 5000,
      },
    },
    
  ],
};
