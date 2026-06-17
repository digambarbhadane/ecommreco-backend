/**
 * Documents and verifies NODE_ENV → env file mapping used by server.js / load-env.js.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveEnvFile } = require('../../config/env-file');

describe('environment file mapping', () => {
  it('maps development to .env.development', () => {
    expect(resolveEnvFile('development')).toBe('.env.development');
    expect(resolveEnvFile(undefined)).toBe('.env.development');
  });

  it('maps staging to .env.uat', () => {
    expect(resolveEnvFile('staging')).toBe('.env.uat');
  });

  it('maps test to .env.test', () => {
    expect(resolveEnvFile('test')).toBe('.env.test');
  });

  it('maps production to .env.production', () => {
    expect(resolveEnvFile('production')).toBe('.env.production');
  });
});
