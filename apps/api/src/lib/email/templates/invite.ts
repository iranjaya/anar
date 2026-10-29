import layout, { type RenderedEmail } from "./layout.js";

export type InviteEmailInput = {
  name: string;
  role: "agency_staff" | "super_admin" | "admin";
  agency: string;
  // Null for an agency staff invite.
  company: string | null;
  inviter: { name: string; role: "owner" | "agency_staff" | "super_admin" };
  url: string;
  expiresAt: Date;
  timeZone: string;
  resent: boolean;
};
type Kind = "first_staff" | "staff" | "super_admin" | "admin";
type Copy = {
  role: string;
  preheader: string;
  heading(input: InviteEmailInput): string;
  subject(input: InviteEmailInput): string;
  intro(input: InviteEmailInput, from: string): string;
};

const copy: Record<Kind, Copy> = {
  first_staff: {
    role: "Agency staff",
    preheader: "Set up your agency on Anar.",
    heading: ({ agency }) => `Set up ${agency} on Anar`,
    subject: ({ agency, inviter }) =>
      `${inviter.name} invited you to set up ${agency} on Anar`,
    intro: ({ name, agency }, from) =>
      `Hi ${name}, ${from} set up ${agency} as a new agency, with you as its first staff member. You add your client companies, invite their sales managers and upload their leads.`,
  },
  staff: {
    role: "Agency staff",
    preheader: "Join as agency staff.",
    heading: ({ agency }) => `Join the ${agency} team on Anar`,
    subject: ({ agency, inviter }) =>
      `${inviter.name} invited you to the ${agency} team on Anar`,
    intro: ({ name, agency, inviter }) =>
      `Hi ${name}, ${inviter.name} added you to the ${agency} team. You help run its client companies: add companies, invite their sales managers and upload their leads.`,
  },
  super_admin: {
    role: "Super Admin (sales manager)",
    preheader: "Join as Super Admin, the sales manager.",
    heading: ({ company }) => `Join ${company} on Anar`,
    subject: ({ company, inviter }) =>
      `${inviter.name} invited you to ${company} on Anar`,
    intro: ({ name, company }, from) =>
      `Hi ${name}, ${from} added you as the sales manager for ${company}. You will see every lead, hand them to your sales team and track how the team is doing.`,
  },
  admin: {
    role: "Admin (salesperson)",
    preheader: "Join as Admin, on the sales team.",
    heading: ({ company }) => `Join ${company} on Anar`,
    subject: ({ company, inviter }) =>
      `${inviter.name} invited you to ${company} on Anar`,
    intro: ({ name, company }, from) =>
      `Hi ${name}, ${from} added you to the ${company} sales team. In Anar you see the leads given to you, call them from your phone and log each call.`,
  },
};

const invite = {
  render(input: InviteEmailInput): RenderedEmail {
    const { name, agency, company, inviter, url, resent } = input;
    const text = copy[invite._kind(input)];
    const target = company ?? agency;
    const from = invite._from(input);
    const blocks = resent
      ? [
          layout.heading("Here is your new invite link"),
          layout.notice(
            "Use the new link in this email.",
            "warn",
            "Your earlier invite link no longer works",
          ),
          layout.para(
            `Hi ${name}, ${from} sent you a fresh invite to ${target}.`,
          ),
        ]
      : [
          layout.heading(text.heading(input)),
          layout.para(text.intro(input, from)),
        ];
    blocks.push(
      layout.rows([
        company ? ["Company", company] : ["Agency", agency],
        ["Your role", text.role],
        ["Invited by", invite._invitedBy(input)],
        ["Link works until", invite._expiry(input.expiresAt, input.timeZone)],
      ]),
      layout.button("Accept invite", url),
      layout.linkFallback(url),
    );
    if (input.role === "admin" && !resent)
      blocks.push(
        layout.notice(
          "Open the link on your phone. That is where you will use Anar most.",
        ),
      );
    return {
      subject: resent
        ? `New invite link for ${target} on Anar`
        : text.subject(input),
      ...layout.render({
        preheader: resent
          ? "Your earlier link no longer works. Use this one within 7 days."
          : `${text.preheader} The link works for 7 days.`,
        company: target,
        blocks,
        footer: {
          reason: `You got this email because ${from} invited you to ${target} on Anar. Not expecting it? Ignore it and nothing happens.`,
          operator: company
            ? `Anar is run by ${agency} for ${company}.`
            : `Anar is the lead tracker ${agency} uses for its client companies.`,
          contact:
            inviter.role === "super_admin"
              ? `Questions? Ask ${inviter.name}, your sales manager.`
              : `Questions? Ask ${from}.`,
        },
      }),
    };
  },

  _kind({ role, inviter }: InviteEmailInput): Kind {
    if (role !== "agency_staff") return role;
    return inviter.role === "owner" ? "first_staff" : "staff";
  },

  _from({ agency, inviter }: InviteEmailInput): string {
    if (inviter.role === "owner") return `${inviter.name} from Anar`;
    if (inviter.role === "agency_staff")
      return `${inviter.name} from ${agency}`;
    return inviter.name;
  },

  _invitedBy({ agency, inviter }: InviteEmailInput): string {
    if (inviter.role === "owner") return `${inviter.name}, Anar`;
    if (inviter.role === "agency_staff") return `${inviter.name}, ${agency}`;
    return `${inviter.name}, Super Admin`;
  },

  // Reads like "Thu 5 Nov, 4:30 pm" in the company's time zone.
  _expiry(date: Date, timeZone: string): string {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone,
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
        .formatToParts(date)
        .map((part) => [part.type, part.value]),
    );
    return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${parts.dayPeriod.toLowerCase()}`;
  },
};

export default invite;
