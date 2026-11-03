import { expect, newPage, signIn, test } from "./fixture";
import { database, expectFits, readDatabase } from "./imports";

const company = "40000000-0000-4000-8000-000000000001";
const agency = "20000000-0000-4000-8000-000000000001";
const manager = {
  userId: "10000000-0000-4000-8000-000000000003",
  email: "manager@browser.example.test",
};
const admin = {
  userId: "10000000-0000-4000-8000-0000000000d3",
  memberId: "50000000-0000-4000-8000-0000000000d3",
  email: "lost-admin@browser.example.test",
};
const outcome = "81000000-0000-4000-8000-0000000000d3";
const reason = "85000000-0000-4000-8000-0000000000d3";
const openStage = "80000000-0000-4000-8000-0000000000d3";
const lostStage = "80000000-0000-4000-8000-0000000000d4";
const managerMember = "50000000-0000-4000-8000-000000000001";
const lead = (n: number) => `77000000-0000-4000-8000-0000000000d${n}`;
const detail = (n: number) => `/browser-company/leads/${lead(n)}`;

test("a manager can keep trying or mark a suggested lead Lost", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected baseURL");
  await database(
    stack,
    `INSERT INTO users (id,email,name) VALUES
      ('${admin.userId}','${admin.email}','Lost Admin') ON CONFLICT DO NOTHING;
    INSERT INTO company_members (id,agency_id,company_id,user_id,name,role,status) VALUES
      ('${admin.memberId}','${agency}','${company}','${admin.userId}','Lost Admin','admin','active')
      ON CONFLICT (id) DO UPDATE SET status = 'active', deactivated_at = null;
    INSERT INTO stages (id,company_id,name,position,kind,is_default) VALUES
      ('${openStage}','${company}','Suggestion open',95,'open',false),
      ('${lostStage}','${company}','Suggestion lost',96,'lost',false)
      ON CONFLICT DO NOTHING;
    INSERT INTO outcomes (id,company_id,name,counts_as_failed,position) VALUES
      ('${outcome}','${company}','Could not reach',true,99) ON CONFLICT DO NOTHING;
    INSERT INTO lost_reasons (id,company_id,name,position) VALUES
      ('${reason}','${company}','No budget now',99) ON CONFLICT DO NOTHING;
    INSERT INTO scoring_configs (id,company_id,version,base_points,hot_min,warm_min,rules,active,created_by)
    SELECT '82000000-0000-4000-8000-0000000000d3','${company}',1,10,70,40,'[]',true,'${manager.userId}'
    WHERE NOT EXISTS (SELECT 1 FROM scoring_configs WHERE company_id = '${company}' AND active);
    INSERT INTO leads (id,company_id,full_name,phone_e164,phone_valid,source_kind,lead_date,stage_id,custom,score,priority,score_breakdown,scored_at,assigned_to,next_action_at,failed_attempts) VALUES
      ('${lead(1)}','${company}','Keep Calling','+9779841330011',true,'import',now(),'${openStage}','{}',10,'cold','{"base":10}',now(),'${admin.memberId}',now() - interval '2 hours',4),
      ('${lead(2)}','${company}','Mark Lost','+9779841330012',true,'import',now(),'${openStage}','{}',10,'cold','{"base":10}',now(),'${admin.memberId}',now() - interval '1 hour',4),
      ('${lead(3)}','${company}','Manager Only','+9779841330013',true,'import',now(),'${openStage}','{}',10,'cold','{"base":10}',now(),'${managerMember}',now() - interval '1 hour',0);`,
  );

  const seller = await newPage(browser, baseURL, testInfo);
  await signIn(seller, mailbox, admin.email);
  const call = async (n: number) => {
    await seller.goto(detail(n));
    await seller.getByRole("link", { name: "Log a call" }).click();
    const sheet = seller.getByRole("dialog", { name: "Log a call" });
    await sheet.getByRole("button", { name: "Could not reach" }).click();
    await sheet.getByRole("button", { name: "Save and next lead" }).click();
    await expect(sheet).toHaveCount(0);
  };
  await call(1);
  expect(
    await readDatabase(
      stack,
      `SELECT count(*) FROM notifications WHERE user_id = '${manager.userId}' AND type = 'lost_suggested' AND url = '${detail(1)}';`,
    ),
  ).toBe("1");
  expect(
    await readDatabase(
      stack,
      `SELECT s.kind FROM leads l JOIN stages s ON s.id = l.stage_id WHERE l.id = '${lead(1)}';`,
    ),
  ).toBe("open");
  await seller.goto(detail(1));
  await expect(
    seller.getByRole("region", { name: "Lost suggestion" }),
  ).toHaveCount(0);
  const denied = await seller.request.post(
    "/api/companies/browser-company/followups/logFollowUp",
    {
      headers: { origin: baseURL },
      data: {
        requestId: crypto.randomUUID(),
        leadId: lead(3),
        outcomeId: outcome,
      },
    },
  );
  expect(denied.status()).toBe(404);

  const reviewer = await newPage(browser, baseURL, testInfo);
  await signIn(reviewer, mailbox, manager.email);
  await reviewer.goto("/browser-company/notifications");
  await reviewer.locator(`a[href="${detail(1)}"]`).click();
  await expect(reviewer).toHaveURL(detail(1));
  const keep = reviewer.getByRole("region", { name: "Lost suggestion" });
  await expect(keep.getByText("5 failed attempts")).toBeVisible();
  await expectFits(reviewer, testInfo, "lost-suggestion-keep");
  await keep.getByRole("button", { name: "Keep trying" }).click();
  await expect(keep).toHaveCount(0);
  expect(
    await readDatabase(
      stack,
      `SELECT failed_attempts || '|' || (lost_suggested_at IS NULL)::text FROM leads WHERE id = '${lead(1)}';`,
    ),
  ).toBe("0|true");

  await call(2);
  await reviewer.goto("/browser-company/notifications");
  await reviewer.locator(`a[href="${detail(2)}"]`).click();
  const mark = reviewer.getByRole("region", { name: "Lost suggestion" });
  await expect(mark.getByText("5 failed attempts")).toBeVisible();
  await mark.getByRole("button", { name: "Mark as Lost" }).click();
  await expect(mark.getByText("Pick why it was lost")).toBeVisible();
  await mark.getByRole("button", { name: "No budget now" }).click();
  await mark.getByRole("button", { name: "Mark as Lost" }).click();
  await expect(mark).toHaveCount(0);
  await expectFits(reviewer, testInfo, "lost-suggestion-marked");
  expect(
    await readDatabase(
      stack,
      `SELECT s.kind || '|' || (l.lost_suggested_at IS NULL)::text
       FROM leads l JOIN stages s ON s.id = l.stage_id WHERE l.id = '${lead(2)}';`,
    ),
  ).toBe("lost|true");
  await seller.context().close();
  await reviewer.context().close();
});
