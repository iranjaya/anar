export function templateNameFromFile(name: string): string {
  return name.replace(/_Leads_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/i, "");
}
