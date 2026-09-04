import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { logger } from "./logger";
import { env } from "./config/env";
import { healthRouter } from "./routes/health";
import { bottlesRouter } from "./routes/bottles";
import { transactionsRouter } from "./routes/transactions";
import { errorHandler } from "./middleware/errorHandler";

export function createApp(): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.use("/uploads", express.static(path.resolve(process.cwd(), env.UPLOADS_DIR)));

  app.use(healthRouter);
  app.use(bottlesRouter);
  app.use(transactionsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  // Must be registered last — Express identifies error-handling middleware
  // by its 4-argument signature.
  app.use(errorHandler);

  return app;
}
