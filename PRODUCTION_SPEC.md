# Production Prompt Library: Technical Specification

## Executive Summary

This document outlines the architectural decisions, API design, and scaling strategy to evolve your browser-based prompt library into a production-grade SaaS platform. We're targeting a 100 user MVP that can scale to 1M users while maintaining sub-100ms response times and <$0.10 cost per active user monthly.

**Key Decisions Made:**

- PostgreSQL + Redis (proven for collaborative editing at scale)
- RESTful API with webhook support (lower complexity than GraphQL for initial MVP)
- OAuth2 + API keys for auth (standard, reduces friction)
- Full-text search initially, vector embeddings for future relevance ranking
- Rate limiting: Token bucket per tier (prevents abuse, fair usage)

---

# 1. SYSTEM ARCHITECTURE DOCUMENT

## 1.1 Current State → Target Architecture

### Current (Browser-based localStorage)

```
User Browser
    ↓
localStorage (5-50MB limit)
    ↓
No persistence, no sharing, no versioning
```

### Target Architecture (Production)

```
┌─────────────────────────────────────────────────────┐
│                    CLIENT LAYER                      │
│  (React/Vue App + SDK for API integration)           │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│              API GATEWAY / Load Balancer             │
│  (Cloudflare/AWS API Gateway - geo-routing)         │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│              APPLICATION LAYER                       │
│  Node.js (Express/Fastify) + TypeScript              │
│  ├─ Prompt Management Service                        │
│  ├─ Collaboration Service (OT/CRDT)                 │
│  ├─ Auth Service (OAuth2)                           │
│  ├─ Rate Limiter (Redis)                            │
│  └─ Search Service                                  │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────┴───────────────┬────────────────┐
│         DATA LAYER                 │                │
├─────────────────────────────────┬──┴────────────────┤
│  PostgreSQL (Primary Store)     │  Redis (Cache)   │
│  ├─ users                       │  ├─ Sessions     │
│  ├─ prompts (versioned)         │  ├─ Rate limits  │
│  ├─ versions                    │  ├─ Search index │
│  ├─ permissions/org             │  └─ Webhooks q   │
│  ├─ audit_log                   │                  │
│  └─ full_text_search_index      │                  │
└─────────────────────────────────┴──────────────────┘
```

## 1.2 Data Persistence Strategy

### Primary Database: PostgreSQL

**Why PostgreSQL:**

- ✅ ACID transactions (critical for version control)
- ✅ Excellent full-text search (tsvector)
- ✅ Proven at scale (Postman uses it for 10M+ collections)
- ✅ JSON support (flexible prompt metadata)
- ✅ Row-level security (RLS) for multi-tenancy
- ✅ Affordable: $15-50/month single instance → managed services at scale

**Schema (Simplified):**

```sql
-- Core tables
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  avatar_url TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE TABLE organizations (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  owner_id UUID REFERENCES users(id),
  created_at TIMESTAMP
);

CREATE TABLE prompts (
  id UUID PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  is_archived BOOLEAN DEFAULT FALSE,

  -- Full-text search
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', title || ' ' || COALESCE(description, ''))
  ) STORED,

  -- Metadata
  tags TEXT[] DEFAULT '{}',
  category VARCHAR(50),
  model_compatibility JSONB -- {gpt-4, claude, etc}
);

CREATE TABLE prompt_versions (
  id UUID PRIMARY KEY,
  prompt_id UUID REFERENCES prompts(id),
  version_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  system_prompt TEXT,
  parameters JSONB, -- {temperature: 0.7, max_tokens: 2000}
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP,
  change_summary VARCHAR(500),
  is_published BOOLEAN DEFAULT FALSE
);

CREATE TABLE prompt_ratings (
  id UUID PRIMARY KEY,
  prompt_id UUID REFERENCES prompts(id),
  user_id UUID REFERENCES users(id),
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMP,
  UNIQUE(prompt_id, user_id) -- One rating per user per prompt
);

CREATE TABLE prompt_notes (
  id UUID PRIMARY KEY,
  prompt_id UUID REFERENCES prompts(id),
  user_id UUID REFERENCES users(id),
  content TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE TABLE permissions (
  id UUID PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id),
  user_id UUID REFERENCES users(id),
  role VARCHAR(50), -- admin, editor, viewer
  created_at TIMESTAMP
);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id),
  user_id UUID REFERENCES users(id),
  action VARCHAR(50), -- create, update, delete, share
  resource_type VARCHAR(50), -- prompt, version
  resource_id UUID,
  metadata JSONB,
  created_at TIMESTAMP,
  ip_address INET
);

-- Indexes for performance
CREATE INDEX idx_prompts_organization ON prompts(organization_id);
CREATE INDEX idx_prompts_search ON prompts USING GIN(search_vector);
CREATE INDEX idx_versions_prompt ON prompt_versions(prompt_id);
CREATE INDEX idx_audit_org ON audit_log(organization_id, created_at DESC);
CREATE INDEX idx_ratings_prompt ON prompt_ratings(prompt_id);
```

### Caching Strategy: Redis

**Purpose:** Reduce database load, speed up common queries, real-time collaboration

- Session storage (JWT tokens + refresh tokens)
- Rate limit counters (per user, per IP)
- Search index cache (full-text results)
- Webhook queue (reliable delivery)
- User's "current editing" state (for conflict detection)

**Memory Estimate (100 users):**

- Sessions: 100 users × 1KB = 100KB
- Rate limits: 100 users × 5 buckets × 100 bytes = 50KB
- Search cache: 10K popular searches × 500 bytes = 5MB
- **Total: ~6MB** (can use AWS ElastiCache free tier)

## 1.3 Authentication Strategy

### OAuth2 + API Keys (Hybrid Approach)

**Why This:**

- OAuth2 for web app users (Google, GitHub logins → lower friction)
- API keys for programmatic access (integrations, CI/CD)
- Easy migration from localStorage (users see instant value)

**Implementation:**

```typescript
// OAuth2 Flow (Web App)
1. User clicks "Login with Google"
2. Redirected to Google → back to /callback?code=xxx
3. Backend exchanges code for JWT token
4. JWT stored in httpOnly cookie (CSRF protection)
5. Refresh token stored securely in DB

// API Key Flow (Integrations)
1. User generates API key in settings
2. API key = sk_live_xxxxxxxxxxxx (32 chars)
3. Hash stored in DB: SHA256(api_key)
4. Client sends: Authorization: Bearer sk_live_xxx
5. Backend verifies hash, returns org_id + user_id

// JWT Token Structure
{
  sub: "user-id",
  org_id: "org-id",
  email: "user@example.com",
  role: "editor", // admin, editor, viewer
  iat: 1702000000,
  exp: 1702003600 // 1 hour
}
```

**Security Checklist:**

- ✅ OAuth2 PKCE (prevent authorization code interception)
- ✅ httpOnly, Secure, SameSite=Strict cookies
- ✅ API key rotation (monthly recommended)
- ✅ Rate limiting per API key (prevents brute force)
- ✅ Audit log all auth events

## 1.4 Real-Time Collaboration Requirements

### Approach: Operational Transformation (OT) OR CRDT

**Decision: CRDT + WebSocket** (simpler than OT for teams)

**Why CRDT:**

- No central authority needed (works offline)
- Convergent: all clients reach same state eventually
- Used by: Google Docs, Figma, Notion

**Implementation Plan for MVP:**

Phase 1 (MVP): Simple locking + version control

```typescript
// Prompt edit locking (pessimistic)
PUT /api/v1/prompts/{id}/acquire-lock
// Locks for 30 seconds, auto-releases on disconnect
// Another user sees: "Jane is editing..."

// Change tracking
POST /api/v1/prompts/{id}/versions
{
  content: "new text",
  change_summary: "Updated system prompt",
  created_by: "user-id"
}
// Returns: { version_number: 3, timestamp, ... }
```

Phase 2 (Post-MVP): Full CRDT with WebSocket

```typescript
// WebSocket events
io.emit("prompt:change", {
  promptId: "xxx",
  change: { index: 45, chars: "+hello", timestamp, userId },
  clientVersion: 5, // causal ordering
});

// Server merges, broadcasts to all clients
// All clients converge to same state automatically
```

**Conflict Resolution:**

- Last-write-wins with timestamp + user ID (deterministic)
- Client can always "revert to published version" if conflict

## 1.5 Rate Limiting & Abuse Prevention

### Token Bucket Algorithm (Per Tier)

```typescript
// Tier Configuration
const LIMITS = {
  free: {
    requests_per_minute: 30,
    api_calls_per_day: 1000,
    prompts_max: 10,
    workspace_members: 1,
  },
  pro: {
    requests_per_minute: 300,
    api_calls_per_day: 100000,
    prompts_max: 1000,
    workspace_members: 10,
  },
  enterprise: {
    requests_per_minute: null, // unlimited
    api_calls_per_day: null,
    prompts_max: null,
    workspace_members: null,
  },
};

// Redis Implementation
async function checkRateLimit(userId, tier) {
  const key = `ratelimit:${userId}`;
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, 60); // 1-minute window
  }

  const limit = LIMITS[tier].requests_per_minute;
  if (current > limit) {
    throw new Error(`Rate limit exceeded: ${current}/${limit}`);
  }

  return {
    remaining: limit - current,
    resetIn: await redis.ttl(key),
  };
}
```

**Abuse Detection:**

- Multiple failed login attempts → 15 min lockout
- API key generating 10M+ tokens/day → flag for review
- Prompt creation > 100/hour → rate limit to 10/hour
- Report via email to security team

## 1.6 Search Infrastructure

### Phase 1 (MVP): PostgreSQL Full-Text Search

```typescript
// Query
SELECT * FROM prompts
WHERE organization_id = $1
  AND search_vector @@ plainto_tsquery('english', $2)
  AND is_archived = FALSE
ORDER BY ts_rank(search_vector, query) DESC
LIMIT 20;

// Performance: ~50ms on 10K prompts with index
```

### Phase 2 (Post-MVP): Vector Embeddings (Semantic Search)

```typescript
// Store embeddings in pgvector (PostgreSQL extension)
CREATE TABLE prompt_embeddings (
  id UUID PRIMARY KEY,
  prompt_id UUID REFERENCES prompts(id),
  embedding vector(1536), -- OpenAI embeddings
  created_at TIMESTAMP
);

// Semantic search
SELECT * FROM prompts p
JOIN prompt_embeddings e ON p.id = e.prompt_id
WHERE p.organization_id = $1
ORDER BY e.embedding <-> query_embedding
LIMIT 10;

// Cost: $0.02 per 1M tokens (OpenAI API)
```

---

# 2. API DESIGN SPECIFICATION

## 2.1 RESTful API vs GraphQL Decision

**Decision: REST + OpenAPI spec**

**Reasoning:**

- MVP teams are more familiar with REST
- Caching easier (HTTP caching headers)
- Rate limiting simpler to implement per endpoint
- Can add GraphQL later without rewriting REST layer
- OpenAPI enables auto-generated docs + client SDKs

## 2.2 Core Endpoints

### Authentication

```
POST   /api/v1/auth/oauth/google     # Initiate Google OAuth
POST   /api/v1/auth/callback         # Handle OAuth redirect
POST   /api/v1/auth/api-keys         # Generate API key
DELETE /api/v1/auth/api-keys/{id}    # Revoke API key
POST   /api/v1/auth/refresh          # Refresh JWT token
```

### Prompts (CRUD + Versioning)

```
GET    /api/v1/prompts               # List (with pagination/search)
POST   /api/v1/prompts               # Create new prompt
GET    /api/v1/prompts/{id}          # Get latest version
PUT    /api/v1/prompts/{id}          # Update prompt (creates version)
DELETE /api/v1/prompts/{id}          # Archive (soft delete)

# Versioning
GET    /api/v1/prompts/{id}/versions           # List all versions
GET    /api/v1/prompts/{id}/versions/{vnum}   # Get specific version
POST   /api/v1/prompts/{id}/versions/{vnum}/publish  # Publish version

# Ratings & Notes (From your current feature)
POST   /api/v1/prompts/{id}/ratings  # Submit rating (1-5)
GET    /api/v1/prompts/{id}/ratings  # Get rating stats
POST   /api/v1/prompts/{id}/notes    # Add note
DELETE /api/v1/prompts/{id}/notes/{nid}  # Delete note
```

### Collaboration

```
POST   /api/v1/organizations             # Create workspace
GET    /api/v1/organizations/{id}        # Get org details
POST   /api/v1/organizations/{id}/members # Invite user
DELETE /api/v1/organizations/{id}/members/{uid} # Remove member

# Permissions
PUT    /api/v1/organizations/{id}/members/{uid}/role # Change role
```

### Search & Analytics

```
GET    /api/v1/search?q=regex&type=prompts   # Full-text search
GET    /api/v1/analytics/usage                # Org usage stats
GET    /api/v1/audit-log                     # Audit log (admin)
```

## 2.3 API Request/Response Format

### Example: Create Prompt

```bash
POST /api/v1/prompts
Content-Type: application/json
Authorization: Bearer eyJ...

{
  "title": "Email Writer",
  "description": "Generates professional emails",
  "content": "You are an email writer...",
  "system_prompt": "Always maintain professional tone",
  "tags": ["email", "writing"],
  "parameters": {
    "model": "gpt-4",
    "temperature": 0.7,
    "max_tokens": 500
  }
}

# Response (201 Created)
{
  "id": "prompt-123",
  "title": "Email Writer",
  "organization_id": "org-456",
  "created_by": "user-789",
  "current_version": 1,
  "created_at": "2025-12-08T14:30:00Z",
  "updated_at": "2025-12-08T14:30:00Z",
  "_links": {
    "self": "/api/v1/prompts/prompt-123",
    "versions": "/api/v1/prompts/prompt-123/versions",
    "publish": "/api/v1/prompts/prompt-123/versions/1/publish"
  }
}
```

### Pagination

```
GET /api/v1/prompts?page=2&per_page=20&sort=-created_at

Response Headers:
X-Total-Count: 156
X-Page: 2
X-Per-Page: 20
Link: <...?page=3>; rel="next", <...?page=1>; rel="prev"
```

## 2.4 Versioning Strategy

### URL Versioning (Recommended)

```
/api/v1/prompts  ← Current version
/api/v2/prompts  ← Breaking changes (2+ years later)
```

**Backwards Compatibility Policy:**

- Support current + 2 prior versions
- 6-month deprecation warning before removing old version
- Use `Accept: application/vnd.promptlib.v1+json` for version negotiation

## 2.5 Webhook Events for Integrations

Enable teams to trigger actions when prompts change:

```typescript
// Webhook Events
prompt.created
prompt.updated
prompt.version.published
prompt.deleted
prompt.rated        // Fires when rating changes
organization.member.added

// Example: Listen for prompt updates
POST /your-webhook-endpoint
Content-Type: application/json
X-Webhook-Signature: sha256=xxx

{
  "event": "prompt.updated",
  "timestamp": "2025-12-08T14:30:00Z",
  "data": {
    "prompt_id": "prompt-123",
    "organization_id": "org-456",
    "version_number": 2,
    "change_summary": "Updated instructions"
  }
}
```

---

# 3. SCALING PROJECTIONS

## 3.1 User Growth Path: 100 → 1M Users

### Phase 1: MVP (Months 1-3) | 100 Users

```
Infrastructure:
├─ 1x Heroku dyno (512MB) - $7/month
├─ Postgres hobby-dev - $9/month
├─ Redis nano - $5/month (free tier available)
└─ Cloudflare - Free

Database Size: ~500MB
Response Time (p95): 150ms
Monthly Cost: $25 (+ hosting)
Cost Per User: $0.25/month

Bottleneck: Single process, no caching
Action: Monitor, add Redis caching
```

### Phase 2: Growth (Months 4-8) | 1K-10K Users

```
Infrastructure:
├─ 2x App servers (standard-2X, 2GB each)
├─ Postgres (4GB, dedicated)
├─ Redis (2GB cache cluster)
├─ CloudFront CDN
└─ Monitoring (DataDog, Sentry)

Database Size: ~50GB
Response Time (p95): 100ms
Monthly Cost: $800
Cost Per User: $0.08/month

Bottleneck: Database connections, search index rebuild time
Action: Add read replicas, tune queries
```

### Phase 3: Scale (Months 9-18) | 10K-100K Users

```
Infrastructure:
├─ 4x App servers (auto-scaling 2-8)
├─ Postgres (32GB, multi-region) + read replicas
├─ Redis cluster (24GB) + sentinel failover
├─ Elasticsearch for search
├─ S3 for audit logs (cost: $0.10/GB/month)
└─ CloudFront + regional caching

Database Size: ~500GB
Response Time (p95): 80ms
Monthly Cost: $5,000
Cost Per User: $0.05/month

Bottleneck: Elasticsearch indexing lag, data transfer costs
Action: Shard by organization_id, tune Elasticsearch
```

### Phase 4: Enterprise (18+ Months) | 100K-1M Users

```
Infrastructure:
├─ Kubernetes cluster (AWS EKS, 20-100 pods)
├─ Postgres managed (RDS with read replicas, global + regional)
├─ Redis cluster with auto-scaling
├─ Elasticsearch (sharded) + OpenSearch
├─ S3 + CloudFront with regional edge caches
├─ Data warehouse (Snowflake) for analytics
└─ Multi-region failover

Database Size: ~5TB
Response Time (p95): 50ms
Monthly Cost: $50,000
Cost Per User: $0.05/month (unit economics improve!)

Bottleneck: Data center latency, compliance across regions
Action: Multi-region deployment, GDPR compliance
```

## 3.2 Performance Benchmarks to Maintain

| Metric                      | Target | Why                        |
| --------------------------- | ------ | -------------------------- |
| **API Response Time (p95)** | <100ms | Users notice >200ms        |
| **Database Query (p95)**    | <50ms  | Slow queries tank SLA      |
| **Search Index Lag**        | <5s    | Real-time feel             |
| **Availability (uptime)**   | 99.9%  | <8 hours downtime/year     |
| **API Error Rate**          | <0.1%  | Users abandon at >1%       |
| **Webhook Delivery**        | 99.95% | Essential for integrations |

**Monitoring Stack:**

```yaml
- Prometheus + Grafana (metrics)
- ELK Stack (logs)
- Sentry (error tracking)
- DataDog/New Relic (APM)
- PagerDuty (on-call alerts)
```

## 3.3 Cost Breakdown at 100K Users (Scale Phase)

| Component                  | Monthly Cost | Per User   |
| -------------------------- | ------------ | ---------- |
| App Servers (auto-scaling) | $1,500       | $0.015     |
| PostgreSQL (managed RDS)   | $1,200       | $0.012     |
| Redis Cluster              | $600         | $0.006     |
| Elasticsearch              | $800         | $0.008     |
| S3 + CDN                   | $400         | $0.004     |
| Monitoring/Logging         | $300         | $0.003     |
| Support/Ops                | $200         | $0.002     |
| **Total**                  | **$5,000**   | **$0.050** |

**Pricing Model (Example):**

- Free: $0/month (10 prompts max, no sharing)
- Pro: $20/month ($0.20 cost → 10x markup, margin: 90%)
- Enterprise: $500+/month (custom)

→ At 10K paid users (Pro tier): **$200K/month revenue** with healthy unit economics

## 3.4 Database Scaling Strategies

### When to implement:

```
100 Users     → Single PostgreSQL instance ✓
1K Users      → Add read replica (for analytics queries)
10K Users     → Partition by organization_id
100K Users    → Multi-region primary + replicas
1M Users      → Geo-sharding by region + tenant sharding
```

**Example: Sharding Strategy at 100K users**

```sql
-- Router determines shard based on organization_id
-- Shard 1: orgs A-F (shard1.db.internal)
-- Shard 2: orgs G-M (shard2.db.internal)
-- Shard 3: orgs N-Z (shard3.db.internal)

SELECT shard FROM organization_shards
WHERE organization_id = $1;
-- Returns: shard2.db.internal

-- Query routed to shard2
SELECT * FROM prompts WHERE organization_id = $1;
```

---

# 4. RECOMMENDED FEATURES: MVP vs Future

## MVP (Launch Week 1, 100 users)

- ✅ **Basic CRUD**: Create, read, update, delete prompts
- ✅ **Versioning**: Auto-versioned, view history, publish version
- ✅ **OAuth2**: Google login (simplest)
- ✅ **Org/Team**: Create workspace, invite 1 additional member (free tier)
- ✅ **Search**: PostgreSQL full-text search (title + description)
- ✅ **Ratings & Notes**: From your current feature ✓
- ✅ **API Keys**: Generate for integrations
- ✅ **Rate Limiting**: 30 req/min per user
- ✅ **Audit Log**: Who changed what, when

## Post-MVP: Priority 1 (Month 2-3, 1K users)

- 📊 **Analytics Dashboard**: Usage trends, popular prompts
- 🔗 **API Documentation**: Auto-generated OpenAPI spec + Postman collection
- 🌐 **Webhooks**: Push events to integrations (CI/CD, Slack, etc)
- 👥 **RBAC**: Granular permissions (admin, editor, viewer)
- 📱 **Mobile App**: React Native or PWA
- 🔍 **Advanced Search**: Filter by tags, model compatibility
- 🧪 **Prompt Testing UI**: Run prompt against different LLMs inline

## Post-MVP: Priority 2 (Month 4-8, 10K users)

- 🔄 **Real-time Collaboration**: WebSocket + CRDT for live editing
- 📈 **Semantic Search**: Vector embeddings for relevance
- 💬 **Comments/Discussion**: On specific versions or prompts
- 🔐 **SSO**: SAML for enterprise
- 🌍 **Multi-region Deployment**: EU, US, Asia data centers
- 📋 **Template Library**: Pre-built prompt templates (marketing, support, etc)
- 🧠 **AI Assistance**: Suggest improvements to prompts

## Future (Post-MVP: 100K+ users)

- 🤖 **Model Fine-tuning**: Fine-tune LLMs with your best prompts
- 📊 **A/B Testing Framework**: Compare prompt versions at scale
- 🔐 **Compliance**: SOC2, GDPR, HIPAA audit trails
- 💰 **Marketplace**: Buy/sell high-quality prompts
- 🌐 **Prompt Federation**: Share across organizations securely

---

# 5. RISK MITIGATION & CONTINGENCY

### Technical Risks

| Risk                                     | Likelihood | Impact   | Mitigation                                         |
| ---------------------------------------- | ---------- | -------- | -------------------------------------------------- |
| Massive prompt versioning → slow queries | Medium     | High     | Index on (prompt_id, version_number DESC)          |
| Redis fails → rate limiting breaks       | Low        | High     | Fall back to in-memory limits (10s accuracy)       |
| OAuth provider (Google) goes down        | Low        | Medium   | Support email/password auth as fallback            |
| Database becomes single point of failure | Low        | Critical | Read replicas + automated backup + RTO <1h         |
| Cost per user exceeds $0.10 at 100K      | Medium     | High     | Optimize search, compress data, cache aggressively |

### Security Risks

- **Data Breach**: Encrypt PII at rest (AES-256), in transit (TLS 1.3)
- **Prompt Injection**: Sanitize all user inputs, run in sandboxed environment
- **Rate Limiting Bypass**: Implement distributed rate limiting across regions
- **Unauthorized Access**: Implement permission checks on every endpoint

---

# 6. TEAM & TIMELINE

## MVP Launch (Week 1-4)

| Role      | Task                                | Effort                     |
| --------- | ----------------------------------- | -------------------------- |
| Backend   | API scaffolding, auth, CRUD prompts | 2 weeks                    |
| Frontend  | Migrate localStorage → API calls    | 1.5 weeks                  |
| DevOps    | Deploy to Heroku, configure CI/CD   | 3 days                     |
| QA        | End-to-end testing, bug fixes       | 1 week                     |
| **Total** |                                     | **4-5 weeks, 2 engineers** |

## Post-MVP: Growth Phase (Month 2-3)

| Feature           | Effort    | Owner                                 |
| ----------------- | --------- | ------------------------------------- |
| Webhooks          | 1 week    | Backend                               |
| Analytics         | 1 week    | Full-stack                            |
| Mobile App        | 3 weeks   | Frontend                              |
| Advanced Search   | 1.5 weeks | Backend                               |
| Monitoring/Alerts | 1 week    | DevOps                                |
| **Total**         |           | **1 backend + 1 frontend + 1 DevOps** |

---

# APPENDIX: Implementation Checklist

## Database Setup

- [ ] Design schema (copy from Section 1.2)
- [ ] Create indexes on frequently queried columns
- [ ] Set up automated backups (daily, 30-day retention)
- [ ] Test disaster recovery (restore from backup in <1 hour)
- [ ] Configure connection pooling (pgBouncer recommended)

## API Development

- [ ] Set up OpenAPI spec (use Swagger/Stoplight)
- [ ] Implement authentication (OAuth2 + API keys)
- [ ] Implement rate limiting (Redis token bucket)
- [ ] Add comprehensive logging (correlation IDs for debugging)
- [ ] Write API tests (Jest, Supertest)

## Security Hardening

- [ ] Enable HTTPS/TLS 1.3
- [ ] Implement CORS properly (whitelist domains)
- [ ] Add request signing (for webhooks)
- [ ] Implement CSRF protection (double-submit cookies)
- [ ] Run security audit (OWASP Top 10)
- [ ] Obtain SOC2 compliance (for enterprise sales)

## DevOps & Monitoring

- [ ] Set up CI/CD pipeline (GitHub Actions recommended)
- [ ] Configure monitoring dashboards (Prometheus + Grafana)
- [ ] Set up alerting (PagerDuty for critical issues)
- [ ] Implement centralized logging (ELK or CloudWatch)
- [ ] Document runbooks for common incidents

## Launch Preparation

- [ ] User testing with 10-20 beta users
- [ ] Performance load testing (simulate 1000 concurrent users)
- [ ] Stress test database (can handle 10x current load?)
- [ ] Security penetration testing
- [ ] Legal: Terms of Service, Privacy Policy, DPA (for EU)

---

## Conclusion

This architecture is designed to:

1. **Launch quickly** (4-5 weeks for MVP)
2. **Scale smoothly** (10x growth with minimal refactoring)
3. **Maintain costs** (<$0.10 per user even at 1M scale)
4. **Ensure reliability** (99.9% uptime SLA)

The key philosophy: **Start simple (PostgreSQL + Redis + REST), add complexity only when needed.** You don't need sharding until 100K users. You don't need vector embeddings until search relevance becomes a problem.

Questions? Review the decision logs above—each choice is documented with trade-offs.
