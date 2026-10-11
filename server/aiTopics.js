// Optional: uses Claude to split the script into topics and write visual search queries.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const MODEL = 'claude-opus-5-5';

const TopicsSchema = z.object({
  topics: z.array(z.object({
    title: z.string(),
    summary: z.string(),
    keywords: z.array(z.string()),
    search_queries: z.array(z.string()),
  })),
});

const SYSTEM = `You help video editors find stock footage (B-roll) and photos for a script.
Split the script into the distinct topics it covers, in the order they appear.
For each topic return:
- title: a short label (2 to 6 words)
- summary: one sentence describing what the narration says
- keywords: 3 to 8 key nouns or names from that part of the script
- search_queries: 4 to 6 short queries (1 to 4 words each) to type into stock photo and video sites such as Pexels or Pixabay. Describe concrete things a camera could capture: subjects, places, objects, actions. Put the most specific query first and end with one broader fallback query. Avoid abstract words that return nothing visual.
Honour explicit visual cues in the script (for example "[B-roll: ...]") by including them as queries.`;

export async function aiDetectTopics(text, { apiKey, maxTopics = 8 } = {}) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('No Anthropic API key was provided for AI topic detection.');
  const client = new Anthropic({ apiKey: key });

  const response = await client.messages.parse(
    {
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: zodOutputFormat(TopicsSchema) },
      // If a safety classifier declines, the API retries on its recommended fallback model.
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Return at most ${maxTopics} topics.\n\n<script>\n${text}\n</script>`,
      }],
    },
    { headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' } },
  );

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined to analyse this script.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('The AI response was cut off before it finished.');
  }
  const parsed = response.parsed_output;
  if (!parsed?.topics?.length) throw new Error('The AI did not return any topics.');

  return parsed.topics.slice(0, maxTopics).map((t, i) => ({
    id: `t${i + 1}`,
    title: t.title.trim() || `Topic ${i + 1}`,
    summary: t.summary.trim(),
    keywords: t.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 8),
    queries: [...new Set(t.search_queries.map((q) => q.trim()).filter(Boolean))].slice(0, 6),
    cues: [],
  })).filter((t) => t.queries.length);
}
