const axios = require('axios');

class ShopifyService {
  constructor() {
    this.accessToken = null;
    this.tokenExpiry = null;
    this.currentScopes = null;
    this.shop = process.env.SHOPIFY_SHOP_NAME?.trim();
    this.clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
    this.clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();
    this.apiVersion = '2024-01';
    
    // Debug logging
    console.log('Shopify Service initialized with shop:', this.shop);
    this.validateConfig();
  }

  validateConfig() {
    console.log('\n=== Shopify Configuration Check ===');
    console.log('Shop:', this.shop || '❌ MISSING');
    console.log('Client ID:', this.clientId ? '✅ Present' : '❌ MISSING');
    console.log('Client Secret:', this.clientSecret ? '✅ Present' : '❌ MISSING');
    
    if (!this.shop) {
      throw new Error('SHOPIFY_SHOP_NAME is not set in .env file');
    }
    if (!this.clientId) {
      throw new Error('SHOPIFY_CLIENT_ID is not set in .env file');
    }
    if (!this.clientSecret) {
      throw new Error('SHOPIFY_CLIENT_SECRET is not set in .env file');
    }
    
    // Remove any trailing slashes or .myshopify.com
    this.shop = this.shop.replace('.myshopify.com', '').replace(/\/$/, '');
    console.log('Cleaned shop name:', this.shop);
    console.log('==============================\n');
  }

  initializeClient() {
    if (!this.shop) {
      throw new Error('Shop name is not defined');
    }
    
    const baseURL = `https://${this.shop}.myshopify.com/admin/api/${this.apiVersion}`;
    console.log('Initializing Shopify client with base URL:', baseURL);
    
    this.client = axios.create({
      baseURL: baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    // Add request interceptor to include access token
    this.client.interceptors.request.use(
      async (config) => {
        await this.ensureValidToken();
        config.headers['X-Shopify-Access-Token'] = this.accessToken;
        return config;
      },
      (error) => Promise.reject(error)
    );
  }

  async refreshAccessToken() {
    try {
      // Debug: Check what we're sending
      console.log('Attempting to refresh token for shop:', this.shop);
      console.log('Using client ID:', this.clientId ? 'Present' : 'Missing');
      
      if (!this.shop) {
        throw new Error('Shop name is not defined');
      }
      
      const tokenUrl = `https://${this.shop}.myshopify.com/admin/oauth/access_token`;
      console.log('Token URL:', tokenUrl);
      
      const response = await axios.post(
        tokenUrl,
        new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'client_credentials',
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiry = new Date(Date.now() + (response.data.expires_in * 1000));
      this.currentScopes = response.data.scope;
      
      console.log('Access token refreshed successfully');
      console.log('Token expires in:', response.data.expires_in, 'seconds');
      console.log('Scopes:', response.data.scope);
      
      // Verify scopes after token refresh
      await this.verifyScopes();
      
      return this.accessToken;
    } catch (error) {
      console.error('Error refreshing access token:');
      console.error('Error message:', error.message);
      console.error('Error code:', error.code);
      console.error('Shop name from env:', this.shop);
      
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      throw error;
    }
  }

  // Update the verifyScopes method in shopify.js:

// Replace the entire verifyScopes method with this:

async verifyScopes() {
  try {
    // Required scopes for our app
    const requiredScopes = [
      'write_orders',   // This includes permission to capture payments (transactions) for orders
      'read_orders',    // For reading order details and checking flags
    ];
    
    console.log('\n=== Scope Verification ===');
    console.log('Required scopes:', requiredScopes);
    
    // The scope is returned as a comma-separated string
    const grantedScopes = this.currentScopes ? this.currentScopes.split(',').map(s => s.trim()) : [];
    console.log('Granted scopes:', grantedScopes);
    
    // Check if we have the required scopes or their equivalents
    const hasWriteOrders = grantedScopes.includes('write_orders');
    
    // read_all_orders includes read_orders and more
    const hasReadOrders = grantedScopes.includes('read_orders') || grantedScopes.includes('read_all_orders');
    
    const missingScopes = [];
    if (!hasWriteOrders) missingScopes.push('write_orders');
    if (!hasReadOrders) missingScopes.push('read_orders (or read_all_orders)');
    
    if (missingScopes.length > 0) {
      console.warn('⚠️ MISSING SCOPES:', missingScopes);
      console.warn('\n🔧 HOW TO FIX:');
      console.warn('1. Go to Shopify Partner Dashboard → Apps → Your App');
      console.warn('2. Click "App setup" → "Admin API integration"');
      console.warn('3. Under "Orders" section, check the required scopes');
      console.warn('4. Click "Save"');
      console.warn('5. Reinstall the app in your store');
      console.warn('6. Restart this server\n');
    } else {
      console.log('✅ All required scopes are granted!');
      if (grantedScopes.includes('read_all_orders')) {
        console.log('🎉 BONUS: You have read_all_orders (even better than read_orders!)');
      }
      console.log('Note: With write_orders scope, you can capture payments on orders.');
    }
    
    return missingScopes;
  } catch (error) {
    console.error('Error verifying scopes:', error.message);
    return ['error'];
  }
}

  async ensureValidToken() {
    if (!this.accessToken || !this.tokenExpiry || this.tokenExpiry < new Date(Date.now() - 300000)) { // 5 minute buffer
      console.log('Token expired or about to expire, refreshing...');
      await this.refreshAccessToken();
    } else {
      const remaining = Math.floor((this.tokenExpiry - new Date()) / 1000 / 60);
      console.log(`Token valid for ${remaining} more minutes`);
    }
  }

  async getOrder(orderId) {
    try {
      await this.ensureValidToken();
      const response = await this.client.get(`/orders/${orderId}.json`);
      return response.data.order;
    } catch (error) {
      if (error.response?.status === 403) {
        const errorMsg = `Permission denied reading order ${orderId}. Missing "read_orders" scope.`;
        console.error(`❌ ${errorMsg}`);
        console.error('Please add "read_orders" scope to your app and reinstall.');
        throw new Error(errorMsg);
      }
      console.error(`Error fetching order ${orderId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  async capturePayment(orderId, transactionId) {
    try {
      await this.ensureValidToken();
      const response = await this.client.post(`/orders/${orderId}/transactions.json`, {
        transaction: {
          kind: 'capture',
          parent_id: transactionId,
        },
      });
      return response.data.transaction;
    } catch (error) {
      console.error(`Error capturing payment for order ${orderId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  async getOrderTransactions(orderId) {
    try {
      await this.ensureValidToken();
      const response = await this.client.get(`/orders/${orderId}/transactions.json`);
      return response.data.transactions;
    } catch (error) {
      if (error.response?.status === 403) {
        const errorMsg = `Permission denied reading transactions for order ${orderId}. Missing "read_orders" scope.`;
        console.error(`❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }
      console.error(`Error fetching transactions for order ${orderId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  async getAuthorizedTransaction(orderId) {
    try {
      const transactions = await this.getOrderTransactions(orderId);
      return transactions.find(t => 
        t.kind === 'authorization' && 
        t.status === 'success' &&
        !t.parent_id // Not already captured
      );
    } catch (error) {
      // If we get a permission error, we can't check for authorized transactions
      console.error(`Cannot check authorized transactions for order ${orderId}:`, error.message);
      return null;
    }
  }

  hasFlag(order, flagName) {
    if (!order) return false;
    
    // Check in note attributes
    if (order.note_attributes) {
      const flagAttr = order.note_attributes.find(attr => 
        attr.name === 'payment_flag' && attr.value === flagName
      );
      if (flagAttr) return true;
    }

    // Check in metafields (if using metafields)
    if (order.metafields) {
      const flagMetafield = order.metafields.find(meta => 
        meta.key === 'payment_flag' && meta.value === flagName
      );
      if (flagMetafield) return true;
    }

    // Check in tags
    if (order.tags && order.tags.includes(flagName)) {
      return true;
    }

    // Check in custom attributes
    if (order.custom_attributes) {
      const flagCustom = order.custom_attributes.find(attr => 
        attr.key === 'payment_flag' && attr.value === flagName
      );
      if (flagCustom) return true;
    }

    return false;
  }

  async processOrder(orderId) {
    try {
      const order = await this.getOrder(orderId);
      
      // Check for buy_now flag
      if (this.hasFlag(order, 'buy_now')) {
        console.log(`Processing buy_now order: ${orderId}`);
        const result = await this.capturePaymentImmediately(orderId);
        return { orderId, flag: 'buy_now', captured: !!result };
      }
      // Check for pay_later flag
      else if (this.hasFlag(order, 'pay_later')) {
        console.log(`Scheduling pay_later order: ${orderId} for 7 days later`);
        // This will be handled by the scheduler
        return {
          orderId,
          flag: 'pay_later',
          scheduledFor: new Date(Date.now() + (7 * 24 * 60 * 60 * 1000)),
        };
      } else {
        console.log(`No payment flag found for order ${orderId}`);
        return null;
      }
    } catch (error) {
      if (error.message.includes('Missing "read_orders" scope')) {
        console.warn(`⚠️ Cannot process order ${orderId} automatically: Missing read_orders scope`);
        console.warn('Please add read_orders scope to enable automatic flag detection');
        return { orderId, error: 'missing_read_scope', message: error.message };
      }
      console.error(`Error processing order ${orderId}:`, error.message);
      throw error;
    }
  }

  async capturePaymentImmediately(orderId) {
    try {
      const authorizedTransaction = await this.getAuthorizedTransaction(orderId);
      
      if (!authorizedTransaction) {
        console.log(`No authorized transaction found for order ${orderId}`);
        return null;
      }

      console.log(`Capturing payment for order ${orderId}, transaction ${authorizedTransaction.id}`);
      return await this.capturePayment(orderId, authorizedTransaction.id);
    } catch (error) {
      console.error(`Error capturing payment immediately for order ${orderId}:`, error.message);
      throw error;
    }
  }

  async capturePaymentForOrder(orderId) {
    return await this.capturePaymentImmediately(orderId);
  }

  // Helper method to get shop info (doesn't require read_orders)
  async getShopInfo() {
    try {
      await this.ensureValidToken();
      const response = await this.client.get('/shop.json');
      return response.data.shop;
    } catch (error) {
      console.error('Error fetching shop info:', error.response?.data || error.message);
      throw error;
    }
  }

  // Test method to check if we can read orders
async testOrderReadPermission() {
  try {
    await this.ensureValidToken();
    const response = await this.client.get('/orders.json?limit=1');
    return {
      success: true,
      hasPermission: true,
      permission: 'read_all_orders', // Specify which permission we have
      orderCount: response.data.orders?.length || 0
    };
  } catch (error) {
    if (error.response?.status === 403) {
      return {
        success: false,
        hasPermission: false,
        error: 'Missing read_orders or read_all_orders scope. Please add this scope in your app configuration.'
      };
    }
    throw error;
  }
}

  // Manual capture without checking flags (for testing without read_orders)
  async manualCapturePayment(orderId, transactionId) {
    try {
      console.log(`Manually capturing payment for order ${orderId}, transaction ${transactionId}`);
      return await this.capturePayment(orderId, transactionId);
    } catch (error) {
      console.error(`Manual capture failed for order ${orderId}:`, error.message);
      throw error;
    }
  }
}

module.exports = new ShopifyService();