# PENWORTH NEW (v2.0) — Enterprise Knowledge Platform

> **Knowledge, verified.**

⚠️ **IMPORTANT**: This is **Penworth New (v2.0)** — the completely rebuilt platform.  
This is **NOT** the legacy penworth.ai codebase. Keep them separate.

| Aspect | Legacy Penworth | Penworth New (This Repo) |
|--------|-----------------|--------------------------|
| Domain | penworth.ai | **new.penworth.ai** |
| Supabase Project | penworth-prod | **penworth-new-prod** |
| Vercel Project | penworth | **penworth-new** |
| Version | 1.x | **2.0** |
| Architecture | Book-centric | Multi-industry knowledge |

---

## 🎯 What's New in v2.0

- **Multi-industry AI agents** — Healthcare, Education, Finance, Legal, Mining, Government, Technology, Publishing
- **Anti-hallucination verification layer** — Every claim grounded in sources
- **Organization workspaces** — Multi-tenant architecture with RLS
- **Enterprise-grade compliance** — HIPAA, SOC2, GDPR ready architecture
- **Knowledge marketplace** — Buy, sell, license verified content

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Supabase account (create **NEW** project)
- Anthropic API key
- Stripe account
- Vercel account

### 1. Install Dependencies

```bash
cd penworth-new
npm install
```

### 2. Create NEW Supabase Project

**CRITICAL**: Create a **new** Supabase project named `penworth-new-prod`. Do NOT use the legacy penworth project.

1. Go to [supabase.com](https://supabase.com) → New Project
2. Name it: `penworth-new-prod`
3. Wait for project to be ready
4. Go to **SQL Editor** and run migrations:
   - Run `supabase/migrations/001_initial_schema.sql`
   - Run `supabase/migrations/002_rls_policies.sql`

### 3. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your **new** Supabase credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-new-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_new_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_new_service_role_key
ANTHROPIC_API_KEY=sk-ant-xxx
NEXT_PUBLIC_APP_URL=https://new.penworth.ai
```

### 4. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 📦 Deployment to Vercel

### Create NEW Vercel Project

**CRITICAL**: Create a **new** Vercel project named `penworth-new`. Do NOT deploy to the legacy penworth project.

```bash
# Option 1: CLI
vercel --name penworth-new

# Option 2: Dashboard
# Go to vercel.com → New Project → Import this repo → Name: penworth-new
```

### Configure Domain

Add subdomain in Vercel Dashboard:
- **Production**: `new.penworth.ai`

### Environment Variables in Vercel

Add all variables from `.env.local` to Vercel Dashboard → Settings → Environment Variables.

---

## 🏗️ Project Structure

```
penworth-new/
├── app/                      # Next.js App Router
│   ├── (auth)/              # Auth pages
│   ├── (dashboard)/         # Protected dashboard
│   ├── api/                 # API routes
│   │   ├── ai/chat/         # Streaming AI endpoint
│   │   └── webhooks/stripe/ # Payment webhooks
├── components/              # React components
├── lib/
│   ├── ai/
│   │   ├── orchestrator.ts  # Agent routing
│   │   └── agents/          # 8 industry prompts
│   ├── supabase/            # Database clients
│   └── stripe/              # Payment utilities
├── supabase/migrations/     # Database schema
└── public/logo.svg          # New Penworth logo
```

---

## 🤖 AI Agent System

### Industries Supported

| Industry | Agent | Specializations |
|----------|-------|-----------------|
| Healthcare | HealthScribe | HIPAA-compliant medical content |
| Education | EduArchitect | Curriculum-aligned materials |
| Finance | FinanceForge | SEC-compliant documentation |
| Legal | LegalDraft | Contract drafting, compliance |
| Mining | ResourceDoc | JORC/NI 43-101 reports |
| Government | PolicyDraft | Policy documents |
| Technology | TechDoc | API docs, technical guides |
| Publishing | AuthorForge | Books, articles, creative |

### Model Routing

- **Opus** → Verification, Compliance (critical reasoning)
- **Sonnet** → Writing, Research, Review (standard tasks)
- **Haiku** → Formatting, Classification (fast tasks)

---

## 💳 Pricing Tiers

| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | 3 projects, 10k words/month |
| Pro | $29/mo | Unlimited projects, 100k words |
| Team | $49/user/mo | Organization features |
| Enterprise | Custom | SSO, SLA, dedicated support |

---

## 🔒 Security

- Row Level Security (RLS) on all tables
- JWT authentication via Supabase
- Tenant isolation for organizations
- No PII in AI prompts

---

## ⚠️ Legacy Migration Notes

If migrating users from legacy penworth.ai:

1. Export user data from legacy Supabase
2. Transform to new schema
3. Import to penworth-new-prod
4. Update DNS: redirect penworth.ai → new.penworth.ai
5. Decommission legacy after validation

---

## 📝 License

Proprietary — A.C.N. 675 668 710 PTY LTD

## 🆘 Support

- **Technical Issues**: Create GitHub issue
- **Business Inquiries**: info@penworth.ai

---

Built with ❤️ for the next generation of knowledge creation
