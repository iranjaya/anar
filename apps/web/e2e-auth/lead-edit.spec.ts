import { expect, newPage, signIn, test } from "./fixture";
import { appAlert, database, expectFits } from "./imports";

const company = "40000000-0000-4000-8000-000000000001";
const managerId = "10000000-0000-4000-8000-000000000003";
const managerEmail = "manager@browser.example.test";
const stage = "80000000-0000-4000-8000-0000000000f3";
const lead = "72000000-0000-4000-8000-000000000001";
const taken = "72000000-0000-4000-8000-000000000002";
const rules = JSON.stringify([
  {
    fieldKey: "unit_type",
    kind: "options",
    points: { "2bhk": 20, "3bhk": 70 },
  },
]);

test("repairing a phone enables Call, a new answer moves the score, and a taken phone keeps the draft", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected baseURL");
  await database(
    stack,
    `INSERT INTO stages (id,company_id,name,position,kind,is_default) VALUES
    ('${stage}','${company}','Edit new',92,'open',false) ON CONFLICT DO NOTHING;
    INSERT INTO fields (id,company_id,key,label,type,options,is_system,position) VALUES
    ('81000000-0000-4000-8000-000000000001','${company}','unit_type','Unit','dropdown','[{"value":"2bhk","label":"2 BHK"},{"value":"3bhk","label":"3 BHK"}]',false,90)
    ON CONFLICT (id) DO UPDATE SET options = EXCLUDED.options;
    INSERT INTO scoring_configs (id,company_id,version,base_points,hot_min,warm_min,rules,active,created_by)
    SELECT '82000000-0000-4000-8000-000000000001','${company}',1,10,70,40,'[]',true,'${managerId}'
    WHERE NOT EXISTS (SELECT 1 FROM scoring_configs WHERE company_id = '${company}' AND active);
    UPDATE scoring_configs SET rules = '${rules}', base_points = 10, warm_min = 40, hot_min = 70
    WHERE company_id = '${company}' AND active;
    DELETE FROM lead_events WHERE lead_id IN ('${lead}','${taken}');
    DELETE FROM leads WHERE id IN ('${lead}','${taken}');
    INSERT INTO leads (id,company_id,full_name,phone_e164,phone_raw,phone_valid,source_kind,lead_date,stage_id,custom,score,priority,score_breakdown,scored_at) VALUES
    ('${lead}','${company}','Edit Lead',null,'98-bad',false,'import','2026-10-22T06:00:00Z','${stage}','{}',10,'cold','{"base":10}',now()),
    ('${taken}','${company}','Taken Phone Lead','+9779841000088','9841000088',true,'import','2026-10-22T06:00:00Z','${stage}','{}',10,'cold','{"base":10}',now());`,
  );

  const page = await newPage(browser, baseURL, testInfo);
  await signIn(page, mailbox, managerEmail);
  await page.goto(`/browser-company/leads/${lead}`);
  await expect(page.getByText("Phone needs review")).toBeVisible();
  await expect(page.getByText("Cold · 10")).toBeVisible();

  await page.getByText("Edit details").click();
  const phone = page.getByLabel("Phone", { exact: true });
  await phone.fill("9841000077");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page
      .locator('section[aria-label="Lead detail"] > header')
      .getByRole("link", { name: "Call", exact: true }),
  ).toHaveAttribute("href", "tel:+9779841000077");
  await expect(page.getByText("Phone needs review")).toHaveCount(0);

  await page.getByLabel("Unit", { exact: true }).selectOption("3bhk");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Hot · 80")).toBeVisible();
  await page.getByText("Why Hot").click();
  await expect(page.getByText("70 pts")).toBeVisible();
  await expectFits(page, testInfo, "lead-edit-saved");

  await page.getByLabel("Name", { exact: true }).fill("Draft Name");
  await phone.fill("9841000088");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(appAlert(page)).toHaveText(
    "Another lead already has this phone",
  );
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Draft Name",
  );
  await expect(phone).toHaveValue("9841000088");
  await expect(
    page.getByRole("heading", { name: "Edit Lead", level: 1 }),
  ).toBeVisible();
  await expectFits(page, testInfo, "lead-edit-conflict");
});
