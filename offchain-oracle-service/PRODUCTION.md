# Production Configuration Guide

This guide explains how to configure the PRMX Off-chain Oracle Service for production deployment.

## Overview

The service runs in production mode when `NODE_ENV=production`. In this mode:

1. **HMAC Secret Validation**: `V3_INGEST_HMAC_SECRET` is required and must be at least 32 characters
2. **Dev Mode Disabled**: `V3_DEV_MODE` is forced to `false` regardless of configuration
3. **Tighter Security**: Shorter nonce window (2 minutes), rate limiting enabled
4. **Strict Error Handling**: Default values not allowed for critical secrets

## Required Environment Variables

### Critical Security

```bash
# Generate a secure secret (minimum 32 chars, 64 recommended)
node scripts/generate-v3-hmac-secret.mjs

# Set in your environment
export V3_INGEST_HMAC_SECRET="your_64_character_hex_secret_here"
```

### Database

```bash
# MongoDB Atlas connection
export MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/prmx-oracle"
```

### Node Connection

```bash
# PRMX node WebSocket
export WS_URL="wss://your-prmx-node.example.com:9944"
```

### AccuWeather API

```bash
export ACCUWEATHER_API_KEY="your_accuweather_api_key"
```

## HMAC Secret Setup

### 1. Generate Secret

```bash
# Generate a 32-byte (64 hex char) secret
node scripts/generate-v3-hmac-secret.mjs

# Or generate as .env format
node scripts/generate-v3-hmac-secret.mjs --env
```

### 2. Configure Ingest API

Set the secret in your deployment environment (Docker secrets, Kubernetes secrets, etc.):

```bash
V3_INGEST_HMAC_SECRET="your_generated_secret"
```

### 3. Configure OCW

Inject the same secret into the OCW's offchain storage:

```bash
# Start node with unsafe RPC methods (only during setup!)
./target/release/prmx-node --dev --rpc-methods=Unsafe

# Inject secrets
node scripts/set-v3-oracle-secrets.mjs \
  --hmac-secret "your_generated_secret" \
  --accuweather-key "your_accuweather_key" \
  --ingest-url "https://your-ingest-api.example.com"
```

## Security Checklist

- [ ] Generated a unique HMAC secret (not reused from other systems)
- [ ] Secret is at least 32 characters (64 recommended)
- [ ] Secret stored securely (environment variables, secrets manager)
- [ ] `V3_DEV_MODE` is NOT set or set to `false`
- [ ] MongoDB connection uses TLS (`mongodb+srv://` or `?ssl=true`)
- [ ] API is behind HTTPS in production
- [ ] Rate limiting is configured appropriately

## Rate Limiting

By default, the service limits each IP to 60 requests per minute. Adjust with:

```bash
V3_RATE_LIMIT_PER_MINUTE=100
```

## Monitoring

Enable request logging for debugging (disable in production for performance):

```bash
V3_REQUEST_LOGGING=true
```

## Running in Production

```bash
NODE_ENV=production npm start
```

Or with Docker:

```dockerfile
ENV NODE_ENV=production
ENV V3_INGEST_HMAC_SECRET=${V3_INGEST_HMAC_SECRET}
CMD ["npm", "start"]
```

