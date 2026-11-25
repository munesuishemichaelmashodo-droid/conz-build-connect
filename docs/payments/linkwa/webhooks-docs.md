# Webhooks Developer Documentation — Linkwa

Real-time payment notifications with signature verification and automatic retries for Linkwa developers.

## Overview

Linkwa posts a `payment.completed` event to your endpoint after a successful checkout. Webhooks let you update orders, send confirmations, or trigger any automation the moment a payment succeeds — without polling.

*Note: Webhooks are included on the Growth plan. Add your endpoint from your dashboard.*

---

## 1. Event Payload (`payment.completed`)

Fired after a successful checkout. Note: `external_payment_link_id` exists only if the link is generated for an App via API.

```json
{
  "event": "payment.completed",
  "payment_link_name": "Premium Subscription",
  "status": "PAID",
  "reference": "PAY-123456789",
  "receipt_id": "REC-987654321",
  "amount": 15.50,
  "currency": "USD",
  "external_payment_link_id": "01ktpcws7840j4k4swyg3zbxgn",
  "checkout_url": "https://linkwa.com/pay/b01jxYz",
  "payment_date_time": "2026-01-01T21:08:56.548172Z",
  "customer": {
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "263771234567"
  }
}
```

---

## 2. Signature Verification

Verify the `X-Linkwa-Signature` header using your webhook signing secret.

### PHP Example
```php
$expected = hash_hmac('sha256', $rawBody, $secret);
$received = $_SERVER['HTTP_X_LINKWA_SIGNATURE'];

if (hash_equals($expected, $received)) {
    // Valid signature - process webhook
}
```

---

## 3. Automatic Retries

If your server returns a temporary error (`5xx`), rate limit (`429`), invalid signature / auth error (`401`), or connection timeout, Linkwa automatically retries webhook delivery up to 9 times (10 total attempts) according to the following schedule:

| Attempt | Schedule |
| :--- | :--- |
| **1st Retry** | 10 seconds |
| **2nd Retry** | 30 seconds |
| **3rd Retry** | 60 seconds |
| **4th Retry** | 5 minutes |
| **5th – 9th Retries** | Every 30 minutes |

*Note: Non-retryable client errors (such as `404 Not Found` or `400 Bad Request`) fail immediately and are not retried. Retries for `401 Unauthorized` give you time to correct your webhook signing secret.*

---

## Additional Resources
- **Developer API Docs:** `/developer-apps/docs` (`/developer-apps/docs.md`)
- **Ecommerce Integrations:** `/integrations/docs` (`/integrations/docs.md`)
