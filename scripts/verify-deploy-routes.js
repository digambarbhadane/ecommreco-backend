/**
 * Verify critical API routes are registered on a deployed host.
 * A route that exists but requires auth should return 401, not 404.
 *
 * Usage:
 *   node scripts/verify-deploy-routes.js https://api-test.ecommreco.com
 *   API_BASE_URL=https://api-dev.ecommreco.com node scripts/verify-deploy-routes.js
 */
const baseUrl = (
  process.argv[2] ||
  process.env.API_BASE_URL ||
  'http://127.0.0.1:5001'
).replace(/\/+$/, '');

const routes = [
  { method: 'GET', path: '/api/v1/health', expect: [200] },
  { method: 'GET', path: '/api/v1/report-imports/config', expect: [401] },
  {
    method: 'GET',
    path: '/api/v1/report-imports/platform-analytics?fromDate=2026-07-05&toDate=2026-08-03',
    expect: [401],
  },
  { method: 'GET', path: '/api/v1/report-imports/dashboard', expect: [401] },
];

async function checkRoute(route) {
  const url = `${baseUrl}${route.path}`;
  const response = await fetch(url, { method: route.method });
  const ok = route.expect.includes(response.status);
  return {
    ok,
    method: route.method,
    path: route.path,
    status: response.status,
    expected: route.expect.join(' or '),
  };
}

async function main() {
  console.log(`Verifying routes on ${baseUrl}\n`);
  const results = [];
  for (const route of routes) {
    results.push(await checkRoute(route));
  }

  let failed = 0;
  for (const result of results) {
    const mark = result.ok ? 'OK' : 'FAIL';
    console.log(
      `[${mark}] ${result.method} ${result.path} → ${result.status} (expected ${result.expected})`,
    );
    if (!result.ok) failed += 1;
  }

  if (failed > 0) {
    console.error(
      `\n${failed} route check(s) failed. If platform-analytics returns 404, rebuild and restart the API:\n` +
        '  cd ecommreco-backend && npm ci --include=dev && npm run build\n' +
        '  pm2 restart api-test   # or api-dev / api-uat',
    );
    process.exit(1);
  }

  console.log('\nAll route checks passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
