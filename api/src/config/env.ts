import "dotenv/config";
import { z } from "zod";

// Fail fast and loud on a bad/missing config rather than limping along with
// `undefined` sprinkled through the chain code — that's exactly the kind of
// error that's easy to misdiagnose as "the blockchain is broken" when it's
// actually just a missing env var.
const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  BESU_RPC_URL: z.string().url(),
  WEB3SIGNER_RPC_URL: z.string().url(),
  CHAIN_ID: z.coerce.number().int().positive(),

  CONTRACT_CONFIG_PATH: z.string().default("./src/config/contract.json"),

  VALUATION_PROVIDER: z.enum(["whiskyhunter", "ebay", "mock"]).default("whiskyhunter"),
  EBAY_CLIENT_ID: z.string().optional(),
  EBAY_CLIENT_SECRET: z.string().optional(),

  UPLOADS_DIR: z.string().default("./uploads"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:4000"),

  VALUATION_REFRESH_CRON: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:");
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
