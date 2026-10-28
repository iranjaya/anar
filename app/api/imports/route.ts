import { createImportBatchAction } from "@/modules/imports/actions";

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "validation", message: "Choose a CSV file." },
      { status: 400 },
    );
  }
  const result = await createImportBatchAction(
    input as Parameters<typeof createImportBatchAction>[0],
  );
  if (result.ok) return Response.json(result);
  const status = {
    unauthorized: 401,
    forbidden: 403,
    not_found: 404,
    validation: 400,
    conflict: 409,
    unavailable: 503,
  }[result.error];
  return Response.json(result, { status });
}
