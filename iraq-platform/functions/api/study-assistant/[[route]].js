// functions/api/study-assistant/[[route]].js — نقطة دخول مساعد الدراسة الذكي والمرشد الأكاديمي.
// المنطق في functions/_lib/study_assistant.js. يحتاج ربط D1 باسم DB، وWorkers AI باسم AI (أو GEMINI_API_KEY مع AI_PROVIDER_MODE=gemini).
// المسار /api/study-assistant/session له ملفه الخاص (session.js) ويبقى كما هو.
import { handleStudyAssistant } from "../../_lib/study_assistant.js";

export async function onRequest({ request, env }) {
  return (await handleStudyAssistant(request, env)) || new Response("not found", { status: 404 });
}
