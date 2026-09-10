import type { CookieOptions, Request, Response } from 'express';

export const REFRESH_COOKIE_NAME = 'ecommreco_rt';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_REFRESH_COOKIE_PATH = '/api/v1/auth';

function parseBooleanEnv(value: string | undefined) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

function normalizeOrigin(value: string) {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

function isLoopbackHost(hostname: string) {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0'
  );
}

/**
 * True when the browser must call the API on a different site (e.g. dev.ecommreco.com
 * → api-dev.ecommreco.com). Local Vite proxy (localhost:8080 → localhost:5001) is NOT
 * cross-origin from the browser's perspective when cookies are set via the proxy.
 */
export function isCrossOriginAuthDeployment(): boolean {
  const apiPublicUrl = String(process.env.API_PUBLIC_URL ?? '').trim();
  const frontendUrl = String(process.env.FRONTEND_URL ?? '').trim();
  if (!apiPublicUrl || !frontendUrl) return false;
  try {
    const api = new URL(apiPublicUrl);
    const fe = new URL(frontendUrl);
    const apiOrigin = normalizeOrigin(api.origin);
    const feOrigin = normalizeOrigin(fe.origin);
    if (apiOrigin === feOrigin) return false;

    if (isLoopbackHost(api.hostname) && isLoopbackHost(fe.hostname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function getRefreshCookieOptions(): CookieOptions {
  const nodeEnv = (process.env.NODE_ENV ?? 'development').toLowerCase();
  const isProd = nodeEnv === 'production';
  const crossOrigin = isCrossOriginAuthDeployment();
  const sameSiteEnv = String(process.env.AUTH_COOKIE_SAMESITE ?? '')
    .trim()
    .toLowerCase();
  const sameSite: CookieOptions['sameSite'] =
    sameSiteEnv === 'none' || sameSiteEnv === 'lax' || sameSiteEnv === 'strict'
      ? sameSiteEnv
      : crossOrigin
        ? 'none'
        : 'lax';
  const secureFromEnv = parseBooleanEnv(process.env.AUTH_COOKIE_SECURE);
  const secure =
    crossOrigin || sameSite === 'none'
      ? true
      : secureFromEnv || isProd;
  const cookieDomain = String(process.env.AUTH_COOKIE_DOMAIN ?? '').trim();
  const cookiePath =
    String(process.env.AUTH_COOKIE_PATH ?? '').trim() ||
    DEFAULT_REFRESH_COOKIE_PATH;

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: cookiePath,
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  };
}

export function readCookie(req: Request, name: string): string {
  const header = String(req.headers.cookie ?? '');
  if (!header) return '';
  const parts = header.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(trimmed.slice(eq + 1).trim());
    } catch {
      return trimmed.slice(eq + 1).trim();
    }
  }
  return '';
}

export function readRefreshCookie(req: Request): string {
  return readCookie(req, REFRESH_COOKIE_NAME).trim();
}

export function setRefreshCookie(res: Response, refreshToken: string) {
  const token = String(refreshToken ?? '').trim();
  if (!token) return;
  res.cookie(REFRESH_COOKIE_NAME, token, getRefreshCookieOptions());
}

export function clearRefreshCookie(res: Response) {
  const options = getRefreshCookieOptions();
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: options.httpOnly,
    secure: options.secure,
    sameSite: options.sameSite,
    path: options.path,
    ...(options.domain ? { domain: options.domain } : {}),
  });
}
