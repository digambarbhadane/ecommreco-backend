import {
  DocumentBuilder,
  SwaggerDocumentOptions,
  type OpenAPIObject,
} from '@nestjs/swagger';

const API_PREFIX = '/api/v1';

/**
 * Nest may emit paths as `/api/v1/auth/login` while servers also use `.../api/v1`,
 * which makes Swagger UI call `/api/v1/api/v1/auth/login`. Normalize to relative paths.
 */
export function normalizeSwaggerDocument(document: OpenAPIObject): OpenAPIObject {
  if (!document.paths) {
    return document;
  }

  const pathKeys = Object.keys(document.paths);
  const pathsIncludeApiPrefix = pathKeys.some(
    (p) => p === API_PREFIX || p.startsWith(`${API_PREFIX}/`),
  );

  if (!pathsIncludeApiPrefix) {
    return document;
  }

  const normalizedPaths: OpenAPIObject['paths'] = {};
  for (const [path, operations] of Object.entries(document.paths)) {
    let relative = path;
    if (relative.startsWith(`${API_PREFIX}/`)) {
      relative = relative.slice(API_PREFIX.length);
    } else if (relative === API_PREFIX) {
      relative = '/';
    }
    if (!relative.startsWith('/')) {
      relative = `/${relative}`;
    }
    normalizedPaths[relative] = operations;
  }
  document.paths = normalizedPaths;

  const defaultServers = [
    { url: `http://localhost:5000${API_PREFIX}`, description: 'Local development server' },
    { url: `https://api-uat.ecommreco.com${API_PREFIX}`, description: 'UAT server' },
    { url: `https://api.ecommreco.com${API_PREFIX}`, description: 'Production server' },
  ];

  document.servers =
    document.servers?.map((server, index) => {
      const trimmed = server.url.replace(/\/+$/, '');
      const base = trimmed.replace(/\/api\/v1$/i, '');
      const fallback = defaultServers[index]?.url ?? defaultServers[0].url;
      return {
        ...server,
        url: `${base}${API_PREFIX}` || fallback,
        description: server.description ?? defaultServers[index]?.description,
      };
    }) ?? defaultServers;

  return document;
}

export const createDocumentOptions = (): SwaggerDocumentOptions => ({
  operationIdFactory: (controllerKey: string, methodKey: string) =>
    `${controllerKey}_${methodKey}`,
  /**
   * Global prefix is `api/v1`. Server URLs in the spec already include `/api/v1`,
   * so paths must be `/auth/login` not `/api/v1/auth/login` (avoids /api/v1/api/v1/...).
   */
  ignoreGlobalPrefix: true,
});

export const buildSwaggerConfig = () =>
  new DocumentBuilder()
    .setTitle('EcommReco API')
    .setDescription(
      'API documentation for EcommReco platform. Authentication is handled via JWT Bearer tokens. Include the token in the Authorization header as: Bearer <token>',
    )
    .setVersion('1.0.0')
    .addServer('http://localhost:5000/api/v1', 'Local development server')
    .addServer('https://api-uat.ecommreco.com/api/v1', 'UAT server')
    .addServer('https://api.ecommreco.com/api/v1', 'Production server')
    .addCookieAuth('access_token', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access_token')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT token',
      },
      'bearer',
    )
    .addApiKey(
      { type: 'apiKey', name: 'x-setup-token', in: 'header' },
      'setup-token',
    )
    .addTag('Auth', 'Authentication and authorization endpoints')
    .addTag('Users', 'User management (super_admin only)')
    .addTag('Roles', 'Role management')
    .addTag('Sellers', 'Seller management and registration')
    .addTag('Leads', 'Lead management, follow-ups, notes, and conversions')
    .addTag('Marketplaces', 'Seller marketplace integrations')
    .addTag('Platform-Marketplaces', 'Platform-level marketplace configuration')
    .addTag('Notifications', 'User notifications and activity logs')
    .addTag('Subscriptions', 'Subscription package management')
    .addTag('GST', 'GSTIN verification and GST data management')
    .addTag('Profile', 'User profile and account management')
    .addTag('Account-Manager', 'Account manager operations')
    .addTag('Sales-Activity', 'Sales activity tracking and targets')
    .addTag('Report-Import', 'Report file uploads and imported data management')
    .addTag('Health', 'Health check and system diagnostics')
    .build();