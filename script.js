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

function scheduleClick(time, accent, duration = 0.2){
  // Generic metronome click (used for main rhythm)
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(accent ? 880 : 660, time);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(accent ? 0.6 : 0.4, time + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(time);
  osc.stop(time + duration + 0.01);
  osc.onended = ()=>{
    gain.disconnect();
  };
  scheduledOscillators.push(osc);
}

function schedulePrepCountSound(time, beatIndex, accent){
  // Count-in: three low thumps (kick-like) then a bright "Go" (high C6)
  const C6 = 1046.5; // C6 in Hz
  const THUMP = 60; // low thump frequency (kick-like)
  const freqMap = [THUMP, THUMP, THUMP, C6];
  // Increase thump levels for greater contrast with the metronome click
  const baseLevels = [2.5, 2.5, 2.5, 0.95];
  const accentBoost = accent ? 0.18 : 0;
  // final 'Go' uses sawtooth for extra brightness
  const waveforms = ['sine', 'sine', 'sine', 'sawtooth'];

  // Tone / cymbal part
  // Shorter decay for prep cymbals, longer for the final 'Go' tone+cymbal
  const toneDecay = beatIndex === 3 ? 0.36 : 0.18;

  // Make the first three prep beats into cymbals (louder)
  if (beatIndex < 3) {
    const dur = 0.18; // shorter cymbal burst for prep
    const sr = audioCtx.sampleRate;
    const buffer = audioCtx.createBuffer(1, Math.floor(sr * dur), sr);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }

    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;

    const hp = audioCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(3500, time);
    hp.Q.setValueAtTime(0.7, time);

    // metallic resonators for shimmer
    const bp1 = audioCtx.createBiquadFilter(); bp1.type = 'bandpass'; bp1.frequency.setValueAtTime(7000, time); bp1.Q.setValueAtTime(6, time);
    const bp2 = audioCtx.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.setValueAtTime(9000, time); bp2.Q.setValueAtTime(6, time);

    const mixGain = audioCtx.createGain();
    // louder for prep cymbals
    const prepLevel = (baseLevels[beatIndex] || 1.0) * 1.2 + accentBoost;
    mixGain.gain.setValueAtTime(0.0001, time);
    mixGain.gain.linearRampToValueAtTime(prepLevel, time + 0.006);
    mixGain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    noise.connect(hp);
    hp.connect(bp1);
    hp.connect(bp2);
    bp1.connect(mixGain);
    bp2.connect(mixGain);
    mixGain.connect(audioCtx.destination);

    noise.start(time);
    noise.stop(time + dur + 0.02);
    noise.onended = ()=>{ mixGain.disconnect(); bp1.disconnect(); bp2.disconnect(); hp.disconnect(); };
    scheduledOscillators.push(noise);

  } else {
    // Final beat: keep bright tone (C6/saw) and a longer cymbal tail (existing approach)
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = waveforms[beatIndex] || 'sawtooth';
    osc.frequency.setValueAtTime(freqMap[beatIndex] || 1046.5, time);
    gain.gain.setValueAtTime(0.0001, time);
    const targetLevel = (baseLevels[beatIndex] || 0.9) + accentBoost;
    gain.gain.exponentialRampToValueAtTime(targetLevel, time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + toneDecay);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(time);
    osc.stop(time + toneDecay + 0.02);
    osc.onended = ()=>{ gain.disconnect(); };
    scheduledOscillators.push(osc);
  }

  // Add a cymbal-like burst on "Go" to distinguish it further
  if (beatIndex === 3) {
    const sr = audioCtx.sampleRate;
    // longer noise buffer for cymbal shimmer
    const dur = 0.28; // 280ms
    const buffer = audioCtx.createBuffer(1, Math.floor(sr * dur), sr);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      // slightly decaying white noise
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }

    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;

    // Create a highpass to remove low end and give cymbal brightness
    const hp = audioCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(4000, time);
    hp.Q.setValueAtTime(0.7, time);

    // Add a couple of bandpass resonators to simulate metallic partials
    const bp1 = audioCtx.createBiquadFilter(); bp1.type = 'bandpass'; bp1.frequency.setValueAtTime(7000, time); bp1.Q.setValueAtTime(6, time);
    const bp2 = audioCtx.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.setValueAtTime(9000, time); bp2.Q.setValueAtTime(6, time);
    const bp3 = audioCtx.createBiquadFilter(); bp3.type = 'bandpass'; bp3.frequency.setValueAtTime(11000, time); bp3.Q.setValueAtTime(5, time);

    // Mix outputs
    const mixGain = audioCtx.createGain();
    mixGain.gain.setValueAtTime(0.0001, time);
    // Attack quickly then decay over the duration
    mixGain.gain.linearRampToValueAtTime(0.9, time + 0.006);
    mixGain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    // Route: noise -> hp -> (bp1->mix, bp2->mix, bp3->mix)
    noise.connect(hp);
    hp.connect(bp1);
    hp.connect(bp2);
    hp.connect(bp3);

    bp1.connect(mixGain);
    bp2.connect(mixGain);
    bp3.connect(mixGain);

    mixGain.connect(audioCtx.destination);

    noise.start(time);
    noise.stop(time + dur + 0.02);
    noise.onended = () => {
      mixGain.disconnect(); bp1.disconnect(); bp2.disconnect(); bp3.disconnect(); hp.disconnect();
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

  const allTokens = bars.flat();
  let i = 0;
  let barUnitTracker = 0;
  while (i < allTokens.length) {
    const token = allTokens[i];
    const isFirstNoteInBar = barUnitTracker % UNITS_PER_BAR === 0;

    if(token.isTriplet){
      const subDur = (token.units / 3) * secondsPerUnit;
      for(let k=0; k<3; k++){
        scheduleClick(cursor, isFirstNoteInBar && k === 0);
        cursor += subDur;
      }
      barUnitTracker += token.units;
      i++;
      continue;
    }

    let totalDuration = token.units * secondsPerUnit;
    let accent = isFirstNoteInBar;
    
    // Accumulate duration for tied notes
    let j = i + 1;
    while (j < allTokens.length && allTokens[j-1].tieToNext) {
      totalDuration += allTokens[j].units * secondsPerUnit;
      barUnitTracker += allTokens[j].units;
      j++;
    }
    
    // Schedule a single click for the entire tied group
    scheduleClick(cursor, accent, totalDuration);
    cursor += totalDuration;
    barUnitTracker += token.units;
    i = j;
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

  // unit sizes for reachability checks (per bar)
  const unitSizes = basePool.map(token => token.units);
  const reachable = new Array(UNITS_PER_BAR + 1).fill(false);
  reachable[0] = true;
  for (let total = 1; total <= UNITS_PER_BAR; total++){
    for (const size of unitSizes){
      if (total >= size && reachable[total - size]){
        reachable[total] = true;
        break;
      }
    }
  }
  if (!reachable[UNITS_PER_BAR]){
    throw new Error(`Level ${levelKey} cannot fill a bar with configured tokens.`);
  }

  // Expand large-duration tokens (minim, semibreve) into beat-sized crotchets with ties
  function expandLargeTokenToBeats(template){
    const beats = template.units / UNITS_PER_QUARTER;
    const out = [];
    for (let i = 0; i < beats; i++){
      const t = { name: 'crotchet', units: UNITS_PER_QUARTER, vfDur: TYPES.crotchet.vfDur };
      // mark ties on all but the last part
      if (i < beats - 1) t.tieToNext = true;
      out.push(t);
    }
    return out;
  }

  function cloneToken(token){
    if(token.isTriplet){
      return {name: token.name, units: token.units, isTriplet:true, base: token.base};
    }
    const copy = {name: token.name, units: token.units, vfDur: token.vfDur};
    if(token.dots){ copy.dots = token.dots; }
    if(token.tieToNext) copy.tieToNext = true;
    return copy;
  }

  function totalUnits(tokens){
    return (tokens || []).reduce((sum, token) => sum + (token ? token.units : 0), 0);
  }

  function isOffbeatQuaverStart(unitOffset){
    // off-beat quaver starts at half-quarter offsets: 4, 12, 20, 28 (units)
    return (unitOffset % UNITS_PER_QUARTER) === (UNITS_PER_QUARTER / 2);
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

  function distributeRequiredTokens(){
    if(!requiredTokens.length) return [[],[]];
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

  // Decompose an integer unit count into canonical tokens (largest-first)
  function decomposeUnits(units){
    const order = ['semibreve','minim','crotchet','quaver','semiquaver','demisemiquaver'];
    const out = [];
    let rem = units;
    for(const name of order){
      const size = TYPES[name].units;
      while(rem >= size){
        out.push({ name: TYPES[name].name, units: size, vfDur: TYPES[name].vfDur });
        rem -= size;
      }
    }
    // rem should be zero; if not, push smallest units
    while(rem > 0){
      out.push({ name: 'demisemiquaver', units: 1, vfDur: TYPES.demisemiquaver.vfDur });
      rem -= 1;
    }
    return out;
  }

  // Split a following token so that its first part equals prevUnits. The
  // remainder is decomposed into canonical durations. All created parts are
  // flagged createdBySplit=true; tieToNext is set on each part except the last
  // so the sequence represents a single tied original token.
  function splitNextToken(bar, nextIdx, firstSize){
    if(nextIdx >= bar.length) return false;
    const nextToken = bar[nextIdx];
    if(nextToken.isTriplet) return false;
    if(nextToken.units <= firstSize) return false;
    const total = nextToken.units;
    const remainder = total - firstSize;
    const parts = [];
    // first part
    parts.push({ name: (()=>{ for(const k in TYPES) if(TYPES[k].units===firstSize) return TYPES[k].name; return 'custom'; })(), units: firstSize, vfDur: (()=>{ for(const k in TYPES) if(TYPES[k].units===firstSize) return TYPES[k].vfDur; return TYPES.crotchet.vfDur; })(), createdBySplit: true });
    // remainder parts
    const remParts = decomposeUnits(remainder);
    for(const rp of remParts){ rp.createdBySplit = true; parts.push(rp); }
    // mark ties on all but last to indicate original single note
    for(let i=0;i<parts.length-1;i++) parts[i].tieToNext = true;
    // replace nextToken with parts
    bar.splice(nextIdx, 1, ...parts);
    return true;
  }

  // Fill a bar sequentially from beat 0 to beat 4, allowing multi-beat templates
  // Fill a single bar; accepts an optional initial requiredList of token templates
  // to place at the start of the bar. Returns { tokens, leftover } where leftover
  // contains any expanded token parts that couldn't fit in this bar and must be
  // prepended to the next bar.
  function fillBar(requiredList){
    const initial = (requiredList || []).map(cloneToken);
    const tokens = initial.slice();
    let usedUnits = totalUnits(tokens);
    if (usedUnits > UNITS_PER_BAR) return null;

    let safety = 0;
    let leftoverParts = [];
    while (usedUnits < UNITS_PER_BAR && safety < 1000){
      safety++;
      const remaining = UNITS_PER_BAR - usedUnits;

      // candidates are any base token that fits within the remaining total of a bar
      const candidates = basePool.filter(token => token.units <= UNITS_PER_BAR).slice();
      if (!candidates.length) return null;

      // Avoid placing triplets starting on off-beat quaver boundaries
      const filtered = candidates.filter(t => {
        if (!t.isTriplet) return true;
        const startUnit = usedUnits;
        if (isOffbeatQuaverStart(startUnit)) return false;
        return true;
      });
      const pickPool = filtered.length ? filtered : candidates;

      const chosenTemplate = weightedPick(pickPool);

      // If chosen spans multiple beats (minim/semibreve), expand into crotchets with ties
      if (!chosenTemplate.isTriplet && chosenTemplate.units > UNITS_PER_QUARTER){
        const expanded = expandLargeTokenToBeats(chosenTemplate).map(cloneToken);
        const expandedUnits = expanded.reduce((s,t)=>s+t.units,0);

        if (expandedUnits <= remaining){
          // fits entirely in this bar - keep the original token as-is
          const chosen = cloneToken(chosenTemplate);
          tokens.push(chosen);
          usedUnits += chosen.units;
        } else if (remaining > 0){
          // split: put first portion into this bar, return remainder for next bar
          const partsThatFit = Math.floor(remaining / UNITS_PER_QUARTER);
          if (partsThatFit <= 0) {
            // cannot place any part here; try picking another candidate
            continue;
          }
          const firstPart = expanded.slice(0, partsThatFit);
          const restPart = expanded.slice(partsThatFit);
          tokens.push(...firstPart);
          usedUnits += firstPart.reduce((s,t)=>s+t.units,0);
          leftoverParts = restPart.map(cloneToken);
          break; // this bar filled or we've placed what fits; leftover will be passed on
        } else {
          // no remaining space, should not happen due to loop condition
          continue;
        }
      } else {
        // chosen is a single-beat token (triplet or crotchet/quaver/etc)
        if (chosenTemplate.units > remaining){
          // chosen doesn't fit in this bar; try another candidate
          // (this handles smaller remaining spaces where only small tokens can fit)
          const smallCandidates = pickPool.filter(t => t.units <= remaining);
          if (!smallCandidates.length) return null;
          const chosenSmall = weightedPick(smallCandidates);
          const chosen = cloneToken(chosenSmall);
          tokens.push(chosen);
          usedUnits += chosen.units;
        } else {
          const chosen = cloneToken(chosenTemplate);
          tokens.push(chosen);
          usedUnits += chosen.units;
        }
      }
    }

    if (usedUnits !== UNITS_PER_BAR) return null;
    return { tokens, leftover: leftoverParts };
  }

  function validate(bars){
    const flatTokens = bars.flat();
    if(cfg.mustInclude && cfg.mustInclude.length){
      for(const typeName of cfg.mustInclude){
        // If the required type is larger than a beat (minim/semibreve), check for tied crotchet groups
        const reqType = TYPES[typeName];
        if(reqType && reqType.units > UNITS_PER_QUARTER){
          const beatsNeeded = reqType.units / UNITS_PER_QUARTER;
          let found = false;
          for(let i=0;i<flatTokens.length;i++){
            // look for a run of consecutive crotchets with tieToNext linking them for the required length
            if(flatTokens[i].name === 'crotchet'){
              let ok = true;
              for(let j=0;j<beatsNeeded-1;j++){
                const cur = flatTokens[i+j];
                if(!cur || cur.name !== 'crotchet' || !cur.tieToNext) { ok = false; break; }
              }
              if(ok) { found = true; break; }
            }
          }
          if(!found) return false;
        } else {
          const found = flatTokens.some(t => !t.isTriplet && t.name === typeName);
          if(!found) return false;
        }
      }
    }
    if(cfg.mustIncludeTriplet){
      const hasTriplet = flatTokens.some(t=>t.isTriplet);
      if(!hasTriplet) return false;
    }
    return true;
  }

  // Try several attempts to generate two valid bars
  for(let attempt = 0; attempt < 400; attempt++){
    const barReqs = distributeRequiredTokens();
    if(!barReqs) continue;

    const firstRes = fillBar(barReqs[0]);
    if(!firstRes) continue;
    const leftover = firstRes.leftover || [];

    // merge leftovers (must be at start) with required tokens for second bar
    const secondReqs = (leftover.length ? leftover.concat(barReqs[1] || []) : (barReqs[1] || []));
    const secondRes = fillBar(secondReqs);
    if(!secondRes) continue;
    // if secondRes still has leftover parts, generation failed for this attempt
    if(secondRes.leftover && secondRes.leftover.length) continue;

    let bars = [firstRes.tokens, secondRes.tokens];

    // Post-process: enforce per-beat grouping rules so we don't leave an isolated
    // quaver alone in a crotchet beat. If a beat contains a single quaver, and the
    // following token is a crotchet, split that crotchet into two quavers a,b and
    // mark a.tieToNext so a is tied to b; this allows the isolated quaver to beam
    // with a while preserving the overall durations via the tie.
    for(let bi = 0; bi < bars.length; bi++){
      const bar = bars[bi];
      let cursor = 0;
      for(let ti = 0; ti < bar.length; ti++){
        const token = bar[ti];
        const startUnit = cursor;
        const beatStart = Math.floor(startUnit / UNITS_PER_QUARTER) * UNITS_PER_QUARTER;
        // check if this token is an isolated quaver within its beat
        if(!token.isTriplet && token.units === UNITS_PER_QUARTER/2){
          // count non-triplet tokens that start within this beat
          let countInBeat = 0;
          for(let scanIdx = 0, scanCursor = 0; scanIdx < bar.length; scanIdx++){
            const scanToken = bar[scanIdx];
            const scanStart = scanCursor;
            if(scanStart >= beatStart && scanStart < beatStart + UNITS_PER_QUARTER){
              if(!scanToken.isTriplet) countInBeat++;
            }
            scanCursor += scanToken.units;
          }
            if(countInBeat === 1){
            // isolated quaver — try to split the next token so its first part
            // matches this quaver's duration (broader rule)
            const nextIdx = ti + 1;
            if(nextIdx < bar.length){
              splitNextToken(bar, nextIdx, token.units);
            }
          } else {
            // If not strictly isolated but we have a direct quaver + crotchet pair
            // (e.g., first two notes are quaver then crotchet), also split the
            // crotchet so the quaver can beam with the first of the two quavers.
            const nextIdx2 = ti + 1;
              if(nextIdx2 < bar.length){
              // broader split: split the following token so its first part matches this quaver
              splitNextToken(bar, nextIdx2, token.units);
            }
          }
        }
        cursor += token.units;
      }
    }
    // Post-process 2: merge adjacent quaver pairs into crotchets when they form
    // a single beat (start at the beat boundary). This converts sequences like
    // [quaver, quaver] -> [crotchet] to make notation simpler when appropriate.
    for(let bi = 0; bi < bars.length; bi++){
      const bar = bars[bi];
      let cursor = 0;
      for(let ti = 0; ti < bar.length - 1; ti++){
        const t1 = bar[ti];
        const t2 = bar[ti+1];
        const startUnit = cursor;
        // only consider plain quavers
        if(!t1.isTriplet && !t2.isTriplet && t1.units === UNITS_PER_QUARTER/2 && t2.units === UNITS_PER_QUARTER/2){
          const endsAtBar = (startUnit + t1.units + t2.units) === UNITS_PER_BAR;

          // Case A: both are regular quavers (not tied, not createdBySplit)
          if(!t1.tieToNext && !t2.tieToNext && !t1.createdBySplit && !t2.createdBySplit){
            if((startUnit % UNITS_PER_QUARTER) === 0 || endsAtBar){
              const crot = { name: 'crotchet', units: UNITS_PER_QUARTER, vfDur: TYPES.crotchet.vfDur };
              bar.splice(ti, 2, crot);
              cursor += crot.units;
              continue;
            }
          }

          // Case B: both were created by a previous split — allow merge if there
          // are no non-split quavers in the same beat (i.e., nothing that needs
          // to beam with the first half).
          if(t1.createdBySplit && t2.createdBySplit){
            const beatStart = Math.floor(startUnit / UNITS_PER_QUARTER) * UNITS_PER_QUARTER;
            // Only consider non-split quavers that occur earlier in the same beat
            // (these are the ones that would need to beam with the first half).
            let precedingNonSplitQuaver = false;
            let scanCursor = 0;
            for(let si = 0; si < bar.length; si++){
              const st = bar[si];
              const sStart = scanCursor;
              if(sStart >= beatStart && sStart < startUnit){
                if(!st.isTriplet && st.units === UNITS_PER_QUARTER/2 && !st.createdBySplit){
                  precedingNonSplitQuaver = true;
                  break;
                }
              }
              scanCursor += st.units;
            }
            if(!precedingNonSplitQuaver){
              const crot2 = { name: 'crotchet', units: UNITS_PER_QUARTER, vfDur: TYPES.crotchet.vfDur };
              bar.splice(ti, 2, crot2);
              cursor += crot2.units;
              continue;
            }
          }
        }
        cursor += t1.units;
      }
    }

    if(validate(bars)) return { bars };
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

  // Check for cross-bar ties (ties spanning across bar lines)
  let hasCrossBarTie = false;
  if (bars.length > 1) {
    for (let bi = 0; bi < bars.length - 1; bi++) {
      const bar = bars[bi];
      if (bar.length > 0 && bar[bar.length - 1].tieToNext) {
        hasCrossBarTie = true;
        break;
      }
    }
  }

  const shouldWrap = opts.width < SINGLE_LINE_BREAKPOINT && bars.length > 1 && !hasCrossBarTie;
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

  const { notes, tuplets, ties, tripletGroups, tokenNoteMap } = processBar(bar, VF);
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
  // Leave extra right-side gap so beams/tuplets don't collide with barlines,
  // especially at narrow widths. Increase padding when the available
  // render width is small to prevent notes from being pushed past the barline.
  let EXTRA_RIGHT_PADDING = 24;
  if (opts.width < 360) {
    EXTRA_RIGHT_PADDING = 64; // small cards need more reserved space
  } else if (opts.width < 480) {
    EXTRA_RIGHT_PADDING = 36;
  }
  const baseFormatWidth = shouldWrap ? opts.width - 40 : opts.width - 80;
  const formatWidth = Math.max(120, baseFormatWidth - EXTRA_RIGHT_PADDING);
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
      // Draw ties created from token-level tieToNext markers (expanded multi-beat tokens)
      if (Array.isArray(tokenNoteMap)){
        for (let ti = 0; ti < tokenNoteMap.length; ti++){
          const info = tokenNoteMap[ti];
          const token = info.token || {};
          if (token.tieToNext){
            const nextInfo = tokenNoteMap[ti+1];
            if (nextInfo){
              const firstNote = notes[info.startIndex];
              const lastNote = notes[nextInfo.startIndex];
              try{
                const tieObj = new VF.StaveTie({ first_note: firstNote, last_note: lastNote, first_indices: [0], last_indices: [0] });
                tieObj.setContext(context).draw();
              } catch(e){}
            }
          }
        }
      }
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
    const barTokenMaps = [];

    for (const bar of bars) {
      const { notes, tuplets, ties, tripletGroups, tokenNoteMap } = processBar(bar, VF);
      allNotes = allNotes.concat(notes);
      allTuplets.push(...tuplets);
      allTies.push(...ties);
      barNotes.push(notes);
      barTokenMaps.push(tokenNoteMap || []);
      
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
  let EXTRA_RIGHT_PADDING = 24;
  if (opts.width < 360) {
    EXTRA_RIGHT_PADDING = 64;
  } else if (opts.width < 480) {
    EXTRA_RIGHT_PADDING = 36;
  }
  const baseFormatWidth = shouldWrap ? opts.width - 40 : opts.width - 80;
  const formatWidth = Math.max(120, baseFormatWidth - EXTRA_RIGHT_PADDING);
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

    if (bars.length > 1) {
      const topY = stave.getYForLine(0) - 1;
      const bottomY = stave.getYForLine(stave.getNumLines() - 1) + 1;
      context.save();
      context.setStrokeStyle('#111');
      context.setLineWidth(1.2);
      // Stave bounds for clamping
      const staveLeft = stave.getX();
      const staveRight = staveLeft + (typeof stave.getWidth === 'function' ? stave.getWidth() : (stave.width || (opts.width - 20)));

      for (let i = 1; i < barNotes.length; i++) {
        const notesInBar = barNotes[i];
        if (!notesInBar.length) continue;
        const firstNote = notesInBar[0];
        const prevNotes = barNotes[i - 1] || [];
        const prevLastNote = prevNotes.length ? prevNotes[prevNotes.length - 1] : null;

        // Conservative offsets to avoid overlapping noteheads
        const DEFAULT_NOTE_MARGIN = 8;
        let leftEdge = staveLeft + 6;
        let rightEdge = staveRight - 6;

        if (prevLastNote && typeof prevLastNote.getAbsoluteX === 'function') {
          const prevX = prevLastNote.getAbsoluteX();
          const prevWidth = (typeof prevLastNote.getWidth === 'function') ? prevLastNote.getWidth() : (prevLastNote.width || 12);
          // prefer to place after prev note's right edge + a small margin
          leftEdge = Math.max(leftEdge, prevX + prevWidth + 2);
        }

        if (firstNote && typeof firstNote.getAbsoluteX === 'function') {
          const firstX = firstNote.getAbsoluteX();
          const firstWidth = (typeof firstNote.getWidth === 'function') ? firstNote.getWidth() : (firstNote.width || 12);
          // prefer to place before first note's left edge - a small margin
          rightEdge = Math.min(rightEdge, firstX - firstWidth - 2);
        }

        let x;
        if (leftEdge <= rightEdge) {
          // place roughly in the middle of the available gap
          x = Math.round((leftEdge + rightEdge) / 2);
        } else if (prevLastNote && typeof prevLastNote.getAbsoluteX === 'function') {
          // no gap: fall back to placing just after previous note's right edge
          const prevX = prevLastNote.getAbsoluteX();
          const prevWidth = (typeof prevLastNote.getWidth === 'function') ? prevLastNote.getWidth() : (prevLastNote.width || 12);
          x = Math.round(prevX + prevWidth + DEFAULT_NOTE_MARGIN);
        } else if (firstNote && typeof firstNote.getAbsoluteX === 'function') {
          x = Math.round(firstNote.getAbsoluteX() - DEFAULT_NOTE_MARGIN);
        } else {
          // final fallback: place at a quarter width from left
          x = Math.round(staveLeft + Math.max(20, (staveRight - staveLeft) / 4));
        }

        // Clamp to stave bounds so the line is always visible
        x = Math.max(staveLeft + 4, Math.min(x, staveRight - 4));

        context.beginPath();
        context.moveTo(x, topY);
        context.lineTo(x, bottomY);
        context.stroke();
      }
      context.restore();
    }

    // Draw ties created from token-level tieToNext markers across bars
    let globalOffset = 0;
    for (let bi = 0; bi < barTokenMaps.length; bi++){
      const tokenMap = barTokenMaps[bi] || [];
      const notesInBar = barNotes[bi] || [];
      for (let ti = 0; ti < tokenMap.length; ti++){
        const info = tokenMap[ti];
        const token = info.token || {};
        if (token.tieToNext){
          // find next token's note start globally
          let nextBar = bi;
          let nextTokenIndex = ti + 1;
          if (nextTokenIndex >= tokenMap.length){
            // next token begins in the next bar
            nextBar = bi + 1;
            nextTokenIndex = 0;
          }
          if (nextBar < barTokenMaps.length){
            const nextInfo = (barTokenMaps[nextBar] || [])[nextTokenIndex];
            if (nextInfo){
              // compute global indices
              let firstGlobal = 0;
              for (let k = 0; k < bi; k++) firstGlobal += (barNotes[k] || []).length;
              firstGlobal += info.startIndex;
              let secondGlobal = 0;
              for (let k = 0; k < nextBar; k++) secondGlobal += (barNotes[k] || []).length;
              secondGlobal += nextInfo.startIndex;
              const firstNote = allNotes[firstGlobal];
              const lastNote = allNotes[secondGlobal];
              try{
                const tieObj = new VF.StaveTie({ first_note: firstNote, last_note: lastNote, first_indices: [0], last_indices: [0] });
                tieObj.setContext(context).draw();
              } catch(e){}
            }
          }
        }
      }
      globalOffset += notesInBar.length;
    }
    for (const tie of allTies) {
      tie.setContext(context).draw();
    }
  }
}

function processBar(bar, VF) {
  const notes = [];
  const tuplets = [];
  const ties = [];
  const tripletGroups = [];
  let currentBeat = 0;

  // tokenNoteMap will track, for each input token, where its corresponding note(s)
  // begin in the `notes` array and how many stave-notes it produced. This is
  // used by the renderer to create ties between adjacent produced notes.
  const tokenNoteMap = [];

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
      const startIndex = notes.length;
      notes.push(...tripletNotes);
      tuplets.push(new VF.Tuplet(tripletNotes));
      tripletGroups.push(tripletNotes);
      tokenNoteMap.push({ startIndex, noteCount: tripletNotes.length, token });
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
      const startIndex = notes.length;
      notes.push(note);
      tokenNoteMap.push({ startIndex, noteCount: 1, token });
    }
    currentBeat += tokenUnits / UNITS_PER_QUARTER;
  }

  // This is a simplified placeholder for tie logic.
  // A full implementation would need to split notes that cross beat boundaries.
  // For now, we'll just return an empty ties array.

  return { notes, tuplets, ties, tripletGroups, tokenNoteMap };
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

