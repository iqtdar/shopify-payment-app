require('dotenv').config();

const shop = process.env.SHOPIFY_SHOP_NAME;
const clientId = process.env.SHOPIFY_CLIENT_ID;
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

console.log('Shop name:', shop);
console.log('Client ID present:', !!clientId);
console.log('Client Secret present:', !!clientSecret);

if (!shop) {
  console.error('ERROR: SHOPIFY_SHOP_NAME is not set in .env file');
  process.exit(1);
}

if (!clientId) {
  console.error('ERROR: SHOPIFY_CLIENT_ID is not set in .env file');
  process.exit(1);
}

if (!clientSecret) {
  console.error('ERROR: SHOPIFY_CLIENT_SECRET is not set in .env file');
  process.exit(1);
}

console.log('All environment variables are set correctly.');
console.log('Full URL would be: https://' + shop + '.myshopify.com/admin/oauth/access_token');
