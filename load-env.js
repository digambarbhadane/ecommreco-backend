const path = require('path');
const dotenv = require('dotenv');

// Determine current environment
const env = process.env.NODE_ENV || 'development';

// Map NODE_ENV to the appropriate .env file
const envFile =
  env === 'production'
    ? '.env.production'
    : env === 'staging'
      ? '.env.uat'
      : '.env.development';

// Load the selected environment file
dotenv.config({
  path: path.resolve(process.cwd(), envFile),
});

console.log(`Loaded environment file: ${envFile}`);
console.log(`NODE_ENV: ${env}`);

module.exports = { env, envFile };
