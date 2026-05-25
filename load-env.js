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
});

console.log(`Loaded environment file: ${envFile}`);
console.log(`NODE_ENV: ${env}`);

module.exports = { env, envFile };
