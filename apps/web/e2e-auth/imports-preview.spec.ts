import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test } from "./fixture";
import { csvFixture, database, expectFits, openImport } from "./imports";

const metaHeaders = [
  "id",
  "created_time",
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "campaign_id",
  "campaign_name",
  "form_id",
  "is_organic",
  "platform",
  "which_apartment_are_you_planning_to_purchase?",
  "when_are_you_planning_to_purchase?_",
  "full_name",
  "phone",
  "email",
  "job_title",
];
const system: Record<string, string> = {
  created_time: "system:lead_date",
  campaign_name: "system:campaign_name",
  platform: "system:source",
  full_name: "system:full_name",
  phone: "system:phone",
  email: "system:email",
};
const fingerprint = (headers: string[]) =>
  createHash("sha256")
    .update(
      [
        ...new Set(
          headers.map((h) =>
            h
              .trim()
              .replace(/\s+/g, " ")
              .toLowerCase()
              .replace(/[?_]+$/, ""),
          ),
        ),
      ]
        .sort()
        .join("\n"),
    )
    .digest("hex");

test("a saved mapping goes straight to exact counts", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected the browser stack URL");
  const { page, slug } = await openImport(
    browser,
    baseURL,
    mailbox,
    testInfo,
    "preview",
  );
  const mapping = metaHeaders.map((header) => ({
    header,
    target: system[header] ?? "skip",
  }));
  await database(
    stack,
    `INSERT INTO mapping_templates (id, company_id, name, header_fingerprint, headers, mapping, created_by)
    SELECT gen_random_uuid(), c.id, 'Spring open house', '${fingerprint(metaHeaders)}',
      '${JSON.stringify(metaHeaders)}', '${JSON.stringify(mapping)}', u.id
    FROM companies c, users u WHERE c.slug = '${slug}' AND u.email = 'staff@browser.example.test';
    INSERT INTO leads (id,company_id,phone_e164,phone_valid,source_kind,lead_date,campaign_name,stage_id,custom,score,priority,score_breakdown,scored_at)
    SELECT gen_random_uuid(), c.id, p.phone, true, 'import', '2026-09-12T04:26:12Z', p.campaign, s.id, '{}', 0, 'cold', '{}', now()
    FROM companies c JOIN stages s ON s.company_id = c.id AND s.is_default
    CROSS JOIN (VALUES ('+9779841000001', 'Spring open house'), ('+919812345678', 'Older campaign')) AS p(phone, campaign)
    WHERE c.slug = '${slug}';`,
  );
  await page
    .getByLabel("Meta CSV file")
    .setInputFiles(csvFixture("meta-utf16le-tab.csv"));
  await expect(page.getByText("Saved mapping found")).toBeVisible();
  await expect(
    page.getByText("Spring open house", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Match columns" }).click();
  await expect(page.getByLabel("Map ad_id", { exact: true })).toHaveValue(
    "skip",
  );
  await page.getByRole("button", { name: "Check 4 rows" }).click();
  await expect(page).toHaveURL(/\/map\?step=check$/);
  const summary = page.getByRole("region", { name: "Import check summary" });
  await expect(
    summary.getByRole("heading", { name: "2 already in, 2 new" }),
  ).toBeVisible();
  await expect(
    summary.getByText("Will import, needs phone review"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import 2 leads" }),
  ).toBeEnabled();
  await expect(
    page.getByText("Lead detail available after the lead screen is enabled"),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Open lead/ })).toHaveCount(0);
  await expectFits(page, testInfo, "import-preview-counts");

  await page.reload();
  await expect(
    summary.getByRole("heading", { name: "2 already in, 2 new" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to columns" }).click();
  await expect(
    page.getByRole("heading", { name: "Match columns", level: 1 }),
  ).toBeVisible();
  await expect(page.getByLabel("Map phone", { exact: true })).toHaveValue(
    "system:phone",
  );
});

test("a file with many bad phones shows the first 50, and a file with no readable rows shows zeros", async ({
  browser,
  baseURL,
  mailbox,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected the browser stack URL");
  const { page, slug } = await openImport(
    browser,
    baseURL,
    mailbox,
    testInfo,
    "limits",
  );
  const many = testInfo.outputPath("many.csv");
  await writeFile(
    many,
    [
      "full_name,phone",
      ...Array.from({ length: 60 }, (_, n) => `Lead ${n},1${n}`),
      "",
    ].join("\n"),
  );
  await page.getByLabel("Meta CSV file").setInputFiles(many);
  await page.getByRole("link", { name: "Match columns" }).click();
  await page.getByRole("button", { name: "Check 60 rows" }).click();
  await expect(
    page.getByRole("heading", { name: "0 already in, 60 new" }),
  ).toBeVisible();
  await expect(page.getByText("Showing first 50 of 60.")).toBeVisible();
  await expectFits(page, testInfo, "import-preview-limit");

  await page.goto(`/${slug}/imports/new`);
  const wide = testInfo.outputPath("wide.csv");
  await writeFile(wide, "full_name,phone\nToo wide,9841000001,extra\n");
  await page.getByLabel("Meta CSV file").setInputFiles(wide);
  await page.getByRole("link", { name: "Match columns" }).click();
  await page.getByRole("button", { name: "Check 1 rows" }).click();
  await expect(
    page.getByRole("heading", { name: "0 already in, 0 new" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Rows that can't be read" })
      .getByText("Row 1"),
  ).toBeVisible();
  await expectFits(page, testInfo, "import-preview-zero");
});
