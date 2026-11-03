import { notFound } from "next/navigation";
import { ReadError } from "@/components/ReadError";
import { getSettings } from "@/modules/settings/server";
import type { Field } from "@/modules/settings/types";
import { getCompanyContext } from "@/modules/tenant/server";
import { getScoringDefaults } from "../server";
import type { ScoringConfig } from "../types";

export async function ScoringDefaultsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const context = await getCompanyContext(slug);
  if (!context?.ok || !context.data.capabilities.includes("settings.manage"))
    notFound();
  const [config, settings] = await Promise.all([
    getScoringDefaults(slug),
    getSettings(slug),
  ]);
  const href = `/${slug}/settings/scoring`;
  const failure = [config, settings].find((result) => !result?.ok);
  return (
    <section className="min-w-0">
      <h1 className="font-display text-3xl font-bold">Lead scoring</h1>
      <p className="mt-2 text-muted wrap-break-word">
        {context.data.company.name}
      </p>
      {!config?.ok || !settings?.ok ? (
        <div className="mt-6">
          <ReadError
            message={
              failure && !failure.ok
                ? failure.message
                : "Scoring could not be loaded."
            }
            href={href}
          />
        </div>
      ) : (
        <ScoringRules config={config.data} fields={settings.data.fields} />
      )}
    </section>
  );
}

function ScoringRules({
  config,
  fields,
}: {
  config: ScoringConfig;
  fields: Field[];
}) {
  return (
    <>
      <dl className="mt-6 grid grid-cols-3 gap-3">
        {[
          ["Base", config.basePoints],
          ["Warm from", config.warmMin],
          ["Hot from", config.hotMin],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-2xl border border-line bg-surface p-4"
          >
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="font-display text-2xl font-bold tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-muted">Version {config.version}</p>
      {config.rules.map((rule) => {
        const field = fields.find((f) => f.key === rule.fieldKey);
        return (
          <section
            key={rule.fieldKey}
            aria-labelledby={`rule-${rule.fieldKey}`}
            className="mt-6"
          >
            <h2
              id={`rule-${rule.fieldKey}`}
              className="font-display text-xl font-semibold wrap-break-word"
            >
              {field?.label ?? rule.fieldKey}
            </h2>
            <ul className="mt-3 space-y-2">
              {rule.kind === "options" &&
                Object.entries(rule.points).map(([code, points]) => (
                  <li
                    key={code}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 rounded-2xl border border-line bg-surface p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem]"
                  >
                    <span className="font-semibold wrap-break-word">
                      {field?.options?.find((o) => o.value === code)?.label ??
                        code}
                    </span>
                    <span className="row-start-2 text-sm text-muted wrap-break-word lg:row-start-auto">
                      Code {code}
                    </span>
                    <span className="row-span-2 self-center text-right font-semibold tabular-nums lg:row-span-1">
                      {points} {points === 1 ? "pt" : "pts"}
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
