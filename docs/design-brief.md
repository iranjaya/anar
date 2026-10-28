# Anar: design brief for 4 screens

## What Anar is

Anar is a lead tracker for real estate and other sales teams. A marketing agency runs Facebook and Instagram ad campaigns for client companies, downloads the leads every morning as a CSV and uploads them into Anar. Each company's managers hand the leads to their sales staff, and the sales staff call them and log every call. It replaces one Excel sheet per salesperson.

Three roles:

- **Agency (DNA):** sets up companies and uploads the daily CSV.
- **Super Admin:** the company's sales manager, 1 or 2 per company. Sees all leads, assigns them, watches the team.
- **Admin:** a salesperson. Sees only their own leads. Works almost only on a phone, between calls, often outdoors.

## What I want

Clickable mockups of 4 screens. Phone first (390 px wide) for all four. Screens 3 and 4 also need a desktop layout (1440 px), since managers and the agency use them at a desk.

Style: clean, calm, fast to read. Big tap targets, one-hand use, thumb-reachable main actions. Clear colours for Hot, Warm and Cold, and red for overdue. Works in bright sunlight, so strong contrast. English only. App name is Anar, no other branding. Light theme first, a dark version is a bonus.

Use made-up sample data (Nepali names, +977 numbers, Kathmandu time). No real people.

## The lead data

Each lead has: full name, phone, email, job title, platform (Facebook or Instagram), campaign name, lead date, assigned salesperson, stage, score (Hot, Warm, Cold), next follow-up date.

Plus the answers from the ad form, for example:

- Apartment: 1 BHK, 2 BHK, 3 BHK, Not sure yet
- Buying when: Within 1 month, Within 2 months, Within 3 months, Just exploring
- Purpose: For myself or family, Investment, Both, Just exploring

Stages: New Lead, Contacted, Qualified, Follow-up, Site Visit, Negotiation, Booked, Lost. Lost needs a reason: Too Expensive, Wrong Location, Bought from Competitor, Not Responding, Not Genuine Lead, Changed Mind, Other.

Call outcomes: Connected - High Interest, Connected - Low Interest, Not Interested, No Answer, Callback Requested, Budget Discussion, Site Visit Scheduled, Site Visit Done, Negotiation Started, Document Submitted.

## Screen 1: My Leads Today (salesperson, phone)

The first screen after login. It answers one question: who do I call now?

- Three sections in this order: **Overdue** (red, count in the header), **Due Today**, **New** (just assigned, never called).
- Each lead row: name, score badge, stage, apartment and buying-when answers in short form, how overdue or when due, and a big **Call** button right on the row.
- Search by name or phone at the top. A simple filter for score and stage.
- A small strip on top with today's progress against target, e.g. "12 of 30 calls today".
- Empty state for a good day: nothing overdue.

## Screen 2: Lead detail and call log (salesperson, phone)

Opened by tapping a lead. The salesperson calls from here and logs the result right after the call, in under 15 seconds.

- Top: name, score badge, stage, a big Call button (opens the phone dialer), WhatsApp and email buttons.
- Lead facts: phone, email, job title, platform, campaign, lead date, and the form answers.
- **Log a call** sheet, opening from the bottom after a call: outcome (one tap from the list), short note, next follow-up date (quick picks: Tomorrow, 3 days, 1 week, or pick a date), and stage change. Choosing Lost asks for the reason.
- Timeline below: every call with date, outcome and note, plus stage changes and when it was assigned, newest first.
- After 5 failed calls (No Answer, Not Interested, Callback Requested), a soft banner suggests marking the lead Lost. The salesperson can dismiss it.
- Show how the score was worked out, e.g. "Hot, 9 points: buying within 1 month 4, budget fit 3, decision maker 2".

## Screen 3: CSV import and column mapping (agency, phone and desktop)

The agency uploads the daily Facebook CSV for one company. The second upload with the same columns should be one tap, since the saved mapping applies itself.

- Step 1: pick the company, drop or pick the file. Show the file name, row count and date range found.
- Step 2: mapping. A row per CSV column: column name as it is in the file (e.g. "which_apartment_are_you_planning_to_purchase?"), three sample values, and where it goes: a fixed field (Name, Phone, Email, Campaign, Platform, Lead date), a custom field (new or existing, type dropdown, text, number or date), or Skip. If a saved mapping matches, it is already filled in with a "Saved mapping applied" note, and new or missing columns are highlighted.
- For dropdown answers, show the codes from the file and their labels, e.g. "2_bhk" shows as "2 BHK".
- Step 3: summary before import: rows to add, duplicates (same phone as an existing lead or another row), invalid rows (bad phone) with the reason. Button to import.
- Step 4: result: added, duplicates skipped (each links to the existing lead), failed rows downloadable. The new leads go to the Unassigned queue.

## Screen 4: Manager dashboard (Super Admin, phone and desktop)

The manager sees how the team is doing today and this week, and who needs a push.

- Top numbers: new leads today, unassigned leads (tap to assign), overdue follow-ups, site visits this week, bookings this month.
- Funnel by stage: how many leads in each stage.
- Team table: one row per salesperson with leads held, calls today against target, overdue count, site visits, bookings, and Hot leads not called in 2 days. Sort by any column. Overdue in red.
- Tap a salesperson to see their detail. A "Compare" control to put two salespeople side by side.
- Date range switch: Today, This week, This month, Custom.
- Unassigned queue entry: select many leads and assign them to one salesperson in one go.

## Out of scope

Login, settings, user management, pipeline and field settings, export screens. Do not design those now.
