/**
 * test/pkce.test.js
 * Unit tests for PKCE OAuth authentication flow:
 * 1. Code verifier generation & RFC 7636 unreserved character compliance
 * 2. Code challenge SHA-256 base64url calculation
 * 3. TokenManager token lifecycle and PKCE parameters
 */

const assert = require('assert');
const { TokenManager } = require('../src/token-manager');

async function runPkceTests() {
  console.log('--- Starting PKCE OAuth Flow Tests ---');

  const tm = new TokenManager();

  // Test 1: Code Verifier Generation
  console.log('Testing Test 1: Code Verifier generation & RFC 7636 format...');
  const verifier = tm.generateCodeVerifier(64);
  assert.strictEqual(typeof verifier, 'string', 'Verifier must be a string');
  assert.strictEqual(verifier.length, 64, 'Verifier length must match requested length (64)');
  assert.match(verifier, /^[A-Za-z0-9\-._~]+$/, 'Verifier must only contain RFC 7636 unreserved characters');
  console.log('✓ Test 1 Passed! Generated verifier:', verifier.substring(0, 16) + '...');

  // Test 2: Code Challenge Computation
  console.log('Testing Test 2: Code Challenge SHA-256 base64url encoding...');
  // Known test vector from RFC 7636 Appendix B:
  // code_verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
  // code_challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
  const rfcVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  const challenge = await tm.generateCodeChallenge(rfcVerifier);

  assert.strictEqual(challenge, expectedChallenge, `Challenge must match RFC 7636 test vector! Got: ${challenge}`);
  assert.ok(!challenge.includes('='), 'Base64url challenge must not include padding =');
  assert.ok(!challenge.includes('+'), 'Base64url challenge must not include +');
  assert.ok(!challenge.includes('/'), 'Base64url challenge must not include /');
  console.log('✓ Test 2 Passed! RFC 7636 test vector accurately verified.');

  // Test 3: Token Validation & Storage
  console.log('Testing Test 3: Official Token validation & format check...');
  assert.strictEqual(tm.isValidFormat('short'), false);
  assert.strictEqual(tm.isValidFormat('BQA1234567890123456789012345678901234567890'), true);
  assert.strictEqual(tm.isOfficialToken('BQD1234567890123456789012345678901234567890'), false, 'BQD is internal player session, not official Web API token');
  assert.strictEqual(tm.isOfficialToken('BQA12345678901234567890123456789012345678901234567890'), true, 'BQA is official Web API token');
  console.log('✓ Test 3 Passed!');

  console.log('\n========================================');
  console.log('🎉 ALL PKCE TESTS PASSED SUCCESSFULLY! 🎉');
  console.log('========================================\n');
}

runPkceTests().catch(err => {
  console.error('❌ PKCE Test Failed:', err);
  process.exit(1);
});
