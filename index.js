require('dotenv').config();
const express = require('express');
const app = express();
const shopifyService = require('./services/shopify');
const webhookController = require('./controllers/webhooks');
const scheduler = require('./services/scheduler');

app.use(express.json());

// Add production logging for Render
if (process.env.NODE_ENV === 'production') {
  console.log('🚀 Running in PRODUCTION mode on Render');
  
  // Force HTTPS in production (Render provides x-forwarded-proto)
  app.use((req, res, next) => {
    const isLocalhost = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    
    if (!isLocalhost && !isSecure && process.env.NODE_ENV === 'production') {
      return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// Add debug middleware with better formatting
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url} - ${req.ip}`);
  next();
});

try {
  // Initialize Shopify client
  shopifyService.initializeClient();
  console.log('✅ Shopify client initialized');
} catch (error) {
  console.error('❌ Failed to initialize Shopify client:', error.message);
  process.exit(1);
}

// === ROUTES ===

// Health check endpoint (used by Render for monitoring)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    shop: process.env.SHOPIFY_SHOP_NAME ? 'Configured' : 'Not configured',
    platform: 'render',
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Shopify Payment Capturer API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      webhooks: ['/webhooks/orders/create', '/webhooks/orders/updated'],
      test: ['/test/shop', '/test/orders', '/test/permissions'],
      documentation: 'See README for full API documentation'
    }
  });
});

// Webhook endpoint for order creation/update
app.post('/webhooks/orders/create', webhookController.handleOrderCreate);
app.post('/webhooks/orders/updated', webhookController.handleOrderUpdate);

// === TEST & DEBUG ENDPOINTS ===

// Test endpoint to manually trigger token refresh
app.get('/test-token', async (req, res) => {
  try {
    const token = await shopifyService.refreshAccessToken();
    res.json({ 
      success: true, 
      message: 'Token refreshed successfully',
      tokenLength: token?.length || 0,
      scopes: shopifyService.currentScopes
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message,
      shop: process.env.SHOPIFY_SHOP_NAME
    });
  }
});

// Test endpoint to verify API connection
app.get('/test/shop', async (req, res) => {
  try {
    await shopifyService.ensureValidToken();
    const response = await shopifyService.client.get('/shop.json');
    res.json({
      success: true,
      shop: response.data.shop,
      scopes: shopifyService.currentScopes,
      environment: process.env.NODE_ENV
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data
    });
  }
});

// Test endpoint to list recent orders
app.get('/test/orders', async (req, res) => {
  try {
    await shopifyService.ensureValidToken();
    const response = await shopifyService.client.get('/orders.json?limit=5&status=any');
    res.json({
      success: true,
      orderCount: response.data.orders?.length || 0,
      orders: response.data.orders,
      environment: process.env.NODE_ENV
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data
    });
  }
});

// Test endpoint to verify transaction permissions
app.get('/test/transactions/:orderId', async (req, res) => {
  try {
    const orderId = req.params.orderId;
    await shopifyService.ensureValidToken();
    const response = await shopifyService.client.get(`/orders/${orderId}/transactions.json`);
    res.json({
      success: true,
      orderId: orderId,
      transactionCount: response.data.transactions?.length || 0,
      transactions: response.data.transactions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data
    });
  }
});

// Test endpoint to capture payment manually
app.post('/test/capture/:orderId', async (req, res) => {
  try {
    const orderId = req.params.orderId;
    
    console.log(`Attempting to capture payment for order ${orderId}`);
    
    // First, check if we have authorized transactions
    const transactions = await shopifyService.getOrderTransactions(orderId);
    
    const authorizedTx = transactions.find(t => 
      t.kind === 'authorization' && t.status === 'success' && !t.parent_id
    );
    
    if (!authorizedTx) {
      return res.json({
        success: false,
        message: 'No authorized transaction found to capture',
        transactions: transactions
      });
    }
    
    console.log(`Found authorized transaction: ${authorizedTx.id}`);
    
    // Try to capture
    const result = await shopifyService.capturePayment(orderId, authorizedTx.id);
    
    res.json({
      success: true,
      message: 'Payment captured successfully',
      transaction: result
    });
    
  } catch (error) {
    console.error('Capture test failed:', error.message);
    
    if (error.response?.data?.errors === 'Required scope missing') {
      res.status(403).json({
        success: false,
        error: 'Missing required scope',
        message: 'Please check your app scopes and reinstall'
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message,
        details: error.response?.data
      });
    }
  }
});

// Manual capture endpoint (works without read_orders scope)
app.post('/manual-capture/:orderId', async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const { transactionId } = req.body;
    
    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: 'transactionId is required in request body'
      });
    }
    
    console.log(`Manual capture request for order ${orderId}, transaction ${transactionId}`);
    
    const result = await shopifyService.manualCapturePayment(orderId, transactionId);
    
    res.json({
      success: true,
      message: 'Payment captured manually',
      transaction: result
    });
    
  } catch (error) {
    console.error('Manual capture failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      note: 'You have write_orders scope, so you should be able to capture payments.'
    });
  }
});

// Test order read permission
app.get('/test/permissions', async (req, res) => {
  try {
    const permissionTest = await shopifyService.testOrderReadPermission();
    res.json(permissionTest);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Simulation endpoint for testing webhooks
app.post('/simulate/order-webhook', async (req, res) => {
  try {
    const { orderId, flag } = req.body;
    
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'orderId is required'
      });
    }
    
    console.log(`Simulating webhook for order ${orderId} with flag: ${flag}`);
    
    // Simulate the webhook processing
    if (flag === 'buy_now') {
      const result = await shopifyService.capturePaymentImmediately(orderId);
      return res.json({
        success: true,
        message: `Order ${orderId} processed with buy_now flag`,
        captured: !!result
      });
    } else if (flag === 'pay_later') {
      const scheduledFor = new Date(Date.now() + (7 * 24 * 60 * 60 * 1000));
      await scheduler.schedulePayment(orderId, scheduledFor);
      return res.json({
        success: true,
        message: `Order ${orderId} scheduled for payment in 7 days`,
        scheduledFor: scheduledFor.toISOString()
      });
    } else {
      return res.json({
        success: true,
        message: `Order ${orderId} processed (no flag)`,
        note: 'No payment flag found'
      });
    }
    
  } catch (error) {
    console.error('Simulation error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// === SERVER STARTUP ===

// Use PORT provided by Render
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🏪 Shop name: ${process.env.SHOPIFY_SHOP_NAME || 'NOT SET'}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  
  // Start the scheduler for pay_later orders
  try {
    await scheduler.start();
    console.log('✅ Payment scheduler started');
    
    // Note about Render free tier limitations
    if (process.env.NODE_ENV === 'production' && process.env.RENDER) {
      console.log('⚠️  NOTE: Render free tier instances sleep after 15 minutes of inactivity.');
      console.log('⚠️  Scheduled payments may be delayed if the instance is sleeping.');
      console.log('⚠️  Consider upgrading to a paid plan or using a cron service to ping the app.');
    }
  } catch (error) {
    console.error('❌ Failed to start scheduler:', error.message);
  }
  
  // Initial token fetch with retry
  let retries = 3;
  while (retries > 0) {
    try {
      console.log(`🔑 Attempting to obtain initial access token (${retries} retries left)...`);
      await shopifyService.refreshAccessToken();
      console.log('✅ Initial access token obtained successfully');
      break;
    } catch (error) {
      retries--;
      if (retries === 0) {
        console.error('❌ Failed to obtain initial access token after all retries:', error.message);
        console.log('⚠️  App will continue, but Shopify API calls may fail until token is obtained');
      } else {
        console.log(`⏳ Retrying in 5 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
  
  console.log('✅ App is fully initialized and ready!');
  console.log('📝 API Documentation:');
  console.log('   • GET  /health - Health check');
  console.log('   • POST /webhooks/orders/create - Order creation webhook');
  console.log('   • POST /webhooks/orders/updated - Order update webhook');
  console.log('   • GET  /test/shop - Test Shopify connection');
  console.log('   • GET  /test/orders - List recent orders');
});

// === ERROR HANDLING ===

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('🔥 UNCAUGHT EXCEPTION:', error);
  console.error('Stack trace:', error.stack);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 UNHANDLED REJECTION at:', promise);
  console.error('Reason:', reason);
});

// Graceful shutdown handler
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received. Shutting down gracefully...');
  // Clean up scheduler jobs if needed
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received. Shutting down gracefully...');
  process.exit(0);
});