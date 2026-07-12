/**
 * Plain-JS entry for server.js / load-env.js (before Nest compiles).
 * Keep in sync with src/config/env-file.ts
 */
function resolveEnvFile(nodeEnv) {
  const env = nodeEnv || 'development';
  if (env === 'production') return '.env.production';
  if (env === 'staging') return '.env.uat';
  if (env === 'test') return '.env.test';
  return '.env.development';
}

function usesTsNodeRuntime(nodeEnv) {
  const env = nodeEnv || 'development';
  return env === 'development' || env === 'test';
}

module.exports = { resolveEnvFile, usesTsNodeRuntime };
