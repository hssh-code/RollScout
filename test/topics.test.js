import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTopics, extractCues, headingText } from '../server/topics.js';

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
