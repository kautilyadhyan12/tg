// ─── Central exercise media mapping ─────────────────────────────────────────
const BASE_IMG = '/images/exercises/';
const BASE_GIF = '/exercise-gifs/';

const RAW = {
  'arm circles':              ['armcircle.jpg',            'ArmCircles1.gif',           'ArmCircles2.gif'],
  'bench press':              ['benchpress.jpg',           'benchpress1.gif',           'benchpress2.gif'],
  'bicep curls':              ['bicepcurls.jpg',           'bicepcurls1.gif',           'bicepcurls2.gif'],
  'bicycle crunch':           ['cyclingcrunch.jpg',        'cyclingcrunch1.gif',        'cyclingcrunch2.gif'],
  'bridge pose':              ['bridgepose.jpg',           'bridgepose1.gif',           'bridgepose2.gif'],
  'bulgarian split squat':    ['bulgariansplitsquat.jpg',  'bulgariansplitsquat1.gif',  'bulgariansplitsquat2.gif'],
  'burpees':                  ['burpees.jpg',              'burpees1.gif',              'burpees2.gif'],
  'calf raises':              ['calfraises.jpg',           'calfraises1.gif',           'calfraises2.gif'],
  'cat-cow stretch':          ['catcowstretch.jpg',        'catcowstretch1.gif',        'catcowstretch2.gif'],
  'chair squats':             ['chairsquat.jpg',           'chairsquat1.gif',           'chairsquat2.gif'],
  "child's pose":             ['childpose.jpg',            'childpose1.gif',            'childpose2.gif'],
  'cobra pose':               ['cobrapose.jpg',            'cobrapose1.gif',            'cobrapose2.gif'],
  'crunches':                 ['crunch.jpg',               'crunch1.gif',               'crunch2.gif'],
  'deadlifts':                ['Deadlifts.jpg',            'deadlift1.gif',             'deadlift2.gif'],
  'downward dog':             ['downwarddog.jpg',          'downwarddog1.gif',          'downwarddog2.gif'],
  'flutter kicks':            ['flutterkick.jpg',          'flutterkick1.gif',          'flutterkick2.gif'],
  'glute bridge':             ['glutebridge.jpg',          'glutebridge1.gif',          'glutebridge2.gif'],
  'hamstring stretch':        ['hamstringstretch.jpg',     'hamstringstretch1.gif',     'hamstring2.gif'],
  'heel raises':              ['hillraise.jpg',            'hillraise1.gif',            'hillraise2.gif'],
  'high knees':               ['highknees.jpg',            'highknees1.gif',            'highknees2.gif'],
  'hip flexor stretch':       ['hipflexorstretch.jpg',     'hipflexorstretch1.gif',     'hipflexerstretch2.gif'],
  'hip thrust':               ['hipthrust.jpg',            'hipthrust1.gif',            'hipthrust2.gif'],
  'jogging in place':         ['jogginginplace.jpg',       'jogginginplace1.gif',       'jogginginplace2.gif'],
  'jump lunges':              ['lungejump.jpg',            'lungejump1.gif',            'lungejump2.gif'],
  'jump squats':              ['jumpsquat.jpg',            'jumpsquat1.gif',            'jumpsquat2.gif'],
  'jumping jacks':            ['jumpingjack.jpg',          'jumpingjack1.gif',          'jumpingjack2.gif'],
  'lateral raises':           ['lateralraises.jpg',        'lateralraises1.gif',        'lateralraises2.gif'],
  'leg raises':               ['legraises.jpg',            'legraises1.gif',            'legraises2.gif'],
  'lunges':                   ['lunge.jpg',                'lunges1.gif',               'lunge2.gif'],
  'mountain climbers':        ['mountainclimber.jpg',      'mountainclimber1.gif',      'mountainclimber2.gif'],
  'pike push-ups':            ['pikepushup.jpg',           'pikepushup1.gif',           'pikepushup2.gif'],
  'plank':                    ['plank.jpg',                'plank1.gif',                'plank2.gif'],
  'plank jacks':              ['plankjack.jpg',            'plankjack1.gif',            'plankjack2.gif'],
  'pull-ups':                 ['pullup.jpg',               'Pull-ups1.gif',             'pullup2.gif'],
  'push-ups':                 ['pushup.jpg',               'pushup1.gif',               'pushup2.gif'],
  'resistance band pull':     ['resistencebendpull.jpg',   'resistencebendpull1.gif',   'resistencebendpull2.gif'],
  'russian twists':           ['russiantwist.jpg',         'russiantwist1.gif',         'russiantwist2.gif'],
  'seated forward bend':      ['seatedforwardbend.jpg',    'seatedforwardbend1.gif',    'seatedforwardbend2.gif'],
  'seated leg raises':        ['seatedlegraise.jpg',       'seatedlegraise1.gif',       'seatedlegraise2.gif'],
  'shoulder press':           ['soldierpress.jpg',         'shoulderpress1.gif',        'soldierpress2.gif'],
  'shoulder stretch':         ['shoulderstretch.jpg',      'soulderstretch1.gif',       'souldierstretch2.gif'],
  'side plank':               ['sideplank.jpg',            'sideplank1.gif',            'sideplank2.gif'],
  'skater jumps':             ['skaterjump.jpg',           'skaterjump1.gif',           'skaterjump2.gif'],
  'skipping rope':            ['skippingrope.jpg',         'skippingrope1.gif',         'skippingrope2.gif'],
  'squats':                   ['squat.jpg',                'squat1.gif',                'squat2.gif'],
  'step-ups':                 ['stepup.jpg',               'stepup1.gif',               'stepup2.gif'],
  'superman hold':            ['superman.jpg',             'superman1.gif',             'superman2.gif'],
  'tree pose':                ['treepose.jpg',             'treepose1.gif',             'treepose2.gif'],
  'tricep dips':              ['tricepdip.jpg',            'tricepdips1.gif',           'tricepdips2.gif'],
  'tricep extensions':        ['tricepextension.jpg',      'tricepextension1.gif',      'tricepextension2.gif'],
  'tuck jumps':               ['truckjump.jpg',            'truckjump1.gif',            'truckjump2.gif'],
  'wall push-ups':            ['wallpushup.jpg',           'wallpushup1.gif',           'wallpushup2.gif'],
  'wall sit':                 ['wallsits.jpg',             'wallsit1.gif',              'wallsit2.gif'],
  'warrior i':                ['warior1.jpg',              'warior1.gif',               'warior11.gif'],
  'warrior ii':               ['warior2.jpg',              'warrior2.gif',              'warior22.gif'],
  "world's greatest stretch": ['worldgreateststretch.jpg', 'worldgreateststretch1.gif', 'worldsgreateststretch2.gif'],
};

const MEDIA = {};
for (const [name, files] of Object.entries(RAW)) {
  MEDIA[name] = {
    photo: BASE_IMG + files[0],
    gifs:  [BASE_GIF + files[1], BASE_GIF + files[2]],
  };
}

export const REMOVED_EXERCISES = new Set(['brisk walking', 'mountain pose']);

function normalize(name) {
  return (name || '').toLowerCase().trim();
}

export function getExerciseMedia(name) {
  const key = normalize(name);
  if (MEDIA[key]) return MEDIA[key];
  for (const [k, v] of Object.entries(MEDIA)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

export function getExercisePhoto(name) {
  const m = getExerciseMedia(name);
  return m ? m.photo : null;
}

export function getExerciseGifs(name) {
  const m = getExerciseMedia(name);
  return m ? m.gifs : [];
}

export function isExerciseRemoved(name) {
  return REMOVED_EXERCISES.has(normalize(name));
}

export default MEDIA;