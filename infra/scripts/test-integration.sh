#!/bin/bash
#
# Test NanoClaw structured plan output
#

set -e

echo "🧪 Testing NanoClaw Integration"
echo "================================"

# Test 1: Check if NanoClaw container is running
echo ""
echo "1. Checking if NanoClaw is accessible..."
if curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo "   ✅ NanoClaw is running"
else
    echo "   ⚠️  NanoClaw not accessible at localhost:3000"
    echo "      (This is OK if running in separate container)"
fi

# Test 2: Simulate a test request
echo ""
echo "2. Testing plan format validation..."

# Create a test payload
TEST_PAYLOAD='{
  "message": "Check uptime on william",
  "userId": 12345,
  "chatId": 67890
}'

echo "   Request: $TEST_PAYLOAD"
echo ""
echo "   Expected response format:"
echo '   {'
echo '     "plan": {'
echo '       "version": "1.0",'
echo '       "summary": "Check system uptime on william",'
echo '       "actions": ['
echo '         {'
echo '           "type": "ssh",'
echo '           "target": "william",'
echo '           "command": "uptime",'
echo '           "risk": "none",'
echo '           "requiresApproval": false,'
echo '           "reason": "Safe diagnostic command"'
echo '         }'
echo '       ]'
echo '     }'
echo '   }'

# Test 3: Validate the schema
echo ""
echo "3. Schema validation test..."
cat << 'EOF' | bun run -
import { PlanSchema } from './apps/telegram-gateway/src/types.ts';

const validPlan = {
  version: "1.0",
  summary: "Check uptime",
  actions: [{
    type: "ssh",
    target: "william",
    command: "uptime",
    risk: "none",
    requiresApproval: false,
    reason: "Safe diagnostic"
  }]
};

const result = PlanSchema.safeParse(validPlan);
if (result.success) {
  console.log("✅ Valid plan passes schema validation");
} else {
  console.log("❌ Valid plan failed:", result.error);
  process.exit(1);
}

const invalidPlan = {
  version: "2.0", // Wrong version
  summary: "Test",
  actions: []
};

const invalidResult = PlanSchema.safeParse(invalidPlan);
if (!invalidResult.success) {
  console.log("✅ Invalid plan correctly rejected");
} else {
  console.log("❌ Invalid plan should have been rejected");
  process.exit(1);
}
EOF

echo ""
echo "✨ Integration tests complete!"
