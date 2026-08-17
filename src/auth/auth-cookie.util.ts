import type { CookieOptions, Request, Response } from 'express';

export const REFRESH_COOKIE_NAME = 'ecommreco_rt';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function parseBooleanEnv(value: string | undefined) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

export function getRefreshCookieOptions(): CookieOptions {
  const nodeEnv = (process.env.NODE_ENV ?? 'development').toLowerCase();
  const isProd = nodeEnv === 'production';
  const secure =
    parseBooleanEnv(process.env.AUTH_COOKIE_SECURE) || isProd;
  const sameSiteEnv = String(process.env.AUTH_COOKIE_SAMESITE ?? '')
    .trim()
    .toLowerCase();
  const sameSite: CookieOptions['sameSite'] =
    sameSiteEnv === 'none' || sameSiteEnv === 'lax' || sameSiteEnv === 'strict'
      ? sameSiteEnv
      : 'lax';

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
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
  });
}
