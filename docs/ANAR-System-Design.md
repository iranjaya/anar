# Anar — Lead Management System

**Date:** 2026-10-27
**For:** DNA Digital Marketing Agency

---

## 1. Product Overview

Anar is a lead management system built for digital marketing agencies that run Meta ads, events, and web campaigns for multiple client companies. It replaces the spreadsheet-based workflow where leads are manually entered, tracked, and reported on per sales person.

**The problem today:**
- Leads from Facebook/Instagram CSVs are manually copied into Excel trackers
- Each sales person has their own spreadsheet (like Sarina's tracker)
- No real-time visibility — Super Admins must open each file to see progress
- Data grows, companies grow, and spreadsheets break
- Risk of one company's data leaking to another

**What Anar does:**
- One system per company with strict data isolation — Company A never sees Company B
- Upload Facebook/Instagram lead CSVs with any column structure (dynamic fields)
- Auto-assign or manually distribute leads to sales admins
- Track follow-ups, pipeline stages, lead scoring — everything the Excel tracker does, but live
- Real-time dashboards and daily/weekly reports for Super Admins
- Each Admin sees only their own leads and performance

---

## 2. Business Model

DNA (the agency) sets up Anar for each client company. Each company is a completely separate workspace. This is part of DNA's service offering — not a separate paid product.

**How it works:**

1. DNA signs a new client (e.g., Soaltee City, a real estate company)
2. DNA creates a new Company in Anar with its own isolated workspace
3. DNA assigns 1-2 Super Admins (managers) for that company
4. Super Admin creates Admin accounts (sales staff like Sarina)
5. DNA uploads Facebook/Instagram lead CSVs into that company's workspace
6. Super Admin distributes leads to Admins
7. Admins work their leads — call, follow up, update status
8. Super Admin monitors performance via dashboard and reports

**Key principle:** Each company is isolated. Soaltee City's workspace has zero connection to any other client's workspace. Different companies can have completely different lead form fields.

**Who manages what:**

| Action | Who does it |
| --- | --- |
| Create a new company workspace | DNA (platform owner) |
| Upload lead CSVs | DNA |
| Assign Super Admins | DNA |
| Create Admin accounts | Super Admin |
| Distribute leads to Admins | Super Admin |
| Work leads (call, follow up) | Admin |
| View all reports | Super Admin |
| View own reports only | Admin |

---

## 3. User Roles & Permissions

Three roles, each with strict access boundaries:

### Platform Owner (DNA)
- Master login to manage all companies
- Creates and manages company workspaces
- Can access any company's data for support
- Uploads lead CSVs on behalf of companies
- Assigns Super Admins to companies

### Super Admin (Manager — 1-2 per company)
- Full visibility of all leads in their company
- Creates and manages Admin accounts
- Assigns/reassigns leads to Admins
- Views all Admin performance reports
- Configures lead pipeline stages and custom fields
- Exports data and generates reports (daily, weekly)
- Cannot see any other company's data

### Admin (Sales staff like Sarina)
- Sees only leads assigned to them
- Updates lead status, logs follow-ups, adds notes
- Views only their own performance dashboard
- Cannot create other users or change settings
- Cannot see leads assigned to other Admins

**Access matrix:**

| Feature | DNA | Super Admin | Admin |
| --- | --- | --- | --- |
| Create company | Yes | No | No |
| Upload CSV leads | Yes | No | No |
| Create users | Yes (Super Admin) | Yes (Admin) | No |
| Assign leads | Yes | Yes | No |
| View all leads | Yes | Yes | No (own only) |
| Update lead status | Yes | Yes | Yes (own only) |
| View all reports | Yes | Yes | No |
| View own report | Yes | Yes | Yes |
| Export data | Yes | Yes | No |
| Configure pipeline/fields | Yes | Yes | No |

---

## 4. Core Features

### 4.1 CSV Upload with Dynamic Field Mapping
- Upload any Facebook/Instagram lead export CSV
- System auto-detects columns from the CSV header
- Map CSV columns to system fields (name, phone, email) and keep the rest as custom fields
- **Create new fields on the fly during upload** — if a new campaign has a question that didn't exist before, DNA creates it right there
- Save mapping templates per campaign so repeated uploads are one-click
- Auto-detect duplicates by phone number before importing
- Support for different encodings (UTF-8, UTF-16 like Meta exports)
- Show import summary: "45 new leads imported, 3 duplicates skipped"

### 4.2 Dynamic Fields (Not Fixed Per Campaign)

**Fixed fields (always present):**
- Full name
- Phone number
- Email
- Lead source (Facebook, Instagram, Event — auto-detected from CSV if present, empty if not)
- Lead date
- Campaign name
- Assigned to (Admin)

**Custom fields (DNA sets up per company + creates on the fly during upload):**

Field types:
- Dropdown (predefined options)
- Text (free text)
- Number
- Date

Examples by industry:

| Industry | Custom fields |
| --- | --- |
| Real Estate (Soaltee) | Apartment type, Purchase timeline, Purpose, Budget |
| College | Course interest, Intake year, Qualification, Location |
| Auto/Bike | Model interest, Budget range, Trade-in, Test drive date |
| Events | Event name, Ticket type, Group size |

Custom fields are stored as key-value pairs per lead. The system never needs schema changes when a new campaign has new questions.

**Display rule:** Only show fields that have data for that lead (no empty fields cluttering the screen).

### 4.3 Lead Management
- Lead list view with search by name or phone number
- Filter by: status, source, assigned admin, date range, priority, any custom field
- Bulk actions: assign, change status, export
- Lead detail view with full history timeline
- Duplicate detection and merge by phone number

### 4.4 Lead Assignment & Distribution
- Super Admin assigns leads to Admins manually or in bulk
- Reassign leads between Admins anytime (e.g., staff is sick or leaves)
- Unassigned leads queue visible to Super Admin

### 4.5 Follow-up Tracking
- Unlimited follow-ups per lead (not limited to 4 like the Excel tracker)
- Each follow-up logs: date, outcome, notes
- Follow-up outcomes (configurable per company):
  - Connected - Low Interest
  - Connected - High Interest
  - Not Interested
  - No Answer
  - Callback Requested
  - Budget Discussion
  - Site Visit Done
  - Site Visit Scheduled
  - Negotiation Started
  - Document Submitted
- Next action date with overdue alerts
- Activity timeline showing every touch point
- **Auto-suggest Lost after 5 failed attempts** (Super Admin can override)

### 4.6 Lead Scoring (Auto-calculated)

Scoring rules (configurable per company):
- Timeline: <15 days = 4 pts, 15-30 days = 3 pts, 1-3 months = 2 pts, 3+ months = 1 pt
- Budget Fit: Yes = 3 pts, Maybe = 2 pts
- Decision Maker: Yes = 2 pts, Shared = 1 pt
- Base score = 1 pt

Priority labels:
- **Hot:** 8+ points
- **Warm:** 5-7 points
- **Cold:** Below 5 points

### 4.7 Notifications (Push)
- Overdue follow-up alerts
- New lead assignment notifications
- Daily summary for Admins (leads due today, overdue, new)
- Weekly summary for Super Admins

### 4.8 Data Export
- Super Admin can download all data anytime (CSV/Excel)
- Filter before export (by date, status, admin, source)

---

## 5. Lead Pipeline & Stages

Default pipeline (from Soaltee tracker). Super Admin can rename, add, or remove stages per company.

**Default stages:**

1. **New Lead** — just imported, not yet contacted
2. **Contacted** — first call made, waiting for outcome
3. **Qualified** — budget, timeline, and decision maker confirmed
4. **Follow-up** — in active follow-up cycle
5. **Site Visit** — site visit scheduled or completed
6. **Negotiation** — pricing/terms discussion
7. **Booked** — deal closed (stays visible in the list, just marked as Booked)
8. **Lost** — deal lost (with reason logged)

**Lost reasons (configurable):**
- Too Expensive
- Wrong Location
- Bought from Competitor
- Not Responding
- Not Genuine Lead
- Changed Mind
- Other

---

## 6. Dashboard & Reporting

### Super Admin — 3 Views

**View 1: Team Overview (all Admins at a glance)**
- Total leads, new today, calls made, site visits, bookings
- Overdue follow-ups per Admin
- Hot/Warm/Cold breakdown
- Pipeline funnel (New to Booked to Lost)
- Leads by source (Facebook, Instagram, Events)

**View 2: Individual Admin Detail (tap any Admin)**
- Their full dashboard (same as what Admin sees)
- Their leads list, follow-up history
- Target vs actual performance

**View 3: Comparison (pick any 2 Admins side by side)**
- Calls made, response time, site visits, bookings, conversion rate
- See who's performing and where the gap is

### Admin Dashboard — "My Leads Today"

Three clear sections on login:
1. **Overdue** (red) — leads they should have called but didn't
2. **Due Today** (yellow) — leads to call today
3. **New Leads** (blue) — fresh leads just assigned

### Targets & KPIs (configurable per Admin)
- Calls per day/week
- Site visits per week/month
- Bookings per month
- More target types can be added during development

---

## 7. Daily Operational Workflow

### DNA (daily morning)
1. Download CSV from Facebook Ads Manager
2. Open Anar master panel → select company → upload CSV
3. System maps fields (saved from first time) → leads imported
4. Done.

### Super Admin (Manager)
1. Sees new unassigned leads
2. Assigns to Admins (bulk or one by one)
3. Monitors all Admins' performance from dashboard
4. Checks overdue follow-ups, stale leads
5. Pulls daily/weekly reports
6. Compares 2 Admins side by side when needed

### Admin (Staff — phone-first workflow)
1. Opens Anar on phone
2. Sees three buckets: Overdue / Due Today / New
3. Taps a lead → sees all info (only fields with data)
4. Taps **Call button** → phone dialer opens with number (click-to-call)
5. After call → quick form:
   - What happened? (dropdown)
   - Notes (free text)
   - Next follow-up date
   - Stage change (if any)
6. Done. Move to next lead.
7. When lead visits site → marks "Site Visit Done" with notes
8. When lead books → marks "Booked"
9. Each Admin owns their leads end-to-end — from first call to booked/lost

---

## 8. Technical Decisions

| Decision | Choice |
| --- | --- |
| Platform | Web app (phone-first responsive UI) |
| Language | English |
| Authentication | Email invitation + OTP on email |
| Session | Stay logged in for 30 days (auto-logout after 30 days of no use) |
| Branding | Anar only (no white-label per company for now) |
| Hosting | Self-hosted on server |
| CSV upload | Manual daily upload by DNA (auto-sync from Facebook API planned for future) |
| Duplicate detection | By phone number |
| Data isolation | Strict per company — no cross-company data access |
| Lead entry | DNA uploads all leads (no manual entry by Admin) |
| Booked leads | Stay visible in the list |
| Phone calling | Click-to-call (tel: link opens phone dialer) |
| Update timing | Admin updates immediately after each call |

---

## 9. Open Questions (To Decide During Development)

1. **Tech stack** — Next.js + PostgreSQL? Or another stack?
2. **Hosting details** — Same server as Ekata or separate?
3. **Push notification service** — OneSignal, Firebase, or other?
4. **Email service for OTP** — SendGrid, AWS SES, or other?
5. **Scheduled reports** — Auto-email daily/weekly reports, or Super Admin pulls manually?
6. **Admin manual lead entry** — Currently DNA-only. Will Admins need to add walk-in/event leads later?
7. **Additional target types** — To be defined during development
8. **Mobile app vs PWA** — PWA (like Ekata) or native app?
9. **Facebook API auto-sync** — Planned for future. Timeline TBD.

---

*This document captures all brainstorming decisions as of 2026-10-27. To be updated as development progresses.*
