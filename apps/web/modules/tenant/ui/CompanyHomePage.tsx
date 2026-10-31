import { getCompanyContext } from "../server";

export async function CompanyHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const result = await getCompanyContext((await params).slug);
  if (!result?.ok) return null;
  const { company, user, role } = result.data;
  return (
    <section>
      <h1 className="mb-6 font-display text-3xl font-bold wrap-break-word">
        {company.name}
      </h1>
      <div className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="font-display text-xl font-semibold">
          Welcome, {user.name}
        </h2>
        <dl className="mt-5 grid gap-5 lg:grid-cols-3">
          <div>
            <dt className="text-sm text-muted">Your role</dt>
            <dd className="mt-1 capitalize">{role.replaceAll("_", " ")}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Company status</dt>
            <dd className="mt-1 capitalize">{company.status}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Timezone</dt>
            <dd className="mt-1">{company.timezone}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
