// Splits a script into topics and derives stock-media search queries for each one.
// This is the built-in, offline method. aiTopics.js offers an optional Claude-powered one.
import {
  words, stem, isContentWord, termFreq, cosine, titleCase, wordCount, contentStems, ABSTRACT, VERBS, STOPWORDS,
} from './text.js';

export const DEFAULT_MAX_TOPICS = 20;
export const MAX_TOPICS = 30;

const CUE_RE = /\[(?:b-?roll|visuals?|shot|footage|images?|img|graphic|on[- ]screen|show|cut to)\s*[:\-–]\s*([^\]]+)\]/gi;
const CUE_LINE_RE = /^\s*\(?(?:b-?roll|visuals?|shot|footage|on[- ]screen|cut to)\s*[:\-–]\s*(.+?)\)?\s*$/i;
const NUMBERED_HEADING_RE = /^(?:scene|part|section|chapter|segment|act|step)\s*(?:\d+|[ivx]+)\b\s*[:.\-–]*\s*(.*)$/i;
const GENERIC_TITLE_RE = /^(?:the\s+)?(?:intro(?:duction)?|outro|conclusion|hook|cta|call to action|summary|recap|ending|opening|closing|final thoughts?|wrap[- ]?up|sponsor(?:ship)?|ad read)$/i;

export function extractCues(text) {
  const cues = [];
  for (const m of String(text).matchAll(CUE_RE)) cues.push(m[1].trim());
  for (const line of String(text).split('\n')) {
    const m = line.match(CUE_LINE_RE);
    if (m) cues.push(m[1].trim());
  }
  return [...new Set(cues.filter((c) => c.length > 1 && c.length <= 80))];
}

function cleanHeading(raw) {
  let t = raw.trim().replace(/^#+\s*/, '').replace(/^\*\*(.+)\*\*$/, '$1').replace(/[:.]+$/, '').trim();
  const numbered = t.match(NUMBERED_HEADING_RE);
  if (numbered) t = numbered[1].trim() || t;
  // Screenplay scene headings: "INT. COFFEE SHOP - NIGHT" -> "Coffee Shop"
  t = t.replace(/^(?:int|ext|int\.?\/ext)\.\s*/i, '')
    .replace(/\s+[-–]\s+(?:day|night|morning|evening|later|continuous|dawn|dusk)$/i, '');
  if (t === t.toUpperCase()) t = titleCase(t.toLowerCase());
  return t.trim();
}

export function headingText(line) {
  const t = line.trim();
  if (!t || t.length > 90) return null;
  if (CUE_LINE_RE.test(t) || /^\[(?:b-?roll|visuals?|shot|footage|images?|img|graphic|on[- ]screen|show|cut to)\b/i.test(t)) return null;
  const n = t.split(/\s+/).length;
  if (/^#{1,6}\s+\S/.test(t)) return cleanHeading(t);
  const bracket = t.match(/^\[([^\]]{1,60})\]$/);
  if (bracket) return cleanHeading(bracket[1]);
  if (NUMBERED_HEADING_RE.test(t) && n <= 10) return cleanHeading(t);
  if (/^\*\*[^*]+\*\*:?$/.test(t) && n <= 10) return cleanHeading(t);
  if (n <= 8 && /[A-Z]{2}/.test(t) && t === t.toUpperCase() && !/[.!?,]$/.test(t)) {
    // An all-caps speaker label such as "NARRATOR:" is not a heading.
    if (/^[A-Z][A-Z .'-]*:$/.test(t) && n <= 2) return null;
    return cleanHeading(t);
  }
  if (n <= 8 && /:$/.test(t) && /^[A-Z0-9]/.test(t)) return cleanHeading(t);
  return null;
}

function cleanBody(text) {
  return String(text)
    .replace(CUE_RE, ' ')
    .split('\n')
    .filter((l) => !CUE_LINE_RE.test(l))
    .join('\n')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*[A-Z][A-Z .'-]{1,30}:\s*/gm, '') // speaker labels
    .replace(/\((?:v\.o\.|o\.s\.|cont'd|beat|pause)\)/gi, ' ')
    .replace(/[*_`>#~|]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function isMeaningfulTitle(title) {
  return Boolean(title) && !GENERIC_TITLE_RE.test(title.trim()) && !NUMBERED_HEADING_RE.test(title.trim());
}

function splitIntoSections(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const sections = [];
  let cur = { title: null, raw: [] };
  let headed = 0;
  for (const line of lines) {
    const h = headingText(line);
    if (h !== null) {
      headed += 1;
      if (cur.title || cur.raw.some((l) => l.trim())) sections.push(cur);
      cur = { title: h, raw: [] };
    } else {
      cur.raw.push(line);
    }
  }
  if (cur.title || cur.raw.some((l) => l.trim())) sections.push(cur);
  return { sections: sections.map((s) => ({ title: s.title, rawText: s.raw.join('\n') })), headed };
}

function sentenceChunks(text, targetWords = 70) {
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9"“'])/);
  const chunks = [];
  let cur = [];
  let count = 0;
  for (const s of sentences) {
    cur.push(s);
    count += wordCount(s);
    if (count >= targetWords) {
      chunks.push(cur.join(' '));
      cur = [];
      count = 0;
    }
  }
  if (cur.length) {
    if (chunks.length && count < targetWords / 3) chunks[chunks.length - 1] += ` ${cur.join(' ')}`;
    else chunks.push(cur.join(' '));
  }
  return chunks;
}

function mergeTitles(a, b) {
  const ta = isMeaningfulTitle(a) ? a : null;
  const tb = isMeaningfulTitle(b) ? b : null;
  if (ta && tb) return `${ta} & ${tb}`.slice(0, 80);
  return ta || tb || a || b || null;
}

function mergeBlocks(blocks, { target, minWords, simThreshold = 1 }) {
  const list = blocks.map((b) => ({ ...b, tf: termFreq(b.body), words: wordCount(b.body) }));
  const merge = (i) => {
    const a = list[i];
    const b = list[i + 1];
    const body = `${a.body}\n\n${b.body}`;
    list.splice(i, 2, {
      title: mergeTitles(a.title, b.title),
      named: Boolean(a.named && b.named),
      rawText: `${a.rawText}\n\n${b.rawText}`,
      body,
      tf: termFreq(body),
      words: a.words + b.words,
    });
  };
  while (list.length > 1) {
    const tinyIdx = list.findIndex((b) => b.words < minWords);
    if (tinyIdx !== -1) {
      if (tinyIdx === 0) merge(0);
      else if (tinyIdx === list.length - 1) merge(tinyIdx - 1);
      else {
        const left = cosine(list[tinyIdx - 1].tf, list[tinyIdx].tf);
        const right = cosine(list[tinyIdx].tf, list[tinyIdx + 1].tf);
        merge(left >= right ? tinyIdx - 1 : tinyIdx);
      }
      continue;
    }
    let best = 0;
    let bestSim = -1;
    for (let i = 0; i < list.length - 1; i++) {
      // Slightly favour merging short neighbours so topics stay balanced.
      const sim = cosine(list[i].tf, list[i + 1].tf) - (list[i].words + list[i + 1].words) / 20000;
      if (sim > bestSim) {
        bestSim = sim;
        best = i;
      }
    }
    if (list.length <= target && bestSim < simThreshold) break;
    merge(best);
  }
  return list;
}

function candidatePhrases(body) {
  const cands = new Map();
  const sentences = body.split(/(?<=[.!?])\s+|\n+/);
  for (const sentence of sentences) {
    const fragments = sentence.split(/[,;:()"“”!?.—–]|\s-\s/);
    let first = true;
    for (const frag of fragments) {
      const ws = words(frag);
      let run = [];
      const flush = () => {
        for (let len = 1; len <= 3; len++) {
          for (let i = 0; i + len <= run.length; i++) {
            const part = run.slice(i, i + len);
            const key = part.map((p) => stem(p.w)).join(' ');
            const entry = cands.get(key) || { key, count: 0, forms: new Map(), proper: 0, len };
            entry.count += 1;
            const surface = part.map((p) => p.w).join(' ');
            entry.forms.set(surface, (entry.forms.get(surface) || 0) + 1);
            if (part.every((p) => p.cap && !p.first)) entry.proper += 1;
            cands.set(key, entry);
          }
        }
        run = [];
      };
      for (const w of ws) {
        const cap = /^[A-Z]/.test(w);
        // Capitalised words mid-sentence keep names together ("Great Barrier Reef").
        const properPart = cap && !first && w.length > 2 && STOPWORDS.has(w.toLowerCase()) && !/^(?:I|The|And|But|Or|Of)$/.test(w);
        if ((isContentWord(w) && !/ly$/i.test(w)) || properPart) {
          run.push({ w, cap, first });
        } else {
          flush();
        }
        first = false;
      }
      flush();
    }
  }
  return [...cands.values()];
}

function extractKeywords(body, idf, max = 6) {
  const lenBoost = { 1: 1, 2: 1.7, 3: 1.75 };
  const scored = candidatePhrases(body).map((c) => {
    const stems = c.key.split(' ');
    const meanIdf = stems.reduce((s, x) => s + (idf.get(x) ?? 1), 0) / stems.length;
    const lowerWords = c.key.split(' ');
    const abstractCount = stems.filter((x) => ABSTRACT.has(x) || ABSTRACT.has(`${x}s`)).length;
    const surfaceWords = [...c.forms.keys()][0].toLowerCase().split(' ');
    const verbCount = surfaceWords.filter((w) => VERBS.has(w)).length;
    let score = c.count * meanIdf * lenBoost[c.len];
    if (c.proper > 0) score *= 1.5;
    else if (lowerWords.some((w) => STOPWORDS.has(w))) score *= 0.3; // "great" only counts inside a name
    if (abstractCount === stems.length) score *= 0.25;
    else if (abstractCount) score *= 0.6;
    if (verbCount === stems.length) score *= 0.2;
    else if (verbCount) score *= 0.45;
    if (/ing$/.test(surfaceWords[surfaceWords.length - 1]) && c.len === 1) score *= 0.7;
    // "robert pitman photographed", "team analyzed": a trailing past-tense verb makes a poor search.
    const lastWord = surfaceWords[surfaceWords.length - 1];
    if (c.proper === 0 && lastWord.length > 4 && /[^e]ed$/.test(lastWord)) score *= 0.35;
    const form = [...c.forms.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { key: c.key, stems, score, phrase: c.proper > 0 ? form : form.toLowerCase() };
  }).sort((a, b) => b.score - a.score);

  const picked = [];
  const covered = new Set();
  const floor = (scored[0]?.score || 0) * 0.2;
  for (const cand of scored) {
    if (cand.score < floor) break;
    if (picked.length >= max) break;
    // Prefer a strong longer phrase over the shorter one it contains ("green sea turtles" over "green sea").
    const sub = picked.findIndex((p) => p.stems.length < cand.stems.length && p.stems.every((s) => cand.stems.includes(s)));
    if (sub !== -1 && cand.score >= picked[sub].score * 0.5) {
      picked[sub] = cand;
      for (let i = picked.length - 1; i >= 0; i--) {
        if (picked[i] !== cand && picked[i].stems.every((s) => cand.stems.includes(s))) picked.splice(i, 1);
      }
      cand.stems.forEach((s) => covered.add(s));
      continue;
    }
    if (cand.stems.every((s) => covered.has(s))) continue;
    picked.push(cand);
    cand.stems.forEach((s) => covered.add(s));
  }
  return picked.map((p) => p.phrase);
}

function firstSentence(text, max = 200) {
  const s = text.replace(/\s+/g, ' ').trim();
  const m = s.match(/^.+?[.!?](?=\s|$)/);
  const out = (m ? m[0] : s);
  return out.length > max ? `${out.slice(0, max - 1).trim()}…` : out;
}

function uniqueQueries(list, max = 6, seen = []) {
  const out = [];
  for (const q of list) {
    const clean = String(q || '').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    const stems = [...new Set(words(clean).filter(isContentWord).map(stem))];
    if (!stems.length) continue;
    // Skip a query that only repeats words of an earlier, more specific one.
    if (seen.some((prev) => stems.every((x) => prev.includes(x)))) continue;
    seen.push(stems);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

// Paragraphs are separated by blank lines, or by single line breaks when the script is
// written one long paragraph per line (common when copying from docs or teleprompters).
export function splitParagraphs(text) {
  const byBlank = String(text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  const longLines = lines.filter((l) => wordCount(l) >= 15).length;
  if (lines.length > byBlank.length && longLines >= Math.max(2, lines.length * 0.6)) return lines;
  return byBlank;
}

// A "label" is a short sentence that just names the subject, the way list-style scripts
// introduce each item: "Blue whale." "Orca." "North Atlantic right whale."
export function labelSentences(paragraph) {
  return String(paragraph).split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((sentence) => {
    if (!/^[A-Z][^.!?]*\.$/.test(sentence)) return false;
    const tokens = sentence.slice(0, -1).split(/\s+/);
    if (tokens.length > 4 || !tokens.every((t) => /^[A-Za-z][A-Za-z'’-]*$/.test(t))) return false;
    const lower = tokens.map((t) => t.toLowerCase().replace(/[’']s$/, ''));
    if (STOPWORDS.has(lower[0])) return false;
    if (lower.filter((t) => STOPWORDS.has(t)).length > 1) return false;
    if (lower.some((t) => VERBS.has(t) || ABSTRACT.has(t) || /(?:ly|ing|ed)$/.test(t))) return false;
    return true;
  }).map((x) => x.slice(0, -1));
}

// Picks one label per paragraph when the script consistently uses them, else returns null.
function detectLabels(blocks) {
  const cands = blocks.map((b) => labelSentences(b.body));
  const labelled = cands.filter((c) => c.length).length;
  if (labelled < 3 || labelled < blocks.length * 0.4) return null;
  // Labels that share a head word with other paragraphs' labels ("... whale") are the strongest.
  const heads = new Map();
  for (const c of cands) {
    for (const h of new Set(c.map((l) => stem(l.split(/\s+/).pop())))) heads.set(h, (heads.get(h) || 0) + 1);
  }
  return cands.map((c) => {
    if (!c.length) return null;
    return [...c].sort((a, b) => (heads.get(stem(b.split(/\s+/).pop())) || 0) - (heads.get(stem(a.split(/\s+/).pop())) || 0))[0];
  });
}

// Builds topics from labelled paragraphs. Unlabelled paragraphs between two labelled ones
// continue the previous topic; an unlabelled opening or closing paragraph stays on its own.
function labelledBlocks(blocks, labels) {
  const first = labels.findIndex(Boolean);
  let last = -1;
  labels.forEach((l, i) => { if (l) last = i; });
  const out = [];
  blocks.forEach((b, i) => {
    if (labels[i]) out.push({ ...b, title: labels[i], named: true });
    else if (i < first || i > last) out.push({ ...b, title: null });
    else {
      const prev = out[out.length - 1];
      prev.body = `${prev.body}\n\n${b.body}`;
      prev.rawText = `${prev.rawText}\n\n${b.rawText}`;
    }
  });
  return out;
}

export function detectTopics(text, { maxTopics = DEFAULT_MAX_TOPICS } = {}) {
  const source = String(text || '').trim();
  if (!source) return [];
  maxTopics = Math.max(1, Math.min(MAX_TOPICS, Number(maxTopics) || DEFAULT_MAX_TOPICS));

  const { sections, headed } = splitIntoSections(source);
  let blocks;
  if (headed >= 2) {
    blocks = sections
      .map((s) => ({ title: s.title, rawText: s.rawText, body: cleanBody(s.rawText) }))
      .filter((b) => b.body || isMeaningfulTitle(b.title));
    // A heading with no body (e.g. "SCENE 1" directly above "INT. KITCHEN") hands its place to the next one.
    blocks = blocks.reduce((acc, b, i, arr) => {
      if (!b.body && i < arr.length - 1) {
        arr[i + 1].title = isMeaningfulTitle(arr[i + 1].title) ? arr[i + 1].title : b.title;
        arr[i + 1].rawText = `${b.rawText}\n${arr[i + 1].rawText}`;
        return acc;
      }
      acc.push(b);
      return acc;
    }, []);
    if (blocks.length && !blocks[0].title && wordCount(blocks[0].body) < 15 && blocks.length > 1) blocks.shift();
    blocks = mergeBlocks(blocks, { target: maxTopics, minWords: 0 });
  } else {
    const body = cleanBody(source);
    blocks = splitParagraphs(source)
      .map((raw) => ({ title: null, rawText: raw, body: cleanBody(raw) }))
      .filter((b) => b.body);
    const labels = blocks.length >= 3 ? detectLabels(blocks) : null;
    if (labels) {
      // The script names each subject, so each named subject is a topic.
      blocks = mergeBlocks(labelledBlocks(blocks, labels), { target: maxTopics, minWords: 0 });
    } else if (blocks.length < 3 && wordCount(body) > 150) {
      blocks = sentenceChunks(body).map((p) => ({ title: null, rawText: p, body: p }));
      blocks = mergeBlocks(blocks, { target: Math.max(1, Math.min(maxTopics, Math.round(wordCount(body) / 120))), minWords: 25, simThreshold: 0.2 });
    } else {
      // Writers' own paragraphs are trusted more than arbitrary sentence chunks.
      blocks = mergeBlocks(blocks, { target: maxTopics, minWords: 12, simThreshold: 0.3 });
    }
  }

  // Inverse document frequency across topics, so words shared by every topic matter less.
  const dfs = new Map();
  for (const b of blocks) for (const s of new Set(b.tf.keys())) dfs.set(s, (dfs.get(s) || 0) + 1);
  const n = blocks.length;
  const idf = new Map([...dfs].map(([s, df]) => [s, n > 1 ? Math.log((n + 1) / df) + 0.3 : 1]));

  const topics = blocks.map((b, i) => {
    const keywords = extractKeywords(b.body, idf);
    const cues = extractCues(b.rawText);
    const meaningful = isMeaningfulTitle(b.title);
    let title = meaningful ? b.title : null;
    if (!title) {
      const top = keywords.slice(0, 2).map((k) => (k === k.toLowerCase() ? titleCase(k) : k));
      title = top.length ? top.join(' & ') : `Topic ${i + 1}`;
      if (b.title) title = `${b.title}: ${title}`;
    }
    const titleQuery = meaningful && b.title.split(/\s+/).length <= 5 ? b.title : null;
    // Cues are checked separately so a long cue does not hide the shorter keyword inside it.
    const cueQueries = uniqueQueries(cues, 3);
    let queries;
    if (b.named) {
      // A named subject ("Blue whale"): its name, the best few details from the script, and
      // shots of the subject itself, so most searches stay on the subject.
      const seen = [[...contentStems(b.title)]];
      const details = uniqueQueries(keywords, 3, seen);
      const shots = uniqueQueries(SHOT_TYPES.map((t) => `${b.title} ${t}`), 2, seen);
      queries = uniqueQueries([...cueQueries, b.title, ...details, ...shots], 6);
    } else {
      queries = [...cueQueries, ...uniqueQueries([titleQuery, ...keywords.slice(0, 5)], 6 - cueQueries.length)];
    }
    if (!queries.length) queries.push(words(b.body).filter(isContentWord).slice(0, 3).join(' ') || title);
    return {
      id: `t${i + 1}`,
      title,
      summary: firstSentence(b.body || b.title || ''),
      keywords,
      queries,
      cues,
      wordCount: wordCount(b.body),
    };
  });

  return topics.filter((t) => t.queries.length);
}

// Generic shot types that work for almost any subject on stock sites.
const SHOT_TYPES = ['close up', 'aerial view', 'slow motion', 'wide shot', 'background'];

// Search phrases for a topic the user typed in: the title itself, then what the script
// says about that subject, then common shot types, then the broader subject.
export function suggestQueries(title, scriptText = '', max = 6) {
  const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim();
  if (!cleanTitle) return [];
  const titleStems = [...contentStems(cleanTitle)];
  const head = titleStems[titleStems.length - 1];
  const context = [];
  const text = String(scriptText || '').trim();
  if (text && titleStems.length) {
    const blocks = splitParagraphs(text).map((raw) => cleanBody(raw)).filter(Boolean);
    const mentions = (body) => words(body).filter((w) => stem(w) === head).length;
    const coversTitle = (body) => {
      const stems = contentStems(body);
      return titleStems.every((x) => stems.has(x));
    };
    // A paragraph is about this subject if it names it in a label ("Blue whale.") or mentions it repeatedly.
    let related = blocks.filter((b) => coversTitle(b)
      && (labelSentences(b).some((l) => [...contentStems(l)].includes(head)) || mentions(b) >= 2));
    if (!related.length) {
      // Otherwise use only the sentences that mention it.
      related = blocks.flatMap((b) => b.split(/(?<=[.!?])\s+/)).filter(coversTitle);
    }
    if (related.length) {
      const body = related.join('\n\n');
      const whole = termFreq(text);
      const local = termFreq(body);
      // Words used all over the script say less about this subject than words used mostly here.
      const idf = new Map([...local].map(([k, v]) => [k, 0.5 + v / (whole.get(k) || v)]));
      context.push(...extractKeywords(body, idf, max));
    }
  }
  const novel = (q) => [...contentStems(q)].some((x) => !titleStems.includes(x));
  const seen = [titleStems];
  const fromScript = uniqueQueries(context.filter(novel), Math.max(0, max - 2), seen);
  const shots = uniqueQueries(SHOT_TYPES.map((t) => `${cleanTitle} ${t}`), max - 1 - fromScript.length, seen);
  const titleWords = words(cleanTitle).filter(isContentWord);
  const broader = titleWords.length > 1 ? [titleWords[titleWords.length - 1]] : [];
  const out = [cleanTitle, ...fromScript, ...shots];
  // The broader subject ("whale") goes last as a fallback, when there is room.
  for (const b of broader) if (out.length < max && !out.some((q) => q.toLowerCase() === b.toLowerCase())) out.push(b);
  return out.slice(0, max);
}
