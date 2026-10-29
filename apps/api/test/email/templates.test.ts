import { describe, expect, it } from "vitest";
import layout from "../../src/lib/email/templates/layout.js";
import signInCode from "../../src/lib/email/templates/signInCode.js";

const footer = {
  reason: "You got this email because Prakash Joshi invited you.",
  operator: "Anar is run by DNA for Sundar Heights.",
  contact: "Questions? Ask Prakash Joshi, your sales manager.",
};

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
