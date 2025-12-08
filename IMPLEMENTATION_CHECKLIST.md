# Quick Reference: Implementation Checklist

## Before You Start

- [ ] Assign tech lead (1 senior engineer)
- [ ] Pick deployment platform (Heroku recommended)
- [ ] Set up Git repo + CI/CD
- [ ] Team aligned on 4-week timeline
- [ ] Stakeholders know MVP scope (no real-time collab, no marketplace)

---

## WEEK 1: Backend Foundation

### Database Setup

- [ ] Create PostgreSQL database (locally or managed service)
- [ ] Copy schema from PRODUCTION_SPEC.md Section 1.2
- [ ] Run initial migrations:
  ```bash
  psql -U postgres -d prompt_lib -f src/db/schema.sql
  ```
- [ ] Verify tables created:
  ```sql
  \dt -- lists all tables
  \d prompts -- shows prompts table structure
  ```
- [ ] Test connection pooling (pgBouncer)
- [ ] Set up automated backup (1x daily minimum)

### Authentication Setup

- [ ] Register OAuth2 app (Google Console, GitHub Apps)
- [ ] Generate OAuth2 credentials (client_id, client_secret)
- [ ] Add to `.env`:
  ```
  GOOGLE_CLIENT_ID=xxx
  GOOGLE_CLIENT_SECRET=xxx
  GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
  ```
- [ ] Implement OAuth2 flow endpoint (POST /auth/callback)
- [ ] Implement API key generation (POST /auth/api-keys)
- [ ] Test auth flow: login → get JWT token

### Server Setup

- [ ] Initialize Node.js project (npm init)
- [ ] Install dependencies (express, pg, redis, jsonwebtoken)
- [ ] Create project structure:
  ```
  src/
  ├── server.ts (main app)
  ├── config.ts (env vars)
  ├── middleware/ (auth, rate limit, error handling)
  ├── routes/ (prompts, auth, org)
  ├── services/ (business logic)
  ├── db/ (migrations, schema)
  └── __tests__/ (unit + integration tests)
  ```
- [ ] Set up TypeScript (tsconfig.json)
- [ ] Test local server:
  ```bash
  npm run dev
  # Server running on http://localhost:3000
  ```

### Monitoring & Logging

- [ ] Set up error tracking (Sentry free tier)
- [ ] Add structured logging (winston or pino)
- [ ] Test error boundary:
  ```bash
  curl http://localhost:3000/api/v1/nonexistent
  # Should return 404 with proper error structure
  ```

**Deliverable:** `curl http://localhost:3000/healthz` returns `{"status":"ok"}`

---

## WEEK 2: CRUD Operations

### Prompt Management Endpoints

- [ ] POST /api/v1/prompts (create)

  - [ ] Validate input (title, content required)
  - [ ] Auto-create version 1
  - [ ] Return 201 with new prompt data
  - [ ] Test: `curl -X POST http://localhost:3000/api/v1/prompts -d '{"title":"test","content":"test"}'`

- [ ] GET /api/v1/prompts (list)

  - [ ] Support pagination (page, per_page params)
  - [ ] Support search (q param with full-text)
  - [ ] Return 20 prompts per page by default
  - [ ] Include rating stats (avg_rating, rating_count)
  - [ ] Test: pagination, search on title/description

- [ ] GET /api/v1/prompts/:id (get one)

  - [ ] Return latest version
  - [ ] Include all metadata
  - [ ] Return 404 if not found

- [ ] PUT /api/v1/prompts/:id (update)

  - [ ] Increment version number
  - [ ] Store change summary (optional)
  - [ ] Update prompt.updated_at
  - [ ] Return new version number
  - [ ] Test: verify version increments on each update

- [ ] DELETE /api/v1/prompts/:id (soft delete)
  - [ ] Set is_archived = TRUE (not hard delete)
  - [ ] Log action to audit_log
  - [ ] Excluded from GET list (WHERE is_archived = FALSE)
  - [ ] Test: verify archived prompts don't show in list

### Version Management

- [ ] GET /api/v1/prompts/:id/versions (list all)

  - [ ] Return all versions for prompt
  - [ ] Order by version_number DESC
  - [ ] Include created_by, created_at, change_summary

- [ ] GET /api/v1/prompts/:id/versions/:vnum (get specific)

  - [ ] Return exact version content
  - [ ] 404 if version doesn't exist

- [ ] POST /api/v1/prompts/:id/versions/:vnum/publish
  - [ ] Mark version as is_published = TRUE
  - [ ] Only one published version per prompt (set others to FALSE)
  - [ ] Log publication event

### Ratings & Notes (Integrate Your Features)

- [ ] POST /api/v1/prompts/:id/ratings

  - [ ] Accept rating 1-5
  - [ ] Upsert (one rating per user per prompt)
  - [ ] Return { average, count }
  - [ ] Test: rate same prompt twice → overwrites first rating

- [ ] GET /api/v1/prompts/:id/ratings

  - [ ] Return average_rating, rating_count
  - [ ] Optionally return all ratings (for admins)

- [ ] POST /api/v1/prompts/:id/notes

  - [ ] Create note linked to prompt
  - [ ] Store user_id, content, created_at
  - [ ] Return note with ID

- [ ] GET /api/v1/prompts/:id/notes

  - [ ] List all notes for prompt
  - [ ] Include creator name

- [ ] DELETE /api/v1/prompts/:id/notes/:nid
  - [ ] Only owner or admin can delete
  - [ ] Soft delete or hard delete (your choice)

### Testing

- [ ] Write unit tests (Jest):

  ```bash
  npm test src/services/__tests__/*.test.ts
  ```

  Should cover:

  - Creating prompt creates version 1
  - Updating increments version
  - Rating validates 1-5 range
  - Search filters correctly

- [ ] Write integration tests:
  ```bash
  npm run test:integration
  ```
  Should cover:
  - Full CRUD flow (create → read → update → delete)
  - Authorization (can't update other user's prompt)
  - Edge cases (missing fields, invalid IDs)

**Deliverable:** All endpoints tested, 80%+ code coverage

---

## WEEK 3: Frontend Migration & Teams

### Frontend: Migrate localStorage → API

- [ ] Update `app.js` to use fetch API:

  ```javascript
  // OLD: localStorage.setItem('prompts', JSON.stringify(...))
  // NEW: fetch('/api/v1/prompts', { method: 'POST', ... })
  ```

- [ ] Get API key flow:

  - [ ] User logs in with OAuth
  - [ ] Frontend gets JWT token
  - [ ] Store token in httpOnly cookie or memory
  - [ ] Send token in Authorization header on all API calls

- [ ] Update renderPrompts():

  - [ ] Call GET /api/v1/prompts instead of localStorage
  - [ ] Handle pagination
  - [ ] Show "Loading..." while fetching

- [ ] Update addPrompt():

  - [ ] POST to /api/v1/prompts
  - [ ] Refresh prompt list on success

- [ ] Update deletePrompt():

  - [ ] DELETE to /api/v1/prompts/:id
  - [ ] Refresh list

- [ ] Update rating submission:

  - [ ] POST to /api/v1/prompts/:id/ratings
  - [ ] Update average rating display

- [ ] Update notes:
  - [ ] POST to /api/v1/prompts/:id/notes
  - [ ] GET to fetch notes on prompt load
  - [ ] DELETE to remove notes

### Team/Organization Features

- [ ] POST /api/v1/organizations

  - [ ] Create workspace
  - [ ] Auto-add creator as owner
  - [ ] Return org_id

- [ ] GET /api/v1/organizations/:id

  - [ ] Return org details
  - [ ] List members + roles

- [ ] POST /api/v1/organizations/:id/members

  - [ ] Invite user by email
  - [ ] Create permission record (role: editor, viewer, admin)
  - [ ] Send invite email (optional for MVP)

- [ ] DELETE /api/v1/organizations/:id/members/:uid

  - [ ] Remove user from org
  - [ ] Revoke all access

- [ ] PUT /api/v1/organizations/:id/members/:uid/role
  - [ ] Change user role (admin, editor, viewer)
  - [ ] Admin only endpoint

### Frontend: Organization UI

- [ ] Add "Create Organization" button
- [ ] Add "Invite Member" dialog
- [ ] Add "Team Settings" page
- [ ] Show current members
- [ ] Show member roles

### Permissions Middleware

- [ ] Check organization_id on every request
- [ ] Verify user has permission to access resource
- [ ] Return 403 Forbidden if unauthorized
- [ ] Example:

  ```typescript
  async function checkPromptAccess(userId, promptId) {
    const {
      rows: [prompt],
    } = await db.query("SELECT * FROM prompts WHERE id = $1", [promptId]);

    const {
      rows: [perm],
    } = await db.query(
      "SELECT * FROM permissions WHERE organization_id = $1 AND user_id = $2",
      [prompt.organization_id, userId]
    );

    if (!perm) throw new Error("Forbidden");
    return true;
  }
  ```

**Deliverable:** Teams can create org, invite members, share prompts

---

## WEEK 4: Deployment & Hardening

### Rate Limiting

- [ ] Implement token bucket (Redis)
- [ ] Limits by tier:
  - Free: 30 req/min
  - Pro: 300 req/min
- [ ] Add rate limit headers to response:
  ```
  X-RateLimit-Limit: 30
  X-RateLimit-Remaining: 25
  X-RateLimit-Reset: 1702000060
  ```
- [ ] Test rate limiting:
  ```bash
  # Send 31 requests in 1 minute
  for i in {1..31}; do curl http://localhost:3000/api/v1/prompts; done
  # Should get 429 Too Many Requests on 31st
  ```

### Security Hardening

- [ ] Enable CORS only for your domain:
  ```typescript
  app.use(cors({ origin: "https://yourdomain.com" }));
  ```
- [ ] Add security headers:
  ```typescript
  app.use(helmet()); // X-Frame-Options, X-Content-Type-Options, etc
  ```
- [ ] CSRF protection (if using cookies):
  ```typescript
  app.use(csrf());
  ```
- [ ] Validate all inputs (sanitize, length limits)
- [ ] SQL injection protection (use parameterized queries):
  ```javascript
  // BAD: db.query(`SELECT * FROM prompts WHERE id = ${id}`)
  // GOOD: db.query('SELECT * FROM prompts WHERE id = $1', [id])
  ```
- [ ] API key hashing (SHA256):
  ```typescript
  const crypto = require("crypto");
  const hash = crypto.createHash("sha256").update(apiKey).digest("hex");
  ```

### Deployment to Heroku

- [ ] Create Heroku account
- [ ] Install Heroku CLI:
  ```bash
  brew install heroku
  heroku login
  ```
- [ ] Create app:
  ```bash
  heroku create my-prompt-lib
  ```
- [ ] Add PostgreSQL:
  ```bash
  heroku addons:create heroku-postgresql:hobby-dev
  ```
- [ ] Add Redis:
  ```bash
  heroku addons:create heroku-redis:premium-0
  ```
- [ ] Set environment variables:
  ```bash
  heroku config:set GOOGLE_CLIENT_ID=xxx
  heroku config:set GOOGLE_CLIENT_SECRET=xxx
  # etc for all .env variables
  ```
- [ ] Deploy:
  ```bash
  git push heroku main
  ```
- [ ] Run migrations:
  ```bash
  heroku run npm run migrate:up
  ```
- [ ] Check logs:
  ```bash
  heroku logs --tail
  ```

### Monitoring & Alerts

- [ ] Set up Sentry for error tracking
- [ ] Configure Heroku metrics dashboard
- [ ] Set up PagerDuty for critical alerts (optional)
- [ ] Monitor:
  - API response time (target: <100ms p95)
  - Error rate (target: <0.1%)
  - Database size (target: growing slowly)
  - Redis memory (target: <500MB)

### Documentation

- [ ] Write API documentation (use OpenAPI/Swagger):

  ```bash
  npm install -D @types/swagger-jsdoc swagger-jsdoc
  ```

  Generate spec at `/api/docs`

- [ ] Create Postman collection (auto-generated from OpenAPI)

- [ ] Write runbooks:

  - How to handle database outage
  - How to scale database
  - How to rotate API keys
  - How to debug failed webhook

- [ ] Document database schema (run migrations in order)

### Launch Checklist

- [ ] All tests passing (npm test)
- [ ] No security warnings (npm audit)
- [ ] Load tested (simulate 100 concurrent users, all under 500ms)
- [ ] Staging environment working
- [ ] 10 beta users testing (no critical bugs)
- [ ] Database backed up (test restore)
- [ ] Monitoring alerts configured
- [ ] Runbooks written
- [ ] Terms of Service + Privacy Policy ready
- [ ] Error boundary tested (503 handling, graceful degradation)

**Deliverable:** Live at https://yourdomain.com, users can sign up and use

---

## Post-Launch (First Month)

### Metrics to Track

- [ ] Daily active users (DAU)
- [ ] User retention (day-7, day-30)
- [ ] Prompts created per user
- [ ] Average prompt rating (validation metric)
- [ ] API uptime (target: 99.9%)
- [ ] Support tickets (should be <5/week initially)

### Early User Feedback

- [ ] Send in-app survey: "What's your biggest pain point?"
- [ ] Track which features users use most (ratings? notes? sharing?)
- [ ] Collect NPS score (target: 50+ is great)

### Quick Wins (Low effort, high impact)

- [ ] Add environment selector (dev/staging/prod) if requested
- [ ] Add prompt templates (email, support, marketing)
- [ ] Export prompts as JSON/YAML if requested
- [ ] Public prompt sharing (share URL to non-members)

### Avoid (Don't build unless users demand it)

- ❌ Marketplace
- ❌ AI suggestions
- ❌ Real-time collaboration
- ❌ Mobile app

---

## Code Organization

```
prompt-lib/
├── src/
│   ├── server.ts                 # Express app
│   ├── config.ts                 # Env vars, config
│   ├── middleware/
│   │   ├── auth.ts              # JWT verification
│   │   ├── rateLimit.ts         # Token bucket
│   │   └── errorHandler.ts
│   ├── routes/
│   │   ├── prompts.ts           # CRUD endpoints
│   │   ├── auth.ts              # OAuth, API keys
│   │   └── organizations.ts     # Team management
│   ├── services/
│   │   ├── promptService.ts     # Business logic
│   │   ├── authService.ts
│   │   └── auditLog.ts
│   ├── db/
│   │   ├── index.ts             # Pool creation
│   │   ├── schema.sql           # Initial schema
│   │   └── migrations/          # Migration files
│   └── __tests__/
│       ├── prompts.test.ts
│       ├── auth.test.ts
│       └── integration/
├── .env.example
├── package.json
├── tsconfig.json
├── jest.config.js
└── docker-compose.yml           # Local dev environment
```

---

## Common Pitfalls to Avoid

- ❌ **Over-complicating auth.** Use OAuth2 provider, save yourself 1 week.
- ❌ **Real-time collaboration in MVP.** Pessimistic locking good enough.
- ❌ **Perfect database design.** Good enough design, ship faster.
- ❌ **Building features nobody asks for.** Ship MVP, listen to users first.
- ❌ **Deploying without monitoring.** You'll spend all night debugging production issues.
- ❌ **Forgetting rate limiting.** Users will accidentally DoS themselves.
- ❌ **Not testing permissions.** Major security hole if user can access other user's prompts.

---

## Success Criteria

### Week 1 Success

- [ ] Server running locally
- [ ] Database schema loaded
- [ ] OAuth2 login working
- [ ] JWT token issued on login

### Week 2 Success

- [ ] All CRUD endpoints working
- [ ] Full-text search working
- [ ] Tests passing
- [ ] Can create, update, rate, note prompts via API

### Week 3 Success

- [ ] Frontend migrated to API calls
- [ ] Multiple users can log in
- [ ] Can invite users to organization
- [ ] Prompts visible to team members

### Week 4 Success

- [ ] Live on Heroku
- [ ] 10 beta users signed up
- [ ] 0 critical bugs
- [ ] Response time under 100ms p95

### Launch Success

- [ ] 100+ signups
- [ ] 50+ daily active users
- [ ] 10+ ratings/notes submitted
- [ ] <1 support ticket per day

---

## Resources

**PostgreSQL:**

- [Official Docs](https://www.postgresql.org/docs/)
- [Full-text search tutorial](https://www.postgresql.org/docs/current/textsearch.html)

**Express.js:**

- [Express.js Guide](https://expressjs.com/)
- [Error handling](https://expressjs.com/en/guide/error-handling.html)

**Authentication:**

- [OAuth2 flow explained](https://www.digitalocean.com/community/tutorials/an-introduction-to-oauth-2)
- [JWT best practices](https://tools.ietf.org/html/rfc8725)

**Testing:**

- [Jest docs](https://jestjs.io/)
- [Testing Library](https://testing-library.com/)

**Deployment:**

- [Heroku docs](https://devcenter.heroku.com/)
- [Heroku scaling](https://devcenter.heroku.com/articles/scaling)

---

## Questions During Implementation?

1. **"How do I...?"** → Check IMPLEMENTATION_ROADMAP.md code examples
2. **"Why this way?"** → Check PRODUCTION_SPEC.md for justification
3. **"Should we build X?"** → Check COMPETITIVE_ANALYSIS.md for market context
4. **"Are we on track?"** → Check this checklist, should complete ~25% per week

**If stuck >30 min:** Check GitHub issues for your tech stack, post question with full error.

---

**Good luck. Ship it. 🚀**

Timeline: 4 weeks → MVP live → 100 users → $2K/month revenue → sustainable business.

You've got this.
