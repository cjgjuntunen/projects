# Liebrary

Liebrary is an online multiplayer bluffing game inspired by the out-of-print board game of the same name and games like "Balderdash" and "Fibbage". Each round a book title is shown to players. Non-reading players submit a fake first line for the title. The reader collects the submissions plus the real first line, players vote for which line they believe is the real one, and points are awarded based on guesses.

This repository contains a simple Node + Express + Socket.IO server and a minimal client UI so you can run private games locally or on a small VPS.

Features
- Multiplayer game lobby with room codes
- Round-based flow with rotating reader
- Submission and voting phases
- Server-enforced timers:
  - 60 seconds to submit (per round)
  - 60 seconds per eligible voter to vote (voting time = 60s × number of eligible voters)
- Scoring rules (as requested):
  - If a player correctly guesses the real sentence, they get +1 point.
  - If someone guesses another player's submitted sentence, the player who wrote that submitted sentence gets +3 points.
- In-memory game state (simple, no persistence)

Contents
- LIEbrary/index.html — client UI + Socket.IO client code
- LIEbrary/server.js — Express + Socket.IO game server
- package.json — convenience script to run the server

Requirements
- Node.js 14+ (recommended)
- npm

Quick start (local)
1. Clone the repo:
   git clone https://github.com/cj-juntunen/projects.git
2. Install dependencies:
   npm install
3. Start the server:
   npm start
   (This runs `node LIEbrary/server.js` per package.json.)
4. Open the client in your browser:
   http://localhost:3000/
   (Index served from the LIEbrary folder.)

You can change the listening port by setting the PORT environment variable:
PORT=8080 npm start

Gameplay (summary)
1. Create a game — the creator becomes the host and receives a room code.
2. Other players join with the room code and a display name.
3. Host sets number of rounds and starts the game.
4. Each round:
   - A title is chosen and one player is designated the reader.
   - Non-reader players have 60 seconds to submit a fake first line for the title.
   - Once submissions are in (or timeout), the server mixes in the real first line and starts the voting phase.
   - Voting time = 60 seconds per eligible voter (everyone except the reader). Players select the line they think is real.
   - After all votes or the vote timeout, the server tallies results and awards points:
     - Correct guesser: +1 point each time they pick the real line.
     - Submitter of a fake that someone else picked: +3 points per guesser.
   - Reader rotates and next round starts. Host can manually advance rounds after results or you can change to auto-advance in code.

Server events (Socket.IO) — quick reference
- Client -> Server:
  - createGame: { playerName }
  - joinGame: { playerName, roomCode }
  - startGame: { roomCode, rounds }
  - submitLine: { roomCode, line }
  - vote: { roomCode, lineId }
  - nextRound: { roomCode }
- Server -> Client:
  - playerData: { playerId, roomCode, isHost }
  - gameCreated: { roomCode }
  - joinedGame: { roomCode, players }
  - updateLobby: { players }
  - gameStarted: { title, readerId, readerName, roundNumber, rounds, submitEndsAt }
  - votingPhase: { lines: [{id, text, playerId?, isReal?}], voteEndsAt }
  - roundResults: { scores, picks, realText, nextReaderName, roundNumber, rounds }
  - error: { message }

Customization
- Titles & real first lines: edit `SAMPLE_BOOKS` in `LIEbrary/server.js` to add or change books.
- Scoring logic: implemented in `finalizeVoting(game)` in `LIEbrary/server.js`. Modify if you want different rules.
- Timers: submission and voting durations are set in `startRound()` and `emitVotingPhase()` (60 seconds and 60 seconds × eligible voters respectively). Adjust those durations for faster/slower games.

Limitations and notes
- In-memory game state: when the server restarts all games/scores are lost. For persistence, add a database.
- Reconnection: current implementation does not restore a player's socket automatically if they reload/disconnect. You can extend the server to support reconnection by mapping players to persistent IDs and reattaching them to rooms.
- Security: there is minimal validation. Don't expose this server on the public internet without adding rate-limiting and appropriate input sanitization for production use.
- Edge cases: small numbers of players (1 or 2) are allowed but gameplay may be trivial — you may want to add minimum player checks before starting.

Development
- Run server with nodemon (recommended for development):
  npm install -g nodemon
  nodemon LIEbrary/server.js
- Client files are static in LIEbrary/index.html; edit there and reload the browser.

How to contribute
- File a GitHub issue describing the enhancement or bug.
- Fork the repository, create a branch for your change, and open a pull request.
- If you want help implementing a feature (reconnect, persistence, better UI), open an issue and we can discuss design before coding.

Example changes you might want next
- Add reconnection support so players who reload keep their scores.
- Persist games & scores in a small database (SQLite, Redis).
- Improve UI/UX: better mobile layout, timers visually represented, animations.
- Add authentication so players keep a persistent identity across devices.
