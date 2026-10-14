import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  detectTopics, extractCues, headingText, labelSentences, splitParagraphs, suggestQueries,
} from '../server/topics.js';

const WHALES = readFileSync(new URL('./fixtures/whales.txt', import.meta.url), 'utf8');

const HEADED = `# Intro
Welcome back. Today we explore the hidden world of coral reefs and the ocean creatures that live there.

## Coral Reefs
Coral reefs cover less than one percent of the ocean floor, yet they support a quarter of all marine species.
The Great Barrier Reef in Australia is the largest reef system on Earth. [B-roll: aerial view of Great Barrier Reef]

## Sea Turtles
Green sea turtles migrate thousands of kilometers between feeding grounds and nesting beaches.
Female turtles return to the same beach where they hatched to lay eggs in the sand.
`;

test('splits a script with headings into one topic per heading', () => {
  const topics = detectTopics(HEADED);
  assert.equal(topics.length, 3);
  assert.equal(topics[1].title, 'Coral Reefs');
  assert.equal(topics[2].title, 'Sea Turtles');
  assert.ok(topics[2].queries.some((q) => /turtle/i.test(q)));
});

test('uses explicit B-roll cues as the first search query', () => {
  const topics = detectTopics(HEADED);
  assert.equal(topics[1].queries[0], 'aerial view of Great Barrier Reef');
  assert.ok(topics[1].queries.some((q) => /coral reefs/i.test(q)));
});

test('keeps proper names together and avoids filler verbs', () => {
  const topics = detectTopics(HEADED);
  const all = topics.flatMap((t) => t.keywords).map((k) => k.toLowerCase());
  assert.ok(all.some((k) => k.includes('great barrier reef') || k.includes('barrier reef')) || topics[1].queries[0].includes('Great Barrier Reef'));
  for (const verb of ['explore', 'live', 'migrate', 'cover']) assert.ok(!all.includes(verb), `${verb} should not be a keyword`);
});

test('splits a plain script into topics by paragraph similarity', () => {
  const text = `The Roman Empire was one of the largest empires in history. At its height, Rome controlled territory from Britain to Egypt. The Colosseum in Rome hosted gladiator fights in front of fifty thousand spectators.

Meanwhile in Asia, the Han Dynasty ruled China. The Great Wall of China was extended to protect against nomadic invaders. Silk Road merchants carried silk and porcelain to Persia.

Today, millions of tourists visit ancient ruins every year. Archaeologists still uncover pottery, coins, and mosaics buried beneath modern cities.`;
  const topics = detectTopics(text);
  assert.equal(topics.length, 3);
  assert.ok(topics[0].queries.some((q) => /rom/i.test(q)));
  assert.ok(topics[1].queries.some((q) => /china|great wall|han dynasty/i.test(q)));
  assert.ok(topics[2].queries.some((q) => /ruins/i.test(q)));
});

test('respects the maximum topic count', () => {
  const sections = Array.from({ length: 12 }, (_, i) => `## Section about item${i}\nThis part talks about lighthouse${i} and harbor${i} boats in detail for viewers.`).join('\n\n');
  assert.ok(detectTopics(sections, { maxTopics: 4 }).length <= 4);
});

test('recognises common heading styles', () => {
  assert.equal(headingText('## Coffee Farms'), 'Coffee Farms');
  assert.equal(headingText('[INTRO]'), 'Intro');
  assert.equal(headingText('SCENE 3: The Harbor'), 'The Harbor');
  assert.equal(headingText('INT. COFFEE SHOP - NIGHT'), 'Coffee Shop');
  assert.equal(headingText('NARRATOR:'), null);
  assert.equal(headingText('This is a normal sentence that just happens to be in the script.'), null);
  assert.equal(headingText('[B-roll: city lights]'), null);
});

test('extracts visual cues in brackets and on their own line', () => {
  assert.deepEqual(extractCues('Text [B-roll: city at night] more\nVISUAL: farmers harvesting coffee'), ['city at night', 'farmers harvesting coffee']);
});

test('handles empty input', () => {
  assert.deepEqual(detectTopics('   '), []);
});

test('list-style script: each named subject becomes its own topic', () => {
  const titles = detectTopics(WHALES).map((t) => t.title);
  const whales = ['Blue whale', 'Humpback whale', 'Orca', 'Gray whale', 'Sperm whale', 'Narwhal',
    'Beluga', 'Fin whale', 'North Atlantic right whale', 'Bowhead whale'];
  for (const w of whales) assert.ok(titles.includes(w), `missing topic ${w}`);
  // Intro and outro paragraphs are kept, but no whale is merged into another.
  assert.equal(titles.length, whales.length + 2);
});

test('the subject name is the first search phrase', () => {
  const blue = detectTopics(WHALES).find((t) => t.title === 'Blue whale');
  assert.equal(blue.queries[0], 'Blue whale');
});

test('one paragraph per line counts as separate paragraphs', () => {
  const text = 'Coffee grows on steep hillsides in Colombia, where farmers pick ripe cherries by hand every season.\n'
    + 'Espresso machines force hot water through finely ground coffee at high pressure in busy cafes.\n'
    + 'Tea plantations in Assam stretch across rolling green hills under heavy monsoon rains each summer.';
  assert.equal(splitParagraphs(text).length, 3);
});

test('recognises short sentences that only name the subject', () => {
  assert.deepEqual(labelSentences('Daily, it eats krill. Blue whale. It feeds in every ocean.'), ['Blue whale']);
  assert.deepEqual(labelSentences('Those patches are white. North Atlantic right whale. It lives off the coast.'), ['North Atlantic right whale']);
  for (const not of ['Not just clicks.', 'The krill stay in.', 'Thanks for watching.', 'How?', 'Clicks built from parts.', '5 whales down.']) {
    assert.deepEqual(labelSentences(not), [], not);
  }
});

test('suggests search phrases for a typed-in topic, using the script', () => {
  const blue = suggestQueries('Blue whale', WHALES);
  assert.equal(blue[0], 'Blue whale');
  assert.equal(blue.length, 6);
  assert.ok(blue.some((q) => /throat|krill|tongue|baleen/i.test(q)), blue.join(', '));
});

test('suggests phrases even when the script does not mention the topic', () => {
  const q = suggestQueries('Killer whale', '');
  assert.equal(q[0], 'Killer whale');
  assert.equal(q.length, 6);
  assert.equal(new Set(q.map((x) => x.toLowerCase())).size, 6, 'no duplicates');
  assert.deepEqual(suggestQueries('   ', WHALES), []);
});
