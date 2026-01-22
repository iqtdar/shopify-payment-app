const schedule = require('node-schedule');
const shopifyService = require('./shopify');

class PaymentScheduler {
  constructor() {
    this.scheduledJobs = new Map();
    this.pendingOrders = new Set();
  }

  async start() {
    console.log('Payment scheduler started');
    
    // Schedule daily check for pending pay_later orders
    schedule.scheduleJob('0 0 * * *', async () => {
      await this.checkPendingOrders();
    });
    
    // Also run immediately on startup
    await this.checkPendingOrders();
  }

  async schedulePayment(orderId, captureDate) {
    const jobId = `payment_capture_${orderId}`;
    
    // Cancel existing job if any
    if (this.scheduledJobs.has(jobId)) {
      this.scheduledJobs.get(jobId).cancel();
    }

    // Schedule new job
    const job = schedule.scheduleJob(captureDate, async () => {
      console.log(`Executing scheduled payment capture for order ${orderId}`);
      try {
        await shopifyService.capturePaymentForOrder(orderId);
        this.scheduledJobs.delete(jobId);
        this.pendingOrders.delete(orderId);
        console.log(`Successfully captured payment for order ${orderId}`);
      } catch (error) {
        console.error(`Failed to capture payment for order ${orderId}:`, error.message);
        // Retry logic could be added here
      }
    });

    this.scheduledJobs.set(jobId, job);
    this.pendingOrders.add(orderId);
    
    console.log(`Payment scheduled for order ${orderId} at ${captureDate}`);
    return jobId;
  }

  async checkPendingOrders() {
    console.log('Checking for pending pay_later orders...');
    
    // In a real application, you would fetch orders from a database
    // For now, we'll rely on the webhook to add orders to pendingOrders
    
    const now = new Date();
    for (const orderId of this.pendingOrders) {
      // You could implement additional checks here
      console.log(`Order ${orderId} is pending payment capture`);
    }
  }

  cancelScheduledPayment(orderId) {
    const jobId = `payment_capture_${orderId}`;
    if (this.scheduledJobs.has(jobId)) {
      this.scheduledJobs.get(jobId).cancel();
      this.scheduledJobs.delete(jobId);
      this.pendingOrders.delete(orderId);
      console.log(`Cancelled scheduled payment for order ${orderId}`);
      return true;
    }
    return false;
  }
}

module.exports = new PaymentScheduler();