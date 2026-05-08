# Run packaged CYPHER project

1. Install dependencies:
   npm install
2. Create local env:
   copy .env.example .env
3. Prepare local HTTPS cert:
   node scripts/ensure-test-cert.js
4. Start development runtime:
   npm run dev

Main UI: https://127.0.0.1:8443/dashboard
Camera sender: https://127.0.0.1:8443/

Do not commit .env, data/, recordings/, snapshots, cert.pem, or key.pem.