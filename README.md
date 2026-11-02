# Errandly

**A shopping agent that spends only what you allow.**

You write a mandate in plain words ("keep the office stocked with ink and paper, up to $60 a purchase and $150 a month, only Staples or Amazon, ask me above $40"). The model (Gemini by default) turns it into a precise spend policy. You approve the mandate once with PayPal, which vaults your wallet for this app. From then on the agent runs errands: it searches real products, picks an offer, and a deterministic policy engine decides whether to pay now, pause for your approval, or refuse. Payments are merchant-initiated charges against the vaulted PayPal wallet, so an in-policy purchase completes with no checkout screen and nobody present. Every step is written to an audit trail.

Built for the PayPal AI Hackathon 2026, aimed at **Best Use of Agentic Commerce**.

## Why this shape

Agents that can spend money need four things that chat alone cannot give: a scoped, revocable payment credential; a policy the model cannot talk its way around; a record of why each dollar moved; and a bias toward spending as little of the owner's money as the task allows. Errandly maps each to a concrete mechanism:

| Need | Mechanism |
|---|---|
| Consent once, charge later | Payment Method Tokens v3: a setup token the user approves, exchanged for a vaulted payment token |
| Spend without a human present | Orders v2 with `payment_source.paypal.vault_id` and `stored_credential` (merchant-initiated, unscheduled) |
| Revocation that actually bites | Revoking a mandate deletes the payment token at PayPal |
| Policy the LLM cannot bypass | `src/lib/policy.ts`: pure code, evaluates caps, categories, merchants, period budgets, expiry, and the auto-approve threshold; the model only proposes |
| Human in the loop where it matters | Purchases above the threshold stop in `awaiting_approval` until the owner clicks Approve; the policy is re-checked at execution time |
| Audit | Each run stores searches, the proposal, every policy check with its reason, the PayPal order and capture ids |
| Respect for the owner's money | Searches are capped to the mandate's per-purchase limit and the remaining period budget before results reach the model; among genuine matches the agent must pick the lowest total price; it buys quantity 1 unless the task says otherwise; and it never pays anything the policy did not approve. A 5-ream case for 34.99 USD beats five single reams for 45.10 USD |

## How it is built

| Layer | Tech |
|---|---|
| UI | Next.js 16, React 19 |
| Agent | Vercel AI SDK v7 `generateText` tool loop. Model switchable with `LLM_PROVIDER`: Gemini 3.1 Pro via `@ai-sdk/google` (default), Claude Opus 5.5 via `@ai-sdk/anthropic`, or either through Vertex AI |
| Mandate parsing | `generateObject` with a zod schema |
| Product search | Channel3 `/v1/search` (100M+ products, 25k retailers). Falls back to a labelled demo catalog when no key is set |
| PayPal | `@paypal/agent-toolkit` for OAuth and the agent's read tools (`get_order`, `list_transactions`); REST for vault and orders |
| Storage | JSON file store (`DATA_DIR`), swap for a database by replacing `src/lib/store.ts` |

Key files: `src/lib/agent.ts` (mandate parsing, run loop, approval flow), `src/lib/policy.ts` (decision engine), `src/lib/paypal.ts` (setup tokens, payment tokens, vault charges, toolkit adapter), `src/lib/channel3.ts`.

## Run it locally

Requirements: Node 24+, pnpm 10 (`corepack enable`), a PayPal sandbox REST app with "Save payment methods" (Vault) enabled, and a model key: a Google AI Studio key (free tier) for the default Gemini provider, or an Anthropic key with `LLM_PROVIDER=anthropic`. A Channel3 key enables live product search; without it a labelled demo catalog is used.

```bash
pnpm install
cp .env.example .env.local     # fill in the keys
pnpm dev                       # http://localhost:3000
```

Flow to demo:

1. Create a mandate from one of the examples. Review the parsed policy.
2. Click **Connect PayPal**, sign in with a sandbox *personal* account, and approve. You land back on the mandate, now **Active**.
3. Run "Order black ink for the HP printer": the agent searches, proposes, the engine auto-approves under the threshold, and PayPal captures the order. The run shows the order id.
4. Run something pricier: the run stops at **Needs approval**. Approve it, and the charge completes; decline it, and nothing moves.
5. Ask for wine or a gift card: the engine refuses and shows which check failed.
6. Revoke the mandate: the payment token is deleted at PayPal.

Check `GET /api/health` for credential status. The sandbox business account that receives these payments can be the same one Ledgerly (the companion project) reads from, so the purchases appear there as transactions.

## What is simulated

Payment is real (sandbox). The hand-off to the retailer after payment is simulated: Errandly records the buy link and marks the order placed. In production this step would call the retailer's agentic checkout or affiliate API; the money side, which is the hard part, is complete.

## Deploy

`render.yaml` provisions a web service with a persistent disk for the JSON store. Set the secret env vars and `APP_URL` to the public URL so PayPal's return redirect lands correctly. Or `docker build -t errand . && docker run -p 3000:3000 -v errand-data:/data --env-file .env.local errand`.

## License

MIT
