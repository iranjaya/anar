import { expect, newPage, signIn, test } from "./fixture";
import { database, expectFits } from "./imports";

const company = "40000000-0000-4000-8000-000000000001";
const agency = "20000000-0000-4000-8000-000000000001";
const managerEmail = "manager@browser.example.test";
const seller = {
  userId: "10000000-0000-4000-8000-0000000000f7",
  memberId: "50000000-0000-4000-8000-0000000000f7",
  email: "queue-admin@browser.example.test",
};
const stage = "80000000-0000-4000-8000-0000000000f1";
const queue = "/browser-company/leads";

function lead(n: number, assignedTo: string | null) {
  const nn = String(n).padStart(2, "0");
  const priority = ["hot", "warm", "cold"][n % 3];
  const owner = assignedTo ? `'${assignedTo}'` : "null";
  const day = String(((n - 1) % 28) + 1).padStart(2, "0");
  return `('70000000-0000-4000-8000-0000000000${nn}','Queue Lead ${nn}','+97798410000${nn}',${owner},'${priority}','2026-10-${day}T06:00:00Z')`;
}

test("the lead queue pages, searches and filters real leads, and an Admin sees only their own", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected baseURL");
  const rows = [
    ...Array.from({ length: 55 }, (_, n) => lead(n + 1, null)),
    lead(60, seller.memberId),
  ];
  await database(
    stack,
    `INSERT INTO users (id,email,name) VALUES ('${seller.userId}','${seller.email}','Queue Admin') ON CONFLICT DO NOTHING;
    INSERT INTO company_members (id,agency_id,company_id,user_id,name,role,status) VALUES
    ('${seller.memberId}','${agency}','${company}','${seller.userId}','Queue Admin','admin','active') ON CONFLICT DO NOTHING;
    INSERT INTO stages (id,company_id,name,position,kind,is_default) VALUES
    ('${stage}','${company}','Queue new',90,'open',false) ON CONFLICT DO NOTHING;
    DELETE FROM lead_events WHERE company_id = '${company}';
    DELETE FROM leads WHERE company_id = '${company}';
    INSERT INTO leads (id,company_id,full_name,phone_e164,assigned_to,priority,lead_date,phone_valid,source_kind,stage_id,custom,score,score_breakdown,scored_at)
    SELECT v.id::uuid, '${company}', v.name, v.phone, v.owner::uuid, v.priority, v.at::timestamptz, true, 'import', '${stage}', '{}', 10, '{}', now()
    FROM (VALUES ${rows.join(",")}) AS v(id,name,phone,owner,priority,at);`,
  );

  const page = await newPage(browser, baseURL, testInfo);
  await signIn(page, mailbox, managerEmail);
  await page.goto(queue);
  const table = page.getByRole("table", { name: "Unassigned leads" });
  await expect(
    page.getByRole("heading", { name: "Unassigned leads", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("55 unassigned leads")).toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(50);
  await expect(page.getByText("Queue Lead 60")).toHaveCount(0);
  const assign = page.getByRole("region", { name: "Assign leads" });
  await expect(assign.getByText("Select leads to assign")).toBeVisible();
  await expect(assign.getByRole("button")).toBeDisabled();
  await expectFits(page, testInfo, "leads-queue");

  await page.getByRole("link", { name: "Next 50 leads" }).click();
  await expect(table.locator("tbody tr")).toHaveCount(5);
  await page.reload();
  await expect(table.locator("tbody tr")).toHaveCount(5);

  await page.goto(queue);
  const search = page.getByLabel("Search leads");
  await search.fill("queue lead 07");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/q=queue\+lead\+07/);
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.getByText("Queue Lead 07")).toBeVisible();

  await search.fill("9841000012");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.getByText("Queue Lead 12")).toBeVisible();

  await search.fill("nobody here");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No leads match" }),
  ).toBeVisible();
  await expect(page.getByText("55 unassigned leads")).toBeVisible();

  await search.fill("");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Hot", exact: true }).click();
  await expect(page).toHaveURL(/priority=hot/);
  await expect(table.locator("tbody tr")).toHaveCount(18);
  await expectFits(page, testInfo, "leads-queue-hot");

  const admin = await newPage(browser, baseURL, testInfo);
  await signIn(admin, mailbox, seller.email);
  await admin.goto(queue);
  await expect(
    admin.getByRole("heading", { name: "My leads", level: 1 }),
  ).toBeVisible();
  await expect(admin.getByText("1 leads assigned to you")).toBeVisible();
  await expect(admin.getByText("Queue Lead 60")).toBeVisible();
  await expect(admin.getByText("Queue Lead 01")).toHaveCount(0);
  await expect(admin.getByText("Your manager assigns leads.")).toBeVisible();
  const refused = await admin.request.get(
    "/api/companies/browser-company/leads/listLeads?assignedTo=unassigned",
  );
  expect(refused.status()).toBe(403);
  await expectFits(admin, testInfo, "leads-mine");

  await database(
    stack,
    `DELETE FROM leads WHERE company_id = '${company}' AND assigned_to IS NULL;`,
  );
  await page.goto(queue);
  await expect(
    page.getByRole("heading", { name: "No unassigned leads" }),
  ).toBeVisible();
  await expect(page.getByText("0 unassigned leads")).toBeVisible();
});
