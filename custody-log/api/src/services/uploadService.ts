import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import multer from "multer";
import { env } from "../config/env";

/**
 * Off-chain document storage for this POC: local disk, served statically by
 * this API process (see app.ts's `/uploads` static route). The contract
 * only ever stores a URI + a sha256 hash (see contracts/CustodyRegistry.sol)
 * — swapping this for S3 later means changing this one file to upload to
 * S3 and return the S3 URL instead; nothing about the contract, the chain
 * write path, or the API's request/response shape needs to change.
 */
fs.mkdirSync(env.UPLOADS_DIR, { recursive: true });

export const uploadMiddleware = multer({
  storage: multer.diskStorage({
    destination: env.UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".bin";
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB — bills of lading/inspection scans can be multi-page PDFs
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype.startsWith("image/") || file.mimetype === "application/pdf");
  },
});

export function describeUpload(file: Express.Multer.File): { documentUri: string; documentHash: string } {
  const bytes = fs.readFileSync(file.path);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  return {
    documentUri: `${env.PUBLIC_BASE_URL}/uploads/${path.basename(file.path)}`,
    documentHash: `0x${sha256}`,
  };
}
