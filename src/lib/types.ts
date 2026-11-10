export type Period = "day" | "week" | "month";

export type Policy = {
  currency: string;
  /** Hard cap on a single purchase. */
  perTransactionMax: number;
  /** Hard cap on total spend within `period`. */
  periodMax: number;
  period: Period;
  /** Purchases at or below this amount run without asking. Above it, the agent pauses for approval. */
  autoApproveBelow: number;
  /** Max number of completed purchases per period. */
  maxPurchasesPerPeriod: number;
  /** Lower-case category keywords. Empty list = any category allowed. */
  allowedCategories: string[];
  blockedCategories: string[];
  /** Retailer domains like "amazon.com". Empty list = any merchant allowed. */
  allowedMerchants: string[];
  blockedMerchants: string[];
  /** ISO date-time or null for no expiry. */
  expiresAt: string | null;
  /** Anything else the agent should respect, in plain words. */
  notes: string;
};

export type MandateStatus = "needs_paypal" | "active" | "revoked" | "expired";

export type Mandate = {
  id: string;
  name: string;
  /** The user's original plain-language instruction. */
  description: string;
  policy: Policy;
  status: MandateStatus;
  createdAt: string;
  paypal: {
    setupTokenId?: string;
    vaultId?: string;
    customerId?: string;
    payerEmail?: string;
    approvedAt?: string;
  };
};

export type Proposal = {
  productId: string;
  title: string;
  merchantDomain: string;
  offerUrl: string;
  imageUrl?: string;
  amount: number;
  currency: string;
  quantity: number;
  category: string;
  rationale: string;
  source: "channel3" | "demo";
};

export type Check = { name: string; pass: boolean; detail: string };

export type Decision = {
  outcome: "auto" | "approval" | "deny";
  reasons: string[];
  checks: Check[];
  spentThisPeriod: number;
  purchasesThisPeriod: number;
  remainingAfter: number;
};

export type Payment = {
  orderId: string;
  captureId?: string;
  status: string;
  amount: number;
  currency: string;
  payerEmail?: string;
  at: string;
};

export type StepType = "thought" | "search" | "policy" | "payment" | "approval" | "error" | "summary" | "fulfillment";

export type RunStep = {
  at: string;
  type: StepType;
  title: string;
  detail?: string;
  data?: unknown;
};

export type RunStatus = "running" | "awaiting_approval" | "completed" | "denied" | "no_match" | "failed";

export type Run = {
  id: string;
  mandateId: string;
  task: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  steps: RunStep[];
  proposal?: Proposal;
  decision?: Decision;
  payment?: Payment;
  summary?: string;
  error?: string;
  /** Set when the run was stopped by the time limit or found abandoned. */
  interrupted?: boolean;
};

export type ProductCandidate = {
  id: string;
  title: string;
  brand: string;
  imageUrl?: string;
  category: string;
  bestOffer: { domain: string; url: string; price: number; currency: string; availability: string } | null;
  offerCount: number;
  source: "channel3" | "demo";
};
