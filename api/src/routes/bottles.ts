import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { uploadMiddleware, describeUpload } from "../services/uploadService";
import * as bottleService from "../services/bottleService";
import { fetchEstimatedValue } from "../services/valuation";
import { CONDITIONS } from "../chain/types";

export const bottlesRouter = Router();

const ConditionEnum = z.enum(CONDITIONS);

const NewBottleSchema = z.object({
  distillery: z.string().min(1).max(120),
  bottleName: z.string().min(1).max(120),
  proof: z.number().min(0).max(200),
  releaseYear: z.number().int().min(1700).max(2100),
  purchaseDate: z.string().datetime().or(z.string().date()),
  purchasePriceCents: z.number().int().nonnegative(),
  condition: ConditionEnum,
  fillLevelPercent: z.number().min(0).max(100),
  photoUri: z.string().min(1),
  photoHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
});

const UpdateConditionSchema = z.object({
  condition: ConditionEnum,
  fillLevelPercent: z.number().min(0).max(100),
});

const NewAppraisalSchema = z.object({
  valueCents: z.number().int().nonnegative(),
  note: z.string().max(500).default(""),
});

/** Turns a write's WriteOutcome into the right HTTP response: 201 with the
 * confirmed resource, or 202 with just the txHash if it's still pending
 * after the wait window (see chain/writeTransaction.ts). */
function respondToWrite<T>(res: import("express").Response, outcome: bottleService.WriteOutcome<T>): void {
  if (outcome.status === "confirmed") {
    res.status(201).json({
      status: "confirmed",
      transaction: { txHash: outcome.txHash, blockNumber: outcome.blockNumber, gasUsed: outcome.gasUsed },
      data: outcome.data,
    });
  } else {
    res
      .status(202)
      .location(`/transactions/${outcome.txHash}`)
      .json({
        status: "pending",
        txHash: outcome.txHash,
        message: "Transaction submitted but not yet confirmed. Poll GET /transactions/:txHash.",
      });
  }
}

bottlesRouter.get(
  "/bottles",
  asyncHandler(async (_req, res) => {
    res.json(await bottleService.listBottles());
  })
);

bottlesRouter.post(
  "/bottles",
  asyncHandler(async (req, res) => {
    const input = NewBottleSchema.parse(req.body);
    const outcome = await bottleService.addBottle(input);
    respondToWrite(res, outcome);
  })
);

bottlesRouter.get(
  "/bottles/:id",
  asyncHandler(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const [bottle, appraisals] = await Promise.all([
      bottleService.getBottle(id),
      bottleService.listAppraisals(id),
    ]);
    res.json({ ...bottle, appraisals });
  })
);

bottlesRouter.patch(
  "/bottles/:id/condition",
  asyncHandler(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const input = UpdateConditionSchema.parse(req.body);
    const outcome = await bottleService.updateCondition(id, input.condition, input.fillLevelPercent);
    respondToWrite(res, outcome);
  })
);

bottlesRouter.get(
  "/bottles/:id/appraisals",
  asyncHandler(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    res.json(await bottleService.listAppraisals(id));
  })
);

// Manual appraisal entry — the human-in-the-loop counterpart to /refresh
// below. Useful when you know a bottle's value better than any API does
// (e.g. you just got an offer on it) and don't want to wait on an external
// source.
bottlesRouter.post(
  "/bottles/:id/appraisals",
  asyncHandler(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const input = NewAppraisalSchema.parse(req.body);
    const outcome = await bottleService.recordAppraisal(id, input.valueCents, "manual", input.note);
    respondToWrite(res, outcome);
  })
);

// Fetches an estimated value from the configured external source (see
// services/valuation/) and records it as a new appraisal on-chain — the
// "trigger a value refresh" endpoint from the project brief.
bottlesRouter.post(
  "/bottles/:id/appraisals/refresh",
  asyncHandler(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const bottle = await bottleService.getBottle(id);

    const estimate = await fetchEstimatedValue({ distillery: bottle.distillery, bottleName: bottle.bottleName });
    if (!estimate) {
      res.status(404).json({
        error: "no_valuation_found",
        message: `No valuation data found for "${bottle.distillery} ${bottle.bottleName}" from any configured source.`,
      });
      return;
    }

    const outcome = await bottleService.recordAppraisal(id, estimate.valueCents, estimate.source, estimate.note);
    respondToWrite(res, outcome);
  })
);

// Accepts a bottle photo, stores it off-chain (see services/uploadService.ts),
// and returns the URI + sha256 hash to pass as `photoUri`/`photoHash` in a
// subsequent POST /bottles or PATCH.
bottlesRouter.post(
  "/uploads",
  uploadMiddleware.single("photo"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "invalid_request", message: "Expected a multipart 'photo' field." });
      return;
    }
    res.status(201).json(describeUpload(req.file));
  })
);
