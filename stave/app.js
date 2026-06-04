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
};

let overlayTimeoutId = null;

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
  // show static ribbons and spawn streamers
  const container = overlay.querySelector('.ribbon-container');
  if (container) container.style.display = 'block';
  spawnStreamers();
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
  // hide ribbon container and clear dynamic streamers
  const container = overlay.querySelector('.ribbon-container');
  if (container) container.style.display = 'none';
  clearStreamers();
}

function spawnStreamers() {
  const container = refs.correctOverlay && refs.correctOverlay.querySelector('.ribbon-container');
  if (!container) return;
  const colors = ['#ffd47a', '#ff9f80', '#8ad3a3', '#6ea8ff', '#ff66b2', '#ffd166'];
  const count = 36;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'confetti';
    // random size
    const size = 6 + Math.round(Math.random() * 10);
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    // random left position across the container
    const left = 6 + Math.random() * 88; // 6%..94%
    const color = colors[Math.floor(Math.random() * colors.length)];
    const popDur = 280 + Math.random() * 360;
    const fallDur = 1000 + Math.random() * 900;
    el.style.left = `${left}%`;
    el.style.background = color;
    el.style.animationDelay = `${Math.random() * 240}ms`;
    el.style.animationDuration = `${Math.round(popDur)}ms, ${Math.round(fallDur)}ms`;
    // randomly make some circular confetti
    if (Math.random() > 0.75) el.classList.add('circle');
    // slight rotation initial
    el.style.transform = `rotate(${Math.floor(Math.random() * 360)}deg)`;
    container.appendChild(el);
    (function(node) {
      node.addEventListener('animationend', () => { try { node.remove(); } catch(e){} }, { once: true });
    })(el);
  }
}

function clearStreamers() {
  const container = refs.correctOverlay && refs.correctOverlay.querySelector('.ribbon-container');
  if (!container) return;
  Array.from(container.children).forEach((child) => child.remove());
}

refs.startQuizHome.addEventListener('click', () => setMode('quiz'));
refs.quizChip.addEventListener('click', () => setMode('quiz'));
refs.trebleChip.addEventListener('click', () => setClef('treble'));
refs.bassChip.addEventListener('click', () => setClef('bass'));
refs.nextNote.addEventListener('click', nextChallenge);
refs.nextNoteQuiz.addEventListener('click', nextChallenge);
if (refs.revealAnswer) refs.revealAnswer.addEventListener('click', revealAnswer);
if (refs.overlayNext) refs.overlayNext.addEventListener('click', () => { const container = refs.correctOverlay && refs.correctOverlay.querySelector('.ribbon-container'); if (container) container.style.display = 'none'; clearStreamers(); closeCorrectOverlay(); nextChallenge(); });

// allow clicking overlay background to dismiss
if (refs.correctOverlay) refs.correctOverlay.addEventListener('click', (e) => {
  if (e.target === refs.correctOverlay) {
    closeCorrectOverlay();
  }
});

render();