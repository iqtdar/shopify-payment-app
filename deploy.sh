#!/bin/bash

# AWS EC2 Deployment Script for Shopify Payment Capturer
# Run this on your EC2 instance after connecting via SSH

echo "🚀 Starting AWS EC2 deployment for Shopify Payment Capturer..."

# Update system
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js 18.x
echo "⬇️ Installing Node.js 18.x..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install Nginx
echo "🌐 Installing Nginx..."
sudo apt install -y nginx

# Install PM2
echo "📊 Installing PM2..."
sudo npm install -g pm2

# Clone or update repository
echo "📥 Setting up application..."
if [ -d "shopify-payment-capturer" ]; then
    echo "📁 Repository exists, pulling latest changes..."
    cd shopify-payment-capturer
    git pull origin main
else
    echo "📁 Cloning repository..."
    git clone https://github.com/iqtdar/shopify-payment-app.git
    cd shopify-payment-capturer
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install --production

# Create environment file if it doesn't exist
if [ ! -f ".env" ]; then
    echo "⚙️ Creating .env file from template..."
    cp .env.example .env
    echo "⚠️ Please edit .env file with your Shopify credentials!"
    echo "   Run: nano .env"
    echo "   Then restart with: pm2 restart all"
fi

# Create logs directory
echo "📝 Creating logs directory..."
mkdir -p logs

# Configure Nginx
echo "🔧 Configuring Nginx..."
sudo tee /etc/nginx/sites-available/shopify-app > /dev/null <<EOF
server {
    listen 80;
    server_name _;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;
    
    # Proxy to Node.js app
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # Static files cache
    location ~* \.(jpg|jpeg|png|gif|ico|css|js)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
EOF

# Enable site and disable default
echo "🔗 Enabling Nginx site..."
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/shopify-app /etc/nginx/sites-enabled/

# Test Nginx configuration
echo "🧪 Testing Nginx configuration..."
sudo nginx -t

# Restart Nginx
echo "🔄 Restarting Nginx..."
sudo systemctl restart nginx

# Start/restart application with PM2
echo "🚀 Starting application with PM2..."
if pm2 list | grep -q "shopify-payment-capturer"; then
    pm2 restart shopify-payment-capturer
else
    pm2 start ecosystem.config.js --env production
fi

# Save PM2 configuration
echo "💾 Saving PM2 configuration..."
pm2 save

# Setup PM2 startup
echo "⚡ Setting up PM2 startup..."
sudo pm2 startup

# Configure firewall (UFW)
echo "🛡️ Configuring firewall..."
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS (for future SSL)
sudo ufw --force enable

# Display status
echo "📊 Displaying status..."
pm2 status
sudo systemctl status nginx --no-pager

# Get public IP
PUBLIC_IP=$(curl -s ifconfig.me)
echo "✅ Deployment completed!"
echo ""
echo "🌐 Your app is now running at: http://$PUBLIC_IP"
echo "📊 Status page: http://$PUBLIC_IP/status"
echo "❤️ Health check: http://$PUBLIC_IP/health"
echo ""
echo "🔧 Next steps:"
echo "1. Edit .env file with your Shopify credentials"
echo "2. Update Shopify webhook URLs to: http://$PUBLIC_IP/webhooks/orders/create"
echo "3. Test the connection at: http://$PUBLIC_IP/test/shop"
echo ""
echo "📝 Logs:"
echo "   pm2 logs shopify-payment-capturer"
echo "   tail -f logs/combined.log"
echo ""
echo "🔄 Restart app: pm2 restart shopify-payment-capturer"
echo "⏹️ Stop app: pm2 stop shopify-payment-capturer"
echo "▶️ Start app: pm2 start shopify-payment-capturer"