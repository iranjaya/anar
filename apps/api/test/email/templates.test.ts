import { describe, expect, it } from "vitest";
import invite, {
  type InviteEmailInput,
} from "../../src/lib/email/templates/invite.js";
import layout from "../../src/lib/email/templates/layout.js";
import signInCode from "../../src/lib/email/templates/signInCode.js";
import stepUpCode from "../../src/lib/email/templates/stepUpCode.js";

const footer = {
  reason: "You got this email because Prakash Joshi invited you.",
  operator: "Anar is run by DNA for Sundar Heights.",
  contact: "Questions? Ask Prakash Joshi, your sales manager.",
};

const link = {
  url: "https://anar.visitshankhuwasabha.com/invite#token=k7Qm2xR9pA",
  expiresAt: new Date("2026-11-05T10:45:00Z"),
  timeZone: "Asia/Kathmandu",
  resent: false,
};
const rohan = { name: "Rohan Gautam", role: "agency_staff" } as const;
const prakash = { name: "Prakash Joshi", role: "super_admin" } as const;
const invites = {
  firstStaff: {
    ...link,
    name: "Rohan",
    role: "agency_staff",
    agency: "DNA",
    company: null,
    inviter: { name: "Kabir Acharya", role: "owner" },
  },
  staff: {
    ...link,
    name: "Ritu",
    role: "agency_staff",
    agency: "DNA",
    company: null,
    inviter: rohan,
  },
  superAdmin: {
    ...link,
    name: "Prakash",
    role: "super_admin",
    agency: "DNA",
    company: "Sundar Heights",
    inviter: rohan,
  },
  admin: {
    ...link,
    name: "Sunaina",
    role: "admin",
    agency: "DNA",
    company: "Sundar Heights",
    inviter: prakash,
  },
} satisfies Record<string, InviteEmailInput>;
const resent = { ...invites.admin, resent: true };

describe("step-up code email", () => {
  it("renders the step-up code email as html and text", async () => {
    const email = stepUpCode.render({ code: "482913" });
    expect(email.subject).toBe("482913 is your Anar code to confirm");
    await expect(email.html).toMatchFileSnapshot(
      "__snapshots__/stepUpCode.html",
    );
    await expect(email.text).toMatchFileSnapshot(
      "__snapshots__/stepUpCode.txt",
    );
  });

  it("tells you to sign out other devices if you did not try this", () => {
    const { html, text } = stepUpCode.render({ code: "482913" });
    expect(text).toContain("\n    482913\n");
    expect(html).toContain("Open Anar and sign out your other devices.");
  });
});

describe("invite emails", () => {
  it.each([
    ["firstStaff", invites.firstStaff],
    ["staff", invites.staff],
    ["superAdmin", invites.superAdmin],
    ["admin", invites.admin],
    ["resent", resent],
  ])("renders the %s invite as html and text", async (name, input) => {
    const email = invite.render(input);
    await expect(email.html).toMatchFileSnapshot(
      `__snapshots__/invite-${name}.html`,
    );
    await expect(email.text).toMatchFileSnapshot(
      `__snapshots__/invite-${name}.txt`,
    );
  });

  it("names who invited you in the subject", () => {
    expect(invite.render(invites.firstStaff).subject).toBe(
      "Kabir Acharya invited you to set up DNA on Anar",
    );
    expect(invite.render(invites.staff).subject).toBe(
      "Rohan Gautam invited you to the DNA team on Anar",
    );
    expect(invite.render(invites.superAdmin).subject).toBe(
      "Rohan Gautam invited you to Sundar Heights on Anar",
    );
    expect(invite.render(invites.admin).subject).toBe(
      "Prakash Joshi invited you to Sundar Heights on Anar",
    );
    expect(invite.render(resent).subject).toBe(
      "New invite link for Sundar Heights on Anar",
    );
  });

  it("shows when the link stops working in the company time zone", () => {
    expect(invite.render(invites.admin).text).toContain(
      "Link works until: Thu 5 Nov, 4:30 pm",
    );
    expect(invite.render({ ...invites.admin, timeZone: "UTC" }).text).toContain(
      "Link works until: Thu 5 Nov, 10:45 am",
    );
  });

  it("says the earlier link stopped working and drops the phone tip on a resend", () => {
    expect(invite.render(resent).text).toContain(
      "Your earlier invite link no longer works",
    );
    expect(invite.render(resent).text).not.toContain(
      "Open the link on your phone",
    );
    expect(invite.render(invites.admin).text).toContain(
      "Open the link on your phone",
    );
  });

  it("points an Admin invited by agency staff back to that staff member", () => {
    const { text } = invite.render({ ...invites.admin, inviter: rohan });
    expect(text).toContain("Invited by: Rohan Gautam, DNA");
    expect(text).toContain("Questions? Ask Rohan Gautam from DNA.");
  });

  it("names the inviting agency in the footer", () => {
    const company = invite.render({
      ...invites.superAdmin,
      agency: "Second Agency",
    }).text;
    const staff = invite.render({
      ...invites.staff,
      agency: "Second Agency",
    }).text;
    expect(company).toContain(
      "Anar is run by Second Agency for Sundar Heights.",
    );
    expect(staff).toContain(
      "Anar is the lead tracker Second Agency uses for its client companies.",
    );
    expect(company).not.toContain("DNA");
    expect(staff).not.toContain("DNA");
  });

  it("escapes the names in the invite", () => {
    const { html } = invite.render({
      ...invites.superAdmin,
      name: "<Ram>",
      company: "Ram & Sons",
    });
    expect(html).not.toContain("<Ram>");
    expect(html).toContain("Hi &lt;Ram&gt;");
    expect(html).toContain("Ram &amp; Sons");
  });
});

describe("email templates", () => {
  it("renders the sign-in code email as html and text", async () => {
    const email = signInCode.render({ code: "482913" });
    expect(email.subject).toBe("482913 is your Anar sign-in code");
    await expect(email.html).toMatchFileSnapshot(
      "__snapshots__/signInCode.html",
    );
    await expect(email.text).toMatchFileSnapshot(
      "__snapshots__/signInCode.txt",
    );
  });

  it("keeps the code as one run of digits so a long press copies all of it", () => {
    const { html, text } = signInCode.render({ code: "004210" });
    expect(html).toContain(">004210</div>");
    expect(text).toContain("\n    004210\n");
  });

  it("keeps every text line within 70 characters", () => {
    const { text } = signInCode.render({ code: "482913" });
    for (const line of text.split("\n"))
      expect(line.length).toBeLessThanOrEqual(70);
  });

  it("escapes names people type", () => {
    const { html } = layout.render({
      preheader: "Hi Ram & <Sita>",
      company: 'Ram & "Sita" <Homes>',
      blocks: [
        layout.heading("Hi Ram & <Sita>"),
        layout.rows([["Invited by", "<b>Ram</b>"]]),
      ],
      footer,
    });
    expect(html).not.toContain("<Sita>");
    expect(html).not.toContain("<b>Ram</b>");
    expect(html).toContain("Hi Ram &amp; &lt;Sita&gt;");
    expect(html).toContain("Ram &amp; &quot;Sita&quot; &lt;Homes&gt;");
    expect(html).toContain("&lt;b&gt;Ram&lt;/b&gt;");
  });

  it("puts the button link in the text version", () => {
    const url = "https://anar.visitshankhuwasabha.com/invite#token=k7Qm2xR9pA";
    const { html, text } = layout.render({
      preheader: "Join Sundar Heights",
      company: "Sundar Heights",
      blocks: [layout.button("Accept invite", url), layout.linkFallback(url)],
      footer,
    });
    expect(html).toContain(`href="${url}"`);
    expect(text).toContain(`Accept invite:\n${url}`);
    expect(text.split(url)).toHaveLength(2);
  });
});
