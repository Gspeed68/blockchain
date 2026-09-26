import type { CustodyEvent, Item, ItemDetail, NewCustodyEventInput, NewItemInput, WriteResult } from "./types";

// Talks ONLY to this app's own backend — never to the chain directly. The
// API layer is the whole point, not a passthrough, so the frontend has no
// ethers.js, no RPC URL, no concept of gas or a signer. It just calls REST
// endpoints and renders what comes back.
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4100";

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

  listItems: () => request<Item[]>("/items"),

  getItem: (id: number) => request<ItemDetail>(`/items/${id}`),

  registerItem: (input: NewItemInput) =>
    request<WriteResult<Item>>("/items", { method: "POST", body: JSON.stringify(input) }),

  recordCustodyEvent: (id: number, input: NewCustodyEventInput) =>
    request<WriteResult<CustodyEvent>>(`/items/${id}/custody-events`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  uploadDocument: (file: File) => {
    const form = new FormData();
    form.append("document", file);
    return request<{ documentUri: string; documentHash: string }>("/uploads", { method: "POST", body: form });
  },

  getTransaction: (txHash: string) =>
    request<{ txHash: string; status: "pending" | "confirmed" | "reverted"; blockNumber?: number; gasUsed?: string }>(
      `/transactions/${txHash}`
    ),
};
