import layout, { type RenderedEmail } from "./layout.js";

const stepUpCode = {
  render(input: { code: string }): RenderedEmail {
    return {
      subject: `${input.code} is your Anar code to confirm`,
      ...layout.render({
        preheader:
          "It confirms a sensitive action in Anar and works for 10 minutes.",
        company: null,
        blocks: [
          layout.heading("Your code to confirm"),
          layout.para(
            "Enter this code in Anar to confirm the sensitive action you started, like an invite or a settings change.",
          ),
          layout.code(input.code),
          layout.para("It works for 10 minutes and only once."),
          layout.notice(
            "Someone may have your session. Open Anar and sign out your other devices.",
            "warn",
            "Did not try this?",
          ),
        ],
        footer: {
          reason:
            "You got this email because someone signed in as you asked to confirm a sensitive action in Anar.",
          operator: "Anar is a lead tracker for sales teams.",
          contact: "Trouble with the code? Ask the person who invited you.",
        },
      }),
    };
  },
};

export default stepUpCode;
