import { expect, newPage, signIn, test } from "./fixture";
import { database, expectFits } from "./imports";

const company = "40000000-0000-4000-8000-000000000001";
const agency = "20000000-0000-4000-8000-000000000001";
const managerId = "10000000-0000-4000-8000-000000000003";
const managerEmail = "manager@browser.example.test";
const seller = {
  userId: "10000000-0000-4000-8000-0000000000f2",
  memberId: "50000000-0000-4000-8000-0000000000f2",
  email: "detail-admin@browser.example.test",
};
const stage = "80000000-0000-4000-8000-0000000000f2";
const good = "71000000-0000-4000-8000-000000000001";
const bad = "71000000-0000-4000-8000-000000000002";
const page = (id: string) => `/browser-company/leads/${id}`;

test("a lead shows its stored score, filled facts and import history, and stays hidden from other Admins", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected baseURL");
  await database(
    stack,
    `INSERT INTO users (id,email,name) VALUES ('${seller.userId}','${seller.email}','Detail Admin') ON CONFLICT DO NOTHING;
    INSERT INTO company_members (id,agency_id,company_id,user_id,name,role,status) VALUES
    ('${seller.memberId}','${agency}','${company}','${seller.userId}','Detail Admin','admin','active') ON CONFLICT DO NOTHING;
    INSERT INTO stages (id,company_id,name,position,kind,is_default) VALUES
    ('${stage}','${company}','Detail new',91,'open',false) ON CONFLICT DO NOTHING;
    INSERT INTO fields (id,company_id,key,label,type,options,is_system,position) VALUES
    ('81000000-0000-4000-8000-000000000001','${company}','unit_type','Unit','dropdown','[{"value":"2bhk","label":"2 BHK"}]',false,90) ON CONFLICT DO NOTHING;
    INSERT INTO scoring_configs (id,company_id,version,base_points,hot_min,warm_min,rules,active,created_by)
    SELECT '82000000-0000-4000-8000-000000000001','${company}',1,10,70,40,'[]',true,'${managerId}'
    WHERE NOT EXISTS (SELECT 1 FROM scoring_configs WHERE company_id = '${company}' AND active);
    DELETE FROM lead_events WHERE lead_id IN ('${good}','${bad}');
    DELETE FROM leads WHERE id IN ('${good}','${bad}');
    INSERT INTO leads (id,company_id,full_name,phone_e164,phone_raw,phone_valid,source,source_kind,lead_date,campaign_name,stage_id,custom,score,priority,score_breakdown,scored_at) VALUES
    ('${good}','${company}','Detail Lead','+9779841000099','9841000099',true,'facebook','import','2026-10-20T06:00:00Z','Spring open house','${stage}','{"unit_type":"2bhk"}',40,'warm','{"base":10,"unit_type":30}',now()),
    ('${bad}','${company}','Bad Phone Lead',null,'98-bad',false,'instagram','import','2026-10-21T06:00:00Z',null,'${stage}','{}',10,'cold','{"base":10}',now());
    INSERT INTO lead_events (id,company_id,lead_id,type,actor_user_id,data,created_at) VALUES
    ('83000000-0000-4000-8000-000000000001','${company}','${good}','imported','${managerId}','{"batchId":"84000000-0000-4000-8000-000000000001","rowNo":1}','2026-10-20T06:00:00Z'),
    ('83000000-0000-4000-8000-000000000002','${company}','${good}','duplicate_import','${managerId}','{"batchId":"84000000-0000-4000-8000-000000000002","rowNo":4,"campaignName":"Autumn","leadDate":"2026-10-25T06:00:00.000Z"}','2026-10-25T06:00:00Z');`,
  );

  const manager = await newPage(browser, baseURL, testInfo);
  await signIn(manager, mailbox, managerEmail);
  await manager.goto(page(good));
  await expect(
    manager.getByRole("heading", { name: "Detail Lead", level: 1 }),
  ).toBeVisible();
  const call = manager
    .locator('section[aria-label="Lead detail"] > header')
    .getByRole("link", { name: "Call", exact: true });
  await expect(call).toHaveAttribute("href", "tel:+9779841000099");
  await expect(manager.getByRole("link", { name: "WhatsApp" })).toBeVisible();
  await expect(manager.getByRole("link", { name: "Email" })).toHaveCount(0);
  await expect(manager.getByRole("link", { name: "Log a call" })).toBeVisible();

  const facts = manager.getByRole("region", { name: "Lead facts" });
  await expect(facts.getByText("Spring open house")).toBeVisible();
  await expect(facts.getByText("Email", { exact: true })).toHaveCount(0);
  await expect(facts.getByText("Form", { exact: true })).toHaveCount(0);
  const answers = manager.getByRole("region", { name: "Form answers" });
  await expect(answers.getByText("2 BHK")).toBeVisible();

  await manager.getByText("Why this score").click();
  await expect(manager.getByText("Base score")).toBeVisible();
  await expect(manager.getByText("30 pts")).toBeVisible();

  const timeline = manager.getByRole("region", { name: "Timeline" });
  await expect(timeline.getByRole("heading", { level: 3 })).toHaveText([
    "Imported again",
    "Lead imported",
  ]);
  await expectFits(manager, testInfo, "lead-detail");

  await manager.goto(page(bad));
  await expect(
    manager.getByRole("heading", { name: "Bad Phone Lead", level: 1 }),
  ).toBeVisible();
  await expect(manager.getByText("Phone needs review")).toBeVisible();
  await expect(
    manager
      .locator('section[aria-label="Lead detail"] > header')
      .getByRole("link", { name: "Call", exact: true }),
  ).toHaveCount(0);
  await expect(manager.getByRole("link", { name: "WhatsApp" })).toHaveCount(0);
  await expect(manager.getByText("98-bad")).toBeVisible();
  await expectFits(manager, testInfo, "lead-detail-bad-phone");

  await database(
    stack,
    `UPDATE scoring_configs SET active = false WHERE company_id = '${company}';`,
  );
  try {
    await manager.goto(page(good));
    await expect(manager.getByRole("alert").first()).toBeVisible();
    await expect(
      manager.getByRole("heading", { name: "Detail Lead" }),
    ).toHaveCount(0);
  } finally {
    await database(
      stack,
      `UPDATE scoring_configs SET active = true WHERE id = '82000000-0000-4000-8000-000000000001';`,
    );
  }

  const admin = await newPage(browser, baseURL, testInfo);
  await signIn(admin, mailbox, seller.email);
  const response = await admin.goto(page(good));
  expect(response?.status()).toBe(404);
  await expect(admin.getByText("Detail Lead")).toHaveCount(0);
  await expectFits(admin, testInfo, "lead-detail-hidden");
});
