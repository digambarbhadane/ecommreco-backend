/**
 * Maps NODE_ENV to the dotenv file loaded by server.js and load-env.js.
 */
function resolveEnvFile(nodeEnv) {
  const env = nodeEnv || 'development';
  if (env === 'production') return '.env.production';
  if (env === 'staging') return '.env.uat';
  if (env === 'test') return '.env.test';
  return '.env.development';
}

/** Development and test run TypeScript via ts-node; UAT/prod use compiled dist. */
function usesTsNodeRuntime(nodeEnv) {
  const env = nodeEnv || 'development';
  return env === 'development' || env === 'test';
}

module.exports = { resolveEnvFile, usesTsNodeRuntime };
