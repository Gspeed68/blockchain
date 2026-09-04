import cron from "node-cron";
import { env } from "../config/env";
import { logger } from "../logger";
import { listBottles, recordAppraisal } from "./bottleService";
import { fetchEstimatedValue } from "./valuation";

/**
 * Optional scheduled valuation refresh — off unless VALUATION_REFRESH_CRON
 * is set (see api/.env.example). Deliberately sequential with a delay
 * between bottles rather than Promise.all-ing the whole collection: this
 * hits an external API on every bottle, and WhiskyHunter's own data only
 * updates daily, so there is no reason to hammer it with concurrent
 * requests — see the project brief's "respect rate limits" requirement.
 */
const DELAY_BETWEEN_BOTTLES_MS = 3_000;

export function startScheduledValuationRefresh(): void {
  if (!env.VALUATION_REFRESH_CRON) {
    logger.info("scheduler: VALUATION_REFRESH_CRON not set, scheduled refresh disabled");
    return;
  }

  if (!cron.validate(env.VALUATION_REFRESH_CRON)) {
    logger.error({ cron: env.VALUATION_REFRESH_CRON }, "scheduler: invalid cron expression, refresh disabled");
    return;
  }

  logger.info({ cron: env.VALUATION_REFRESH_CRON }, "scheduler: scheduled valuation refresh enabled");

  cron.schedule(env.VALUATION_REFRESH_CRON, async () => {
    logger.info("scheduler: starting scheduled valuation refresh run");
    let bottles;
    try {
      bottles = await listBottles();
    } catch (err) {
      logger.error({ err }, "scheduler: failed to list bottles, aborting this run");
      return;
    }

    for (const bottle of bottles) {
      try {
        const estimate = await fetchEstimatedValue({ distillery: bottle.distillery, bottleName: bottle.bottleName });
        if (!estimate) {
          logger.info({ bottleId: bottle.id }, "scheduler: no valuation found, skipping");
        } else {
          const result = await recordAppraisal(bottle.id, estimate.valueCents, estimate.source, estimate.note);
          logger.info({ bottleId: bottle.id, result }, "scheduler: recorded appraisal");
        }
      } catch (err) {
        logger.error({ err, bottleId: bottle.id }, "scheduler: failed to refresh bottle, continuing to next");
      }
      await sleep(DELAY_BETWEEN_BOTTLES_MS);
    }
    logger.info("scheduler: scheduled valuation refresh run complete");
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
