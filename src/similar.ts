// Is a new "to make this stronger" question the same as one the user already answered, just reworded?
// Content-word overlap, with distinctive tech terms (graphql, kubernetes, eventbridge...) weighted heavily.
const STOP = new Set("a an and any are as at be been beyond by can could do does for from has have how i if in is it its of on or other our so such than that the their them there these this to use used using was we were what when where which who with would you your yourself ever anything something specifically production prod project projects side build built work worked working experience hands hand even".split(" "));
const TECH = /^(graphql|kubernetes|k8s|ecs|eks|gke|fargate|eventbridge|appsync|kafka|rabbitmq|java|spring|kotlin|python|fastapi|django|terraform|grafana|prometheus|coralogix|datadog|opensearch|elasticsearch|mcp|saml|oauth|oidc|websockets?|grpc|redis|mongodb|cassandra|temporal|react|nextjs|go|golang|rust|c#|\.net|playwright|posthog|lambda|dynamodb|postgres|postgresql|a\/b|llm|rag|embeddings|vector)$/;

export function terms(q: string): string[] {
  return [...new Set(q.toLowerCase().replace(/[^a-z0-9#/.+ ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)))];
}

export function sameQuestion(a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true;
  const ta = terms(a), tb = terms(b);
  const techA = ta.filter((t) => TECH.test(t)), techB = tb.filter((t) => TECH.test(t));
  // same main technology: the first one each question names ("Have you used EventBridge...", "Any work with EventBridge or AppSync...")
  if (techA.length && techB.length && techA[0] === techB[0]) return true;
  // or they share a technology and neither is about much else
  if (techA.length <= 2 && techB.length <= 2 && techA.some((t) => techB.includes(t))) return true;
  const inter = ta.filter((t) => tb.includes(t)).length;
  return inter / new Set([...ta, ...tb]).size >= 0.5;
}
