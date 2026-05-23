const path = require('path');
const dotenv = require('dotenv');
const { resolveEnvFile } = require('./config/env-file');

// Determine current environment
const env = process.env.NODE_ENV || 'development';
const envFile = resolveEnvFile(env);

// Load the selected environment file
dotenv.config({
  path: path.resolve(process.cwd(), envFile),
});

console.log(`Loaded environment file: ${envFile}`);
console.log(`NODE_ENV: ${env}`);

module.exports = { env, envFile };
