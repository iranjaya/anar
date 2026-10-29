export type Block = { html: string; text: string | null };
export type RenderedEmail = { subject: string; text: string; html: string };
export type Footer = { reason: string; operator: string; contact: string };
type Tone = "overdue" | "due" | "new" | "call" | "brand" | "plain";
type Stat = { value: number; label: string; tone: Tone };

// The app tokens from apps/web/app/globals.css. Email clients have no CSS variables.
const color = {
  bg: "#f3f5f4",
  surface: "#ffffff",
  line: "#dee3e1",
  ink: "#15191b",
  ink2: "#2e3639",
  muted: "#4a5458",
  brand: "#7a1438",
  brandSoft: "#f1e4e9",
  overdue: "#b42318",
  overdueSoft: "#fdecea",
  due: "#7a4a00",
  dueSoft: "#fff3d1",
  dueEdge: "#d99a06",
  new: "#1e4fc2",
  newSoft: "#e6eefc",
  call: "#0b6e4f",
  callSoft: "#e3f2ea",
};
const tones: Record<Tone, [soft: string, strong: string]> = {
  overdue: [color.overdueSoft, color.overdue],
  due: [color.dueSoft, color.due],
  new: [color.newSoft, color.new],
  call: [color.callSoft, color.call],
  brand: [color.brandSoft, color.brand],
  plain: [color.bg, color.ink],
};
// Gmail drops web fonts, so the email uses the reader's system font.
const font =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const mono =
  "ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace";

const layout = {
  render(input: {
    preheader: string;
    company: string | null;
    blocks: Block[];
    footer: Footer;
  }): { html: string; text: string } {
    const { _escape: esc, _type: type, _table: table } = layout;
    const footerLines = [
      input.footer.reason,
      input.footer.operator,
      input.footer.contact,
    ];
    const header =
      table('width="100%"') +
      `<tr><td align="left" valign="middle" style="${type(22, 28, 800, color.brand)}letter-spacing:-0.5px;">Anar</td>` +
      `<td align="right" valign="middle" style="${type(14, 20, 600, color.muted)}">${input.company ? esc(input.company) : ""}</td></tr></table>`;
    const body =
      table('width="100%"') +
      input.blocks
        .map(
          (block, i) =>
            `<tr><td style="padding:0 0 ${i === input.blocks.length - 1 ? 0 : 20}px;">${block.html}</td></tr>`,
        )
        .join("") +
      "</table>";
    const footer = footerLines
      .map(
        (line) =>
          `<p style="margin:0 0 6px;${type(13, 19, 400, color.muted)}">${esc(line)}</p>`,
      )
      .join("");
    // The filler stops Gmail pulling body text into the inbox preview line.
    // Outlook skips the [if !mso] block, as it ignores display:none.
    const preheader = `<!--[if !mso]><!--><div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${color.bg};opacity:0;">${esc(input.preheader)}${"&#847;&zwnj;&nbsp;".repeat(40)}</div><!--<![endif]-->`;
    const html =
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">' +
      `</head><body style="margin:0;padding:0;background:${color.bg};">${preheader}` +
      table(
        `width="100%" bgcolor="${color.bg}" style="background:${color.bg};"`,
      ) +
      '<tr><td align="center" style="padding:24px 12px 32px;">' +
      // Outlook desktop ignores max-width, so it gets a fixed 600px table.
      '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->' +
      table('width="100%" style="max-width:600px;"') +
      `<tr><td style="padding:0 8px 14px;">${header}</td></tr>` +
      `<tr><td bgcolor="${color.surface}" style="background:${color.surface};border:1px solid ${color.line};border-radius:12px;padding:28px 24px;">${body}</td></tr>` +
      `<tr><td style="padding:20px 8px 0;">${footer}</td></tr>` +
      "</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>";
    const text = [
      input.company ? `Anar | ${input.company}` : "Anar",
      ...input.blocks.flatMap((block) => (block.text ? [block.text] : [])),
      `--\n${layout._wrap(footerLines.join("\n"))}`,
    ].join("\n\n");
    return { html, text };
  },

  heading(title: string, sub?: string): Block {
    const { _escape: esc, _type: type } = layout;
    return {
      html:
        `<h1 style="margin:0;${type(22, 28, 700, color.ink)}">${esc(title)}</h1>` +
        (sub
          ? `<p style="margin:4px 0 0;${type(14, 20, 400, color.muted)}">${esc(sub)}</p>`
          : ""),
      text: sub ? `${title}\n${sub}` : title,
    };
  },

  para(text: string): Block {
    return {
      html: `<p style="margin:0;${layout._type(16, 24, 400, color.ink2)}">${layout._escape(text)}</p>`,
      text: layout._wrap(text),
    };
  },

  button(label: string, url: string): Block {
    const { _escape: esc, _type: type } = layout;
    return {
      html:
        layout._table() +
        `<tr><td bgcolor="${color.brand}" style="background:${color.brand};border-radius:8px;">` +
        `<a href="${esc(url)}" style="display:inline-block;padding:15px 32px;${type(16, 20, 600, "#ffffff")}text-decoration:none;border-radius:8px;">${esc(label)}</a>` +
        "</td></tr></table>",
      text: `${label}:\n${url}`,
    };
  },

  // Html only: the button's text version already prints the link.
  linkFallback(url: string): Block {
    const esc = layout._escape;
    return {
      html:
        `<p style="margin:0;${layout._type(13, 19, 400, color.muted)}">Button not working? Copy this link into your browser:<br>` +
        `<a href="${esc(url)}" style="color:${color.brand};word-break:break-all;">${esc(url)}</a></p>`,
      text: null,
    };
  },

  // One text run with no spaces, so a long press copies the whole code.
  code(digits: string): Block {
    return {
      html:
        layout._table('width="100%"') +
        `<tr><td align="center" bgcolor="${color.brandSoft}" style="background:${color.brandSoft};border-radius:12px;padding:18px 12px;">` +
        `<div style="${layout._type(36, 44, 700, color.ink, mono)}letter-spacing:10px;padding-left:10px;">${layout._escape(digits)}</div>` +
        "</td></tr></table>",
      text: `    ${digits}`,
    };
  },

  stats(items: Stat[], cols = items.length): Block {
    const { _escape: esc, _type: type, _table: table } = layout;
    const width = Math.floor(100 / cols);
    const rows: Stat[][] = [];
    for (let i = 0; i < items.length; i += cols)
      rows.push(items.slice(i, i + cols));
    const html = rows
      .map(
        (row) =>
          `${table('width="100%"')}<tr>${row
            .map((item, i) => {
              const [soft, strong] = tones[item.tone];
              const gap = i
                ? '<td width="8" style="width:8px;font-size:0;line-height:0;">&nbsp;</td>'
                : "";
              return (
                `${gap}<td width="${width}%" valign="top" bgcolor="${soft}" style="width:${width}%;background:${soft};border-radius:10px;padding:14px 12px;">` +
                `<div style="${type(30, 34, 800, strong)}">${esc(item.value)}</div>` +
                `<div style="margin-top:2px;${type(13, 18, 600, color.ink2)}">${esc(item.label)}</div></td>`
              );
            })
            .join("")}</tr></table>`,
      )
      .join(
        '<div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>',
      );
    const pad = Math.max(...items.map((item) => String(item.value).length)) + 2;
    return {
      html,
      text: items
        .map((item) => String(item.value).padEnd(pad) + item.label)
        .join("\n"),
    };
  },

  rows(items: [label: string, value: string][]): Block {
    const { _escape: esc, _type: type } = layout;
    const html = items
      .map(([label, value], i) => {
        const border = `border-bottom:1px solid ${color.line};${i ? "" : `border-top:1px solid ${color.line};`}`;
        return (
          `<tr><td valign="top" style="padding:10px 12px 10px 0;${border}${type(14, 20, 400, color.muted)}">${esc(label)}</td>` +
          `<td align="right" valign="top" style="padding:10px 0;${border}${type(15, 20, 600, color.ink)}">${esc(value)}</td></tr>`
        );
      })
      .join("");
    return {
      html: `${layout._table('width="100%"')}${html}</table>`,
      text: items.map(([label, value]) => `${label}: ${value}`).join("\n"),
    };
  },

  notice(body: string, tone: "info" | "warn" = "info", title?: string): Block {
    const { _escape: esc, _type: type } = layout;
    const [bg, edge, head] =
      tone === "warn"
        ? [color.dueSoft, color.dueEdge, color.due]
        : [color.bg, color.line, color.ink];
    return {
      html:
        layout._table('width="100%"') +
        `<tr><td bgcolor="${bg}" style="background:${bg};border:1px solid ${edge};border-radius:10px;padding:12px 14px;">` +
        (title
          ? `<div style="${type(14, 20, 700, head)}">${esc(title)}</div>`
          : "") +
        `<div style="${type(14, 20, 400, color.ink2)}">${esc(body)}</div></td></tr></table>`,
      text: layout._wrap(title ? `${title}\n${body}` : body),
    };
  },

  _escape(value: string | number): string {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  },

  _type(
    size: number,
    lineHeight: number,
    weight: number,
    textColor: string,
    family = font,
  ): string {
    return `font-family:${family};font-size:${size}px;line-height:${lineHeight}px;font-weight:${weight};color:${textColor};`;
  },

  _table(attrs = ""): string {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ${attrs}>`;
  },

  // Some phone clients show plain text without wrapping it.
  _wrap(text: string, width = 70): string {
    return text
      .split("\n")
      .map((line) => {
        const lines: string[] = [];
        let current = "";
        for (const word of line.split(" ")) {
          if (current && `${current} ${word}`.length > width) {
            lines.push(current);
            current = word;
          } else current = current ? `${current} ${word}` : word;
        }
        lines.push(current);
        return lines.join("\n");
      })
      .join("\n");
  },
};

export default layout;
