const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

class ShopifyService {
  constructor() {
    this.accessToken = null;
    this.tokenExpiry = null;
    this.shop = process.env.SHOPIFY_SHOP_NAME;
    this.clientId = process.env.SHOPIFY_CLIENT_ID;
    this.clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    this.apiVersion = '2024-01';
    this.scheduledJobs = [];
    this.isSchedulerRunning = false;
    this.payLaterDelay = (process.env.PAY_LATER_DELAY_MINUTES || 30) * 60 * 1000;
    
    // Create logs directory
    this.logsDir = path.join(__dirname, '../logs');
    this.ensureLogsDirectory();
  }

  async ensureLogsDirectory() {
    try {
      await fs.mkdir(this.logsDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create logs directory:', error.message);
    }
  }

  logToFile(message) {
    const logFile = path.join(this.logsDir, 'shopify-service.log');
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    fs.appendFile(logFile, logMessage).catch(() => {
      // Silently fail if we can't write to log file
    });
  }

  initializeClient() {
    console.log('Initializing Shopify client for:', this.shop);
    this.logToFile(`Initializing Shopify client for: ${this.shop}`);

    if (!this.shop) {
      throw new Error('SHOPIFY_SHOP_NAME is not set in environment variables');
    }

    this.baseURL = `https://${this.shop}.myshopify.com/admin/api/${this.apiVersion}`;
    console.log('✅ Shopify client configured');
    this.logToFile('Shopify client configured successfully');
  }

  async refreshAccessToken() {
    try {
      console.log('Refreshing access token...');
      this.logToFile('Refreshing access token');

      if (!this.shop || !this.clientId || !this.clientSecret) {
        throw new Error('Missing Shopify configuration');
      }

      const response = await axios.post(
        `https://${this.shop}.myshopify.com/admin/oauth/access_token`,
        new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'client_credentials',
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10000 // 10 second timeout
        }
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiry = new Date(Date.now() + response.data.expires_in * 1000);

      this.client = axios.create({
        baseURL: this.baseURL,
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.accessToken,
          'User-Agent': 'Shopify-Payment-Capturer/1.0'
        },
        timeout: 30000 // 30 second timeout for Shopify API
      });

      console.log('✅ Access token refreshed successfully');
      console.log('Scopes:', response.data.scope);
      this.logToFile(`Access token refreshed. Scopes: ${response.data.scope}`);
      
      return this.accessToken;
    } catch (error) {
      const errorMsg = `Error refreshing access token: ${error.message}`;
      console.error('❌', errorMsg);
      this.logToFile(`ERROR: ${errorMsg}`);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      throw error;
    }
  }

  async ensureValidToken() {
    if (
      !this.accessToken ||
      !this.tokenExpiry ||
      this.tokenExpiry < new Date(Date.now() - 300000) // Refresh if expires in 5 minutes
    ) {
      console.log('Token expired or about to expire, refreshing...');
      this.logToFile('Token needs refresh');
      await this.refreshAccessToken();
    }
  }

  async getOrder(orderId) {
    try {
      await this.ensureValidToken();
      const response = await this.client.get(`/orders/${orderId}.json`);
      return response.data.order;
    } catch (error) {
      const errorMsg = `Error fetching order ${orderId}: ${error.message}`;
      console.error(errorMsg);
      this.logToFile(`ERROR: ${errorMsg}`);
      throw error;
    }
  }

  async capturePayment(orderId, transactionId) {
    try {
      await this.ensureValidToken();
      const response = await this.client.post(
        `/orders/${orderId}/transactions.json`,
        {
          transaction: {
            kind: 'capture',
            parent_id: transactionId,
            amount: null // Capture full amount
          },
        }
      );
      
      const successMsg = `✅ Payment captured for order ${orderId}, transaction ${transactionId}`;
      console.log(successMsg);
      this.logToFile(successMsg);
      
      return response.data.transaction;
    } catch (error) {
      const errorMsg = `Error capturing payment for order ${orderId}: ${error.message}`;
      console.error(errorMsg);
      this.logToFile(`ERROR: ${errorMsg}`);
      if (error.response) {
        console.error('Error response:', error.response.data);
      }
      throw error;
    }
  }

  async getOrderTransactions(orderId) {
    try {
      await this.ensureValidToken();
      const response = await this.client.get(
        `/orders/${orderId}/transactions.json`
      );
      return response.data.transactions;
    } catch (error) {
      const errorMsg = `Error fetching transactions for order ${orderId}: ${error.message}`;
      console.error(errorMsg);
      this.logToFile(`ERROR: ${errorMsg}`);
      throw error;
    }
  }

  async getRecentOrders(limit = 5) {
    try {
      await this.ensureValidToken();
      const response = await this.client.get(
        `/orders.json?limit=${limit}&status=any&order=created_at desc`
      );
      return response.data.orders || [];
    } catch (error) {
      const errorMsg = `Error fetching recent orders: ${error.message}`;
      console.error(errorMsg);
      this.logToFile(`ERROR: ${errorMsg}`);
      return [];
    }
  }

  async processOrder(orderData) {
    try {
      console.log(`🎯 Processing order: ${orderData.id}`);
      this.logToFile(`Processing order: ${orderData.id}`);

      // Fetch the full order
      const order = await this.getOrder(orderData.id);
      
      console.log('🔍 Checking for payment flag...');
      
      // Check multiple places for payment flag
      let paymentFlag = null;
      
      // 1. Check note attributes
      const noteAttributes = order.note_attributes || [];
      const paymentFlagAttr = noteAttributes.find(attr => {
        const name = attr.name ? attr.name.toLowerCase() : '';
        return name === 'payment_flag' || name === 'purchase_type';
      });
      
      if (paymentFlagAttr) {
        paymentFlag = paymentFlagAttr.value.toLowerCase();
        console.log(`✅ Found payment flag in note attributes: ${paymentFlag}`);
      }
      
      // 2. Check line item properties
      if (!paymentFlag && order.line_items && order.line_items.length > 0) {
        for (const lineItem of order.line_items) {
          if (lineItem.properties && lineItem.properties.length > 0) {
            const prop = lineItem.properties.find(p => {
              const name = p.name ? p.name.toLowerCase() : '';
              return name === 'payment_flag' || name === 'purchase_type';
            });
            if (prop) {
              paymentFlag = prop.value.toLowerCase();
              console.log(`✅ Found payment flag in line item properties: ${paymentFlag}`);
              break;
            }
          }
        }
      }
      
      // 3. Check tags
      if (!paymentFlag && order.tags) {
        const tags = order.tags.toLowerCase();
        if (tags.includes('buy_now')) {
          paymentFlag = 'buy_now';
          console.log('✅ Found buy_now tag');
        } else if (tags.includes('pay_later')) {
          paymentFlag = 'pay_later';
          console.log('✅ Found pay_later tag');
        }
      }

      if (!paymentFlag) {
        console.log(`ℹ️ No payment flag found for order ${order.id}`);
        this.logToFile(`No payment flag found for order ${order.id}`);
        return;
      }

      // Get transactions
      const transactions = await this.getOrderTransactions(order.id);
      const authTransaction = transactions.find(t => 
        t.kind === 'authorization' && t.status === 'success'
      );

      if (!authTransaction) {
        console.log(`⚠️ No authorized transaction found for order ${order.id}`);
        this.logToFile(`No authorized transaction for order ${order.id}`);
        return;
      }

      const transactionId = authTransaction.id;
      console.log(`✅ Found authorized transaction: ${transactionId}`);

      if (paymentFlag === 'buy_now') {
        console.log(`💰 Processing buy_now for order ${order.id}`);
        this.logToFile(`Processing buy_now for order ${order.id}`);
        
        try {
          await this.capturePayment(order.id, transactionId);
        } catch (error) {
          console.error(`❌ Buy now capture failed: ${error.message}`);
          this.logToFile(`Buy now capture failed: ${error.message}`);
        }
      } else if (paymentFlag === 'pay_later') {
        console.log(`⏰ Processing pay_later for order ${order.id}, scheduling capture in ${this.payLaterDelay / 60000} minutes`);
        this.logToFile(`Scheduling pay_later capture for order ${order.id}`);
        
        this.schedulePaymentCapture(order.id, transactionId, this.payLaterDelay);
      } else {
        console.log(`❓ Unknown payment flag: ${paymentFlag}`);
        this.logToFile(`Unknown payment flag: ${paymentFlag}`);
      }

    } catch (error) {
      const errorMsg = `Error processing order ${orderData.id}: ${error.message}`;
      console.error(errorMsg);
      this.logToFile(`ERROR: ${errorMsg}`);
      throw error;
    }
  }

  schedulePaymentCapture(orderId, transactionId, delay) {
    console.log(`⏰ Scheduling payment capture for order ${orderId} in ${delay}ms`);
    this.logToFile(`Scheduling payment capture for order ${orderId}`);
    
    const scheduledTime = Date.now() + delay;
    
    const job = {
      orderId,
      transactionId,
      scheduledTime,
      jobId: null
    };
    
    job.jobId = setTimeout(async () => {
      try {
        console.log(`🔔 Executing scheduled payment capture for order ${orderId}`);
        this.logToFile(`Executing scheduled capture for order ${orderId}`);
        
        await this.capturePayment(orderId, transactionId);
        
        this.removeScheduledJob(orderId);
      } catch (error) {
        console.error(`❌ Scheduled capture failed: ${error.message}`);
        this.logToFile(`Scheduled capture failed: ${error.message}`);
      }
    }, delay);
    
    this.scheduledJobs.push(job);
    console.log(`📅 Scheduled job added. Total jobs: ${this.scheduledJobs.length}`);
  }

  removeScheduledJob(orderId) {
    const index = this.scheduledJobs.findIndex(j => j.orderId === orderId);
    if (index > -1) {
      clearTimeout(this.scheduledJobs[index].jobId);
      this.scheduledJobs.splice(index, 1);
      console.log(`🗑️ Removed scheduled job for order ${orderId}`);
      this.logToFile(`Removed scheduled job for order ${orderId}`);
    }
  }

  getScheduledJobs() {
    return this.scheduledJobs.map(job => {
      const timeLeft = job.scheduledTime - Date.now();
      const minutes = Math.floor(timeLeft / (1000 * 60));
      const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
      
      return {
        orderId: job.orderId,
        scheduledTime: new Date(job.scheduledTime).toISOString(),
        timeLeft: `${minutes}m ${seconds}s`,
        timeLeftMs: timeLeft
      };
    });
  }

  startScheduler() {
    if (this.isSchedulerRunning) return;
    
    console.log('🚀 Starting payment capture scheduler...');
    this.logToFile('Starting payment capture scheduler');
    this.isSchedulerRunning = true;
    
    // Check every minute for overdue jobs
    setInterval(() => {
      const now = Date.now();
      this.scheduledJobs.forEach(job => {
        if (job.scheduledTime <= now && job.jobId) {
          console.log(`⏰ Job for order ${job.orderId} is overdue, executing now...`);
          this.logToFile(`Overdue job detected for order ${job.orderId}`);
          
          clearTimeout(job.jobId);
          
          this.capturePayment(job.orderId, job.transactionId)
            .then(() => {
              console.log(`✅ Overdue job completed for order ${job.orderId}`);
              this.logToFile(`Overdue job completed for order ${job.orderId}`);
              this.removeScheduledJob(job.orderId);
            })
            .catch(error => {
              console.error(`❌ Failed overdue job: ${error.message}`);
              this.logToFile(`Failed overdue job: ${error.message}`);
            });
        }
      });
    }, 60000); // Check every minute
  }
}

module.exports = new ShopifyService();