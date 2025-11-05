# Rhythm Guessing — static web app

This is a small rhythm-guessing web app intended for piano and singing tutors.

Features
- Four difficulty levels: Easy, Medium, Difficult, Expert
- Generates a 2-bar rhythm per question following level rules, while the first two bars are prep beats
- Renders rhythms visually using VexFlow (via CDN)
- Presents 4 options (one correct + 3 distractors)
- Bottom-left toast messages: green for "Correct!" and red for "Incorrect! The correct option is option X"

How to run
1. Open `index.html` in a modern browser (no server required). VexFlow is loaded via CDN.

Notes & assumptions
- Time signature is 4/4 (each bar = 4 beats, 2 bars total)
- Internally the smallest unit is a 16nd note (semiquaver)
- Easy includes semibreve to crotchet
- Medium includes minim to quaver but no triplets
- Difficult includes all from medium in addition to that, semiquaver and triplets.
- Expert includes crotchet to semiquaver.