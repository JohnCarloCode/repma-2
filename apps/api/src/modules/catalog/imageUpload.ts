import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { AppError } from '../../core/errors.js';

// RF-17 / RNF-06 — multipart parsing for `POST /products/:id/image`: one file
// in the `image` field, held in memory (≤5 MB, so a buffer is fine and there
// is no temp file to clean up), then streamed to Storage by the service. The
// global JSON/urlencoded parsers (100 kb) skip multipart bodies, so they never
// see the upload.
export const IMAGE_FIELD = 'image';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TOO_LARGE = 'The image cannot exceed 5 MB';

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 10, parts: 11 },
}).single(IMAGE_FIELD);

function invalid(path: string, message: string): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'Invalid request', [{ path, message }]);
}

// Every parser failure becomes the API's envelope (never Express's default):
// too large → 413 on `image`; a file under another field → 400 "Unknown field";
// a second file → 400; any other limit or a malformed body → 400 on `image`.
export function parseImage(req: Request, res: Response, next: NextFunction): void {
  parser(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(413, 'PAYLOAD_TOO_LARGE', TOO_LARGE, [{ path: IMAGE_FIELD, message: TOO_LARGE }]));
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
        return next(
          err.field && err.field !== IMAGE_FIELD
            ? invalid(err.field, 'Unknown field')
            : invalid(IMAGE_FIELD, 'Upload a single image'),
        );
      }
    }
    next(invalid(IMAGE_FIELD, 'The upload could not be read'));
  });
}

// The type is decided by the file's signature (magic bytes), never by the
// client's mimetype or file name; the result also sets the stored object's
// Content-Type and extension.
export type ImageType = { contentType: 'image/jpeg' | 'image/png'; extension: 'jpg' | 'png' };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

export function detectImageType(content: Buffer): ImageType | null {
  if (content.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (content.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  return null;
}
