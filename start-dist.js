/**
 * Start compiled API (dist/src/main.js) after loading dotenv for NODE_ENV.
 * Use on EC2 after `npm run build` — do not run `node dist/src/main.js` directly.
 *
 *   NODE_ENV=development node start-dist.js   → .env.development
 *   NODE_ENV=production node start-dist.js    → .env.production
 */
require('./load-env');

const fs = require('fs');
const path = require('path');

const compiledMain = path.resolve(__dirname, 'dist/src/main.js');
if (!fs.existsSync(compiledMain)) {
  console.error(`Missing ${compiledMain}. Run: npm run build`);
  process.exit(1);
}

require(compiledMain);
