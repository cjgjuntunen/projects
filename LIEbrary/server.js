// Server file for Liebrary (node + socket.io)
// Save as LIEbrary/server.js and run: node LIEbrary/server.js

const express = require('express');
const path = require('path');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));

const games = new Map();

const GAME_PHASES = {
    LOBBY: 'lobby',
    SUBMIT: 'submit',
    VOTE: 'vote',
    RESULTS: 'results'
};

// Sample books (title + real first line)
const SAMPLE_BOOKS = [
    { title: "The Last Sunset", firstLine: "It was the last sunset she would ever see." },
    { title: "Whispers in the Dark", firstLine: "The whisper woke him before the storm." },
    { title: "The Silent Garden", firstLine: "No one came to the garden anymore, except the weeds." },
    { title: "Echoes of Tomorrow", firstLine: "Tomorrow had a way of sounding like yesterday." },
    { title: "The Forgotten Door", firstLine: "Behind that door was the thing they'd promised never to name." }
];

function makeId() {
    return Math.random().toString(36).substring(2, 9);
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

io.on('connection', (socket) => {
    socket.on('createGame', ({ playerName }) => {
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        const game = {
            players: [{ id: socket.id, name: playerName, isHost: true, score: 0 }],
            phase: GAME_PHASES.LOBBY,
            submissions: [],
            votes: {}, // voterId -> submissionId
            title: '',
            realLineObj: null,
            roomCode,
            currentReaderIndex: 0,
            roundNumber: 0,
            roundsTotal: 5,
            timers: {
                submitTimeout: null,
                voteTimeout: null
            },
            lastVotingLines: []
        };
        games.set(roomCode, game);

        socket.join(roomCode);

        socket.emit('playerData', { playerId: socket.id, roomCode, isHost: true });
        socket.emit('gameCreated', { roomCode });

        io.to(roomCode).emit('updateLobby', { players: game.players });
    });

    socket.on('joinGame', ({ playerName, roomCode }) => {
        const game = games.get(roomCode);
        if (!game) {
            return socket.emit('error', { message: 'Game not found' });
        }
        game.players.push({ id: socket.id, name: playerName, isHost: false, score: 0 });
        socket.join(roomCode);

        socket.emit('playerData', { playerId: socket.id, roomCode, isHost: false });
        socket.emit('joinedGame', { roomCode, players: game.players });

        io.to(roomCode).emit('updateLobby', { players: game.players });
    });

    socket.on('startGame', ({ roomCode, rounds }) => {
        const game = games.get(roomCode);
        if (!game) return;
        const player = game.players.find(p => p.id === socket.id);
        if (!player?.isHost) return;

        game.roundsTotal = rounds || 5;
        startRound(game);
    });

    socket.on('submitLine', ({ roomCode, line }) => {
        const game = games.get(roomCode);
        if (!game || game.phase !== GAME_PHASES.SUBMIT) return;

        const readerId = game.players[game.currentReaderIndex]?.id;
        if (socket.id === readerId) return; // reader doesn't submit

        // prevent duplicate submissions
        if (game.submissions.find(s => s.playerId === socket.id)) return;

        const submission = {
            id: makeId(),
            playerId: socket.id,
            text: line,
            isReal: false
        };
        game.submissions.push(submission);

        // if everyone except reader submitted, proceed to voting immediately
        const expectedSubmissions = Math.max(0, game.players.length - 1);
        if (game.submissions.length === expectedSubmissions) {
            // clear the submit timeout and start voting
            if (game.timers.submitTimeout) {
                clearTimeout(game.timers.submitTimeout);
                game.timers.submitTimeout = null;
            }
            emitVotingPhase(game);
        } else {
            io.to(roomCode).emit('updateLobby', { players: game.players });
        }
    });

    socket.on('vote', ({ roomCode, lineId }) => {
        const game = games.get(roomCode);
        if (!game || game.phase !== GAME_PHASES.VOTE) return;

        const readerId = game.players[game.currentReaderIndex]?.id;
        if (socket.id === readerId) return; // reader doesn't vote

        // record vote (one vote per eligible voter)
        game.votes[socket.id] = lineId;

        // if all eligible voted, finalize early
        const eligibleVoters = Math.max(0, game.players.length - 1);
        if (Object.keys(game.votes).length === eligibleVoters) {
            if (game.timers.voteTimeout) {
                clearTimeout(game.timers.voteTimeout);
                game.timers.voteTimeout = null;
            }
            finalizeVoting(game);
        }
    });

    socket.on('nextRound', ({ roomCode }) => {
        const game = games.get(roomCode);
        if (!game) return;
        const player = game.players.find(p => p.id === socket.id);
        if (!player?.isHost) return;
        if (game.phase === GAME_PHASES.RESULTS || game.phase === GAME_PHASES.LOBBY) {
            // advance reader index already set at finalizeVoting
            startRound(game);
        }
    });

    socket.on('disconnect', () => {
        for (const [roomCode, game] of games.entries()) {
            const idx = game.players.findIndex(p => p.id === socket.id);
            if (idx !== -1) {
                const wasHost = game.players[idx].isHost;
                // If disconnected player had submitted earlier this round, keep their submission but their socket is gone.
                game.players.splice(idx, 1);
                if (game.players.length === 0) {
                    // clear timers
                    if (game.timers.submitTimeout) clearTimeout(game.timers.submitTimeout);
                    if (game.timers.voteTimeout) clearTimeout(game.timers.voteTimeout);
                    games.delete(roomCode);
                } else {
                    if (wasHost) game.players[0].isHost = true;
                    // adjust reader index to keep it within bounds
                    if (idx <= game.currentReaderIndex) {
                        game.currentReaderIndex = Math.max(0, game.currentReaderIndex - 1);
                    }
                    io.to(roomCode).emit('updateLobby', { players: game.players });
                }
                break;
            }
        }
    });
});

// Start a round: pick a book, set timers for submission
function startRound(game) {
    const book = SAMPLE_BOOKS[Math.floor(Math.random() * SAMPLE_BOOKS.length)];
    game.title = book.title;
    game.realLineObj = { text: book.firstLine };
    game.submissions = [];
    game.votes = {};
    game.phase = GAME_PHASES.SUBMIT;
    game.lastVotingLines = [];

    // increment roundNumber now
    game.roundNumber = (game.roundNumber || 0) + 1;

    const reader = game.players[game.currentReaderIndex];
    const readerId = reader ? reader.id : null;
    const readerName = reader ? reader.name : '';

    // submission timer: 60 seconds from now
    const submitDurationMs = 60 * 1000;
    const submitEndsAt = Date.now() + submitDurationMs;

    // clear any previous submit timeout
    if (game.timers.submitTimeout) {
        clearTimeout(game.timers.submitTimeout);
        game.timers.submitTimeout = null;
    }

    // set submit timeout to automatically move to voting after 60s
    game.timers.submitTimeout = setTimeout(() => {
        emitVotingPhase(game);
        game.timers.submitTimeout = null;
    }, submitDurationMs);

    io.to(game.roomCode).emit('gameStarted', {
        title: game.title,
        readerId,
        readerName,
        roundNumber: game.roundNumber,
        rounds: game.roundsTotal,
        submitEndsAt
    });
}

// Build voting options, set voting timeout (60s per eligible voter), and emit
function emitVotingPhase(game) {
    // add real line as special option
    const realObj = {
        id: 'REAL_' + makeId(),
        playerId: null,
        text: game.realLineObj.text,
        isReal: true
    };
    const allLines = game.submissions.map(s => ({ id: s.id, text: s.text, playerId: s.playerId, isReal: false })).concat([realObj]);
    shuffle(allLines);

    game.phase = GAME_PHASES.VOTE;
    game.votes = {};
    game.lastVotingLines = allLines;

    // voting time: 60 seconds per eligible voter (everyone except reader)
    const eligibleVoters = Math.max(0, game.players.length - 1);
    const voteDurationMs = 60 * 1000 * Math.max(1, eligibleVoters); // at least 60s
    const voteEndsAt = Date.now() + voteDurationMs;

    // Clear any existing vote timeout
    if (game.timers.voteTimeout) {
        clearTimeout(game.timers.voteTimeout);
        game.timers.voteTimeout = null;
    }

    // set vote timeout to finalize voting when time is up
    game.timers.voteTimeout = setTimeout(() => {
        finalizeVoting(game);
        game.timers.voteTimeout = null;
    }, voteDurationMs);

    io.to(game.roomCode).emit('votingPhase', { lines: allLines, voteEndsAt });
}

// Finalize votes, apply scoring per rules:
// - If a player correctly guesses the real sentence, they get 1 point.
// - If someone guesses another player's submitted sentence, the player who wrote the sentence get 3 points.
function finalizeVoting(game) {
    if (!game) return;
    // create lookup of lastVotingLines
    const lookup = {};
    for (const l of game.lastVotingLines) {
        lookup[l.id] = l;
    }

    const picks = []; // { voterName, votedText, wasReal }
    // apply votes
    for (const [voterId, votedLineId] of Object.entries(game.votes)) {
        const voter = game.players.find(p => p.id === voterId);
        const chosen = lookup[votedLineId];
        if (!voter || !chosen) continue;
        const wasReal = !!chosen.isReal;
        picks.push({
            voterName: voter.name,
            votedText: chosen.text,
            wasReal
        });
        if (wasReal) {
            // voter gets 1 point
            voter.score = (voter.score || 0) + 1;
        } else {
            // the submitter gets 3 points
            const submitter = game.players.find(p => p.id === chosen.playerId);
            if (submitter) {
                submitter.score = (submitter.score || 0) + 3;
            }
        }
    }

    // Prepare scores list
    const scores = game.players.map(p => ({ name: p.name, points: p.score || 0 }));

    // prepare next reader
    const nextReaderIndex = (game.currentReaderIndex + 1) % game.players.length;
    const nextReader = game.players[nextReaderIndex];

    // mark phase RESULTS
    game.phase = GAME_PHASES.RESULTS;
    game.currentReaderIndex = nextReaderIndex;

    io.to(game.roomCode).emit('roundResults', {
        scores,
        picks,
        realText: game.realLineObj.text,
        nextReaderName: nextReader ? nextReader.name : '',
        roundNumber: game.roundNumber,
        rounds: game.roundsTotal
    });

    // If last round reached, keep as results (game ends)
    if (game.roundNumber >= game.roundsTotal) {
        // clear timers
        if (game.timers.submitTimeout) clearTimeout(game.timers.submitTimeout);
        if (game.timers.voteTimeout) clearTimeout(game.timers.voteTimeout);
        game.timers.submitTimeout = null;
        game.timers.voteTimeout = null;
    } else {
        // reset submissions/votes/lastVotingLines (they will be repopulated next round)
        game.submissions = [];
        game.votes = {};
        game.lastVotingLines = [];
    }
}

server.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
});
