import { expect, newPage, signIn, test } from "./fixture";
import { database, expectFits, readDatabase } from "./imports";

const company = "40000000-0000-4000-8000-000000000001";
const agency = "20000000-0000-4000-8000-000000000001";
const manager = "10000000-0000-4000-8000-000000000003";
const admin = {
  userId: "10000000-0000-4000-8000-0000000000f9",
  memberId: "50000000-0000-4000-8000-0000000000f9",
  email: "log-admin@browser.example.test",
};
const open = "80000000-0000-4000-8000-0000000000f9";
const lost = "80000000-0000-4000-8000-0000000000fa";
const reached = "81000000-0000-4000-8000-0000000000f9";
const reason = "85000000-0000-4000-8000-0000000000f9";
const lead = (n: number) => `77000000-0000-4000-8000-00000000000${n}`;

test("a call keeps the form on failure, saves the note and local date, then opens the next lead", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected baseURL");
  await database(
    stack,
    `INSERT INTO users (id,email,name) VALUES
      ('${admin.userId}','${admin.email}','Log Admin') ON CONFLICT DO NOTHING;
    INSERT INTO company_members (id,agency_id,company_id,user_id,name,role,status) VALUES
      ('${admin.memberId}','${agency}','${company}','${admin.userId}','Log Admin','admin','active')
      ON CONFLICT (id) DO UPDATE SET status = 'active', deactivated_at = null;
    INSERT INTO stages (id,company_id,name,position,kind,is_default) VALUES
      ('${open}','${company}','Log Open',97,'open',false),
      ('${lost}','${company}','Log Lost',98,'lost',false) ON CONFLICT DO NOTHING;
    INSERT INTO outcomes (id,company_id,name,counts_as_failed,position) VALUES
      ('${reached}','${company}','Reached customer',false,97) ON CONFLICT DO NOTHING;
    INSERT INTO lost_reasons (id,company_id,name,position) VALUES
      ('${reason}','${company}','No budget',97) ON CONFLICT DO NOTHING;
    INSERT INTO scoring_configs (id,company_id,version,base_points,hot_min,warm_min,rules,active,created_by)
    SELECT '82000000-0000-4000-8000-0000000000f9','${company}',1,10,70,40,'[]',true,'${manager}'
    WHERE NOT EXISTS (SELECT 1 FROM scoring_configs WHERE company_id = '${company}' AND active);
    INSERT INTO leads (id,company_id,full_name,phone_e164,phone_valid,source_kind,lead_date,stage_id,custom,score,priority,score_breakdown,scored_at,assigned_to,next_action_at) VALUES
      ('${lead(1)}','${company}','Call Lead One','+9779841330001',true,'import',now(),'${open}','{}',10,'cold','{"base":10}',now(),'${admin.memberId}',now() - interval '2 hours'),
      ('${lead(2)}','${company}','Call Lead Two','+9779841330002',true,'import',now(),'${open}','{}',10,'cold','{"base":10}',now(),'${admin.memberId}',now() - interval '1 hour');`,
  );

  const page = await newPage(browser, baseURL, testInfo);
  await signIn(page, mailbox, admin.email);
  await page.goto(`/browser-company/leads/${lead(1)}`);
  const logLink = page.getByRole("link", { name: "Log a call" });
  const facts = page.getByRole("region", { name: "Lead facts" });
  await expect(logLink).toBeVisible();
  await expect(facts).toBeVisible();
  const position = await logLink.evaluate(
    (link) => getComputedStyle(link).position,
  );
  if (testInfo.project.name === "phone") {
    expect(position).toBe("fixed");
    await facts.scrollIntoViewIfNeeded();
  } else {
    expect(position).toBe("static");
  }
  const logBox = await logLink.boundingBox();
  const factsBox = await facts.boundingBox();
  if (!logBox || !factsBox) throw new Error("Lead detail is not visible");
  if (testInfo.project.name === "phone") {
    expect(factsBox.y + factsBox.height).toBeLessThanOrEqual(logBox.y);
    const reserve = await page
      .getByRole("main")
      .last()
      .evaluate((main) =>
        Number.parseFloat(getComputedStyle(main).paddingBottom),
      );
    expect(reserve).toBeGreaterThan(logBox.height);
  } else {
    expect(logBox.y + logBox.height).toBeLessThanOrEqual(factsBox.y);
  }
  await expectFits(page, testInfo, "log-call-detail");
  const call = page.getByRole("link", { name: "Call", exact: true });
  await expect(call).toHaveAttribute("href", "tel:+9779841330001");
  await call.click();
  await expect(page).toHaveURL(/log=1/);
  const sheet = page.getByRole("dialog", { name: "Log a call" });
  await expect(sheet).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Timeline" }).getByText("Call logged"),
  ).toHaveCount(0);
  await sheet.getByRole("button", { name: "Reached customer" }).click();
  await sheet.getByLabel("Note").fill("Asked for a call tomorrow");
  await sheet.getByRole("button", { name: "Tomorrow" }).click();
  await expectFits(page, testInfo, "log-call-form");

  await database(
    stack,
    `UPDATE outcomes SET archived_at = now() WHERE id = '${reached}';`,
  );
  await sheet.getByRole("button", { name: "Save and next lead" }).click();
  await expect(sheet.getByRole("alert")).toHaveText("Choose an active outcome");
  await expect(sheet.getByLabel("Note")).toHaveValue(
    "Asked for a call tomorrow",
  );
  await expect(sheet.getByRole("button", { name: "Tomorrow" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    await readDatabase(
      stack,
      `SELECT count(*) FROM follow_ups WHERE lead_id = '${lead(1)}';`,
    ),
  ).toBe("0");

  await database(
    stack,
    `UPDATE outcomes SET archived_at = null WHERE id = '${reached}';`,
  );
  await sheet.getByRole("button", { name: "Save and next lead" }).click();
  await expect(page).toHaveURL(`/browser-company/today?lead=${lead(2)}`);
  await expect(
    page
      .getByRole("region", { name: "Selected lead" })
      .getByText("Call Lead Two"),
  ).toBeVisible();
  expect(
    await readDatabase(
      stack,
      `SELECT notes || '|' || to_char(next_action_at at time zone 'Asia/Kathmandu', 'HH24:MI')
       FROM follow_ups WHERE lead_id = '${lead(1)}';`,
    ),
  ).toBe("Asked for a call tomorrow|10:00");

  await page.goto(`/browser-company/leads/${lead(1)}`);
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(
    timeline.getByRole("heading", { name: "Reached customer" }),
  ).toBeVisible();
  await expect(timeline.getByText("Asked for a call tomorrow")).toBeVisible();
  await page.goto(`/browser-company/leads/${lead(2)}`);
  await page.getByRole("link", { name: "Log a call" }).click();
  const second = page.getByRole("dialog", { name: "Log a call" });
  await second.getByRole("button", { name: "Reached customer" }).click();
  await second.getByLabel("Note").fill("Asked us to stop calling");
  await second.getByRole("button", { name: "Log Lost" }).click();
  await second.getByRole("button", { name: "No budget" }).click();
  await second.getByRole("button", { name: "Mark as Lost" }).click();
  await expect(page).toHaveURL("/browser-company/today");
  expect(
    await readDatabase(
      stack,
      `SELECT notes FROM follow_ups WHERE lead_id = '${lead(2)}';`,
    ),
  ).toBe("Asked us to stop calling");
});
