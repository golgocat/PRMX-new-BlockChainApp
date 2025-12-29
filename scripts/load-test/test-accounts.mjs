#!/usr/bin/env node
/**
 * Test Accounts for PRMX Load Test
 * 
 * Provides keypairs for DAO, Alice, Bob, Charlie, Dave, Eve, and Ferdie
 * for use in multi-user LP scenarios.
 */

import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady, encodeAddress } from '@polkadot/util-crypto';

// Initialize crypto and create accounts
let accounts = null;
let keyring = null;

// Initialize function - must be called before using accounts
export async function initAccounts() {
  if (accounts) return accounts;
  
  // Wait for WASM crypto to be ready
  await cryptoWaitReady();
  
  // Create keyring instance
  keyring = new Keyring({ type: 'sr25519' });
  
  // Standard development accounts
  accounts = {
    // Alice - Primary test user (also acts as sudo)
    alice: keyring.addFromUri('//Alice'),
    
    // Bob - Secondary test user / LP investor
    bob: keyring.addFromUri('//Bob'),
    
    // Charlie - Third test user / LP investor
    charlie: keyring.addFromUri('//Charlie'),
    
    // Dave - Fourth test user / LP investor
    dave: keyring.addFromUri('//Dave'),
    
    // Eve - Fifth test user / LP investor
    eve: keyring.addFromUri('//Eve'),
    
    // Ferdie - Sixth test user / secondary market buyer
    ferdie: keyring.addFromUri('//Ferdie'),
  };
  
  return accounts;
}

// Get accounts (must call initAccounts first)
export function getAccounts() {
  if (!accounts) {
    throw new Error('Accounts not initialized. Call initAccounts() first.');
  }
  return accounts;
}

// Dedicated DAO account (//DAO) - defined in runtime/src/lib.rs
// Address: 5EyKeA48QNY6LbD2QeN2JUuArTiyBTDN2BBYoLLCwz9rXdZS
export function getDaoAddress() {
  const daoAccountHex = '0x8099b04502498ba2936833a5715a95dbcd367628a4dd4792222b7bcb4aa79959';
  return encodeAddress(daoAccountHex, 42);
}

// Dedicated Oracle account (//Oracle) - used by offchain-oracle-service
// Address: 5ERNkbfECLx6hDuTwjVPrXgaGe7hE114d6rFz1d2LxcVFnbB
export function getOracleAddress() {
  const oracleAccountHex = '0x683c4ef19d8fec497566bf7c24c5d6e3625edecde19d80c39281e4686961fa74';
  return encodeAddress(oracleAccountHex, 42);
}

// Get all LP investor accounts (excluding Alice who is policy holder)
export function getLpInvestors() {
  const accts = getAccounts();
  return [accts.bob, accts.charlie, accts.dave, accts.eve, accts.ferdie];
}

// Get account by index (for rotation in multi-investor scenarios)
export function getAccountByIndex(index) {
  const accts = getAccounts();
  const allAccounts = [
    accts.alice,
    accts.bob,
    accts.charlie,
    accts.dave,
    accts.eve,
    accts.ferdie,
  ];
  return allAccounts[index % allAccounts.length];
}

// Get investor by index (excluding Alice)
export function getInvestorByIndex(index) {
  const investors = getLpInvestors();
  return investors[index % investors.length];
}

// Print account info
export function printAccountInfo() {
  const accts = getAccounts();
  console.log('Test Accounts:');
  console.log('─'.repeat(60));
  console.log(`  Alice:   ${accts.alice.address}`);
  console.log(`  Bob:     ${accts.bob.address}`);
  console.log(`  Charlie: ${accts.charlie.address}`);
  console.log(`  Dave:    ${accts.dave.address}`);
  console.log(`  Eve:     ${accts.eve.address}`);
  console.log(`  Ferdie:  ${accts.ferdie.address}`);
  console.log(`  DAO:     ${getDaoAddress()}`);
  console.log('─'.repeat(60));
}

// Export keyring getter
export function getKeyring() {
  if (!keyring) {
    throw new Error('Keyring not initialized. Call initAccounts() first.');
  }
  return keyring;
}
