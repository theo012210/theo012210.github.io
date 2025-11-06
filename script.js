/**
 * Rhythm Guessing - script.js
 * - Generates a 2-bar rhythm according to level rules
 * - Renders using VexFlow (via CDN)
 * - Shows 3 distractor options plus the correct one
 * - Toast feedback bottom-left
 */

// Basic utilities and music token definitions
const UNIT = 1; // smallest unit = demisemiquaver (1/32 note)
const UNITS_PER_QUARTER = 8; // quarter = 8 units
const UNITS_PER_BAR = UNITS_PER_QUARTER * 4; // 32 units per bar

const TYPES = {
  semibreve: {name:'semibreve', units: 32, vfDur:'w'},
  minim: {name:'minim', units: 16, vfDur:'h'},
  crotchet: {name:'crotchet', units: 8, vfDur:'q'},
  quaver: {name:'quaver', units: 4, vfDur:'8'},
  semiquaver: {name:'semiquaver', units: 2, vfDur:'16'},
  demisemiquaver: {name:'demisemiquaver', units: 1, vfDur:'32'},
};

function tripletGroup(baseType){
  return {name:`triplet-${baseType.name}`, units: UNITS_PER_QUARTER, isTriplet:true, base:baseType};
}

const NOTE_WEIGHT_CONFIG = [
  {key:'semibreve', label:'Semibreve'},
  {key:'minim', label:'Minim'},
  {key:'crotchet', label:'Crotchet'},
  {key:'quaver', label:'Quaver'},
  {key:'semiquaver', label:'Semiquaver'}
];

const DEFAULT_WEIGHT_PERCENT = 100;
const noteWeights = NOTE_WEIGHT_CONFIG.reduce((acc, cfg)=>{
  acc[cfg.key] = DEFAULT_WEIGHT_PERCENT / 100;
  return acc;
}, {});

function validateWeightsForLevel(levelKey){
  const cfg = LEVELS[levelKey];
  if(!cfg) return {ok:true, zeroTypes:[]};
  const zeroTypes = cfg.allowed.filter(name=>{
    const weight = noteWeights[name];
    return typeof weight === 'number' && weight <= 0;
  });
  if(zeroTypes.length > 1){
    return {ok:false, zeroTypes};
  }
  return {ok:true, zeroTypes};
}

// Level config
const LEVELS = {
  easy: {
    allowed:['semibreve','minim','crotchet'],
    allowTriplets:false,
    mustInclude:[]
  },
  medium: {
    allowed:['minim','crotchet','quaver'],
    allowTriplets:false,
    mustInclude:['quaver']
  },
  difficult: {
    allowed:['minim','crotchet','quaver','semiquaver'],
    allowTriplets:true,
    mustInclude:['semiquaver'],
    mustIncludeTriplet:true
  },
  expert: {
    allowed:['crotchet','quaver','semiquaver'],
    allowTriplets:true,
    mustInclude:['semiquaver'],
    mustIncludeTriplet:true
  }
};

// DOM
const vfContainer = document.getElementById('renderer');
const optionsContainer = document.getElementById('optionsContainer');
const levelSelect = document.getElementById('level');
const newBtn = document.getElementById('newBtn');
const playBtn = document.getElementById('playBtn');
const weightControlsEl = document.getElementById('noteWeightControls');
const instructionsModal = document.getElementById('instructionsModal');
const instructionsBackdrop = document.getElementById('instructionsBackdrop');
const closeInstructionsBtn = document.getElementById('closeInstructions');
const startGameBtn = document.getElementById('startGameBtn');
const toastManager = new Toasts({position:'bottom-left', offsetX:16, offsetY:16});

function openInstructionsModal(){
  if(!instructionsModal) return;
  instructionsModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  if(startGameBtn){
    setTimeout(()=>startGameBtn.focus(), 0);
  }
}

function closeInstructionsModal(){
  if(!instructionsModal) return;
  instructionsModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  if(newBtn){
    newBtn.focus();
  }
}

function initializeNoteWeightControls(){
  if(!weightControlsEl) return;
  NOTE_WEIGHT_CONFIG.forEach(cfg=>{
    const row = document.createElement('div');
    row.className = 'note-weight-row';

    const header = document.createElement('div');
    header.className = 'note-weight-header';

    const label = document.createElement('span');
    label.textContent = cfg.label;

    const value = document.createElement('span');
    value.className = 'note-weight-value';
    value.textContent = `${DEFAULT_WEIGHT_PERCENT}%`;

    header.appendChild(label);
    header.appendChild(value);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '5';
    slider.value = String(DEFAULT_WEIGHT_PERCENT);
    slider.dataset.note = cfg.key;
    slider.dataset.previous = slider.value;
    slider.setAttribute('aria-label', `${cfg.label} frequency`);

    slider.addEventListener('input', ()=>{
      const percent = Number(slider.value);
      noteWeights[cfg.key] = percent / 100;
      value.textContent = `${percent}%`;
    });

    slider.addEventListener('change', ()=>{
      const levelKey = levelSelect ? levelSelect.value : null;
      if(levelKey){
        const validation = validateWeightsForLevel(levelKey);
        if(!validation.ok){
          const previous = slider.dataset.previous || String(DEFAULT_WEIGHT_PERCENT);
          slider.value = previous;
          const prevPercent = Number(previous);
          noteWeights[cfg.key] = prevPercent / 100;
          value.textContent = `${prevPercent}%`;
          showToast('At most one note type can be set to 0% for this level.', false);
          return;
        }
      }
      slider.dataset.previous = slider.value;
      newQuestion();
    });

    row.appendChild(header);
    row.appendChild(slider);
    weightControlsEl.appendChild(row);
  });
}

initializeNoteWeightControls();

let currentCorrectIndex = null;
let currentRhythm = null;
let currentOptions = null;
let attemptsRemaining = 3;
let audioCtx = null;
let scheduledOscillators = [];
let playbackTimeout = null;
let isPlaying = false;
const TEMPO_BPM = 96;
const secondsPerUnit = (60 / TEMPO_BPM) / UNITS_PER_QUARTER;
// Change prep to 1 bar and make it a 1-2-3-Go style with distinct sounds
const PREP_BARS = 1;

function ensureAudioContext(){
  if(!audioCtx){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if(audioCtx.state === 'suspended'){
    audioCtx.resume();
  }
}

function finalizePlaybackState(){
  isPlaying = false;
  scheduledOscillators = [];
  if(playbackTimeout){
    clearTimeout(playbackTimeout);
    playbackTimeout = null;
  }
  if(playBtn){
    playBtn.disabled = false;
    playBtn.textContent = 'Play (metronome)';
  }
}

function stopPlayback(){
  if(scheduledOscillators.length){
    for(const osc of scheduledOscillators){
      try {
        osc.stop();
      } catch(e){
        // ignore
      }
    }
  }
  finalizePlaybackState();
}

function scheduleClick(time, accent){
  // Generic metronome click (used for main rhythm)
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(accent ? 880 : 660, time);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(accent ? 0.6 : 0.4, time + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.15);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(time);
  osc.stop(time + 0.2);
  osc.onended = ()=>{
    gain.disconnect();
  };
  scheduledOscillators.push(osc);
}

function schedulePrepCountSound(time, beatIndex, accent){
  // 1-2-3-Go with distinct waveforms and pitched tones: C4, D4, E4, F4
  const freqMap = [261.63, 293.66, 329.63, 349.23]; // C4, D4, E4, F4
  const baseLevels = [0.46, 0.52, 0.48, 0.7];
  const accentBoost = accent ? 0.18 : 0;
  const waveforms = ['sine', 'square', 'triangle', 'sawtooth'];

  // Tone part
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = waveforms[beatIndex] || 'square';
  osc.frequency.setValueAtTime(freqMap[beatIndex] || 700, time);
  gain.gain.setValueAtTime(0.0001, time);
  const targetLevel = (baseLevels[beatIndex] || 0.5) + accentBoost;
  gain.gain.exponentialRampToValueAtTime(targetLevel, time + 0.006);
  const toneDecay = beatIndex === 3 ? 0.25 : 0.18;
  gain.gain.exponentialRampToValueAtTime(0.0001, time + toneDecay);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(time);
  osc.stop(time + toneDecay + 0.02);
  osc.onended = ()=>{
    gain.disconnect();
  };
  scheduledOscillators.push(osc);

  // Add a tiny noise burst on "Go" to distinguish it further
  if(beatIndex === 3){
    const sr = audioCtx.sampleRate;
    const dur = 0.08; // 80ms
    const buffer = audioCtx.createBuffer(1, Math.floor(sr * dur), sr);
    const data = buffer.getChannelData(0);
    for(let i=0; i<data.length; i++){
      // Pink-ish noise via simple filter-ish accumulation
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    const nGain = audioCtx.createGain();
    nGain.gain.setValueAtTime(0.0001, time);
    nGain.gain.exponentialRampToValueAtTime(0.4, time + 0.003);
    nGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);
    noise.connect(nGain);
    nGain.connect(audioCtx.destination);
    noise.start(time);
    noise.stop(time + 0.1);
    noise.onended = ()=>{
      nGain.disconnect();
    };
    scheduledOscillators.push(noise);
  }
}

function playRhythm(bars){
  if(!bars || !bars.length){
    return;
  }
  ensureAudioContext();
  stopPlayback();
  if(playBtn){
    playBtn.disabled = true;
    playBtn.textContent = 'Playing...';
  }
  isPlaying = true;

  let startTime = audioCtx.currentTime + 0.1;
  let cursor = startTime;

  const prepBeats = PREP_BARS * 4;
  const beatDurationSeconds = UNITS_PER_QUARTER * secondsPerUnit;
  for(let beat = 0; beat < prepBeats; beat++){
    // Distinct 1-2-3-Go sounds with accents on beats 1 and 3
    const beatIndex = beat % 4;
    const shouldAccent = beatIndex === 0 || beatIndex === 2;
    schedulePrepCountSound(cursor, beatIndex, shouldAccent);
    cursor += beatDurationSeconds;
  }

  for(const bar of bars){
    let isFirstNoteInBar = true;
    for(const token of bar){
      if(token.isTriplet){
        const subDur = (token.units / 3) * secondsPerUnit;
        for(let i=0;i<3;i++){
          scheduleClick(cursor, isFirstNoteInBar && i === 0);
          cursor += subDur;
        }
      } else {
        scheduleClick(cursor, isFirstNoteInBar);
        cursor += token.units * secondsPerUnit;
      }
      isFirstNoteInBar = false;
    }
  }

  playbackTimeout = setTimeout(()=>{
    finalizePlaybackState();
  }, Math.max(0, (cursor - startTime) * 1000 + 150));
}

// -- Generation helpers --
function pickRandom(arr){return arr[Math.floor(Math.random()*arr.length)];}

function getTokenWeight(token){
  if(token.isTriplet){
    const baseName = token.base ? token.base.name : 'quaver';
    const weight = noteWeights[baseName];
    return typeof weight === 'number' && weight >= 0 ? weight : 1;
  }
  const weight = noteWeights[token.name];
  return typeof weight === 'number' && weight >= 0 ? weight : 1;
}

function weightedPick(candidates){
  const weights = candidates.map(getTokenWeight);
  const total = weights.reduce((sum, value)=>sum + value, 0);
  if(total <= 0){
    return pickRandom(candidates);
  }
  let threshold = Math.random() * total;
  for(let i=0;i<candidates.length;i++){
    threshold -= weights[i];
    if(threshold <= 0){
      return candidates[i];
    }
  }
  return candidates[candidates.length - 1];
}

function cloneBars(bars){
  return bars.map(bar=>bar.map(token=>Object.assign({}, token)));
}

function barsKey(bars){
  return bars.map(bar=>bar.map(token=>{
    if(token.isTriplet) return `triplet:${token.base ? token.base.name : ''}`;
    return `${token.name}:${token.units}:${token.vfDur || ''}:${token.dots || 0}`;
  }).join('-')).join('|');
}

function generateForLevel(levelKey){
  const cfg = LEVELS[levelKey];
  if(!cfg) throw new Error(`Unknown level: ${levelKey}`);

  const allowedNotes = cfg.allowed.map(k=>TYPES[k]).filter(Boolean);
  if(!allowedNotes.length) throw new Error(`No note types configured for ${levelKey}`);
  if(cfg.mustIncludeTriplet && !cfg.allowTriplets){
    throw new Error(`Level ${levelKey} requires triplets but does not allow them.`);
  }

  const tripletTemplate = cfg.allowTriplets ? tripletGroup(TYPES.quaver) : null;
  const basePool = cfg.allowTriplets && tripletTemplate
    ? allowedNotes.concat([tripletTemplate])
    : allowedNotes.slice();
  const unitSizes = basePool.map(token=>token.units);

  const reachable = new Array(UNITS_PER_BAR + 1).fill(false);
  reachable[0] = true;
  for(let total=1; total<=UNITS_PER_BAR; total++){
    for(const size of unitSizes){
      if(total >= size && reachable[total - size]){
        reachable[total] = true;
        break;
      }
    }
  }
  if(!reachable[UNITS_PER_BAR]){
    throw new Error(`Level ${levelKey} cannot fill a bar with configured tokens.`);
  }

  const requiredTokens = [];
  if(cfg.mustInclude && cfg.mustInclude.length){
    cfg.mustInclude.forEach(name=>{
      const token = TYPES[name];
      if(token) requiredTokens.push(token);
    });
  }
  if(cfg.mustIncludeTriplet && tripletTemplate){
    requiredTokens.push(tripletTemplate);
  }

  function totalUnits(tokens){
    return (tokens || []).reduce((sum, token)=>sum + (token ? token.units : 0), 0);
  }

  function cloneToken(token){
    if(token.isTriplet){
      return {name: token.name, units: token.units, isTriplet:true, base: token.base};
    }
    const copy = {name: token.name, units: token.units, vfDur: token.vfDur};
    if(token.dots){
      copy.dots = token.dots;
    }
    return copy;
  }

  function fillBar(requiredList){
    const initial = (requiredList || []).map(cloneToken);
    const tokens = initial.slice();
    let usedUnits = totalUnits(tokens);
    if(usedUnits > UNITS_PER_BAR){
      return null;
    }

    let safety = 0;
    while(usedUnits < UNITS_PER_BAR && safety < 500){
      safety++;
      const remaining = UNITS_PER_BAR - usedUnits;
      const candidates = basePool.filter(token=>{
        const leftover = remaining - token.units;
        return leftover >= 0 && reachable[leftover];
      });
      if(!candidates.length){
        return null;
      }
      const chosenTemplate = weightedPick(candidates);
      const chosen = cloneToken(chosenTemplate);
      tokens.push(chosen);
      usedUnits += chosen.units;
    }

    if(usedUnits !== UNITS_PER_BAR){
      return null;
    }

    return tokens.sort(()=>Math.random() - 0.5);
  }

  function distributeRequiredTokens(){
    if(!requiredTokens.length){
      return [[],[]];
    }

    const barReqs = [[],[]];
    const order = requiredTokens.slice().sort(()=>Math.random() - 0.5);
    for(const template of order){
      const firstChoice = Math.random() < 0.5 ? 0 : 1;
      const secondChoice = firstChoice === 0 ? 1 : 0;
      if(totalUnits(barReqs[firstChoice]) + template.units <= UNITS_PER_BAR){
        barReqs[firstChoice].push(template);
      } else if(totalUnits(barReqs[secondChoice]) + template.units <= UNITS_PER_BAR){
        barReqs[secondChoice].push(template);
      } else {
        return null;
      }
    }

    return barReqs;
  }

  function validate(bars){
    const flatTokens = bars.flat();
    if(cfg.mustInclude && cfg.mustInclude.length){
      for(const typeName of cfg.mustInclude){
        const found = flatTokens.some(t=>!t.isTriplet && t.name === typeName);
        if(!found) return false;
      }
    }
    if(cfg.mustIncludeTriplet){
      const hasTriplet = flatTokens.some(t=>t.isTriplet);
      if(!hasTriplet) return false;
    }
    return true;
  }

  for(let attempt=0; attempt<400; attempt++){
    const barReqs = distributeRequiredTokens();
    if(!barReqs) continue;
    const firstBar = fillBar(barReqs[0]);
    if(!firstBar) continue;
    const secondBar = fillBar(barReqs[1]);
    if(!secondBar) continue;
    const bars = [firstBar, secondBar];
    if(validate(bars)){
      return {bars};
    }
  }

  throw new Error(`Failed to generate rhythm for level ${levelKey}`);
}

// Convert our token representation into VexFlow StaveNotes and tuplets
function renderRhythmInto(div, bars, opts={width:600, height:120}){
  div.innerHTML='';
  if(!window.Vex || !Vex.Flow){
    throw new Error('VexFlow library is not available.');
  }
  const VF = Vex.Flow;
  const TUPLET_Y_SHIFT = -32;

  const STAVE_HEIGHT = 80;
  const STAVE_Y_PAD = 20;
  const STAVE_TOP_EXTRA = Math.max(0, Math.abs(TUPLET_Y_SHIFT) - 8);
  const SINGLE_LINE_BREAKPOINT = 500;
  const shouldWrap = opts.width < SINGLE_LINE_BREAKPOINT && bars.length > 1;
  const numStaves = shouldWrap ? bars.length : 1;
  const requiredHeight = numStaves * STAVE_HEIGHT + STAVE_Y_PAD + STAVE_TOP_EXTRA + STAVE_Y_PAD;

  const renderer = new VF.Renderer(div, VF.Renderer.Backends.SVG);
  renderer.resize(opts.width, requiredHeight);
  const context = renderer.getContext();
  context.setFont('Arial', 10, 'normal');

  if (shouldWrap) {
    // Render each bar on its own stave (line)
    let staveY = STAVE_Y_PAD + STAVE_TOP_EXTRA;
    for (const bar of bars) {
      const stave = new VF.Stave(10, staveY, opts.width - 20);
      if (staveY === STAVE_Y_PAD + STAVE_TOP_EXTRA) {
        stave.addClef('percussion');
        stave.addTimeSignature('4/4');
      }
      stave.setContext(context).draw();

      const { notes, tuplets, ties, tripletGroups } = processBar(bar, VF);
      const voice = new VF.Voice({ num_beats: 4, beat_value: 4 });
      voice.setMode(VF.Voice.Mode.SOFT);
      voice.addTickables(notes);

      const noteGroups = [];
      let currentGroup = [];
      notes.forEach(note => {
        if (note.isTripletPart) {
          if (currentGroup.length > 0) {
            noteGroups.push(currentGroup);
            currentGroup = [];
          }
        } else {
          currentGroup.push(note);
        }
      });
      if (currentGroup.length > 0) {
        noteGroups.push(currentGroup);
      }

      const straightBeams = noteGroups.flatMap(group => VF.Beam.generateBeams(group, {
        groups: [new VF.Fraction(2, 8)]
      }));
      const tripletBeams = tripletGroups.map(group => new VF.Beam(group));
      const beams = straightBeams.concat(tripletBeams);

  const formatter = new VF.Formatter().joinVoices([voice]);
  // Leave a small right-side gap so beams/tuplets don't collide with barlines
  const formatWidth = shouldWrap ? opts.width - 40 : opts.width - 80;
      formatter.format([voice], formatWidth);
      voice.draw(context, stave);

      for (const t of tuplets) {
        t.setTupletLocation(VF.Tuplet.LOCATION_TOP);
        if(typeof t.setYShift === 'function'){
          t.setYShift(TUPLET_Y_SHIFT);
        } else if(t.render_options){
          t.render_options.y_shift = TUPLET_Y_SHIFT;
        }
        t.setContext(context).draw();
      }
      beams.forEach(b => b.setContext(context).draw());
      for (const tie of ties) {
        tie.setContext(context).draw();
      }

      staveY += STAVE_HEIGHT;
    }
  } else {
    // Render all bars on a single stave
    const stave = new VF.Stave(10, STAVE_Y_PAD + STAVE_TOP_EXTRA, opts.width - 20);
    stave.addClef('percussion');
    stave.addTimeSignature('4/4');
    stave.setContext(context).draw();

    const allTuplets = [];
    const allTies = [];
    const barNotes = [];
    const allBeams = [];
    let allNotes = [];

    for (const bar of bars) {
      const { notes, tuplets, ties, tripletGroups } = processBar(bar, VF);
      allNotes = allNotes.concat(notes);
      allTuplets.push(...tuplets);
      allTies.push(...ties);
      barNotes.push(notes);
      
      const noteGroups = [];
      let currentGroup = [];
      notes.forEach(note => {
        if (note.isTripletPart) {
          if (currentGroup.length > 0) {
            noteGroups.push(currentGroup);
            currentGroup = [];
          }
        } else {
          currentGroup.push(note);
        }
      });
      if (currentGroup.length > 0) {
        noteGroups.push(currentGroup);
      }

      const straightBeams = noteGroups.flatMap(group => VF.Beam.generateBeams(group, {
        groups: [new VF.Fraction(2, 8)]
      }));
      const tripletBeams = tripletGroups.map(group => new VF.Beam(group));
      const beams = straightBeams.concat(tripletBeams);
      allBeams.push(...beams);
    }

    const voice = new VF.Voice({ num_beats: bars.length * 4, beat_value: 4 });
    voice.setMode(VF.Voice.Mode.SOFT);
    voice.addTickables(allNotes);

  const formatter = new VF.Formatter().joinVoices([voice]);
  // Reduce the formatting width slightly to reserve right padding and avoid overlap
  const formatWidth = shouldWrap ? opts.width - 40 : opts.width - 80;
    formatter.format([voice], formatWidth);
    voice.draw(context, stave);

    for (const t of allTuplets) {
      t.setTupletLocation(VF.Tuplet.LOCATION_TOP);
      if(typeof t.setYShift === 'function'){
        t.setYShift(TUPLET_Y_SHIFT);
      } else if(t.render_options){
        t.render_options.y_shift = TUPLET_Y_SHIFT;
      }
      t.setContext(context).draw();
    }
    allBeams.forEach(b => b.setContext(context).draw());
    for (const tie of allTies) {
      tie.setContext(context).draw();
    }

    if (bars.length > 1) {
      const topY = stave.getYForLine(0) - 1;
      const bottomY = stave.getYForLine(stave.getNumLines() - 1) + 1;
      context.save();
      context.setStrokeStyle('#111');
      context.setLineWidth(1.2);
      for (let i = 1; i < barNotes.length; i++) {
        const notesInBar = barNotes[i];
        if (!notesInBar.length) continue;
        const firstNote = notesInBar[0];
        const x = Math.max(stave.getX() + 6, firstNote.getAbsoluteX() - 12);
        context.beginPath();
        context.moveTo(x, topY);
        context.lineTo(x, bottomY);
        context.stroke();
      }
      context.restore();
    }
  }
}

function processBar(bar, VF) {
  const notes = [];
  const tuplets = [];
  const ties = [];
  const tripletGroups = [];
  let currentBeat = 0;

  for (const token of bar) {
    const tokenUnits = token.units;
    const tokenStartUnit = currentBeat * UNITS_PER_QUARTER;
    const tokenEndUnit = tokenStartUnit + tokenUnits;

    if (token.isTriplet) {
      const tripletNotes = [
        new VF.StaveNote({ keys: ['b/4'], duration: '8' }),
        new VF.StaveNote({ keys: ['b/4'], duration: '8' }),
        new VF.StaveNote({ keys: ['b/4'], duration: '8' }),
      ];
      tripletNotes.forEach(n => {
        n.isTripletPart = true;
        n.setStemDirection(1);
      });
      notes.push(...tripletNotes);
      tuplets.push(new VF.Tuplet(tripletNotes));
      tripletGroups.push(tripletNotes);
    } else {
      const dur = token.vfDur || (() => {
        for (const k in TYPES) if (TYPES[k].units === token.units) return TYPES[k].vfDur;
        return 'q';
      })();
      
      const note = new VF.StaveNote({ keys: ['b/4'], duration: dur });
      note.setStemDirection(1);
      if (token.dots) {
        for (let d = 0; d < token.dots; d++) note.addDotToAll();
      }
      notes.push(note);
    }
    currentBeat += tokenUnits / UNITS_PER_QUARTER;
  }

  // This is a simplified placeholder for tie logic.
  // A full implementation would need to split notes that cross beat boundaries.
  // For now, we'll just return an empty ties array.

  return { notes, tuplets, ties, tripletGroups };
}

function tokenLabel(token){
  if(token.isTriplet){
    const base = token.base ? token.base.name : 'quaver';
    return `Triplet (${base})`;
  }
  return (token.name || 'note').replace(/-/g,' ');
}

function renderRhythmFallback(div, bars){
  div.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'fallbackRhythm';
  bars.forEach((bar, idx)=>{
    const barRow = document.createElement('div');
    barRow.className = 'fallbackBar';
    const label = document.createElement('span');
    label.className = 'fallbackBarLabel';
    label.textContent = `Bar ${idx+1}`;
    const notes = document.createElement('span');
    notes.className = 'fallbackNotes';
    notes.textContent = bar.map(tokenLabel).join('   ');
    barRow.appendChild(label);
    barRow.appendChild(notes);
    wrap.appendChild(barRow);
  });
  div.appendChild(wrap);
}

function tryRenderRhythm(div, bars, opts){
  try {
    renderRhythmInto(div, bars, opts);
  } catch(err){
    console.error('Failed to render rhythm', err, bars);
    renderRhythmFallback(div, bars);
  }
}

// Option generation: create three distractors by mutating the correct bars
function generateOptions(correctBars, levelKey){
  const options = [correctBars];
  const seen = new Set([barsKey(correctBars)]);
  let attempts = 0;
  while(options.length < 4 && attempts < 200){
    attempts++;
    const candidate = generateForLevel(levelKey).bars;
    const key = barsKey(candidate);
    if(seen.has(key)) continue;
    options.push(candidate);
    seen.add(key);
  }

  while(options.length < 4){
    options.push(cloneBars(correctBars));
  }

  const order = options.map((o,i)=>({o,i})).sort(()=>Math.random()-.5);
  const shuffled = order.map(x=>x.o);
  const correctIndex = order.findIndex(x=>x.i===0);

  return {options:shuffled, correctIndex};
}

// UI wiring
function showToast(text, ok=true){
  toastManager.push({
    style: ok ? 'success' : 'error',
    title: ok ? 'Great job!' : 'Try again',
    content: text,
    dismissAfter: '2000ms',
    closeButton: false
  });
}

function getCardRenderWidth(card){
  if(!card){
    return null;
  }
  const cardRectWidth = card.getBoundingClientRect ? card.getBoundingClientRect().width : 0;
  const containerRectWidth = optionsContainer && optionsContainer.getBoundingClientRect
    ? optionsContainer.getBoundingClientRect().width
    : (optionsContainer ? optionsContainer.clientWidth : 0);
  const referenceWidth = cardRectWidth && cardRectWidth > 0 ? cardRectWidth : containerRectWidth;
  if(!referenceWidth || referenceWidth <= 0){
    return null;
  }
  let computedPadding = 0;
  if(typeof window !== 'undefined' && window.getComputedStyle){
    const styles = window.getComputedStyle(card);
    const paddingLeft = parseFloat(styles.paddingLeft) || 0;
    const paddingRight = parseFloat(styles.paddingRight) || 0;
    computedPadding = paddingLeft + paddingRight;
  }
  const available = referenceWidth - computedPadding;
  const candidate = Number.isFinite(available) && available > 0 ? available : referenceWidth;
  return Math.max(120, Math.floor(candidate));
}

function renderRhythmForCard(card, bars){
  if(!card) return;
  const canvas = card.querySelector('.optionRenderer');
  if(!canvas) return;
  const renderWidth = getCardRenderWidth(card);
  if(!renderWidth){
    requestAnimationFrame(()=>renderRhythmForCard(card, bars));
    return;
  }
  tryRenderRhythm(canvas, bars, {width:renderWidth, height:120});
}

function rerenderOptionCards(){
  if(!currentOptions || !Array.isArray(currentOptions)){
    return;
  }
  if(!optionsContainer){
    return;
  }
  const cards = optionsContainer.querySelectorAll('.optionCard');
  Array.from(cards).forEach(card=>{
    const idx = Number(card.dataset.optionIndex);
    const bars = currentOptions[idx];
    if(bars){
      renderRhythmForCard(card, bars);
    }
  });
}

function renderOptionCard(container, bars, idx){
  const card = document.createElement('div');
  card.className='optionCard';
  card.dataset.optionIndex = String(idx);
  const label = document.createElement('div');
  label.className = 'optionLabel';
  label.textContent = `Option ${idx+1}`;
  card.appendChild(label);
  const canvas = document.createElement('div');
  canvas.className='optionRenderer';
  card.appendChild(canvas);
  card.addEventListener('click',()=>{
    if(attemptsRemaining <= 0) return;
    if(currentCorrectIndex===idx){
      attemptsRemaining = 0;
      showToast('Correct!', true);
      setTimeout(()=>{
        newQuestion();
      }, 600);
    } else {
      attemptsRemaining -= 1;
      if(attemptsRemaining > 0){
        const triesWord = attemptsRemaining === 1 ? 'try' : 'tries';
        showToast(`Not quite. ${attemptsRemaining} ${triesWord} left.`, false);
      } else {
        showToast(`Out of tries! The correct option was option ${currentCorrectIndex+1}.`, false);
        setTimeout(()=>{
          newQuestion();
        }, 900);
      }
    }
  });
  container.appendChild(card);
  renderRhythmForCard(card, bars);
}

function newQuestion(){
  const level = levelSelect.value;
  const validation = validateWeightsForLevel(level);
  if(!validation.ok){
    showToast('Adjust the sliders so no more than one allowed note type is at 0% for this level.', false);
    return;
  }
  const gen = generateForLevel(level);
  const {options, correctIndex} = generateOptions(gen.bars, level);
  currentCorrectIndex = correctIndex;
  attemptsRemaining = 3;
  currentRhythm = options[correctIndex];
  currentOptions = options;
  if(isPlaying) stopPlayback();

  if(vfContainer){
    vfContainer.innerHTML = '';
    vfContainer.style.display = 'none';
  }

  optionsContainer.innerHTML='';
  options.forEach((opt, i)=> renderOptionCard(optionsContainer, opt, i));
}

newBtn.addEventListener('click', newQuestion);
levelSelect.addEventListener('change', ()=> newQuestion());
if(playBtn){
  playBtn.addEventListener('click', ()=>{
    if(isPlaying){
      stopPlayback();
    } else {
      playRhythm(currentRhythm);
    }
  });
}

newQuestion();
openInstructionsModal();

if(closeInstructionsBtn){
  closeInstructionsBtn.addEventListener('click', ()=> closeInstructionsModal());
}

if(startGameBtn){
  startGameBtn.addEventListener('click', ()=> closeInstructionsModal());
}

if(instructionsBackdrop){
  instructionsBackdrop.addEventListener('click', ()=> closeInstructionsModal());
}

document.addEventListener('keydown', (event)=>{
  if(event.key === 'Escape' && instructionsModal && !instructionsModal.classList.contains('hidden')){
    closeInstructionsModal();
  }
});

let resizeAnimationFrame = null;
window.addEventListener('resize', ()=>{
  if(resizeAnimationFrame){
    cancelAnimationFrame(resizeAnimationFrame);
  }
  resizeAnimationFrame = requestAnimationFrame(()=>{
    resizeAnimationFrame = null;
    rerenderOptionCards();
  });
});

