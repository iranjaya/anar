export function formatPhone(phone: string | null): string {
  return phone?.replace(/^(\+977)(\d{10})$/, "$1 $2") ?? "No phone";
}
