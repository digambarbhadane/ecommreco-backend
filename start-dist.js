/**
 * Start compiled API (dist/src/main.js) after loading dotenv for NODE_ENV.
 * Use on EC2 after `npm run build` — do not run `node dist/src/main.js` directly.
 *
 *   NODE_ENV=development node start-dist.js   → .env.development
 *   NODE_ENV=production node start-dist.js    → .env.production
 */
const fs = require('fs');
const path = require('path');

const { env, envFile } = require('./load-env');
const envPath = path.resolve(process.cwd(), envFile);

if (!fs.existsSync(envPath)) {
  console.error(
    `[env] Cannot start: ${envFile} not found (NODE_ENV=${env}). ` +
      'Create it from .env.development on the server, or use: pm2 start ecosystem.config.js --only api-dev',
  );
  process.exit(1);
}

if (!process.env.MONGODB_URI?.trim()) {
  console.error(
    `[env] MONGODB_URI is not set after loading ${envFile}. ` +
      'Check the file is not empty and NODE_ENV matches the env file you edited.',
  );
  process.exit(1);
}

const compiledMain = path.resolve(__dirname, 'dist/src/main.js');
if (!fs.existsSync(compiledMain)) {
  console.error(`Missing ${compiledMain}. Run: npm run build`);
  process.exit(1);
}

require(compiledMain);
