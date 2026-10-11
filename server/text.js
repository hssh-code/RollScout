// Tokenizing helpers shared by topic detection and result ranking.

export const STOPWORDS = new Set(`
a about above across actually after again against all almost alone along already also although always am among an and
another any anybody anyone anything anyway anywhere are aren't around as ask asked at away back be became because become
becomes been before began behind being below best better between beyond big both but by came can cannot can't could
couldn't did didn't do does doesn't doing don't done down during each either else enough even ever every everybody
everyone everything everywhere few find first for four from full further gave get gets getting give given gives go goes
going gone good got gotten great had hadn't has hasn't have haven't having he he'd he'll her here here's hers herself
he's him himself his how however i i'd if i'll i'm in indeed instead into is isn't it it's its itself i've just keep
kind know known last least less let let's like likely lot lots made make makes making many may maybe me might mine more
most mostly much must my myself near need needs never new next no nobody none nor not nothing now of off often oh ok
okay old on once one ones only onto or other others otherwise our ours ourselves out over own part per perhaps put
quite rather really right said same saw say says see seem seemed seems seen several shall she she'd she'll she's should
shouldn't show since so some somebody someone something sometimes somewhere soon still such sure take taken tell than
that that's the their theirs them themselves then there there's these they they'd they'll they're they've thing things
think this those though thought three through thus till to today together too took toward towards try two under until
up upon us use used uses using very via want wanted wants was wasn't way ways we we'd well we'll went were we're weren't
we've what what's whatever when where where's whether which while who whoever whole who's whom whose why will with
within without won't would wouldn't yeah yes yet you you'd you'll your you're yours yourself yourselves you've
video videos channel subscribe episode guys hey hello welcome watch watching folks everybody gonna wanna gotta stuff
able ago almost basically certainly clearly definitely especially exactly finally hopefully literally obviously probably
simply totally truly usually around because cause course fact facts example examples reason reasons point points question
questions answer answers idea ideas time times year years day days today tomorrow yesterday moment moments minute minutes
second seconds hour hours week weeks month months lot bit kind sort type types number numbers part parts end start
beginning important different similar various certain own sure true real whole main top little huge large small
another anyone everyone someone nothing anything everything something case cases way ways place places thing things
zero one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty sixty seventy eighty ninety
hundred hundreds thousand thousands million millions billion billions trillion percent percentage quarter half dozen
dozens couple single double once twice third fourth fifth less more most least nearly roughly approximately
beneath besides inside outside underneath amid amidst throughout whose every meanwhile later earlier
`.split(/\s+/).filter(Boolean));

// Common verbs. Stock searches work best with nouns, so phrases built on these are ranked lower.
export const VERBS = new Set(`
explore explores explored exploring live lives lived living cover covers covered support supports supported migrate
migrates migrated return returns returned lay lays laid cause causes caused expel expels expelled turn turns turned
replant replanting build builds built carry carries carried visit visits visited uncover uncovered display displays
displayed protect protects protected extend extends extended control controls controlled host hosts hosted rule rules
ruled exist exists existed bring brings brought look looks looked feel feels felt happen happens happened include
includes included become becomes remain remains remained grow grows grew help helps helped learn learns learned create
creates created move moves moved begin begins continue continues continued mean means meant call calls called leave
leaves left started starts change changes changed produce produces produced allow allows allowed provide provides
provided require requires required increase increases increased reduce reduces reduced lead leads led discover
discovered decide decided believe believes believed understand understood consider considered develop developed
remember imagine notice noticed realize realized hear heard talk talks talked speak spoke spend spent pay paid lose
lost win won meet met run runs ran sit sat stand stood seeing rising rise rises rose stay stays stayed appear appears
appeared buy bought sell sold send sent reach reached kill killed die dies died serve served play plays played work
works worked worth matter matters say talking trying tried wonder wondered agree argue argued explain explained
buried bury hatched hatch get gets take takes taking makes made goes went happen
`.split(/\s+/).filter(Boolean));

// Words that rarely make good stock media searches on their own.
export const ABSTRACT = new Set(`
problem problems solution solutions concept concepts process processes system systems information knowledge strategy
strategies method methods approach result results benefit benefits impact effect effects factor factors level levels
issue issues aspect aspects situation context purpose value values quality role roles experience experiences ability
change changes success failure history future past present research study studies data theory goal goals tip tips
step steps rule rules way life world people person thing truth story stories lesson lessons secret secrets mistake mistakes
`.split(/\s+/).filter(Boolean));

export function stem(word) {
  let w = word.toLowerCase();
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) w = w.slice(0, -1);
  return w;
}

export function words(text) {
  return (String(text).match(/[A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z]/g) || [])
    .map((w) => w.replace(/[’]/g, "'").replace(/'s$/i, ''));
}

export function isContentWord(w) {
  const lw = w.toLowerCase();
  return lw.length > 2 && !STOPWORDS.has(lw);
}

// Stemmed content-word set, used to compare search results against a topic.
export function contentStems(text) {
  const out = new Set();
  for (const w of words(text)) if (isContentWord(w)) out.add(stem(w));
  return out;
}

export function termFreq(text) {
  const tf = new Map();
  for (const w of words(text)) {
    if (!isContentWord(w)) continue;
    const s = stem(w);
    tf.set(s, (tf.get(s) || 0) + 1);
  }
  return tf;
}

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of a) {
    na += v * v;
    const bv = b.get(k);
    if (bv) dot += v * bv;
  }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function titleCase(s) {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

export function wordCount(text) {
  return words(text).length;
}

export function slugify(s, max = 48) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '') || 'topic';
}
