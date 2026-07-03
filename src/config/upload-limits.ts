/** Max size per report file (bytes). Keep nginx `client_max_body_size` >= this value. */
export const UPLOAD_MAX_FILE_BYTES = (() => {
  const raw = process.env.UPLOAD_MAX_FILE_SIZE_MB;
  const mb = raw ? Number(raw) : 100;
  if (!Number.isFinite(mb) || mb <= 0) {
    return 100 * 1024 * 1024;
  }
  return Math.floor(mb * 1024 * 1024);
})();

export const UPLOAD_MAX_FILE_MB = Math.round(UPLOAD_MAX_FILE_BYTES / (1024 * 1024));

export const MULTER_UPLOAD_LIMITS = {
  fileSize: UPLOAD_MAX_FILE_BYTES,
  fieldSize: UPLOAD_MAX_FILE_BYTES,
  files: 15,
} as const;
