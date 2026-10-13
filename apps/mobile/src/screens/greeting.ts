/** The browser's own greeting for the hour on the person's clock (apps/web/src/pages/Dashboard.jsx). */
export function greetingAt(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
