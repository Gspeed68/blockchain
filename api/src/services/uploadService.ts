import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import multer from "multer";
import { env } from "../config/env";

/**
 * Off-chain photo storage for this POC: local disk, served statically by
 * this API process (see app.ts's `/uploads` static route). The contract
 * only ever stores a URI + a sha256 hash (see contracts/BottleRegistry.sol)
 * — swapping this for S3 later means changing this one file to upload to
 * S3 and return the S3 URL instead; nothing about the contract, the chain
 * write path, or the API's request/response shape needs to change.
 */
fs.mkdirSync(env.UPLOADS_DIR, { recursive: true });

export const uploadMiddleware = multer({
  storage: multer.diskStorage({
    destination: env.UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype.startsWith("image/"));
  },
});

export function describeUpload(file: Express.Multer.File): { photoUri: string; photoHash: string } {
  const bytes = fs.readFileSync(file.path);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  return {
    photoUri: `${env.PUBLIC_BASE_URL}/uploads/${path.basename(file.path)}`,
    photoHash: `0x${sha256}`,
  };
}
