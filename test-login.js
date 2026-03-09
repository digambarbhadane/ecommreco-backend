
const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api/v1';

const users = [
  { email: 'superadmin@example.com', password: 'password123', role: 'super_admin' },
  { email: 'sales.manager@example.com', password: 'password123', role: 'sales_manager' },
  { email: 'operations.manager@example.com', password: 'password123', role: 'account_operations_manager' },
  { email: 'success.manager@example.com', password: 'password123', role: 'customer_success_manager' },
  { email: 'seller@example.com', password: 'password123', role: 'seller' },
];

async function testLogin() {
  console.log('Testing login for all roles...');
  let successCount = 0;

  for (const user of users) {
    try {
      console.log(`Attempting login for ${user.email}...`);
      const response = await axios.post(`${BASE_URL}/auth/login`, {
        email: user.email,
        password: user.password,
      });

      console.log('Response data:', JSON.stringify(response.data, null, 2));
      if (response.data && response.data.data && response.data.data.accessToken) {
        console.log(`✅ Login successful for ${user.role} (${user.email})`);
        
        // verify role in response if returned, or decode token if needed (skipping token decode for now)
        const responseUser = response.data.data.user;
        if (responseUser && responseUser.role === user.role) {
             console.log(`   Role match: ${responseUser.role}`);
        } else if (responseUser) {
             console.log(`   ⚠️ Role mismatch! Expected ${user.role}, got ${responseUser.role}`);
        }

        successCount++;
      } else {
        console.log(`❌ Login failed for ${user.role}: No token received`);
      }
    } catch (error) {
      console.log(`❌ Login failed for ${user.role}:`, error);
      if (error.response) {
        console.log(`   Status: ${error.response.status}`);
        console.log(`   Data:`, error.response.data);
      }
    }
  }

  console.log(`\nSummary: ${successCount}/${users.length} logins successful.`);
}

testLogin();
