import { describe, expect, it } from "vitest";
import { buildSeed } from "./seed";

describe("seed", () => {
  const now = new Date("2026-10-28T12:00:00+05:45");
  const tomorrow = new Date("2026-10-29T00:00:00+05:45");
  const seed = buildSeed(now);
  const sundar = seed.companies.find(
    (company) => company.slug === "sundar-heights",
  );
  const admins = seed.members.filter(
    (member) => member.companyId === sundar?.id && member.role === "admin",
  );
  const overdue = seed.leads.filter(
    (lead) =>
      lead.assignedTo !== null &&
      lead.nextActionAt !== null &&
      lead.nextActionAt < now &&
      seed.stages.some(
        (stage) => stage.id === lead.stageId && stage.kind === "open",
      ),
  );

  it("creates two companies and leaves Pahad empty", () => {
    expect(seed.companies.map((company) => company.slug).sort()).toEqual([
      "pahad-view",
      "sundar-heights",
    ]);
    const pahad = seed.companies.find(
      (company) => company.slug === "pahad-view",
    );
    expect(
      seed.leads.filter((lead) => lead.companyId === pahad?.id),
    ).toHaveLength(0);
    expect(
      seed.mappingTemplates.filter(
        (template) => template.companyId === pahad?.id,
      ),
    ).toHaveLength(0);
  });

  it("gives Sundar 45 unassigned leads from this morning", () => {
    const unassigned = seed.leads.filter(
      (lead) => lead.companyId === sundar?.id && lead.assignedTo === null,
    );
    const today = new Date("2026-10-28T00:00:00+05:45");
    expect(unassigned).toHaveLength(45);
    for (const lead of unassigned) {
      expect(lead.leadDate.getTime()).toBeGreaterThanOrEqual(today.getTime());
      expect(lead.leadDate.getTime()).toBeLessThan(now.getTime());
    }
  });

  it("gives Sunaina her overdue, due today and new story leads", () => {
    const sunaina = admins.find((member) => member.name === "Sunaina Shrestha");
    const leads = seed.leads.filter((lead) => lead.assignedTo === sunaina?.id);
    expect(leads).toHaveLength(10);
    expect(
      overdue.filter((lead) => lead.assignedTo === sunaina?.id),
    ).toHaveLength(3);
    expect(
      leads.filter(
        (lead) =>
          lead.nextActionAt !== null &&
          lead.nextActionAt >= now &&
          lead.nextActionAt < tomorrow,
      ),
    ).toHaveLength(3);

    const fresh = leads.filter((lead) => lead.lastContactedAt === null);
    expect(fresh).toHaveLength(4);
    for (const lead of fresh) {
      expect(
        seed.followUps.filter((call) => call.leadId === lead.id),
      ).toHaveLength(0);
      const assignment = seed.events.find(
        (event) => event.leadId === lead.id && event.type === "assigned",
      );
      expect(assignment?.createdAt.getTime()).toBeGreaterThan(
        now.getTime() - 24 * 60 * 60 * 1000,
      );
      expect(assignment?.createdAt.getTime()).toBeLessThanOrEqual(
        now.getTime(),
      );
    }

    expect(
      leads.find((lead) => lead.fullName === "Bikash Thapa"),
    ).toMatchObject({
      priority: "hot",
      score: 10,
      nextActionAt: new Date("2026-10-26T10:00:00+05:45"),
    });
    const nirmal = leads.find((lead) => lead.fullName === "Nirmal Adhikari");
    expect(nirmal).toMatchObject({
      failedAttempts: 5,
      lostSuggestedAt: expect.any(Date),
    });
    expect(
      seed.followUps.filter((call) => call.leadId === nirmal?.id),
    ).toHaveLength(5);
    expect(leads.filter((lead) => !lead.phoneValid)).toHaveLength(1);
    expect(leads.filter((lead) => lead.email === null)).toHaveLength(1);
  });

  it("gives Rojina more overdue leads than every other Sundar Admin", () => {
    const rojina = admins.find((member) => member.name === "Rojina Lama");
    const count = overdue.filter(
      (lead) => lead.assignedTo === rojina?.id,
    ).length;
    expect(admins).toHaveLength(5);
    expect(count).toBeGreaterThan(0);
    for (const member of admins.filter((member) => member.id !== rojina?.id)) {
      expect(count).toBeGreaterThan(
        overdue.filter((lead) => lead.assignedTo === member.id).length,
      );
    }
  });

  it("keeps today's calls inside today just after midnight", () => {
    const now = new Date("2026-10-31T00:19:00+05:45");
    const midnight = new Date("2026-10-31T00:00:00+05:45");
    const seed = buildSeed(now);
    const calls = seed.followUps.filter(
      (call) =>
        call.byMemberId === "sundar-heights-sunaina" &&
        call.happenedAt >= midnight,
    );
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call.happenedAt <= now).toBe(true);
  });
});
