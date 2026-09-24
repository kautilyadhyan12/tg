// Whether a gym can pay online, by its currency. Indian gyms pay through Razorpay (Kd,
// RULINGS 2026-09-24), which is ROADMAP Stage 3 item 1d.
export function onlinePaymentFor(currency: string, paddleSetUp: boolean): "available" | "coming_soon" | "unavailable" {
  if (currency === "INR") return "coming_soon";
  return paddleSetUp ? "available" : "unavailable";
}