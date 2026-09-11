export function openRouterTraceEnvironment(): "production" | "develop" {
  return process.env.VERCEL_ENV === "production" ? "production" : "develop";
}
