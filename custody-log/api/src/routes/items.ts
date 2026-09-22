import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { uploadMiddleware, describeUpload } from "../services/uploadService";
import * as itemService from "../services/itemService";
import { EVENT_TYPES } from "../chain/types";

export const itemsRouter = Router();

const NewItemSchema = z.object({
  sku: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  category: z.string().max(80).default(""),
  originLocation: z.string().max(200).default(""),
  initialCustodian: z.string().min(1).max(200),
  documentUri: z.string().optional(),
  documentHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
});

// EVENT_TYPES[0] is "Registered", which is seeded automatically by
// registerItem() and can't be recorded through this endpoint — see
// contracts/CustodyRegistry.sol's recordCustodyEvent().
const RecordableEventType = z.enum(EVENT_TYPES.slice(1) as [string, ...string[]]);

const NewCustodyEventSchema = z.object({
  eventType: RecordableEventType,
  toCustodian: z.string().min(1).max(200),
  location: z.string().min(1).max(200),
  notes: z.string().max(1000).default(""),
  documentUri: z.string().optional(),
  documentHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
});

/** Turns a write's WriteOutcome into the right HTTP response: 201 with the
 * confirmed resource, or 202 with just the txHash if it's still pending
 * after the wait window (see chain/writeTransaction.ts). */
function respondToWrite<T>(res: import("express").Response, outcome: itemService.WriteOutcome<T>): void {
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

itemsRouter.get(
  "/items",
  asyncHandler(async (_req, res) => {
    res.json(await itemService.listItems());
  })
);

itemsRouter.post(
  "/items",
  asyncHandler(async (req, res) => {
    const input = NewItemSchema.parse(req.body);
    const outcome = await itemService.registerItem(input);
    respondToWrite(res, outcome);
  })
);

itemsRouter.get(
  "/items/:id",
  asyncHandler(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const [item, custodyEvents] = await Promise.all([
      itemService.getItem(id),
      itemService.listCustodyEvents(id),
    ]);
    res.json({ ...item, custodyEvents });
  })
);

itemsRouter.get(
  "/items/:id/custody-events",
  asyncHandler(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    res.json(await itemService.listCustodyEvents(id));
  })
);

// The core custody-log write: hands the item off (or records an
// inspection/delivery/damage/loss), appending to the on-chain history and
// updating the item's cached current-state fields to match.
itemsRouter.post(
  "/items/:id/custody-events",
  asyncHandler(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const input = NewCustodyEventSchema.parse(req.body);
    const outcome = await itemService.recordCustodyEvent(id, input as itemService.NewCustodyEventInput);
    respondToWrite(res, outcome);
  })
);

// Accepts a supporting document (bill of lading, inspection cert, damage
// photo), stores it off-chain (see services/uploadService.ts), and returns
// the URI + sha256 hash to pass as `documentUri`/`documentHash` in a
// subsequent POST /items or POST /items/:id/custody-events.
itemsRouter.post(
  "/uploads",
  uploadMiddleware.single("document"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "invalid_request", message: "Expected a multipart 'document' field." });
      return;
    }
    res.status(201).json(describeUpload(req.file));
  })
);
