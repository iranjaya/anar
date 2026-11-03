import { expect, newPage, signIn, test } from "./fixture";
import { database, expectFits } from "./imports";

const company = "40000000-0000-4000-8000-000000000001";
const agency = "20000000-0000-4000-8000-000000000001";
const manager = "10000000-0000-4000-8000-000000000003";
const seller = {
  userId: "10000000-0000-4000-8000-0000000000f8",
  memberId: "50000000-0000-4000-8000-0000000000f8",
  email: "today-admin@browser.example.test",
};
const stage = "80000000-0000-4000-8000-0000000000f8";
const lead = (n: number) => `75000000-0000-4000-8000-00000000000${n}`;
const tomorrow = `((date_trunc('day', now() at time zone 'Asia/Kathmandu') + interval '1 day 10 hours') at time zone 'Asia/Kathmandu')`;

test("Today shows the three buckets, selected lead and caught-up states", async ({
  browser,
  baseURL,
  mailbox,
  stack,
}, testInfo) => {
  if (!baseURL) throw new Error("Expected baseURL");
  await database(
    stack,
    `INSERT INTO users (id,email,name) VALUES ('${seller.userId}','${seller.email}','Today Admin');
    INSERT INTO company_members (id,agency_id,company_id,user_id,name,role,status) VALUES
    ('${seller.memberId}','${agency}','${company}','${seller.userId}','Today Admin','admin','active');
    INSERT INTO stages (id,company_id,name,position,kind,is_default) VALUES
    ('${stage}','${company}','Today open',96,'open',false);
    INSERT INTO leads (id,company_id,full_name,phone_valid,source_kind,lead_date,stage_id,custom,score,priority,score_breakdown,scored_at,assigned_to,next_action_at) VALUES
    ('${lead(1)}','${company}','Today Overdue',false,'import',now(),'${stage}','{}',80,'hot','{}',now(),'${seller.memberId}',now() - interval '1 hour'),
    ('${lead(2)}','${company}','Today Due',false,'import',now(),'${stage}','{}',50,'warm','{}',now(),'${seller.memberId}',((date_trunc('day', now() at time zone 'Asia/Kathmandu') + interval '1 day') at time zone 'Asia/Kathmandu') - interval '1 millisecond'),
    ('${lead(3)}','${company}','Today New',false,'import',now(),'${stage}','{}',10,'cold','{}',now(),'${seller.memberId}',null),
    ('${lead(4)}','${company}','Today Later',false,'import',now(),'${stage}','{}',10,'cold','{}',now(),'${seller.memberId}',${tomorrow});
    INSERT INTO lead_events (id,company_id,lead_id,type,actor_user_id,data,created_at) VALUES
    ('76000000-0000-4000-8000-000000000001','${company}','${lead(3)}','assigned','${manager}','{"assignmentId":"76000000-0000-4000-8000-000000000002","from":null,"to":"${seller.memberId}"}',now() - interval '1 hour');`,
  );

  const page = await newPage(browser, baseURL, testInfo);
  await signIn(page, mailbox, seller.email);
  await page.goto("/browser-company/today");
  const list = page.getByRole("region", { name: "Today's leads" });
  const filters = page.getByRole("complementary", { name: "Today filters" });
  await expect(
    page.getByRole("heading", { name: "My Leads Today" }),
  ).toBeVisible();
  await expect(filters.getByText("0 calls today")).toBeVisible();
  for (const [bucket, name] of [
    ["Overdue 1", "Today Overdue"],
    ["Due today 1", "Today Due"],
    ["New 1", "Today New"],
  ]) {
    await expect(list.getByRole("region", { name: bucket })).toBeVisible();
    await expect(list.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(list.getByText("Today Later")).toHaveCount(0);
  await filters.getByRole("button", { name: "Hot", exact: true }).click();
  await expect(list.getByRole("region", { name: "Overdue 1" })).toBeVisible();
  await expect(list.getByRole("region", { name: "Due today 1" })).toHaveCount(
    0,
  );
  await filters.getByRole("button", { name: "All", exact: true }).click();
  await expectFits(page, testInfo, "today-list");

  await list.getByRole("link", { name: "Today Due", exact: true }).click();
  await expect(page).toHaveURL(`/browser-company/today?lead=${lead(2)}`);
  const selected = page.getByRole("region", { name: "Selected lead" });
  await expect(
    selected.getByRole("heading", { name: "Today Due" }),
  ).toBeVisible();
  await expect(selected.getByText("Today open")).toBeVisible();
  await expectFits(page, testInfo, "today-selected");
  if (testInfo.project.name === "phone") {
    await expect(list).toBeHidden();
    await page.getByRole("link", { name: "Back to the list" }).click();
    await expect(page).toHaveURL("/browser-company/today");
    await expect(list).toBeVisible();
  } else {
    await expect(list).toBeVisible();
    const listBox = await list.boundingBox();
    const detailBox = await selected.boundingBox();
    expect(listBox).not.toBeNull();
    expect(detailBox).not.toBeNull();
    if (listBox && detailBox)
      expect(listBox.x + listBox.width).toBeLessThan(detailBox.x);
  }
  await database(
    stack,
    `UPDATE leads SET next_action_at = ${tomorrow}, last_contacted_at = now()
    WHERE id IN ('${lead(1)}','${lead(2)}','${lead(3)}');`,
  );
  await page.goto("/browser-company/today");
  await expect(
    page.getByRole("heading", { name: "Good day. Nothing overdue." }),
  ).toBeVisible();
  await expect(
    page.getByText("Next one is due tomorrow at 10:00"),
  ).toBeVisible();
  await expect(list.getByRole("region", { name: "Overdue 0" })).toBeVisible();
  await expect(list.getByRole("region", { name: "Due today 0" })).toBeVisible();
  await expect(list.getByRole("region", { name: "New 0" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No leads assigned to you yet" }),
  ).toHaveCount(0);

  await database(
    stack,
    `UPDATE leads SET assigned_to = null WHERE assigned_to = '${seller.memberId}';`,
  );
  await page.goto("/browser-company/today");
  await expect(
    page.getByRole("heading", { name: "No leads assigned to you yet" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Good day. Nothing overdue." }),
  ).toHaveCount(0);
});
