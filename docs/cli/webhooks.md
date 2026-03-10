---
summary: "CLI reference for `hexos webhooks` (webhook helpers + Gmail Pub/Sub)"
read_when:
  - You want to wire Gmail Pub/Sub events into HexOS
  - You want webhook helper commands
---

# `hexos webhooks`

Webhook helpers and integrations (Gmail Pub/Sub, webhook helpers).

Related:
- Webhooks: [Webhook](/automation/webhook)
- Gmail Pub/Sub: [Gmail Pub/Sub](/automation/gmail-pubsub)

## Gmail

```bash
hexos webhooks gmail setup --account you@example.com
hexos webhooks gmail run
```

See [Gmail Pub/Sub documentation](/automation/gmail-pubsub) for details.
