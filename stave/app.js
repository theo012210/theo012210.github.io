const clefLabels = {
  treble: 'Treble clef',
  bass: 'Bass clef',
};
const clefDescriptions = {
  treble: 'Right hand notes for higher sounds.',
  bass: 'Left hand notes for lower sounds.',
};
const staffPositions = {
  treble: [
    { answer: 'C4', y: 212, ledger: true, kind: 'ledger' },
    { answer: 'D4', y: 200, kind: 'space' },
    { answer: 'E4', y: 188, kind: 'line' },
    { answer: 'F4', y: 176, kind: 'space' },
    { answer: 'G4', y: 164, kind: 'line' },
    { answer: 'A4', y: 152, kind: 'space' },
    { answer: 'B4', y: 140, kind: 'line' },
    { answer: 'C5', y: 128, kind: 'space' },
    { answer: 'D5', y: 116, kind: 'line' },
    { answer: 'E5', y: 104, kind: 'space' },
    { answer: 'F5', y: 92, kind: 'line' },
  ],
  bass: [
    { answer: 'G2', y: 188, kind: 'line' },
    { answer: 'A2', y: 176, kind: 'space' },
    { answer: 'B2', y: 164, kind: 'line' },
    { answer: 'C3', y: 152, kind: 'space' },
    { answer: 'D3', y: 140, kind: 'line' },
    { answer: 'E3', y: 128, kind: 'space' },
    { answer: 'F3', y: 116, kind: 'line' },
    { answer: 'G3', y: 104, kind: 'space' },
    { answer: 'A3', y: 92, kind: 'line' },
  ],
};

function getAnswerChoices(clef) {
  return [...new Set(staffPositions[clef].map((position) => displayNoteName(position.answer)))];
}

function displayNoteName(answer) {
  return answer.replace(/\d+/g, '');
}

const state = {
  mode: 'quiz',
  clef: 'treble',
  challenge: createChallenge('treble'),
  selectedAnswer: null,
  score: {
    correct: 0,
    tried: 0,
  },
  message: 'Choose the note name that matches the staff.',
};

const refs = {
  boardStage: document.getElementById('board-stage'),
  modeTitle: document.getElementById('mode-title'),
  message: document.getElementById('message'),
  scoreRow: document.getElementById('score-row'),
  answerGrid: document.getElementById('answer-grid'),
  nextNote: document.getElementById('next-note'),
  nextNoteQuiz: document.getElementById('next-note-quiz'),
  revealAnswer: document.getElementById('reveal-answer'),
  trebleChip: document.getElementById('treble-chip'),
  bassChip: document.getElementById('bass-chip'),
  quizChip: document.getElementById('quiz-chip'),
  startQuizHome: document.getElementById('start-quiz-home'),
  correctOverlay: document.getElementById('correct-overlay'),
  overlayNext: document.getElementById('overlay-next-note'),
  confettiCanvas: document.getElementById('confetti-canvas'),
};

let overlayTimeoutId = null;
let confettiAnimationId = null;
let confettiParticles = [];
let confettiContext = null;

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function createChallenge(clef) {
  const position = staffPositions[clef][randomInt(staffPositions[clef].length)];
  return {
    answer: position.answer,
    clef,
    y: position.y,
    ledger: position.ledger,
    kind: position.kind,
  };
}

function getHintMessage() {
  if (state.challenge.kind === 'ledger') {
    return 'It sits on a ledger line below the staff. Ledger lines are little helper lines for notes just outside the staff.';
  }

  if (state.challenge.kind === 'line') {
    return 'It sits on a line. Notes on a line go right through the line.';
  }

  return 'It sits in a space. Notes in spaces float between the lines.';
}

function getFeedbackText() {
  if (!state.selectedAnswer) {
    return null;
  }

  const answer = displayNoteName(state.challenge.answer);

  if (state.selectedAnswer === answer) {
    return 'Great job!';
  }

  return `This note is ${answer}. ${getHintMessage()}`;
}

function getFeedbackLines() {
  if (!state.selectedAnswer) {
    return [];
  }

  const answer = displayNoteName(state.challenge.answer);

  if (state.selectedAnswer === answer) {
    return ['Great job!'];
  }

  if (state.challenge.kind === 'ledger') {
    return [`This note is ${answer}.`, 'It uses a helper line.'];
  }

  if (state.challenge.kind === 'line') {
    return [`This note is ${answer}.`, 'It sits on a line.'];
  }

  return [`This note is ${answer}.`, 'It sits in a space.'];
}

function renderBoard() {
  const y = state.challenge.y;
  const showLedger = state.challenge.ledger;
  const promptY = y - 38;
  const feedbackLines = getFeedbackLines();
  const feedbackY = y - 74;
  const isWrongAnswer = state.selectedAnswer && state.selectedAnswer !== displayNoteName(state.challenge.answer);

  refs.boardStage.innerHTML = `
    <svg viewBox="0 0 420 280" class="note-board" role="img" aria-label="Music staff with note">
      <defs>
        <linearGradient id="noteFill" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffcc66" />
          <stop offset="100%" stop-color="#f36f56" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="420" height="280" rx="32" fill="#fffdf7" />
      <text x="32" y="42" class="staff-label">${clefLabels[state.challenge.clef]}</text>
      <text x="32" y="64" class="staff-caption">${clefDescriptions[state.challenge.clef]}</text>
      ${[0, 1, 2, 3, 4]
        .map(
          (line) => `
            <line x1="64" x2="356" y1="${92 + line * 24}" y2="${92 + line * 24}" class="staff-line" />
          `,
        )
        .join('')}
      ${feedbackLines.length && isWrongAnswer ? `
        <g aria-hidden="true">
          <rect x="44" y="${feedbackY - 28}" width="164" height="52" rx="18" fill="#fff4d6" stroke="#f5a623" stroke-width="2" />
          <text x="126" y="${feedbackY - 4}" text-anchor="middle" class="staff-feedback">
            ${feedbackLines.map((line, index) => `<tspan x="126" dy="${index === 0 ? 0 : 16}">${line}</tspan>`).join('')}
          </text>
          <path d="M 208 ${feedbackY + 18} C 220 ${feedbackY + 22}, 224 ${feedbackY + 26}, 222 ${y - 2}" fill="none" stroke="#f5a623" stroke-width="4" stroke-linecap="round" />
          <circle cx="224" cy="${y - 2}" r="5" fill="#f5a623" />
        </g>
      ` : `
        <g aria-hidden="true">
          <rect x="266" y="${promptY - 18}" width="96" height="30" rx="15" fill="#fff4d6" stroke="#f5a623" stroke-width="2" />
          <text x="314" y="${promptY + 2}" text-anchor="middle" class="staff-prompt">Look here!</text>
          <path d="M 266 ${promptY + 2} C 250 ${promptY + 10}, 238 ${promptY + 18}, 224 ${y - 2}" fill="none" stroke="#f5a623" stroke-width="4" stroke-linecap="round" />
          <circle cx="224" cy="${y - 2}" r="5" fill="#f5a623" />
        </g>
      `}
      ${showLedger ? `<line x1="180" x2="240" y1="${y}" y2="${y}" class="ledger-line" />` : ''}
      <g transform="translate(210 ${y})">
        <ellipse cx="0" cy="0" rx="20" ry="14" fill="url(#noteFill)" stroke="#d34f31" stroke-width="3" transform="rotate(-18)" />
        <rect x="15" y="-82" width="6" height="82" rx="3" class="note-stem" />
      </g>
    </svg>
  `;
}

function renderAnswerButtons() {
  refs.answerGrid.innerHTML = getAnswerChoices(state.clef)
    .map((choice) => {
      const classes = ['answer-button'];
      if (state.mode !== 'quiz') {
        classes.push('answer-idle');
      }
      if (state.selectedAnswer) {
        if (choice === displayNoteName(state.challenge.answer)) {
          classes.push('answer-correct');
        } else if (choice === state.selectedAnswer) {
          classes.push('answer-wrong');
        }
      }

      return `<button type="button" class="${classes.join(' ')}" data-answer="${choice}">${displayNoteName(choice)}</button>`;
    })
    .join('');

  refs.answerGrid.querySelectorAll('[data-answer]').forEach((button) => {
    button.addEventListener('click', () => handleGuess(button.getAttribute('data-answer')));
  });
}

function renderScore() {
  const accuracy = state.score.tried === 0 ? 0 : Math.round((state.score.correct / state.score.tried) * 100);
  refs.scoreRow.innerHTML = `
    <span>${state.score.correct} correct</span>
    <span>${state.score.tried} tried</span>
    <span>${accuracy}% accuracy</span>
  `;
}

function renderMode() {
  refs.modeTitle.textContent =
    state.mode === 'quiz'
      ? `${clefLabels[state.clef]} quiz`
      : 'Choose quiz';

  refs.message.textContent = state.message;
  refs.nextNote.disabled = state.mode === 'home';
  refs.nextNoteQuiz.disabled = state.mode === 'home';
  if (refs.revealAnswer) refs.revealAnswer.disabled = state.mode === 'home';

  refs.trebleChip.classList.toggle('chip-active', state.clef === 'treble');
  refs.bassChip.classList.toggle('chip-active', state.clef === 'bass');
  refs.quizChip.classList.toggle('chip-active', state.mode === 'quiz');
}

function render() {
  renderMode();
  renderBoard();
  renderAnswerButtons();
  renderScore();
}

function setMode(mode) {
  state.mode = mode;
  state.selectedAnswer = null;

  if (mode === 'quiz') {
    state.message = 'Choose the note name that matches the staff.';
  } else {
    state.message = 'Tap a note to start the game.';
  }

  render();
}

function setClef(clef) {
  state.clef = clef;
  state.challenge = createChallenge(clef);
  state.selectedAnswer = null;
  state.message = state.mode === 'quiz' ? 'Choose the note name that matches the staff.' : 'Look at the note, then reveal the answer.';
  render();
}

function nextChallenge() {
  state.challenge = createChallenge(state.clef);
  state.selectedAnswer = null;
  state.message = state.mode === 'quiz' ? 'Next note!' : 'A new note is ready.';
  render();
}

function revealAnswer() {
  state.message = `This note is ${displayNoteName(state.challenge.answer)}.`;
  render();
}

function handleGuess(answer) {
  if (state.mode !== 'quiz') {
    state.message = 'Switch to quiz mode to use the answer buttons.';
    render();
    return;
  }

  if (state.selectedAnswer) {
    return;
  }

  state.selectedAnswer = answer;
  state.score.tried += 1;

  if (answer === displayNoteName(state.challenge.answer)) {
    state.score.correct += 1;
    state.message = 'Great job!';
    showCorrectOverlay();
  } else {
    state.message = 'Try the next note.';
  }

  render();
}

function showCorrectOverlay() {
  const overlay = refs.correctOverlay;
  if (!overlay) return;
  const msg = overlay.querySelector('.overlay-message');
  if (msg) msg.textContent = `This note is ${displayNoteName(state.challenge.answer)}.`;
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
  // auto-dismiss after 2.5s and advance to next challenge
  if (overlayTimeoutId) clearTimeout(overlayTimeoutId);
  overlayTimeoutId = setTimeout(() => {
    overlayTimeoutId = null;
    closeCorrectOverlay();
    nextChallenge();
  }, 2500);
  startConfettiAnimation();
}

function closeCorrectOverlay() {
  const overlay = refs.correctOverlay;
  if (!overlay) return;
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
  if (overlayTimeoutId) {
    clearTimeout(overlayTimeoutId);
    overlayTimeoutId = null;
  }
  stopConfettiAnimation();
}

function resizeConfettiCanvas() {
  const canvas = refs.confettiCanvas;
  if (!canvas) return;
  const pixelRatio = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  confettiContext = canvas.getContext('2d');
  if (confettiContext) {
    confettiContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }
}

function createConfettiParticle() {
  const canvas = refs.confettiCanvas;
  return {
    x: Math.random() * (canvas ? canvas.clientWidth : window.innerWidth),
    y: Math.random() * (canvas ? canvas.clientHeight : window.innerHeight) - (canvas ? canvas.clientHeight : window.innerHeight),
    size: Math.random() * 6 + 3,
    speedX: (Math.random() - 0.5) * 4,
    speedY: Math.random() * 4 + 2,
    rotation: (Math.random() - 0.5) * 5,
    color: `hsl(${Math.random() * 360}, 80%, 60%)`,
    shape: Math.random() > 0.7 ? 'circle' : 'rect',
  };
}

function initConfettiParticles(count = 80) {
  confettiParticles = Array.from({ length: count }, () => createConfettiParticle());
}

function updateConfettiParticle(particle, width, height) {
  particle.x += particle.speedX;
  particle.y += particle.speedY;
  particle.x += Math.sin(particle.y * 0.1) * Math.random() * 0.5;
  if (particle.y > height + 20) {
    particle.y = Math.random() * height - height;
    particle.x = Math.random() * width;
  }
}

function drawConfettiParticle(particle) {
  if (!confettiContext) return;
  confettiContext.save();
  confettiContext.translate(particle.x, particle.y);
  confettiContext.rotate(particle.rotation);
  confettiContext.fillStyle = particle.color;
  if (particle.shape === 'circle') {
    confettiContext.beginPath();
    confettiContext.arc(0, 0, particle.size * 0.65, 0, Math.PI * 2);
    confettiContext.fill();
  } else {
    confettiContext.fillRect(
      particle.size,
      particle.size / 4,
      particle.size * 2,
      particle.size / 2,
    );
  }
  confettiContext.restore();
}

function animateConfetti() {
  if (!refs.correctOverlay || !refs.correctOverlay.classList.contains('show')) {
    confettiAnimationId = null;
    return;
  }

  const canvas = refs.confettiCanvas;
  if (!canvas || !confettiContext) {
    confettiAnimationId = null;
    return;
  }

  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  confettiContext.clearRect(0, 0, width, height);

  confettiParticles.forEach((particle) => {
    updateConfettiParticle(particle, width, height);
    drawConfettiParticle(particle);
  });

  confettiAnimationId = requestAnimationFrame(animateConfetti);
}

function startConfettiAnimation() {
  stopConfettiAnimation();
  resizeConfettiCanvas();
  initConfettiParticles();
  animateConfetti();
}

function stopConfettiAnimation() {
  if (confettiAnimationId) {
    cancelAnimationFrame(confettiAnimationId);
    confettiAnimationId = null;
  }
  confettiParticles = [];
  if (confettiContext && refs.confettiCanvas) {
    confettiContext.clearRect(0, 0, refs.confettiCanvas.clientWidth || window.innerWidth, refs.confettiCanvas.clientHeight || window.innerHeight);
  }
}

refs.startQuizHome.addEventListener('click', () => setMode('quiz'));
refs.quizChip.addEventListener('click', () => setMode('quiz'));
refs.trebleChip.addEventListener('click', () => setClef('treble'));
refs.bassChip.addEventListener('click', () => setClef('bass'));
refs.nextNote.addEventListener('click', nextChallenge);
refs.nextNoteQuiz.addEventListener('click', nextChallenge);
if (refs.revealAnswer) refs.revealAnswer.addEventListener('click', revealAnswer);
if (refs.overlayNext) refs.overlayNext.addEventListener('click', () => { closeCorrectOverlay(); nextChallenge(); });

// allow clicking overlay background to dismiss
if (refs.correctOverlay) refs.correctOverlay.addEventListener('click', (e) => {
  if (e.target === refs.correctOverlay) {
    closeCorrectOverlay();
  }
});

window.addEventListener('resize', () => {
  if (refs.correctOverlay && refs.correctOverlay.classList.contains('show')) {
    resizeConfettiCanvas();
  }
});

render();