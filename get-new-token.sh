#!/bin/bash
echo "Getting fresh access token with updated scopes..."
echo

# Direct API call to get new token
curl -X POST \
  "https://iconic-rings-us.myshopify.com/admin/oauth/access_token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=e168581227968015c6876d3a1d84fc16" \
  -d "client_secret=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"
