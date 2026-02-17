#!/bin/bash
set -e

DEPLOY_DIR="/home/antfarm/deployments/trmnl-spotify-private"
SERVICE_NAME="trmnl-spotify-private"

echo "Deploying $SERVICE_NAME..."

cd "$DEPLOY_DIR"

echo "Pulling latest changes..."
git pull origin main

echo "Installing dependencies..."
npm ci --production

echo "Restarting service..."
sudo systemctl restart "$SERVICE_NAME"

echo "Deployment complete!"
