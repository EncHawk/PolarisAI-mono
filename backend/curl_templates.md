1. Ingest a paper
curl -X POST http://localhost:3000/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "arxiv_id": "2301.12345",
    "top_n_citations": 8,
    "execution_mode": "create"
  }'
Response: { "job_uuid": "...", "paper_id": "...", "status": "queued" }
2. Approve / reject a plan
# Approve
curl -X POST http://localhost:3000/plan/JOB_UUID/approve \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"approved": true, "feedback": ""}'

# Reject with feedback
curl -X POST http://localhost:3000/plan/JOB_UUID/approve \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"approved": false, "feedback": "Add a test file"}'
3. Get API key (if you have a Google ID token)
curl -X POST http://localhost:3000/auth/exchange \
  -H "Content-Type: application/json" \
  -d '{"id_token": "YOUR_GOOGLE_ID_TOKEN"}'
Response: { "user_id": "...", "api_key": "uuid-here", "email": "...", ... }
4. Check job status / traces
curl http://localhost:3000/events/JOB_UUID \
  -H "Authorization: Bearer YOUR_API_KEY"

# Or SSE stream
curl -N http://localhost:3000/events/JOB_UUID \
  -H "Authorization: Bearer YOUR_API_KEY"
Quick test with manual API key (dev)
If you don't have Google OAuth set up, insert a test user + api_key directly in Supabase:
insert into users (id, email, name, credits, api_key)
values (
  gen_random_uuid(),
  'test@example.com',
  'Test User',
  10.00,
  'test-api-key-123'
);
