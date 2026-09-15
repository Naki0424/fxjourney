import multer from "multer";

export const MAX_MEDIA_FILE_SIZE = 10 * 1024 * 1024;
export const ALLOWED_MEDIA_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg"]);

export function createMediaUploadMiddleware() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_MEDIA_FILE_SIZE },
    fileFilter: (request, file, callback) => {
      if (!ALLOWED_MEDIA_MIME_TYPES.has(file.mimetype.toLowerCase())) {
        callback(new Error("Please upload a PNG, JPG, or JPEG screenshot."));
        return;
      }
      callback(null, true);
    },
  });
}
