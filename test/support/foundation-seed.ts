import { execFile } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

type Stack = { baseURL: string; mailURL: string; apiContainer: string };
type Message = { ID: string; To: { Address: string }[] };

export const foundation = {
  owner: { email: "owner@browser.example.test", name: "Browser Owner" },
  agencies: [
    {
      name: "DNA",
      slug: "dna",
      staff: { email: "dna-staff@browser.example.test", name: "DNA Staff" },
      companies: [
        { name: "DNA North", slug: "dna-north" },
        { name: "DNA South", slug: "dna-south" },
      ],
    },
    {
      name: "Second Agency",
      slug: "second-agency",
      staff: {
        email: "second-staff@browser.example.test",
        name: "Second Staff",
      },
      companies: [
        { name: "Second East", slug: "second-east" },
        { name: "Second West", slug: "second-west" },
      ],
    },
  ],
} as const;

export async function seedFoundation(stack: Stack): Promise<void> {
  const mailbox = async (): Promise<Message[]> =>
    (
      await (
        await fetch(`${stack.mailURL}/api/v1/messages`, {
          signal: AbortSignal.timeout(5000),
        })
      ).json()
    ).messages;

  async function nextMail(email: string, before: string[], pattern: RegExp) {
    for (let attempt = 0; attempt < 60; attempt++) {
      for (const message of await mailbox()) {
        if (
          before.includes(message.ID) ||
          !message.To.some((to) => to.Address === email)
        )
          continue;
        const body = await (
          await fetch(`${stack.mailURL}/api/v1/message/${message.ID}`)
        ).json();
        const found = (body.Text as string).match(pattern)?.[1];
        if (found) return found;
      }
      await setTimeout(500);
    }
    throw new Error(`No email for ${email}`);
  }
  const ids = async () => (await mailbox()).map((message) => message.ID);

  async function call(
    path: string,
    body: object,
    cookie = "",
  ): Promise<{ data: Record<string, string>; cookie: string }> {
    const response = await fetch(`${stack.baseURL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: stack.baseURL,
        cookie,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json();
    if (!result.ok) throw new Error(`${path}: ${result.message}`);
    const session = response.headers.getSetCookie()[0]?.split(";")[0];
    return { data: result.data, cookie: session ?? cookie };
  }

  async function signIn(email: string) {
    const before = await ids();
    await call("/api/auth/requestOtp", { email });
    const code = await nextMail(email, before, /\b(\d{6})\b/);
    return (await call("/api/auth/verifyOtp", { email, code })).cookie;
  }

  async function accept(email: string, name: string, before: string[]) {
    const token = await nextMail(
      email,
      before,
      /\/invite#token=([A-Za-z0-9_-]{43})/,
    );
    await call("/api/auth/acceptInvite", { token, name });
  }

  await run(
    "docker",
    [
      "exec",
      "-e",
      "ANAR_ENV=foundation",
      stack.apiContainer,
      "node",
      "dist/modules/auth/bootstrap.js",
      "--environment",
      "foundation",
      "--email",
      foundation.owner.email,
      "--name",
      foundation.owner.name,
    ],
    { timeout: 30_000 },
  );
  const owner = await signIn(foundation.owner.email);
  for (const agency of foundation.agencies) {
    const before = await ids();
    await call(
      "/api/agencies/createAgency",
      {
        name: agency.name,
        slug: agency.slug,
        email: agency.staff.email,
        staffName: agency.staff.name,
      },
      owner,
    );
    await accept(agency.staff.email, agency.staff.name, before);
    const staff = await signIn(agency.staff.email);
    for (const company of agency.companies) {
      const { data } = await call(
        "/api/companies/createCompany",
        {
          name: company.name,
          slug: company.slug,
          defaultCountry: "NP",
          timezone: "Asia/Kathmandu",
        },
        staff,
      );
      const email = `admin-${company.slug}@browser.example.test`;
      const invited = await ids();
      await call(
        "/api/companies/inviteSuperAdmin",
        { companyId: data.companyId, email, name: `${company.name} Admin` },
        staff,
      );
      await accept(email, `${company.name} Admin`, invited);
    }
    const [first] = agency.companies;
    const manager = await signIn(`admin-${first.slug}@browser.example.test`);
    const sellerEmail = `seller-${first.slug}@browser.example.test`;
    const invited = await ids();
    await call(
      `/api/companies/${first.slug}/members/inviteAdmin`,
      { email: sellerEmail, name: `${first.name} Seller` },
      manager,
    );
    await accept(sellerEmail, `${first.name} Seller`, invited);
  }
}

if (import.meta.main) {
  const [baseURL = "", mailURL = "", apiContainer = ""] = process.argv.slice(2);
  if (!/^https?:\/\/127\.0\.0\.1:\d+$/.test(baseURL) || !apiContainer)
    throw new Error(
      "Use: foundation-seed.ts <baseURL> <mailURL> <apiContainer>",
    );
  await seedFoundation({ baseURL, mailURL, apiContainer });
}
