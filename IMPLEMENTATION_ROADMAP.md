# Implementation Roadmap: From Browser App to Production

**Current State:** Prompt library in browser localStorage with ratings + notes features  
**Goal:** Production-ready SaaS with team collaboration  
**Timeline:** 4 weeks to MVP

---

## WEEK 1: Backend Foundation

### Day 1-2: Project Setup

```bash
# Initialize Node.js backend
mkdir prompt-lib-api && cd prompt-lib-api
npm init -y
npm install express cors dotenv pg redis jsonwebtoken
npm install -D typescript @types/express @types/node

# Create structure
mkdir src/{routes,models,middleware,services}
touch src/server.ts src/config.ts .env .env.example docker-compose.yml
```

### Day 2-3: Database Schema & Migrations

```typescript
// src/db/schema.sql
-- Copy from PRODUCTION_SPEC.md Section 1.2
-- Key tables: users, organizations, prompts, prompt_versions,
--             prompt_ratings, prompt_notes, permissions, audit_log

// Use pg-migrate for version control:
npm install -D node-pg-migrate pg
npx node-pg-migrate create "001-initial-schema"
```

### Day 4-5: Authentication (OAuth2 + API Keys)

```typescript
// src/services/auth.ts
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";

export function setupAuth(app) {
  // OAuth2 callback handler
  app.get("/api/v1/auth/callback", async (req, res) => {
    const { code } = req.query;
    // Exchange code for token
    const token = await exchangeCodeForToken(code);
    res.json({ token });
  });

  // API key generation
  app.post("/api/v1/auth/api-keys", authenticate, async (req, res) => {
    const apiKey = generateSecureKey(); // 32 char random
    const hash = sha256(apiKey);
    await db.query(
      "INSERT INTO api_keys (user_id, key_hash, name) VALUES ($1, $2, $3)",
      [req.user.id, hash, req.body.name]
    );
    res.json({ key: apiKey }); // Only show once!
  });
}
```

### Deliverable: Single-user API working locally

```bash
curl -X POST http://localhost:3000/api/v1/auth/api-keys \
  -H "Authorization: Bearer token" \
  -d '{"name":"my-app"}'
# Returns: {"key":"sk_live_xxx"}
```

---

## WEEK 2: Core CRUD Operations

### Day 6-7: Prompt Management Endpoints

```typescript
// src/routes/prompts.ts
import { Router } from "express";

const router = Router();

// GET /api/v1/prompts (list with pagination)
router.get("/", authenticate, async (req, res) => {
  const { page = 1, per_page = 20, q } = req.query;
  const offset = (page - 1) * per_page;

  let query = `
    SELECT p.*, 
           COUNT(*) OVER() as total,
           AVG(pr.rating) as avg_rating,
           COUNT(pr.id) as rating_count
    FROM prompts p
    LEFT JOIN prompt_ratings pr ON p.id = pr.prompt_id
    WHERE p.organization_id = $1
  `;

  if (q) {
    query += ` AND p.search_vector @@ plainto_tsquery('english', $2)`;
  }

  query += ` ORDER BY p.created_at DESC LIMIT $${q ? 3 : 2} OFFSET $${
    q ? 4 : 3
  }`;

  const { rows } = await db.query(
    query,
    [req.org.id, q, per_page, offset].filter(Boolean)
  );

  res.json({
    data: rows,
    pagination: {
      page,
      per_page,
      total: rows[0]?.total || 0,
    },
  });
});

// POST /api/v1/prompts (create)
router.post("/", authenticate, async (req, res) => {
  const { title, content, description, tags } = req.body;

  // Validate
  if (!title?.trim() || !content?.trim()) {
    return res.status(400).json({ error: "Title and content required" });
  }

  const { rows } = await db.query(
    `INSERT INTO prompts 
     (id, organization_id, title, description, created_by, tags)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
     RETURNING *`,
    [req.org.id, title, description, req.user.id, tags]
  );

  // Auto-create version 1
  await db.query(
    `INSERT INTO prompt_versions 
     (id, prompt_id, version_number, content, created_by)
     VALUES (gen_random_uuid(), $1, 1, $2, $3)`,
    [rows[0].id, content, req.user.id]
  );

  res.status(201).json(rows[0]);
});

// PUT /api/v1/prompts/:id (update)
router.put("/:id", authenticate, async (req, res) => {
  const { content, change_summary } = req.body;

  // Get current version number
  const {
    rows: [latest],
  } = await db.query(
    `SELECT version_number FROM prompt_versions 
     WHERE prompt_id = $1 ORDER BY version_number DESC LIMIT 1`,
    [req.params.id]
  );

  // Create new version
  const newVersion = latest.version_number + 1;
  await db.query(
    `INSERT INTO prompt_versions 
     (id, prompt_id, version_number, content, created_by, change_summary)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
    [req.params.id, newVersion, content, req.user.id, change_summary]
  );

  // Update prompt updated_at
  await db.query("UPDATE prompts SET updated_at = NOW() WHERE id = $1", [
    req.params.id,
  ]);

  res.json({ version: newVersion });
});

// DELETE /api/v1/prompts/:id (soft delete)
router.delete("/:id", authenticate, async (req, res) => {
  await db.query("UPDATE prompts SET is_archived = TRUE WHERE id = $1", [
    req.params.id,
  ]);

  // Log action
  await auditLog(req.org.id, req.user.id, "delete", "prompt", req.params.id);

  res.json({ success: true });
});

export default router;
```

### Day 8: Rating & Notes Integration

```typescript
// src/routes/ratings.ts
router.post("/prompts/:id/ratings", authenticate, async (req, res) => {
  const { rating } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "Rating must be 1-5" });
  }

  // Upsert (user can only have one rating per prompt)
  await db.query(
    `INSERT INTO prompt_ratings (id, prompt_id, user_id, rating)
     VALUES (gen_random_uuid(), $1, $2, $3)
     ON CONFLICT (prompt_id, user_id) DO UPDATE SET rating = $3`,
    [req.params.id, req.user.id, rating]
  );

  // Calculate new average
  const {
    rows: [stats],
  } = await db.query(
    `SELECT AVG(rating)::float as avg, COUNT(*) as count
     FROM prompt_ratings WHERE prompt_id = $1`,
    [req.params.id]
  );

  res.json({ average: stats.avg, count: stats.count });
});

// POST /api/v1/prompts/:id/notes
router.post("/prompts/:id/notes", authenticate, async (req, res) => {
  const { content } = req.body;

  await db.query(
    `INSERT INTO prompt_notes (id, prompt_id, user_id, content)
     VALUES (gen_random_uuid(), $1, $2, $3)`,
    [req.params.id, req.user.id, content]
  );

  res.status(201).json({ success: true });
});
```

### Deliverable: All CRUD endpoints working + tests

```bash
npm test
# ✓ POST /prompts creates prompt with version 1
# ✓ GET /prompts returns paginated list
# ✓ PUT /prompts/:id increments version
# ✓ POST /prompts/:id/ratings accepts 1-5
# ✓ POST /prompts/:id/notes saves note
```

---

## WEEK 3: Frontend Migration & Collaboration

### Day 9-10: Migrate localStorage → API Calls

```typescript
// src/services/promptService.ts (Frontend)
export class PromptService {
  private apiKey: string;

  async listPrompts(page = 1, search = "") {
    const res = await fetch(
      `/api/v1/prompts?page=${page}&per_page=20&q=${search}`,
      { headers: { Authorization: `Bearer ${this.apiKey}` } }
    );
    return res.json();
  }

  async createPrompt(title: string, content: string) {
    const res = await fetch("/api/v1/prompts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ title, content }),
    });
    return res.json();
  }

  async updatePrompt(id: string, content: string, summary: string) {
    const res = await fetch(`/api/v1/prompts/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ content, change_summary: summary }),
    });
    return res.json(); // Returns { version: 2 }
  }

  async ratePrompt(id: string, rating: number) {
    return fetch(`/api/v1/prompts/${id}/ratings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ rating }),
    }).then((r) => r.json());
  }
}
```

### Day 11-12: Team/Organization Support

```typescript
// src/routes/organizations.ts
router.post("/", authenticate, async (req, res) => {
  const { name } = req.body;

  const {
    rows: [org],
  } = await db.query(
    `INSERT INTO organizations (id, name, owner_id)
     VALUES (gen_random_uuid(), $1, $2)
     RETURNING *`,
    [name, req.user.id]
  );

  // Add creator as admin
  await db.query(
    `INSERT INTO permissions (id, organization_id, user_id, role)
     VALUES (gen_random_uuid(), $1, $2, 'admin')`,
    [org.id, req.user.id]
  );

  res.status(201).json(org);
});

// POST /api/v1/organizations/:id/members (invite)
router.post("/:id/members", authenticate, async (req, res) => {
  const { email, role } = req.body;

  // Find user by email
  const {
    rows: [user],
  } = await db.query("SELECT id FROM users WHERE email = $1", [email]);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  // Add to organization
  await db.query(
    `INSERT INTO permissions (id, organization_id, user_id, role)
     VALUES (gen_random_uuid(), $1, $2, $3)`,
    [req.params.id, user.id, role]
  );

  res.json({ success: true });
});
```

### Deliverable: Web app can create org, invite members, share prompts

---

## WEEK 4: Deployment & Hardening

### Day 13-14: Rate Limiting & Security

```typescript
// src/middleware/rateLimit.ts
import Redis from "redis";

const redis = Redis.createClient();

export async function rateLimit(req, res, next) {
  const key = `ratelimit:${req.user.id}`;
  const limit = req.user.tier === "pro" ? 300 : 30; // req/min

  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, 60);
  }

  if (current > limit) {
    return res.status(429).json({
      error: "Rate limit exceeded",
      remaining: 0,
      resetIn: await redis.ttl(key),
    });
  }

  // Set response headers
  res.set({
    "X-RateLimit-Limit": limit,
    "X-RateLimit-Remaining": limit - current,
    "X-RateLimit-Reset": Date.now() + (await redis.ttl(key)) * 1000,
  });

  next();
}

// Apply to all API routes
app.use("/api/v1", authenticate, rateLimit);
```

### Day 14: Deployment (Heroku)

```bash
# Create Heroku app
heroku create my-prompt-lib
heroku addons:create heroku-postgresql:hobby-dev
heroku addons:create heroku-redis:premium-0

# Deploy
git push heroku main

# Verify
heroku logs --tail
```

### Day 15: Monitoring & Error Handling

```typescript
// src/middleware/errorHandler.ts
export function errorHandler(err, req, res, next) {
  console.error("API Error:", {
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    error: err.message,
    stack: err.stack,
    timestamp: new Date(),
  });

  // Don't leak internal errors to client
  const status = err.status || 500;
  const message = err.status ? err.message : "Internal server error";

  res.status(status).json({ error: message });
}

app.use(errorHandler);
```

---

## Testing Checklist

```bash
# Unit tests
npm test -- src/services/*.test.ts

# Integration tests (API)
npm run test:integration
# ✓ Create prompt → versions increments
# ✓ Rate 5 stars → avg updates
# ✓ Invite user → permissions set
# ✓ Rate limit → 429 on excess

# Load testing (simulate 100 concurrent users)
npm run test:load
# ✓ 100 concurrent requests under 500ms
# ✓ Database doesn't crash

# Security audit
npm audit
npx snyk test
```

---

## Migration Strategy: Browser App → Cloud

### Phase 1: Feature Parity (Week 1-2)

- Everything works in cloud that worked in browser
- Users can create/update/delete prompts
- Ratings and notes sync to server

### Phase 2: One-Way Sync (Week 3)

- Browser localStorage → Cloud (automatic backup)
- Cloud → Browser (populate on load)
- User can switch between browser + cloud seamlessly

### Phase 3: Cloud-First (Week 4)

- Default to cloud storage
- localStorage as offline cache
- Sync on reconnect

**User Communication:**

> "We're moving your prompts to the cloud for better collaboration. Your local copies are backed up automatically. No action needed!"

---

## Cost Estimate: MVP Infrastructure

| Component              | Tier                | Monthly Cost   |
| ---------------------- | ------------------- | -------------- |
| Heroku Dyno            | Standard-1X (512MB) | $7             |
| PostgreSQL             | Hobby-dev (10GB)    | $9             |
| Redis                  | Premium-0 (1GB)     | $5             |
| Heroku Postgres Backup | 2 backups/day       | $0 (included)  |
| CloudFlare             | Pro                 | $20            |
| Domain                 | .app                | $12            |
| Monitoring (Sentry)    | Free tier           | $0             |
| **Total**              |                     | **~$53/month** |

**Cost per user at 100 users:** $0.53 (acceptable for MVP)

---

## Launch Checklist

- [ ] Database backed up (test restore takes <1 hour)
- [ ] Error tracking enabled (Sentry)
- [ ] Monitoring dashboard set up (Heroku metrics)
- [ ] API documentation generated (OpenAPI spec)
- [ ] 10 beta users testing (no critical bugs)
- [ ] Terms of Service + Privacy Policy written
- [ ] Security header review (X-Frame-Options, CSP)
- [ ] Rate limiting tested (429 returns correctly)
- [ ] Database indexed (queries <100ms)
- [ ] Logging centralized (can debug production issues)

---

## Quick Start for Junior Engineer

```bash
# Clone repo
git clone https://github.com/yourname/prompt-lib.git
cd prompt-lib

# Setup
npm install
cp .env.example .env
# Edit .env with your Postgres/Redis URLs

# Start local DB
docker-compose up -d

# Run migrations
npm run migrate:up

# Start server
npm run dev
# Server running on http://localhost:3000

# Run tests
npm test

# Deploy to Heroku
git push heroku main
```

**Key Files to Understand:**

1. `src/server.ts` — Express app setup
2. `src/routes/prompts.ts` — All CRUD logic
3. `src/db/schema.sql` — Database structure
4. `src/middleware/auth.ts` — Permission checking

**When Stuck:**

- Check `src/__tests__` for examples
- Read error logs: `heroku logs --tail`
- Ask in team Slack (not email)

---

## Estimated Timeline

| Week | Deliverable                   | Owner           |
| ---- | ----------------------------- | --------------- |
| 1    | Backend API, auth, DB         | 1 Sr Eng        |
| 2    | All CRUD endpoints, tests     | 1 Sr Eng        |
| 3    | Frontend migration, teams     | 1 FE + 1 BE     |
| 4    | Deployment, hardening, launch | 1 DevOps + 1 BE |

**Total:** 4 weeks, 2-3 engineers, shipped to production.

---

## Post-MVP: Month 2-3 Priority

1. **Git Sync** (1 week) — Export prompts to GitHub
2. **Analytics Dashboard** (1 week) — Usage trends
3. **Webhook Events** (1 week) — For CI/CD integrations
4. **Comments** (1 week) — Discussion on versions
5. **Mobile PWA** (2 weeks) — Works offline

This roadmap assumes: **execution over perfection**. Ship it, get feedback, iterate.
