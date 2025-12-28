#!/usr/bin/env node
/**
 * Generate a cryptographically secure HMAC secret for V3 Oracle
 * 
 * This script generates a secure random secret for authenticating
 * communication between the OCW and Ingest API.
 * 
 * Usage:
 *   node scripts/generate-v3-hmac-secret.mjs [options]
 * 
 * Options:
 *   --length <bytes>    Secret length in bytes (default: 32)
 *   --format <format>   Output format: hex, base64 (default: hex)
 *   --env               Output as .env file format
 *   --json              Output as JSON
 */

import crypto from 'crypto';

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        length: 32,
        format: 'hex',
        env: false,
        json: false,
    };
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--length':
                config.length = parseInt(args[++i], 10);
                if (config.length < 16) {
                    console.error('❌ Error: Secret length must be at least 16 bytes');
                    process.exit(1);
                }
                break;
            case '--format':
                config.format = args[++i];
                if (!['hex', 'base64'].includes(config.format)) {
                    console.error('❌ Error: Format must be "hex" or "base64"');
                    process.exit(1);
                }
                break;
            case '--env':
                config.env = true;
                break;
            case '--json':
                config.json = true;
                break;
            case '--help':
            case '-h':
                console.log(`
PRMX V3 HMAC Secret Generator

Generates a cryptographically secure random secret for authenticating
communication between the Offchain Worker (OCW) and Ingest API.

Usage:
  node scripts/generate-v3-hmac-secret.mjs [options]

Options:
  --length <bytes>    Secret length in bytes (default: 32, min: 16)
  --format <format>   Output format: hex (64 chars) or base64 (44 chars)
  --env               Output as .env file format
  --json              Output as JSON

Examples:
  # Generate a 32-byte hex secret
  node scripts/generate-v3-hmac-secret.mjs

  # Generate a 64-byte base64 secret in .env format
  node scripts/generate-v3-hmac-secret.mjs --length 64 --format base64 --env

  # Generate and save to .env.secrets
  node scripts/generate-v3-hmac-secret.mjs --env >> .env.secrets
                `);
                process.exit(0);
        }
    }
    
    return config;
}

function generateSecret(length, format) {
    const bytes = crypto.randomBytes(length);
    return format === 'base64' ? bytes.toString('base64') : bytes.toString('hex');
}

function main() {
    const config = parseArgs();
    const secret = generateSecret(config.length, config.format);
    
    if (config.json) {
        console.log(JSON.stringify({
            secret,
            length: config.length,
            format: config.format,
            generatedAt: new Date().toISOString(),
            usage: {
                ocwEnv: 'V3_INGEST_HMAC_SECRET',
                ingestApiEnv: 'V3_INGEST_HMAC_SECRET',
            }
        }, null, 2));
    } else if (config.env) {
        console.log(`# V3 HMAC Secret - Generated ${new Date().toISOString()}`);
        console.log(`# ${config.length} bytes, ${config.format} format`);
        console.log(`V3_INGEST_HMAC_SECRET="${secret}"`);
    } else {
        console.log('═'.repeat(60));
        console.log('PRMX V3 HMAC Secret Generator');
        console.log('═'.repeat(60));
        console.log('');
        console.log(`Secret (${config.length} bytes, ${config.format}):`);
        console.log('');
        console.log(`  ${secret}`);
        console.log('');
        console.log('Usage:');
        console.log('');
        console.log('1. Set in your .env file:');
        console.log(`   V3_INGEST_HMAC_SECRET="${secret}"`);
        console.log('');
        console.log('2. Or set as environment variable:');
        console.log(`   export V3_INGEST_HMAC_SECRET="${secret}"`);
        console.log('');
        console.log('3. Inject into OCW storage:');
        console.log('   node scripts/set-v3-oracle-secrets.mjs --hmac-secret "..."');
        console.log('');
        console.log('IMPORTANT: Keep this secret secure and never commit it to Git!');
        console.log('');
    }
}

main();

