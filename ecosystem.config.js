/**
 * PM2 — EcommReco API on EC2
 *
 *   npm run build
 *   pm2 start ecosystem.config.js --only api-dev
 *   pm2 start ecosystem.config.js --only api-test
 *   pm2 logs api-test
 *
 * NODE_ENV selects the env file via start-dist.js:
 *   development → .env.development (api-dev)
 *   test        → .env.test (api-test)
 *   staging     → .env.uat (api-uat)
 *   production  → .env.production (api-prod)
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
      },
    },
    {
      name: 'api-test',
      cwd: __dirname,
      script: 'start-dist.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '600M',
      env: {
        NODE_ENV: 'test',
      },
    },
    {
      name: 'api-uat',
      cwd: __dirname,
      script: 'start-dist.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '600M',
      env: {
        NODE_ENV: 'staging',
      },
    },
    {
      name: 'api-prod',
      cwd: __dirname,
      script: 'start-dist.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '600M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
