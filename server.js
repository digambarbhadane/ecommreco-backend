const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { resolveEnvFile, usesTsNodeRuntime } = require('./config/env-file');

// Determine current environment
const env = process.env.NODE_ENV || 'development';
const envFile = resolveEnvFile(env);
const envPath = path.resolve(process.cwd(), envFile);

if (!fs.existsSync(envPath)) {
  console.error(
    `[env] Missing ${envFile} (NODE_ENV=${env}). ` +
      'The app does not read .env.dev — use .env.development, .env.uat, or .env.production. ' +
      'Copy from the matching .env.*.example file in the project root.',
  );
}

// Load the selected environment file (do not override vars set by Render/host)
const loaded = dotenv.config({
  path: envPath,
  override: false,
});

if (loaded.error && fs.existsSync(envPath)) {
  console.error(`[env] Failed to parse ${envFile}:`, loaded.error.message);
}

console.log(`Loaded environment file: ${envFile}`);
console.log(`NODE_ENV: ${env}`);

if (usesTsNodeRuntime(env)) {
  require('ts-node/register');
  require('tsconfig-paths/register');
  require(path.resolve(__dirname, 'src/main'));
} else {
  const compiledMain = path.resolve(__dirname, 'dist/src/main.js');
  if (!require('fs').existsSync(compiledMain)) {
    console.error(
      `Missing ${compiledMain}. Run "npm run build" during deploy (Render build command), not at start.`,
    );
    process.exit(1);
  }
  require(compiledMain);
}
