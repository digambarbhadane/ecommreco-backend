const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { resolveEnvFile } = require('./config/env-file');

// Determine current environment
const env = process.env.NODE_ENV || 'development';
const envFile = resolveEnvFile(env);
const envPath = path.resolve(process.cwd(), envFile);

if (!fs.existsSync(envPath)) {
  console.error(
    `[env] Missing ${envFile} (NODE_ENV=${env}). .env.dev is not used — see docs/EC2-DEPLOY.md`,
  );
}

dotenv.config({
  path: envPath,
  override: true,
});

console.log(`Loaded environment file: ${envFile}`);
console.log(`NODE_ENV: ${env}`);
console.log(`PORT: ${process.env.PORT ?? '(not set)'}`);
console.log(`FRONTEND_URL: ${process.env.FRONTEND_URL ?? '(not set)'}`);
console.log(`API_PUBLIC_URL: ${process.env.API_PUBLIC_URL ?? '(not set)'}`);

module.exports = { env, envFile };
