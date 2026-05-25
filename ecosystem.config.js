/**
 * PM2 — EcommReco API (development on EC2)
 *
 * Uses NODE_ENV=development → loads .env.development
 *
 *   npm run build
 *   pm2 start ecosystem.config.js
 *   pm2 logs api-dev
 *
 * Do not use api-prod here unless you create .env.production.
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
