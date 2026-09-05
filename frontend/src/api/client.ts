import type { Appraisal, Bottle, BottleDetail, NewBottleInput, WriteResult } from "./types";

// Talks ONLY to this app's own backend — never to the chain directly. That's
// deliberate (see the project README): the API layer is the whole point,
// not a passthrough, so the frontend has no ethers.js, no RPC URL, no
// concept of gas or a signer. It just calls REST endpoints and renders
// what comes back.
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "content-type": "application/json", ...init?.headers },
  });

  const body = await res.json().catch(() => undefined);

  if (!res.ok) {
    const message = (body && typeof body === "object" && "message" in body ? String(body.message) : undefined) ??
      (body && typeof body === "object" && "error" in body ? String(body.error) : `HTTP ${res.status}`);
    throw new ApiError(message, res.status, body);
  }

  return body as T;
}

export const api = {
  health: () => request<{ status: string; besu: unknown; web3signer: unknown }>("/health"),

  listBottles: () => request<Bottle[]>("/bottles"),

  getBottle: (id: number) => request<BottleDetail>(`/bottles/${id}`),

  addBottle: (input: NewBottleInput) =>
    request<WriteResult<Bottle>>("/bottles", { method: "POST", body: JSON.stringify(input) }),

  updateCondition: (id: number, condition: string, fillLevelPercent: number) =>
    request<WriteResult<Bottle>>(`/bottles/${id}/condition`, {
      method: "PATCH",
      body: JSON.stringify({ condition, fillLevelPercent }),
    }),

  recordAppraisal: (id: number, valueCents: number, note: string) =>
    request<WriteResult<Appraisal>>(`/bottles/${id}/appraisals`, {
      method: "POST",
      body: JSON.stringify({ valueCents, note }),
    }),

  refreshValuation: (id: number) =>
    request<WriteResult<Appraisal>>(`/bottles/${id}/appraisals/refresh`, { method: "POST" }),

  uploadPhoto: (file: File) => {
    const form = new FormData();
    form.append("photo", file);
    return request<{ photoUri: string; photoHash: string }>("/uploads", { method: "POST", body: form });
  },

  getTransaction: (txHash: string) =>
    request<{ txHash: string; status: "pending" | "confirmed" | "reverted"; blockNumber?: number; gasUsed?: string }>(
      `/transactions/${txHash}`
    ),
};
