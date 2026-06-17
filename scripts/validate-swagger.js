#!/usr/bin/env node
const https = require('https');
const http = require('http');

const host = process.env.SWAGGER_HOST || 'localhost';
const port = process.env.SWAGGER_PORT || '5000';
const protocol = process.env.SWAGGER_HTTPS === 'true' ? https : http;

const path = process.env.SWAGGER_JSON_PATH || '/api/v1/docs-json';
// Fallback for older mounts: SWAGGER_JSON_PATH=/docs-json

console.log(`Fetching OpenAPI spec from ${protocol === https ? 'https' : 'http'}://${host}:${port}${path}...`);

const req = protocol.request({ host, port, path, method: 'GET', timeout: 10000 }, (res) => {
  if (res.statusCode !== 200) {
    console.error(`❌ HTTP ${res.statusCode} - Swagger endpoint not available`);
    process.exit(1);
  }

  let data = '';
  res.on('data', (chunk) => (data += chunk));
  res.on('end', () => {
    try {
      const spec = JSON.parse(data);
      const errors = [];

      if (!spec.openapi || !spec.openapi.startsWith('3.')) {
        errors.push(`Invalid or missing OpenAPI version: ${spec.openapi}`);
      }
      if (!spec.info?.title) errors.push('Missing info.title');
      if (!spec.info?.version) errors.push('Missing info.version');
      if (!spec.paths || Object.keys(spec.paths).length === 0) {
        errors.push('No paths defined in OpenAPI spec');
      }

      if (errors.length > 0) {
        console.error('❌ Invalid OpenAPI spec:');
        errors.forEach((e) => console.error(`  - ${e}`));
        process.exit(1);
      }

      const pathCount = Object.keys(spec.paths).length;
      const tagCounts = {};
      if (spec.tags) {
        spec.tags.forEach((t) => (tagCounts[t.name] = 0));
      }

      Object.entries(spec.paths).forEach(([path, methods]) => {
        Object.entries(methods).forEach(([method, details]) => {
          if (Array.isArray(details.tags)) {
            details.tags.forEach((tag) => {
              if (tagCounts[tag] !== undefined) tagCounts[tag]++;
            });
          }
          if (!details.summary) {
            console.warn(`⚠️  Path ${path} [${method.toUpperCase()}] has no summary`);
          }
        });
      });

      console.log(`✅ OpenAPI spec is valid (${pathCount} paths)`);
      if (spec.tags) {
        console.log('\nTags:');
        spec.tags.forEach((t) => {
          const count = tagCounts[t.name] ?? 0;
          console.log(`  ${t.name}: ${count} endpoints`);
        });
      }

      const undocumentedTags = Object.entries(tagCounts)
        .filter(([, count]) => count === 0)
        .map(([name]) => name);
      if (undocumentedTags.length > 0) {
        console.warn(`\n⚠️  Empty tags (unused): ${undocumentedTags.join(', ')}`);
      }

      process.exit(0);
    } catch (parseErr) {
      console.error(`❌ Failed to parse OpenAPI JSON: ${parseErr.message}`);
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error(`❌ Cannot reach server: ${err.message}`);
  console.error('   Make sure the server is running with Swagger enabled.');
  process.exit(1);
});

req.on('timeout', () => {
  console.error('❌ Request timed out');
  process.exit(1);
});

req.end();