class HistoryManager {
    constructor(onChangeCallback) {
        this.undoStack = [];
        this.redoStack = [];
        this.onChangeCallback = onChangeCallback;
    }

    saveState(boardState) {
        this.undoStack.push(JSON.parse(JSON.stringify(boardState)));
        this.redoStack = [];
        if (this.onChangeCallback) this.onChangeCallback();
    }

    undo(currentBoardState) {
        if (this.undoStack.length === 0) return null;
        this.redoStack.push(JSON.parse(JSON.stringify(currentBoardState)));
        return this.undoStack.pop();
    }

    redo(currentBoardState) {
        if (this.redoStack.length === 0) return null;
        this.undoStack.push(JSON.parse(JSON.stringify(currentBoardState)));
        return this.redoStack.pop();
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
        if (this.onChangeCallback) this.onChangeCallback();
    }
}