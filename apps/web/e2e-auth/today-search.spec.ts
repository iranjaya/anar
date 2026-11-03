import { expect, newPage, signIn, test } from "./fixture";
import { database, expectFits } from "./imports";

const company = "40000000-0000-4000-8000-000000000001";
const agency = "20000000-0000-4000-8000-000000000001";
const user = "10000000-0000-4000-8000-0000000000e9";
const member = "50000000-0000-4000-8000-0000000000e9";
const stage = "80000000-0000-4000-8000-0000000000e9";
const email = "today-search@browser.example.test";
const lead = (n: number) =>
  `79000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("Today search can reach a lead past the first page", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected the browser stack URL");
  const leads = Array.from({ length: 51 }, (_, index) => {
    const n = index + 1;
    const name = n === 51 ? "Search Target" : `Other Lead ${n}`;
    return `('${lead(n)}','${company}','${name}',false,'import',now(),'${stage}','{}',10,'cold','{}',now(),'${member}',now() - interval '1 hour')`;
  });
  await database(
    stack,
    `INSERT INTO users (id,email,name) VALUES ('${user}','${email}','Today Search');
    INSERT INTO company_members (id,agency_id,company_id,user_id,name,role,status) VALUES
    ('${member}','${agency}','${company}','${user}','Today Search','admin','active');
    INSERT INTO stages (id,company_id,name,position,kind,is_default) VALUES
    ('${stage}','${company}','Today search',97,'open',false);
    INSERT INTO leads (id,company_id,full_name,phone_valid,source_kind,lead_date,stage_id,custom,score,priority,score_breakdown,scored_at,assigned_to,next_action_at) VALUES
    ${leads.join(",")};`,
  );
  const page = await newPage(browser, baseURL, testInfo);
  await signIn(page, mailbox, email);
  await page.goto("/browser-company/today");
  const list = page.getByRole("region", { name: "Today's leads" });
  await expect(list.getByRole("link", { name: "Search Target" })).toHaveCount(
    0,
  );
  await page
    .getByRole("searchbox", { name: "Search leads" })
    .fill("Search Target");
  await expect(
    list.getByRole("heading", { name: "No leads match" }),
  ).toHaveCount(0);
  await list.getByRole("button", { name: "Show more overdue" }).click();
  await expect(list.getByRole("link", { name: "Search Target" })).toBeVisible();
  await expectFits(page, testInfo, "today-search-past-page");
});
