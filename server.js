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

// Load the selected environment file (do not override vars set by Render/host)
dotenv.config({
  path: path.resolve(process.cwd(), envFile),
  override: false,
});

console.log(`Loaded environment file: ${envFile}`);
console.log(`NODE_ENV: ${env}`);

if (env === 'development') {
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
