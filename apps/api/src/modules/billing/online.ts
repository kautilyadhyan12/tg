// Whether a gym can pay online, by its currency: an Indian gym through Razorpay (Kd,
// RULINGS 2026-09-24; ROADMAP Stage 3 item 1d), every other through Paddle.
export interface OnlinePayments {
  paddle: boolean;
  razorpay: boolean;
}

export function onlinePaymentFor(currency: string, setUp: OnlinePayments): "available" | "unavailable" {
  if (currency === "INR") return setUp.razorpay ? "available" : "unavailable";
  return setUp.paddle ? "available" : "unavailable";
}
