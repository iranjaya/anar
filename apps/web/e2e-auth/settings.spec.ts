import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Page, TestInfo } from "@playwright/test";
import {
  expect,
  newPage,
  signIn,
  stackContainer,
  staffEmail,
  test,
} from "./fixture";

const run = promisify(execFile);
type Stack = Parameters<typeof stackContainer>[0];

async function database(stack: Stack, query: string) {
  await run(
    "docker",
    [
      "exec",
      await stackContainer(stack, "db"),
      "psql",
      "-U",
      "postgres",
      "-d",
      "anar",
      "-v",
      "ON_ERROR_STOP=1",
      "-qc",
      query,
    ],
    { timeout: 30000 },
  );
}

async function expectFits(page: Page, testInfo: TestInfo, name: string) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true,
  });
}

async function openSettings(
  browser: Parameters<typeof newPage>[0],
  baseURL: string,
  mailbox: Parameters<typeof signIn>[1],
  testInfo: TestInfo,
  name: string,
) {
  const slug = `${name}-${testInfo.project.name}`;
  const title = `Settings ${name} ${testInfo.project.name}`;
  const page = await newPage(browser, baseURL, testInfo);
  await signIn(page, mailbox, staffEmail);
  await page.goto("/agency/companies");
  await page.getByLabel("Company name", { exact: true }).fill(title);
  await page.getByLabel("Company slug").fill(slug);
  await page
    .getByRole("button", { name: "Create company", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Company created", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel(`Reason for entering ${title}`)
    .fill("Setting up the pipeline");
  await page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .getByRole("button", { name: "Enter company", exact: true })
    .click();
  await expect(page).toHaveURL(`/${slug}`);
  await page.goto(`/${slug}/settings`);
  await expect(
    page.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();
  return { page, slug };
}

async function addLead(
  stack: Stack,
  slug: string,
  stage: string,
  custom: object = {},
) {
  await database(
    stack,
    `INSERT INTO leads (id,company_id,phone_valid,source_kind,lead_date,stage_id,custom,score,priority,score_breakdown,scored_at)
    SELECT gen_random_uuid(), c.id, false, 'import', now(), s.id, '${JSON.stringify(custom)}', 0, 'cold', '{}', now()
    FROM companies c JOIN stages s ON s.company_id = c.id
    WHERE c.slug = '${slug}' AND s.name = '${stage}'`,
  );
}

const section = (page: Page, name: string) =>
  page.getByRole("region", { name, exact: true });

test("a new company opens with readable defaults and a clear outage", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected the browser stack URL");
  const { page } = await openSettings(
    browser,
    baseURL,
    mailbox,
    testInfo,
    "defaults",
  );
  const stages = section(page, "Stages");
  await expect(stages.getByRole("listitem")).toHaveCount(8);
  await expect(
    stages.getByRole("listitem").filter({ hasText: "New Lead" }),
  ).toContainText("default");
  await expect(
    section(page, "Fields").getByText("purchase_timeline", { exact: true }),
  ).toBeVisible();
  await expect(
    section(page, "Call outcomes").getByRole("form", { name: "No Answer" }),
  ).toBeVisible();
  await expect(
    section(page, "Call outcomes")
      .getByRole("form", { name: "No Answer" })
      .getByLabel("Counts as a failed attempt"),
  ).toBeChecked();
  await expect(
    section(page, "Lost reasons").getByRole("form", { name: "Other" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add field" })).toHaveCount(1);
  await expectFits(page, testInfo, "settings-defaults");

  await database(stack, "REVOKE SELECT ON stages FROM anar_app;");
  try {
    await page.reload();
    await expect(
      page.getByRole("alert").filter({ hasText: "Try again" }),
    ).toBeVisible();
    await expect(section(page, "Stages")).toHaveCount(0);
  } finally {
    await database(stack, "GRANT SELECT ON stages TO anar_app;");
  }
  await page.getByRole("link", { name: "Try again" }).click();
  await expect(section(page, "Stages")).toBeVisible();
  await page.context().close();
});

test("a manager adds a field, edits it and archives it without losing answers", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected the browser stack URL");
  const { page, slug } = await openSettings(
    browser,
    baseURL,
    mailbox,
    testInfo,
    "fields",
  );
  const fields = section(page, "Fields");
  const form = fields.getByRole("region", { name: "Add a field" });
  await form.getByLabel("Name", { exact: true }).fill("Has parking");
  await expect(form.getByLabel("Key (optional)")).toHaveAttribute(
    "placeholder",
    "has_parking",
  );
  await form.getByLabel("Code 1").fill("yes");
  await form.getByLabel("Label 1").fill("Yes");
  await form.getByRole("button", { name: "Add a choice" }).click();
  await form.getByLabel("Code 2").fill("no");
  await form.getByLabel("Label 2").fill("No");
  await page.getByRole("button", { name: "Add field" }).click();
  await expect(page.getByText("Field added.")).toBeVisible();
  const parking = fields
    .getByRole("listitem")
    .filter({ hasText: "has_parking" });
  await expect(parking).toContainText("2 choices");

  await database(
    stack,
    "UPDATE sessions SET last_otp_at = now() - interval '20 minutes';",
  );
  await form.getByLabel("Name", { exact: true }).fill("Floor");
  await form.getByLabel("Type").selectOption("number");
  await form.getByRole("button", { name: "Add field" }).click();
  await expect(form.getByRole("alert").first()).toContainText("fresh code", {
    ignoreCase: true,
  });
  await expect(form.getByLabel("Name", { exact: true })).toHaveValue("Floor");
  await database(stack, "UPDATE sessions SET last_otp_at = now();");

  await addLead(stack, slug, "New Lead", { has_parking: "yes" });
  await parking.getByRole("button", { name: "Edit" }).click();
  await parking.getByLabel("Name", { exact: true }).fill("Parking");
  await parking.getByRole("button", { name: "Remove choice 2" }).click();
  await parking.getByRole("button", { name: "Save" }).click();
  await expect(parking.getByRole("alert")).toContainText(
    "type and codes must stay",
  );
  await expect(parking.getByLabel("Name", { exact: true })).toHaveValue(
    "Parking",
  );
  await page.reload();
  const reloaded = fields
    .getByRole("listitem")
    .filter({ hasText: "has_parking" });
  await reloaded.getByRole("button", { name: "Edit" }).click();
  await reloaded.getByLabel("Name", { exact: true }).fill("Parking");
  await reloaded.getByLabel("Label 1").fill("Yes, covered");
  await reloaded.getByRole("button", { name: "Save" }).click();
  await expect(reloaded.getByText("Saved.")).toBeVisible();
  await page.reload();
  await expect(
    fields.getByRole("listitem").filter({ hasText: "Parking" }),
  ).toHaveCount(1);

  const renamed = fields
    .getByRole("listitem")
    .filter({ hasText: "has_parking" });
  await renamed.getByRole("button", { name: "Edit" }).click();
  await expect(renamed.getByText("Answers already stored")).toBeVisible();
  await renamed.getByRole("button", { name: "Archive field" }).click();
  await expect(fields.getByText("Archived (1)")).toBeVisible();
  await expectFits(page, testInfo, "settings-fields");
  await page.context().close();
});

test("a manager adds, renames, reorders and archives stages", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected the browser stack URL");
  const { page, slug } = await openSettings(
    browser,
    baseURL,
    mailbox,
    testInfo,
    "stages",
  );
  const stages = section(page, "Stages");
  const items = stages.getByRole("listitem");
  await stages.getByLabel("Name", { exact: true }).fill("Visit Set");
  await page.getByRole("button", { name: "Save stage" }).click();
  await expect(page.getByText("Stage saved.")).toBeVisible();
  await expect(items.last()).toContainText("Visit Set");

  await stages.getByLabel("Stage", { exact: true }).selectOption({
    label: "Visit Set",
  });
  await stages.getByLabel("Name", { exact: true }).fill("Visit Booked");
  await stages.getByLabel("New leads start here").check();
  await page.getByRole("button", { name: "Save stage" }).click();
  await expect(page.getByText("Stage saved.")).toBeVisible();
  await page.reload();
  await expect(items.filter({ hasText: "Visit Booked" })).toContainText(
    "default",
  );
  await expect(items.filter({ hasText: "New Lead" })).not.toContainText(
    "default",
  );

  await page.getByRole("button", { name: "Move Visit Booked up" }).click();
  await expect(items.nth(7)).toContainText("Visit Booked");
  await page.reload();
  await expect(items.nth(7)).toContainText("Visit Booked");
  await expect(items.nth(8)).toContainText("Lost");

  await expect(
    page.getByRole("button", { name: "Archive Visit Booked" }),
  ).toBeDisabled();
  await expect(items.filter({ hasText: "Visit Booked" })).toContainText(
    "The default stage cannot be archived.",
  );
  await addLead(stack, slug, "Contacted");
  await page.getByRole("button", { name: "Archive Contacted" }).click();
  await expect(
    items.filter({ hasText: "Contacted" }).getByRole("alert"),
  ).toContainText("Move them before archiving it");
  await page.getByRole("button", { name: "Archive Qualified" }).click();
  await expect(stages.getByText("Archived (1)")).toBeVisible();
  await expect(items).toHaveCount(8);
  await expectFits(page, testInfo, "settings-stages");
  await page.context().close();
});

test("a manager keeps outcomes and lost reasons, never fewer than one", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected the browser stack URL");
  const { page, slug } = await openSettings(
    browser,
    baseURL,
    mailbox,
    testInfo,
    "outcomes",
  );
  const outcomes = section(page, "Call outcomes");
  const budget = outcomes.getByRole("form", { name: "Budget Discussion" });
  await budget.getByLabel("Counts as a failed attempt").check();
  await budget.getByRole("button", { name: "Save" }).click();
  await expect(outcomes.getByText("Saved.")).toBeVisible();
  const added = outcomes.getByRole("form", { name: "New call outcome" });
  await added.getByLabel("Name").fill("Wrong Number");
  await added.getByLabel("Counts as a failed attempt").check();
  await added.getByRole("button", { name: "Add" }).click();
  await page.reload();
  await expect(
    outcomes
      .getByRole("form", { name: "Budget Discussion" })
      .getByLabel("Counts as a failed attempt"),
  ).toBeChecked();
  await expect(
    outcomes
      .getByRole("form", { name: "Wrong Number" })
      .getByLabel("Counts as a failed attempt"),
  ).toBeChecked();

  const reasons = section(page, "Lost reasons");
  const reason = reasons.getByRole("form", { name: "New lost reason" });
  await reason.getByLabel("Name").fill("Too Far");
  await reason.getByRole("button", { name: "Add" }).click();
  await expect(reasons.getByRole("form", { name: "Too Far" })).toBeVisible();
  const far = reasons.getByRole("form", { name: "Too Far" });
  await far.getByLabel("Name").fill("Too Far Away");
  await far.getByRole("button", { name: "Save" }).click();
  await expect(
    reasons.getByRole("form", { name: "Too Far Away" }),
  ).toBeVisible();
  await reasons
    .getByRole("form", { name: "Changed Mind" })
    .getByRole("button", { name: "Archive" })
    .click();
  await expect(reasons.getByText("Archived (1)")).toBeVisible();

  await database(
    stack,
    `UPDATE lost_reasons SET archived_at = now()
    WHERE name <> 'Other' AND company_id = (SELECT id FROM companies WHERE slug = '${slug}')`,
  );
  await page.reload();
  const last = reasons.getByRole("form", { name: "Other" });
  await expect(last.getByRole("button", { name: "Archive" })).toBeDisabled();
  await expect(
    reasons.getByText("Keep at least one lost reason."),
  ).toBeVisible();
  await expectFits(page, testInfo, "settings-outcomes");
  await page.context().close();
});
