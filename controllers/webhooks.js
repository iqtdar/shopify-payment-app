const shopifyService = require('../services/shopify');

// Verify Shopify webhook HMAC (for production)
const verifyWebhook = (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    // In production, implement HMAC verification
    // For now, we'll trust all webhooks
    console.log('⚠️ HMAC verification not implemented');
  }
  next();
};

const handleOrderCreate = async (req, res) => {
  try {
    const orderData = req.body;
    
    console.log('📦 Order create webhook received');
    console.log('Order ID:', orderData.id);
    console.log('Financial status:', orderData.financial_status);
    
    if (!orderData.id) {
      console.error('❌ No order ID in webhook payload');
      return res.status(400).send('Invalid webhook payload');
    }
    
    // Acknowledge webhook immediately
    res.status(200).send('Webhook received');
    
    // Process asynchronously
    setTimeout(async () => {
      try {
        await shopifyService.processOrder(orderData);
      } catch (error) {
        console.error('Error in async processing:', error);
      }
    }, 0);
    
  } catch (error) {
    console.error('Error handling order create webhook:', error);
    res.status(500).send('Error processing webhook');
  }
};

const handleOrderUpdate = async (req, res) => {
  try {
    const orderData = req.body;
    console.log('🔄 Order updated:', orderData.id || 'unknown');
    
    // Just acknowledge for now
    res.status(200).send('Webhook received');
  } catch (error) {
    console.error('Error handling order update webhook:', error);
    res.status(500).send('Error processing webhook');
  }
};

module.exports = {
  handleOrderCreate,
  handleOrderUpdate,
  verifyWebhook
};