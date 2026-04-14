#!/bin/bash

# =============================================
# PENWORTH DEPLOYMENT SCRIPT
# =============================================

set -e

echo "🚀 Penworth Deployment Script"
echo "=============================="

# Check prerequisites
echo ""
echo "📋 Checking prerequisites..."

if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+."
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed."
    exit 1
fi

echo "✅ Node.js $(node -v)"
echo "✅ npm $(npm -v)"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Check environment variables
echo ""
echo "🔐 Checking environment variables..."

if [ ! -f .env.local ]; then
    echo "❌ .env.local not found!"
    echo "Please copy .env.example to .env.local and fill in your values:"
    echo "  cp .env.example .env.local"
    exit 1
fi

# Source env file to check required vars
source .env.local 2>/dev/null || true

required_vars=(
    "NEXT_PUBLIC_SUPABASE_URL"
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    "SUPABASE_SERVICE_ROLE_KEY"
    "ANTHROPIC_API_KEY"
    "STRIPE_SECRET_KEY"
)

missing_vars=()
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=($var)
    fi
done

if [ ${#missing_vars[@]} -gt 0 ]; then
    echo "❌ Missing required environment variables:"
    for var in "${missing_vars[@]}"; do
        echo "   - $var"
    done
    echo ""
    echo "Please update your .env.local file."
    exit 1
fi

echo "✅ All required environment variables are set"

# Build the application
echo ""
echo "🏗️  Building application..."
npm run build

echo ""
echo "✅ Build successful!"
echo ""
echo "=============================="
echo "🎉 Penworth is ready for deployment!"
echo ""
echo "Next steps:"
echo "1. Run locally: npm run dev"
echo "2. Deploy to Vercel: vercel deploy --prod"
echo ""
echo "Or push to GitHub and connect to Vercel for automatic deployments."
echo "=============================="
