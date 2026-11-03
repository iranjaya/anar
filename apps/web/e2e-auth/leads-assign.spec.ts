import { expect, newPage, signIn, test } from "./fixture";
import { appAlert, database, expectFits } from "./imports";

const company = "40000000-0000-4000-8000-000000000001";
const agency = "20000000-0000-4000-8000-000000000001";
const managerId = "10000000-0000-4000-8000-000000000003";
const managerEmail = "manager@browser.example.test";
const seller = {
  userId: "10000000-0000-4000-8000-0000000000f6",
  memberId: "50000000-0000-4000-8000-0000000000f6",
  email: "assign-admin@browser.example.test",
};
const stage = "80000000-0000-4000-8000-0000000000f6";
const lead = (n: number) => `74000000-0000-4000-8000-00000000000${n}`;

test("a manager assigns a filtered selection, keeps it on failure, unassigns from the detail, and an Admin cannot assign", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected baseURL");
  await database(
    stack,
    `INSERT INTO users (id,email,name) VALUES ('${seller.userId}','${seller.email}','Assign Admin') ON CONFLICT DO NOTHING;
    INSERT INTO company_members (id,agency_id,company_id,user_id,name,role,status) VALUES
    ('${seller.memberId}','${agency}','${company}','${seller.userId}','Assign Admin','admin','active')
    ON CONFLICT (id) DO UPDATE SET status = 'active', deactivated_at = null;
    INSERT INTO stages (id,company_id,name,position,kind,is_default) VALUES
    ('${stage}','${company}','Assign new',95,'open',false) ON CONFLICT DO NOTHING;
    INSERT INTO scoring_configs (id,company_id,version,base_points,hot_min,warm_min,rules,active,created_by)
    SELECT '82000000-0000-4000-8000-000000000001','${company}',1,10,70,40,'[]',true,'${managerId}'
    WHERE NOT EXISTS (SELECT 1 FROM scoring_configs WHERE company_id = '${company}' AND active);
    DELETE FROM notifications WHERE user_id = '${seller.userId}';
    DELETE FROM lead_events WHERE lead_id IN ('${lead(1)}','${lead(2)}','${lead(3)}','${lead(4)}');
    DELETE FROM leads WHERE id IN ('${lead(1)}','${lead(2)}','${lead(3)}','${lead(4)}');
    INSERT INTO leads (id,company_id,full_name,phone_valid,source_kind,lead_date,stage_id,custom,score,priority,score_breakdown,scored_at) VALUES
    ('${lead(1)}','${company}','Assign Lead One',false,'import','2026-10-24T06:00:00Z','${stage}','{}',10,'cold','{"base":10}',now()),
    ('${lead(2)}','${company}','Assign Lead Two',false,'import','2026-10-24T06:00:00Z','${stage}','{}',10,'cold','{"base":10}',now()),
    ('${lead(3)}','${company}','Assign Lead Three',false,'import','2026-10-24T06:00:00Z','${stage}','{}',10,'cold','{"base":10}',now()),
    ('${lead(4)}','${company}','Other Unassigned',false,'import','2026-10-24T06:00:00Z','${stage}','{}',10,'cold','{"base":10}',now());`,
  );

  const page = await newPage(browser, baseURL, testInfo);
  await signIn(page, mailbox, managerEmail);
  await page.goto("/browser-company/leads?q=Assign+Lead");
  const table = page.getByRole("table", { name: "Unassigned leads" });
  await expect(table.locator("tbody tr")).toHaveCount(3);
  const panel = page.getByRole("region", { name: "Assign leads" });
  await page.getByLabel(/Select all 3 shown/).check();
  await panel.getByLabel("Assign to").selectOption({ label: "Assign Admin" });
  await expectFits(page, testInfo, "leads-assign-picked");

  await database(
    stack,
    `UPDATE company_members SET status = 'deactivated', deactivated_at = now() WHERE id = '${seller.memberId}';`,
  );
  await panel.getByRole("button", { name: "Assign 3 leads" }).click();
  await expect(appAlert(page)).toHaveText("Choose an active member");
  await expect(panel.getByText("3 selected")).toBeVisible();
  await expect(panel.getByLabel("Assign to")).toHaveValue(seller.memberId);

  await database(
    stack,
    `UPDATE company_members SET status = 'active', deactivated_at = null WHERE id = '${seller.memberId}';`,
  );
  await panel.getByRole("button", { name: "Assign 3 leads" }).click();
  await expect(
    page.getByText("3 leads assigned to Assign Admin."),
  ).toBeVisible();
  await page.goto("/browser-company/leads");
  await expect(page.getByText("Assign Lead One")).toHaveCount(0);
  await expect(page.getByText("Other Unassigned")).toBeVisible();

  await page.goto(`/browser-company/leads/${lead(1)}`);
  const owner = page.getByRole("region", { name: "Assign lead" });
  await expect(owner.getByLabel("Owner")).toHaveValue(seller.memberId);
  await owner.getByLabel("Owner").selectOption({ label: "Unassigned" });
  await owner.getByRole("button", { name: "Save owner" }).click();
  await expect(
    page
      .getByRole("region", { name: "Timeline" })
      .getByRole("heading", { name: "Lead unassigned" }),
  ).toBeVisible();
  await expect(owner.getByLabel("Owner")).toHaveValue("unassign");
  await expectFits(page, testInfo, "leads-assign-detail");

  const admin = await newPage(browser, baseURL, testInfo);
  await signIn(admin, mailbox, seller.email);
  await admin.goto("/browser-company/leads");
  await expect(
    admin.getByRole("heading", { name: "My leads", level: 1 }),
  ).toBeVisible();
  await expect(admin.getByText("Your manager assigns leads.")).toBeVisible();
  await expect(admin.getByText("Assign Lead Two")).toBeVisible();
  const refused = await admin.request.post(
    "/api/companies/browser-company/leads/assignLeads",
    {
      headers: { origin: baseURL },
      data: { leadIds: [lead(4)], memberId: seller.memberId },
    },
  );
  expect(refused.status()).toBe(403);
  await admin.goto(`/browser-company/leads/${lead(2)}`);
  await expect(admin.getByRole("region", { name: "Assign lead" })).toHaveCount(
    0,
  );
  await expectFits(admin, testInfo, "leads-assign-admin");
});
