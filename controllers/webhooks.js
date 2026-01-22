const shopifyService = require('../services/shopify');
const scheduler = require('../services/scheduler');

class WebhookController {
  async handleOrderCreate(req, res) {
    try {
      const order = req.body;
      console.log(`Order created: ${order.id}`);
      
      // Process the order
      const result = await shopifyService.processOrder(order.id);
      
      if (result && result.flag === 'pay_later') {
        await scheduler.schedulePayment(result.orderId, result.scheduledFor);
      }
      
      res.status(200).send('Webhook received');
    } catch (error) {
      console.error('Error handling order create webhook:', error);
      res.status(500).send('Internal server error');
    }
  }

  async handleOrderUpdate(req, res) {
    try {
      const order = req.body;
      console.log(`Order updated: ${order.id}`);
      
      // Check if payment flag was added or changed
      if (shopifyService.hasFlag(order, 'buy_now')) {
        // If now marked as buy_now, capture immediately
        await shopifyService.capturePaymentImmediately(order.id);
        // Cancel any scheduled payment if exists
        scheduler.cancelScheduledPayment(order.id);
      } else if (shopifyService.hasFlag(order, 'pay_later')) {
        // If now marked as pay_later, schedule for 7 days from now
        const scheduledFor = new Date(Date.now() + (7 * 24 * 60 * 60 * 1000));
        await scheduler.schedulePayment(order.id, scheduledFor);
      }
      
      res.status(200).send('Webhook received');
    } catch (error) {
      console.error('Error handling order update webhook:', error);
      res.status(500).send('Internal server error');
    }
  }
}

module.exports = new WebhookController();