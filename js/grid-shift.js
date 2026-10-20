const GridShift = {
    shift(boardState, direction, cols = 4, rows = 3) {
        const newBoard = new Array(cols * rows).fill(null);
        const fallenPieces = [];

        let dx = 0;
        let dy = 0;

        if (direction === 'up') dy = -1;
        if (direction === 'down') dy = 1;
        if (direction === 'left') dx = -1;
        if (direction === 'right') dx = 1;

        for (let index = 0; index < boardState.length; index++) {
            const pieceId = boardState[index];
            if (pieceId === null || pieceId === undefined) continue;

            const currentX = index % cols;
            const currentY = Math.floor(index / cols);

            const targetX = currentX + dx;
            const targetY = currentY + dy;

            if (targetX >= 0 && targetX < cols && targetY >= 0 && targetY < rows) {
                const targetIndex = targetY * cols + targetX;
                newBoard[targetIndex] = pieceId;
            } else {
                fallenPieces.push({ pieceId, currentX, currentY });
            }
        }

        return {
            newBoard,
            fallenPieces
        };
    }
};