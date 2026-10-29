import layout, { type RenderedEmail } from "./layout.js";

const signInCode = {
  render(input: { code: string }): RenderedEmail {
    return {
      subject: `${input.code} is your Anar sign-in code`,
      ...layout.render({
        preheader:
          "It works for 10 minutes. If you did not ask for it, ignore this email.",
        company: null,
        blocks: [
          layout.heading("Your sign-in code"),
          layout.para("Enter this code in Anar to sign in."),
          layout.code(input.code),
          layout.para(
            "It works for 10 minutes and only once. If you ask for a new code, this one stops working.",
          ),
          layout.notice(
            "Ignore this email. Nobody can sign in without the code.",
            "info",
            "Did not ask for this?",
          ),
        ],
        footer: {
          reason:
            "You got this email because someone asked to sign in to Anar with this email address.",
          operator: "Anar is a lead tracker for sales teams.",
          contact: "Trouble signing in? Ask the person who invited you.",
        },
      }),
    };
  },
};

export default signInCode;
