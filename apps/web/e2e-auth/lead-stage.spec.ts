import { expect, newPage, signIn, test } from "./fixture";
import { appAlert, database, expectFits } from "./imports";

const company = "40000000-0000-4000-8000-000000000001";
const managerId = "10000000-0000-4000-8000-000000000003";
const managerEmail = "manager@browser.example.test";
const open = "80000000-0000-4000-8000-0000000000f4";
const lostStage = "80000000-0000-4000-8000-0000000000f5";
const price = "85000000-0000-4000-8000-000000000001";
const tooFar = "85000000-0000-4000-8000-000000000002";
const lead = "73000000-0000-4000-8000-000000000001";

test("moving a lead to lost needs a reason, shows in the timeline, and keeps the pick when the save fails", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected baseURL");
  await database(
    stack,
    `INSERT INTO stages (id,company_id,name,position,kind,is_default) VALUES
    ('${open}','${company}','Stage open',93,'open',false),
    ('${lostStage}','${company}','Stage lost',94,'lost',false) ON CONFLICT DO NOTHING;
    INSERT INTO lost_reasons (id,company_id,name,position) VALUES
    ('${price}','${company}','Price',1),('${tooFar}','${company}','Too far',2)
    ON CONFLICT (id) DO UPDATE SET archived_at = null;
    INSERT INTO scoring_configs (id,company_id,version,base_points,hot_min,warm_min,rules,active,created_by)
    SELECT '82000000-0000-4000-8000-000000000001','${company}',1,10,70,40,'[]',true,'${managerId}'
    WHERE NOT EXISTS (SELECT 1 FROM scoring_configs WHERE company_id = '${company}' AND active);
    DELETE FROM lead_events WHERE lead_id = '${lead}';
    DELETE FROM leads WHERE id = '${lead}';
    INSERT INTO leads (id,company_id,full_name,phone_valid,source_kind,lead_date,stage_id,custom,score,priority,score_breakdown,scored_at,next_action_at) VALUES
    ('${lead}','${company}','Stage Lead',false,'import','2026-10-23T06:00:00Z','${open}','{}',10,'cold','{"base":10}',now(),now() + interval '1 day');`,
  );

  const page = await newPage(browser, baseURL, testInfo);
  await signIn(page, mailbox, managerEmail);
  await page.goto(`/browser-company/leads/${lead}`);
  const panel = page.getByRole("region", { name: "Change stage" });
  const save = panel.getByRole("button", { name: "Save stage" });
  await expect(save).toBeDisabled();

  await panel.getByRole("button", { name: "Stage lost" }).click();
  await expect(panel.getByText("Pick why the lead was lost")).toBeVisible();
  await expect(save).toBeDisabled();
  await panel.getByRole("button", { name: "Price" }).click();
  await save.click();

  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(
    timeline.getByRole("heading", { name: "Moved to Stage lost" }),
  ).toBeVisible();
  await expect(timeline.getByText("Price")).toBeVisible();
  await expect(save).toBeDisabled();
  await expectFits(page, testInfo, "lead-stage-lost");

  await database(
    stack,
    `UPDATE lost_reasons SET archived_at = now() WHERE id = '${tooFar}';`,
  );
  await panel.getByRole("button", { name: "Too far" }).click();
  await save.click();
  await expect(appAlert(page)).toHaveText("Choose why the lead was lost");
  await expect(panel.getByRole("button", { name: "Too far" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    panel.getByRole("button", { name: "Stage lost" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expectFits(page, testInfo, "lead-stage-error");

  await panel.getByRole("button", { name: "Stage open" }).click();
  await expect(panel.getByRole("button", { name: "Price" })).toHaveCount(0);
  await save.click();
  await expect(
    timeline.getByRole("heading", { name: "Moved to Stage open" }),
  ).toBeVisible();
});
