const urlParams = new URLSearchParams(window.location.search);
const userRole = urlParams.get('role') === 'guest' ? 'guest' : 'host';
const isHost = userRole === 'host';
const currentRoom = urlParams.get('room') || '';
const validRoom = /^\d{6}$/.test(currentRoom);
const requestedDuration = parseInt(urlParams.get('time') || '300', 10);
const initialDuration = Number.isFinite(requestedDuration) && requestedDuration >= 30 && requestedDuration <= 3600 ? requestedDuration : 300;

const TOTAL_PIECES = CONFIG.cols * CONFIG.rows;
const PIECE_W = CONFIG.pieceWidth;
const PIECE_H = CONFIG.pieceHeight;
const SCORE_SOLVED = 20;
const SCORE_FAILED = -10;
const CALM_NEXT_DELAY = 3500;
const DRAG_SEND_INTERVAL = 33;
const IMAGE_PATH_PATTERN = /^assets\/images\/[\w\-]+\.(webp|png|jpe?g|avif)$/i;

let gameMode = urlParams.get('mode') === 'calm' ? 'calm' : 'blitz';
let boardState = new Array(TOTAL_PIECES).fill(null);
let piecesPositions = {};
let scoreP1 = 0;
let scoreP2 = 0;
let solvedCount = 0;
let remainingTime = initialDuration;
let timerInterval = null;
let currentGame = null;
let activeRoundId = null;
let roundActive = false;
let matchOver = false;
let refreshPending = false;
let activeDrag = null;
let remoteDragId = null;
let lastDragSent = 0;
let usedImages = [];
let bannerTimer = null;

const pieceElements = new Map();
const moveHistory = new HistoryManager();
const playArea = document.getElementById('playArea');
const puzzleBoard = document.getElementById('puzzleBoard');
const sideControls = document.querySelector('.side-controls');
const puzzleSlots = Array.from(document.querySelectorAll('.puzzle-slot'));
const scoreboardBar = document.querySelector('.scoreboard-bar');
const scoreP1El = document.getElementById('scoreP1');
const scoreP2El = document.getElementById('scoreP2');
const timeCounterEl = document.getElementById('timeCounter');
const timerLabelEl = document.querySelector('.timer-label');
const submitBtn = document.getElementById('submitBtn');
const roundBanner = document.getElementById('roundBanner');

const clearModal = document.getElementById('clearModal');
const refreshWaitModal = document.getElementById('refreshWaitModal');
const refreshWaitDesc = document.getElementById('refreshWaitDesc');
const refreshConfirmModal = document.getElementById('refreshConfirmModal');
const refreshConfirmDesc = document.getElementById('refreshConfirmDesc');
const cancelRefreshWaitBtn = document.getElementById('cancelRefreshWaitBtn');
const connectionModal = document.getElementById('connectionModal');
const connectionTitle = document.getElementById('connectionTitle');
const connectionDesc = document.getElementById('connectionDesc');
const connectionBackLink = document.getElementById('connectionBackLink');
const noticeModal = document.getElementById('noticeModal');
const noticeTitle = document.getElementById('noticeTitle');
const noticeDesc = document.getElementById('noticeDesc');
const noticeOkBtn = document.getElementById('noticeOkBtn');

const opponentLabel = isHost ? 'Spieler 2' : 'Spieler 1';

const offlineNetwork = { send: () => false, isConnected: () => false };
const network = validRoom
    ? new NetworkManager(userRole, currentRoom, handleNetworkMessage, handleNetworkStatus)
    : offlineNetwork;

if (!validRoom) window.location.replace('index.html');

function isCalm() {
    return gameMode === 'calm';
}

function formatTime(seconds) {
    const safe = Math.max(0, seconds);
    const m = Math.floor(safe / 60).toString().padStart(2, '0');
    const s = (safe % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function deepCopy(value) {
    return JSON.parse(JSON.stringify(value));
}

function canInteract() {
    return roundActive;
}

function updateSubmitState() {
    submitBtn.disabled = !canInteract();
}

function renderClock() {
    timeCounterEl.textContent = isCalm() ? String(solvedCount) : formatTime(remainingTime);
}

function applyModeUI() {
    scoreboardBar.classList.toggle('calm-mode', isCalm());
    timerLabelEl.textContent = isCalm() ? 'Gemeinsam gelöst' : 'Zeit';
    renderClock();
}

function updateScoreDisplay() {
    scoreP1El.textContent = scoreP1;
    scoreP2El.textContent = scoreP2;
}

function getOwnScore() {
    return isHost ? scoreP1 : scoreP2;
}

function setOwnScore(value) {
    if (isHost) scoreP1 = value;
    else scoreP2 = value;
    updateScoreDisplay();
}

function showModal(modal) {
    modal.classList.remove('hidden');
}

function hideModal(modal) {
    modal.classList.add('hidden');
}

function showNotice(title, desc) {
    noticeTitle.textContent = title;
    noticeDesc.textContent = desc;
    showModal(noticeModal);
}

function showBanner(text, duration = 3500) {
    clearTimeout(bannerTimer);
    roundBanner.textContent = text;
    roundBanner.classList.remove('hidden');
    bannerTimer = setTimeout(() => roundBanner.classList.add('hidden'), duration);
}

function showConnection(title, desc, failed = false) {
    connectionTitle.textContent = title;
    connectionDesc.textContent = desc;
    connectionBackLink.hidden = !failed;
    showModal(connectionModal);
}

function hideRefreshModals() {
    refreshPending = false;
    hideModal(refreshWaitModal);
    hideModal(refreshConfirmModal);
}

function rectOf(el, inset = 0) {
    return {
        x: el.offsetLeft + inset,
        y: el.offsetTop + inset,
        w: el.offsetWidth - inset * 2,
        h: el.offsetHeight - inset * 2
    };
}

function getBlockedRects() {
    const boardInset = puzzleBoard.clientLeft || 0;
    return [rectOf(puzzleBoard, boardInset), rectOf(sideControls)];
}

function getBounds() {
    return {
        maxX: Math.max(0, playArea.clientWidth - PIECE_W),
        maxY: Math.max(0, playArea.clientHeight - PIECE_H)
    };
}

function intersects(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function isBlocked(x, y) {
    const rect = { x, y, w: PIECE_W, h: PIECE_H };
    return getBlockedRects().some((blocked) => intersects(rect, blocked));
}

function isValidCoordinate(pos) {
    return Boolean(pos) && Number.isFinite(pos.x) && Number.isFinite(pos.y);
}

function isUsablePosition(pos) {
    if (!isValidCoordinate(pos)) return false;
    const { maxX, maxY } = getBounds();
    return pos.x >= 0 && pos.y >= 0 && pos.x <= maxX && pos.y <= maxY && !isBlocked(pos.x, pos.y);
}

function clampPosition(pos) {
    const { maxX, maxY } = getBounds();
    const x = isValidCoordinate(pos) ? pos.x : maxX;
    const y = isValidCoordinate(pos) ? pos.y : 0;
    return {
        x: Math.round(Math.min(Math.max(0, x), maxX)),
        y: Math.round(Math.min(Math.max(0, y), maxY))
    };
}

function conflictsWith(pos, occupied) {
    return occupied.some((other) => Math.abs(other.x - pos.x) < PIECE_W * 0.7 && Math.abs(other.y - pos.y) < PIECE_H * 0.7);
}

function randomFreePosition(occupied = []) {
    const { maxX, maxY } = getBounds();
    for (let attempt = 0; attempt < 150; attempt++) {
        const pos = {
            x: Math.floor(Math.random() * (maxX + 1)),
            y: Math.floor(Math.random() * (maxY + 1))
        };
        const strict = attempt < 100;
        if (!isBlocked(pos.x, pos.y) && (!strict || !conflictsWith(pos, occupied))) return pos;
    }
    for (let x = maxX; x >= 0; x -= 20) {
        for (let y = 0; y <= maxY; y += 20) {
            if (!isBlocked(x, y)) return { x, y };
        }
    }
    const board = rectOf(puzzleBoard);
    return clampPosition({ x: board.x + board.w + 20, y: 0 });
}

function sanitizePosition(pos, occupied) {
    return isUsablePosition(pos) ? { x: Math.round(pos.x), y: Math.round(pos.y) } : randomFreePosition(occupied);
}

function freePositions(excludeIds = []) {
    const result = [];
    for (let id = 0; id < TOTAL_PIECES; id++) {
        if (excludeIds.includes(id) || boardState.includes(id)) continue;
        if (isValidCoordinate(piecesPositions[id])) result.push(piecesPositions[id]);
    }
    return result;
}

function snapshotState() {
    return { board: [...boardState], positions: deepCopy(piecesPositions) };
}

function saveHistoryIfChanged(snapshot) {
    if (JSON.stringify(snapshot) !== JSON.stringify(snapshotState())) moveHistory.saveState(snapshot);
}

function setPieceFree(piece, x, y) {
    piece.classList.remove('is-slotted');
    piece.classList.add('is-free');
    piece.style.left = `${x}px`;
    piece.style.top = `${y}px`;
    if (piece.parentElement !== playArea) playArea.appendChild(piece);
}

function setPieceSlotted(piece, slot) {
    piece.classList.remove('is-free');
    piece.classList.add('is-slotted');
    piece.style.left = '';
    piece.style.top = '';
    if (piece.parentElement !== slot) slot.appendChild(piece);
}

function renderPiece(id) {
    const piece = pieceElements.get(id);
    if (!piece) return;
    piece.style.zIndex = '';
    const slotIndex = boardState.indexOf(id);
    if (slotIndex !== -1 && puzzleSlots[slotIndex]) {
        setPieceSlotted(piece, puzzleSlots[slotIndex]);
        return;
    }
    if (!isValidCoordinate(piecesPositions[id])) {
        piecesPositions[id] = randomFreePosition(freePositions([id]));
    }
    const pos = clampPosition(piecesPositions[id]);
    setPieceFree(piece, pos.x, pos.y);
}

function renderAll(skipId = null) {
    for (let id = 0; id < TOTAL_PIECES; id++) {
        if (id !== skipId) renderPiece(id);
    }
}

function normalizeBoard(board) {
    const seen = new Set();
    const normalized = new Array(TOTAL_PIECES).fill(null);
    for (let i = 0; i < TOTAL_PIECES; i++) {
        const value = Array.isArray(board) ? board[i] : null;
        if (Number.isInteger(value) && value >= 0 && value < TOTAL_PIECES && !seen.has(value)) {
            normalized[i] = value;
            seen.add(value);
        }
    }
    return normalized;
}

function isSolvedBoard(board) {
    return board.length === TOTAL_PIECES && board.every((pieceId, slotIndex) => pieceId === slotIndex);
}

function isFullySolved() {
    return isSolvedBoard(boardState);
}

function applySnapshot(snapshot) {
    boardState = normalizeBoard(snapshot.board);
    piecesPositions = deepCopy(snapshot.positions || {});
    renderAll();
}

function broadcastState() {
    if (!isCalm() || !activeRoundId) return;
    network.send({
        type: 'STATE_SYNC',
        roundId: activeRoundId,
        board: [...boardState],
        positions: piecesPositions
    });
}

function applyRemoteState(data) {
    if (!isCalm() || !roundActive || data.roundId !== activeRoundId) return;
    const before = snapshotState();
    const incomingBoard = normalizeBoard(data.board);
    const incomingPositions = data.positions && typeof data.positions === 'object' ? deepCopy(data.positions) : {};
    const draggedId = activeDrag ? activeDrag.pieceId : null;

    if (!activeDrag) {
        const incoming = { board: incomingBoard, positions: incomingPositions };
        if (JSON.stringify(before) !== JSON.stringify(incoming)) moveHistory.saveState(before);
    }

    remoteDragId = null;
    boardState = incomingBoard;
    const ownPosition = draggedId !== null ? piecesPositions[draggedId] : null;
    piecesPositions = incomingPositions;
    if (draggedId !== null) {
        piecesPositions[draggedId] = ownPosition;
        boardState = boardState.map((id) => (id === draggedId ? null : id));
    }
    renderAll(draggedId);
}

function applyRemoteDrag(data) {
    if (!isCalm() || !roundActive || data.roundId !== activeRoundId) return;
    if (!Number.isInteger(data.id) || data.id < 0 || data.id >= TOTAL_PIECES) return;
    if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
    if (activeDrag && activeDrag.pieceId === data.id) return;
    const piece = pieceElements.get(data.id);
    if (!piece) return;
    remoteDragId = data.id;
    const slotIndex = boardState.indexOf(data.id);
    if (slotIndex !== -1) boardState[slotIndex] = null;
    setPieceFree(piece, data.x, data.y);
    piece.style.zIndex = '998';
}

function createPiece(originalIndex, imageSrc) {
    const piece = document.createElement('div');
    piece.className = 'puzzle-piece is-free';
    piece.id = `piece-${originalIndex}`;
    piece.dataset.originalIndex = originalIndex;

    const x = (originalIndex % CONFIG.cols) * PIECE_W;
    const y = Math.floor(originalIndex / CONFIG.cols) * PIECE_H;

    piece.style.backgroundImage = `url("${imageSrc}")`;
    piece.style.backgroundPosition = `-${x}px -${y}px`;
    piece.style.backgroundSize = `${CONFIG.cols * PIECE_W}px ${CONFIG.rows * PIECE_H}px`;

    makeDraggable(piece, originalIndex);
    return piece;
}

function setupGame(imageSrc, coords, remaining) {
    clearInterval(timerInterval);
    remainingTime = remaining;
    boardState = new Array(TOTAL_PIECES).fill(null);
    piecesPositions = {};
    activeDrag = null;
    remoteDragId = null;
    roundActive = true;
    matchOver = false;
    moveHistory.clear();

    pieceElements.forEach((piece) => piece.remove());
    pieceElements.clear();

    const placed = [];
    for (let id = 0; id < TOTAL_PIECES; id++) {
        const pos = sanitizePosition(coords && coords[id], placed);
        piecesPositions[id] = pos;
        placed.push(pos);
        const piece = createPiece(id, imageSrc);
        pieceElements.set(id, piece);
        playArea.appendChild(piece);
    }

    renderAll();
    hideRefreshModals();
    hideModal(connectionModal);
    hideModal(noticeModal);
    updateSubmitState();
    applyModeUI();
}

function pickNextImage() {
    const all = CONFIG.images;
    if (all.length === 1) return all[0];
    let pool = all.filter((image) => !usedImages.includes(image));
    if (!pool.length) {
        usedImages = currentGame ? [currentGame.image] : [];
        pool = all.filter((image) => !usedImages.includes(image));
    }
    const image = pool[Math.floor(Math.random() * pool.length)];
    usedImages.push(image);
    return image;
}

function buildInitPayload() {
    return {
        type: 'INIT_GAME',
        roundId: activeRoundId,
        mode: gameMode,
        image: currentGame.image,
        coords: currentGame.coords,
        duration: currentGame.duration,
        remaining: remainingTime,
        solved: solvedCount,
        scores: { host: scoreP1, guest: scoreP2 }
    };
}

function startRound() {
    if (matchOver) {
        scoreP1 = 0;
        scoreP2 = 0;
        remainingTime = initialDuration;
        updateScoreDisplay();
    }

    const image = pickNextImage();
    const coords = {};
    const placed = [];
    for (let id = 0; id < TOTAL_PIECES; id++) {
        const pos = randomFreePosition(placed);
        coords[id] = pos;
        placed.push(pos);
    }

    activeRoundId = Date.now();
    currentGame = { image, coords, duration: initialDuration };
    setupGame(image, coords, remainingTime);
    startTimer();
    network.send(buildInitPayload());
}

function applyRemoteInit(data) {
    gameMode = data.mode === 'calm' ? 'calm' : 'blitz';
    if (Number.isFinite(data.solved)) solvedCount = data.solved;
    if (data.scores) {
        if (Number.isFinite(data.scores.host)) scoreP1 = data.scores.host;
        if (Number.isFinite(data.scores.guest)) scoreP2 = data.scores.guest;
        updateScoreDisplay();
    }

    const remaining = Number.isFinite(data.remaining) ? data.remaining : data.duration;

    if (currentGame && data.roundId === activeRoundId) {
        remainingTime = remaining;
        applyModeUI();
        hideModal(connectionModal);
        return;
    }

    const image = typeof data.image === 'string' && IMAGE_PATH_PATTERN.test(data.image) ? data.image : CONFIG.images[0];
    const duration = Number.isFinite(data.duration) ? data.duration : initialDuration;
    activeRoundId = data.roundId;
    currentGame = { image, coords: data.coords || {}, duration };
    setupGame(image, currentGame.coords, Number.isFinite(remaining) ? remaining : duration);
    startTimer();
}

function startTimer() {
    clearInterval(timerInterval);
    renderClock();
    if (!isHost || isCalm()) return;

    timerInterval = setInterval(() => {
        remainingTime--;
        renderClock();
        network.send({ type: 'SYNC_TIME', remaining: remainingTime });
        if (remainingTime <= 0) timeUp();
    }, 1000);
}

function resultText() {
    const summary = `Spieler 1: ${scoreP1} – Spieler 2: ${scoreP2}.`;
    if (scoreP1 === scoreP2) return `${summary} Unentschieden!`;
    return `${summary} ${scoreP1 > scoreP2 ? 'Spieler 1' : 'Spieler 2'} gewinnt!`;
}

function timeUp() {
    clearInterval(timerInterval);
    remainingTime = 0;
    renderClock();
    if (!roundActive || isCalm()) return;
    roundActive = false;
    matchOver = true;
    updateSubmitState();
    showNotice('Zeit abgelaufen', resultText());
}

function awardBlitzRound(winner) {
    if (!isHost || !roundActive || isCalm()) return;
    roundActive = false;
    if (winner === 'host') scoreP1 += SCORE_SOLVED;
    else scoreP2 += SCORE_SOLVED;
    updateScoreDisplay();
    network.send({ type: 'ROUND_WON', winner, scores: { host: scoreP1, guest: scoreP2 } });
    showBanner(winner === 'host'
        ? `Du warst zuerst fertig! +${SCORE_SOLVED} IQ-Punkte. Neues Puzzle!`
        : 'Spieler 2 war schneller. Neues Puzzle!');
    startRound();
}

function completeCalmRound() {
    if (!isHost || !roundActive || !isCalm()) return;
    roundActive = false;
    solvedCount++;
    renderClock();
    updateSubmitState();
    network.send({ type: 'CALM_SOLVED', solved: solvedCount });
    showBanner('Geschafft! Ihr habt das Puzzle gemeinsam gelöst. Gleich geht es weiter...', CALM_NEXT_DELAY);
    const solvedRoundId = activeRoundId;
    setTimeout(() => {
        if (activeRoundId === solvedRoundId) startRound();
    }, CALM_NEXT_DELAY);
}

function handleNetworkStatus(status) {
    if (status === 'connecting') {
        if (isHost) showConnection('Warte auf Spieler 2...', `Raumcode: ${currentRoom}`);
        else showConnection('Verbinde...', `Verbindung zu Raum ${currentRoom} wird aufgebaut.`);
        return;
    }
    if (status === 'connected') {
        showConnection('Verbunden', 'Spiel wird vorbereitet...');
        return;
    }
    if (status === 'disconnected') {
        hideRefreshModals();
        if (remoteDragId !== null) {
            remoteDragId = null;
            renderAll(activeDrag ? activeDrag.pieceId : null);
        }
        if (isHost) showConnection('Verbindung getrennt', 'Warte darauf, dass Spieler 2 sich erneut verbindet...');
        else showConnection('Verbindung getrennt', 'Verbindung wird neu aufgebaut...');
        return;
    }
    if (status === 'failed') {
        showConnection('Raum nicht gefunden', 'Bitte prüfe den Code und versuche es erneut.', true);
    }
}

function handleNetworkMessage(data) {
    if (data.type === 'CLIENT_READY') {
        if (!isHost) return;
        if (!currentGame) {
            startRound();
        } else {
            network.send(buildInitPayload());
            broadcastState();
            hideModal(connectionModal);
        }
        return;
    }

    if (data.type === 'INIT_GAME') {
        if (!isHost) applyRemoteInit(data);
        return;
    }

    if (data.type === 'SYNC_TIME') {
        if (isHost || isCalm() || !roundActive || !Number.isFinite(data.remaining)) return;
        remainingTime = data.remaining;
        renderClock();
        if (remainingTime <= 0) timeUp();
        return;
    }

    if (data.type === 'UPDATE_SCORE') {
        if (!Number.isFinite(data.score)) return;
        if (isHost) scoreP2 = data.score;
        else scoreP1 = data.score;
        updateScoreDisplay();
        return;
    }

    if (data.type === 'CLAIM_SOLVED') {
        if (!isHost || !roundActive || data.roundId !== activeRoundId) return;
        if (!isSolvedBoard(normalizeBoard(data.board))) return;
        if (isCalm()) completeCalmRound();
        else awardBlitzRound('guest');
        return;
    }

    if (data.type === 'ROUND_WON') {
        if (isHost) return;
        roundActive = false;
        updateSubmitState();
        if (data.scores) {
            if (Number.isFinite(data.scores.host)) scoreP1 = data.scores.host;
            if (Number.isFinite(data.scores.guest)) scoreP2 = data.scores.guest;
            updateScoreDisplay();
        }
        showBanner(data.winner === 'guest'
            ? `Du warst zuerst fertig! +${SCORE_SOLVED} IQ-Punkte. Neues Puzzle!`
            : 'Spieler 1 war schneller. Neues Puzzle!');
        return;
    }

    if (data.type === 'CALM_SOLVED') {
        if (isHost) return;
        roundActive = false;
        if (Number.isFinite(data.solved)) solvedCount = data.solved;
        renderClock();
        updateSubmitState();
        showBanner('Geschafft! Ihr habt das Puzzle gemeinsam gelöst. Gleich geht es weiter...', CALM_NEXT_DELAY);
        return;
    }

    if (data.type === 'STATE_SYNC') {
        applyRemoteState(data);
        return;
    }

    if (data.type === 'DRAG_MOVE') {
        applyRemoteDrag(data);
        return;
    }

    if (data.type === 'REQUEST_REFRESH') {
        if (refreshPending) {
            refreshPending = false;
            hideModal(refreshWaitModal);
            network.send({ type: 'RESPONSE_REFRESH', accepted: true });
            if (isHost) startRound();
            return;
        }
        refreshConfirmDesc.textContent = `${opponentLabel} möchte das Puzzle neu starten. Möchtest du zustimmen?`;
        showModal(refreshConfirmModal);
        return;
    }

    if (data.type === 'CANCEL_REFRESH_REQUEST') {
        hideModal(refreshConfirmModal);
        return;
    }

    if (data.type === 'RESPONSE_REFRESH') {
        const wasPending = refreshPending;
        refreshPending = false;
        hideModal(refreshWaitModal);
        if (data.accepted && isHost && wasPending) startRound();
        if (!data.accepted && wasPending) showNotice('Anfrage abgelehnt', `${opponentLabel} hat den Neustart abgelehnt.`);
    }
}

function sendDragPosition(pieceId, x, y, force = false) {
    if (!isCalm()) return;
    const now = performance.now();
    if (!force && now - lastDragSent < DRAG_SEND_INTERVAL) return;
    lastDragSent = now;
    network.send({ type: 'DRAG_MOVE', roundId: activeRoundId, id: pieceId, x, y });
}

function makeDraggable(piece, pieceId) {
    piece.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (!canInteract() || activeDrag || remoteDragId === pieceId) return;
        e.preventDefault();

        const areaRect = playArea.getBoundingClientRect();
        const pieceRect = piece.getBoundingClientRect();
        const startLeft = pieceRect.left - areaRect.left;
        const startTop = pieceRect.top - areaRect.top;
        const slotIndex = boardState.indexOf(pieceId);
        const snapshot = snapshotState();

        if (slotIndex !== -1) boardState[slotIndex] = null;
        setPieceFree(piece, startLeft, startTop);
        piece.style.zIndex = '999';
        piece.setPointerCapture(e.pointerId);

        activeDrag = {
            pieceId,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            startLeft,
            startTop,
            slotIndex,
            snapshot
        };
        sendDragPosition(pieceId, startLeft, startTop, true);
    });

    piece.addEventListener('pointermove', (e) => {
        if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;
        const left = activeDrag.startLeft + e.clientX - activeDrag.startX;
        const top = activeDrag.startTop + e.clientY - activeDrag.startY;
        piece.style.left = `${left}px`;
        piece.style.top = `${top}px`;
        sendDragPosition(pieceId, left, top);
    });

    const finish = (e) => {
        if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;
        const drag = activeDrag;
        activeDrag = null;
        if (piece.hasPointerCapture(e.pointerId)) piece.releasePointerCapture(e.pointerId);
        piece.style.zIndex = '';

        const areaRect = playArea.getBoundingClientRect();
        const pieceRect = piece.getBoundingClientRect();
        const centerX = pieceRect.left + pieceRect.width / 2;
        const centerY = pieceRect.top + pieceRect.height / 2;

        const targetIndex = puzzleSlots.findIndex((slot) => {
            const r = slot.getBoundingClientRect();
            return centerX >= r.left && centerX < r.right && centerY >= r.top && centerY < r.bottom;
        });

        if (targetIndex !== -1) {
            const occupant = boardState[targetIndex];
            if (occupant !== null && occupant !== undefined) {
                if (drag.slotIndex !== -1 && boardState[drag.slotIndex] === null) {
                    boardState[drag.slotIndex] = occupant;
                } else if (drag.slotIndex === -1) {
                    piecesPositions[occupant] = clampPosition({ x: drag.startLeft, y: drag.startTop });
                } else {
                    piecesPositions[occupant] = randomFreePosition(freePositions([occupant]));
                }
            }
            boardState[targetIndex] = pieceId;
        } else {
            piecesPositions[pieceId] = clampPosition({
                x: pieceRect.left - areaRect.left,
                y: pieceRect.top - areaRect.top
            });
        }

        renderAll();
        saveHistoryIfChanged(drag.snapshot);
        broadcastState();
    };

    piece.addEventListener('pointerup', finish);
    piece.addEventListener('pointercancel', finish);
}

function fallPosition(item, direction, occupied) {
    const offsets = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const [dx, dy] = offsets[direction];
    const inset = puzzleBoard.clientLeft || 0;
    const preferred = {
        x: puzzleBoard.offsetLeft + inset + (item.currentX + dx) * PIECE_W,
        y: puzzleBoard.offsetTop + inset + (item.currentY + dy) * PIECE_H
    };
    if (isUsablePosition(preferred) && !conflictsWith(preferred, occupied)) return preferred;
    return randomFreePosition(occupied);
}

function handleShift(direction) {
    if (!canInteract() || activeDrag || boardState.every((value) => value === null)) return;
    const snapshot = snapshotState();
    const result = GridShift.shift(boardState, direction, CONFIG.cols, CONFIG.rows);
    boardState = result.newBoard;

    const fallenIds = result.fallenPieces.map((item) => item.pieceId);
    const occupied = freePositions(fallenIds);
    result.fallenPieces.forEach((item) => {
        const pos = fallPosition(item, direction, occupied);
        piecesPositions[item.pieceId] = pos;
        occupied.push(pos);
    });

    renderAll();
    saveHistoryIfChanged(snapshot);
    broadcastState();
}

document.getElementById('shiftUpBtn').addEventListener('click', () => handleShift('up'));
document.getElementById('shiftDownBtn').addEventListener('click', () => handleShift('down'));
document.getElementById('shiftLeftBtn').addEventListener('click', () => handleShift('left'));
document.getElementById('shiftRightBtn').addEventListener('click', () => handleShift('right'));

function triggerUndo() {
    if (!canInteract() || activeDrag) return;
    const previous = moveHistory.undo(snapshotState());
    if (previous) {
        applySnapshot(previous);
        broadcastState();
    }
}

function triggerRedo() {
    if (!canInteract() || activeDrag) return;
    const next = moveHistory.redo(snapshotState());
    if (next) {
        applySnapshot(next);
        broadcastState();
    }
}

document.getElementById('undoBtn').addEventListener('click', triggerUndo);
document.getElementById('redoBtn').addEventListener('click', triggerRedo);

window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && e.shiftKey) {
        e.preventDefault();
        triggerRedo();
    } else if (key === 'z') {
        e.preventDefault();
        triggerUndo();
    } else if (key === 'y') {
        e.preventDefault();
        triggerRedo();
    }
});

window.addEventListener('resize', () => {
    if (!activeDrag && pieceElements.size) renderAll();
});

const clearBtn = document.getElementById('clearBtn');
const cancelClearBtn = document.getElementById('cancelClearBtn');
const confirmClearBtn = document.getElementById('confirmClearBtn');

clearBtn.addEventListener('click', () => {
    if (canInteract()) showModal(clearModal);
});
cancelClearBtn.addEventListener('click', () => hideModal(clearModal));

confirmClearBtn.addEventListener('click', () => {
    hideModal(clearModal);
    if (!canInteract() || activeDrag) return;
    const placedIds = boardState.filter((id) => id !== null);
    if (!placedIds.length) return;

    const snapshot = snapshotState();
    const occupied = freePositions();
    placedIds.forEach((id) => {
        const pos = randomFreePosition(occupied);
        piecesPositions[id] = pos;
        occupied.push(pos);
    });
    boardState = new Array(TOTAL_PIECES).fill(null);
    renderAll();
    saveHistoryIfChanged(snapshot);
    broadcastState();
});

const refreshBtn = document.getElementById('refreshBtn');
const acceptRefreshBtn = document.getElementById('acceptRefreshBtn');
const rejectRefreshBtn = document.getElementById('rejectRefreshBtn');

refreshBtn.addEventListener('click', () => {
    if (refreshPending) return;
    if (!network.isConnected()) {
        showNotice('Keine Verbindung', 'Es besteht aktuell keine Verbindung zum Mitspieler.');
        return;
    }
    refreshPending = true;
    refreshWaitDesc.textContent = `Warte auf Bestätigung von ${opponentLabel}...`;
    showModal(refreshWaitModal);
    network.send({ type: 'REQUEST_REFRESH' });
});

cancelRefreshWaitBtn.addEventListener('click', () => {
    refreshPending = false;
    hideModal(refreshWaitModal);
    network.send({ type: 'CANCEL_REFRESH_REQUEST' });
});

acceptRefreshBtn.addEventListener('click', () => {
    hideModal(refreshConfirmModal);
    network.send({ type: 'RESPONSE_REFRESH', accepted: true });
    if (isHost) startRound();
});

rejectRefreshBtn.addEventListener('click', () => {
    hideModal(refreshConfirmModal);
    network.send({ type: 'RESPONSE_REFRESH', accepted: false });
});

noticeOkBtn.addEventListener('click', () => hideModal(noticeModal));

function submitSolution() {
    if (!canInteract() || activeDrag) return;
    const solved = isFullySolved();

    if (isCalm()) {
        if (!solved) {
            showNotice('Noch nicht ganz', 'Macht in Ruhe weiter – gemeinsam schafft ihr das.');
            return;
        }
        if (isHost) {
            completeCalmRound();
        } else if (!network.send({ type: 'CLAIM_SOLVED', roundId: activeRoundId, board: [...boardState] })) {
            showNotice('Keine Verbindung', 'Es besteht aktuell keine Verbindung zum Mitspieler.');
        }
        return;
    }

    if (!solved) {
        const newScore = getOwnScore() + SCORE_FAILED;
        setOwnScore(newScore);
        network.send({ type: 'UPDATE_SCORE', score: newScore });
        showNotice('Nicht korrekt', `Die Lösung ist unvollständig oder falsch. ${SCORE_FAILED} IQ-Punkte.`);
        return;
    }

    if (isHost) {
        awardBlitzRound('host');
    } else if (network.send({ type: 'CLAIM_SOLVED', roundId: activeRoundId, board: [...boardState] })) {
        showBanner('Lösung gesendet – wird geprüft...', 2000);
    } else {
        showNotice('Keine Verbindung', 'Es besteht aktuell keine Verbindung zum Mitspieler.');
    }
}

submitBtn.addEventListener('click', submitSolution);

updateSubmitState();
updateScoreDisplay();
applyModeUI();