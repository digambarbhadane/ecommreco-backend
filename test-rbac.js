const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api/v1';

// Test credentials
const USERS = {
  seller: { email: 'seller@example.com', password: 'password123', role: 'seller' },
  sales_manager: { email: 'sales.manager@example.com', password: 'password123', role: 'sales_manager' },
  super_admin: { email: 'superadmin@example.com', password: 'password123', role: 'super_admin' },
};

async function login(user) {
  try {
    const response = await axios.post(`${BASE_URL}/auth/login`, {
      email: user.email,
      password: user.password,
    });
    return {
      token: response.data.data.accessToken,
      userId: response.data.data.user.id
    };
  } catch (error) {
    console.error(`Login failed for ${user.email}:`, error.message);
    throw error;
  }
}

async function testEndpoint(name, url, token, expectedStatus, role, method = 'GET', data = null) {
  try {
    const config = {
      headers: { Authorization: `Bearer ${token}` },
    };
    
    let response;
    if (method === 'GET') {
      response = await axios.get(url, config);
    } else if (method === 'POST') {
      response = await axios.post(url, data, config);
    }

    if (expectedStatus === 200 || expectedStatus === 201) {
      console.log(`✅ [PASS] ${role} accessed ${name} (Expected: ${expectedStatus} OK)`);
    } else {
      console.log(`❌ [FAIL] ${role} accessed ${name} (Expected: ${expectedStatus}, Got: ${response.status} OK)`);
    }
  } catch (error) {
    if (error.response && error.response.status === expectedStatus) {
      console.log(`✅ [PASS] ${role} denied access to ${name} (Expected: ${expectedStatus} ${error.response.statusText})`);
    } else if (error.response) {
      console.log(`❌ [FAIL] ${role} -> ${name} (Expected: ${expectedStatus}, Got: ${error.response.status} ${error.response.statusText})`);
      if (error.response.data) console.log('   Error data:', JSON.stringify(error.response.data));
    } else {
      console.log(`❌ [FAIL] ${role} -> ${name} (Error: ${error.message})`);
    }
  }
}

async function runTests() {
  console.log('Starting RBAC Tests...');

  try {
    // 1. Login users
    const sellerAuth = await login(USERS.seller);
    const salesAuth = await login(USERS.sales_manager);
    const adminAuth = await login(USERS.super_admin);

    const sellerToken = sellerAuth.token;
    const salesToken = salesAuth.token;
    const adminToken = adminAuth.token;
    const sellerId = sellerAuth.userId;

    console.log('Tokens obtained. Running endpoint tests...\n');

    // Test 1: Marketplaces (Allowed for everyone)
    await testEndpoint('GET /marketplaces', `${BASE_URL}/marketplaces`, sellerToken, 200, 'seller');

    // Test 2: Sellers (Allowed for sales_manager, Forbidden for seller)
    await testEndpoint('GET /sellers', `${BASE_URL}/sellers`, salesToken, 200, 'sales_manager');
    await testEndpoint('GET /sellers', `${BASE_URL}/sellers`, sellerToken, 403, 'seller');

    // Test 3: Leads (Allowed for sales_manager, Forbidden for seller)
    await testEndpoint('GET /leads', `${BASE_URL}/leads`, salesToken, 200, 'sales_manager');
    await testEndpoint('GET /leads', `${BASE_URL}/leads`, sellerToken, 403, 'seller');

    // Test 4: GSTIN Verification (Allowed for seller & super_admin)
    const validGstin = '29ABCDE1234F1Z5';
    await testEndpoint('POST /gstin/verify', `${BASE_URL}/gstin/verify`, sellerToken, 201, 'seller', 'POST', { gstin: validGstin });
    await testEndpoint('POST /gstin/verify', `${BASE_URL}/gstin/verify`, salesToken, 403, 'sales_manager', 'POST', { gstin: validGstin });

    // Test 5: GSTs (Allowed for seller & super_admin)
    const gstPayload = { sellerId: sellerId, gstNumber: validGstin };
    // Note: Creating GST might fail if duplicate, so we expect 201 or 409 (Conflict) but for RBAC check 403 is the key
    // We will just check if we can access it.
    await testEndpoint('GET /gsts', `${BASE_URL}/gsts`, sellerToken, 200, 'seller');
    await testEndpoint('GET /gsts', `${BASE_URL}/gsts`, salesToken, 403, 'sales_manager');
    
    await testEndpoint('POST /gsts', `${BASE_URL}/gsts`, sellerToken, 201, 'seller', 'POST', gstPayload);
    await testEndpoint('POST /gsts', `${BASE_URL}/gsts`, salesToken, 403, 'sales_manager', 'POST', gstPayload);

  } catch (error) {
    console.error('Test execution failed:', error);
  }
}

runTests();
