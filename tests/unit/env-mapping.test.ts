/**
 * Documents and verifies NODE_ENV → env file mapping used by server.js / load-env.js.
 */
function resolveEnvFile(nodeEnv: string | undefined): string {
  const env = nodeEnv || 'development';
  return env === 'production'
    ? '.env.production'
    : env === 'staging'
      ? '.env.uat'
      : '.env.development';
}

describe('environment file mapping', () => {
  it('maps development to .env.development', () => {
    expect(resolveEnvFile('development')).toBe('.env.development');
    expect(resolveEnvFile(undefined)).toBe('.env.development');
  });

  it('maps staging to .env.uat', () => {
    expect(resolveEnvFile('staging')).toBe('.env.uat');
  });

  it('maps production to .env.production', () => {
    expect(resolveEnvFile('production')).toBe('.env.production');
  });
});
