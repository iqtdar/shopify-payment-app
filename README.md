# Shopify Payment Capturer

A private Shopify app that captures payments based on order metadata flags (`buy_now` or `pay_later`).

## Features

- **buy_now flag**: Captures payment immediately when order is created/updated
- **pay_later flag**: Schedules payment capture for 7 days later
- **Webhook support**: Automatically processes orders via Shopify webhooks
- **Manual capture**: API endpoints for manual payment capture
- **Health monitoring**: Health check endpoint for uptime monitoring

## Installation & Deployment

### Deploy to Render (Free Tier)

1. **Push to GitHub:**
   ```bash
   git add .
   git commit -m "Initial commit"
   git push origin main