const PUZZLE_COUNT = 88;

const CONFIG = {
    cols: 4,
    rows: 3,
    pieceWidth: 120,
    pieceHeight: 120,
    images: Array.from({ length: PUZZLE_COUNT }, (_, i) => `assets/images/puzzle-${String(i + 1).padStart(2, '0')}.webp`)
};
