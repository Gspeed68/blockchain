import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./logger";
import { startScheduledValuationRefresh } from "./services/scheduler";

const app = createApp();

app.listen(env.PORT, () => {
  logger.info(`Bourbon Registry API listening on :${env.PORT}`);
  logger.info(`  Besu RPC:       ${env.BESU_RPC_URL}`);
  logger.info(`  Web3Signer RPC: ${env.WEB3SIGNER_RPC_URL}`);
  startScheduledValuationRefresh();
});
