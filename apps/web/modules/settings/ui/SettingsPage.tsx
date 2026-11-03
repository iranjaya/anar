import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ReadError } from "@/components/ReadError";
import { getCompanyContext } from "@/modules/tenant/server";
import { getSettings } from "../server";
import { FieldForm } from "./FieldForm";
import { FieldList } from "./FieldList";
import { LostReasonList } from "./LostReasonList";
import { OutcomeList } from "./OutcomeList";
import { StageForm } from "./StageForm";
import { StageList } from "./StageList";

export async function SettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const context = await getCompanyContext(slug);
  if (!context?.ok || !context.data.capabilities.includes("settings.manage"))
    notFound();
  const catalog = await getSettings(slug);
  const href = `/${slug}/settings`;
  const sections: { id: string; title: string; content: ReactNode }[] =
    catalog?.ok
      ? [
          {
            id: "fields",
            title: "Fields",
            content: (
              <>
                <FieldList slug={slug} fields={catalog.data.fields} />
                <FieldForm slug={slug} />
              </>
            ),
          },
          {
            id: "stages",
            title: "Stages",
            content: (
              <>
                <StageList slug={slug} stages={catalog.data.stages} />
                <StageForm
                  slug={slug}
                  stages={catalog.data.stages.filter(
                    (stage) => stage.archivedAt === null,
                  )}
                />
              </>
            ),
          },
          {
            id: "outcomes",
            title: "Call outcomes",
            content: (
              <OutcomeList slug={slug} outcomes={catalog.data.outcomes} />
            ),
          },
          {
            id: "lost-reasons",
            title: "Lost reasons",
            content: (
              <LostReasonList
                slug={slug}
                lostReasons={catalog.data.lostReasons}
              />
            ),
          },
        ]
      : [];
  return (
    <section className="min-w-0">
      <h1 className="font-display text-3xl font-bold">Settings</h1>
      <p className="mt-2 text-muted wrap-break-word">
        {context.data.company.name}
      </p>
      {!catalog?.ok ? (
        <div className="mt-6">
          <ReadError
            message={catalog?.message ?? "Settings could not be loaded."}
            href={href}
          />
        </div>
      ) : (
        <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[12rem_minmax(0,1fr)] lg:items-start">
          <nav
            aria-label="Settings sections"
            className="hidden lg:sticky lg:top-6 lg:block"
          >
            <ul className="space-y-1">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="flex min-h-11 items-center rounded-xl px-3 font-semibold text-muted hover:bg-surface hover:text-ink"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="min-w-0 space-y-8">
            {sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-heading`}
                className="min-w-0 scroll-mt-6"
              >
                <h2
                  id={`${section.id}-heading`}
                  className="font-display text-xl font-semibold"
                >
                  {section.title}
                </h2>
                {section.content}
              </section>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
