class NetworkManager {
    constructor(role, roomId, onMessage, onStatus) {
        this.role = role;
        this.roomId = roomId;
        this.hostId = 'dragger-' + roomId;
        this.onMessage = onMessage;
        this.onStatus = onStatus;
        this.conn = null;
        this.peer = null;
        this.attempts = 0;
        this.maxGuestAttempts = 25;
        this.retryDelay = 1500;
        this.openTimeout = 8000;
        this.retryTimer = null;
        this.openTimer = null;
        this.start();
    }

    setStatus(status) {
        if (this.onStatus) this.onStatus(status);
    }

    start() {
        this.setStatus('connecting');
        this.peer = this.role === 'host' ? new Peer(this.hostId) : new Peer();
        this.bindPeer(this.peer);
    }

    restart() {
        const old = this.peer;
        this.peer = null;
        if (old && !old.destroyed) old.destroy();
        this.start();
    }

    schedule(action) {
        clearTimeout(this.retryTimer);
        this.attempts++;
        if (this.role === 'guest' && this.attempts > this.maxGuestAttempts) {
            this.setStatus('failed');
            return;
        }
        this.retryTimer = setTimeout(action, this.retryDelay);
    }

    bindPeer(peer) {
        peer.on('open', () => {
            if (peer !== this.peer) return;
            if (this.role === 'guest') this.connectToHost();
        });

        peer.on('connection', (incoming) => {
            if (peer !== this.peer) return;
            if (this.role !== 'host') {
                incoming.close();
                return;
            }
            const previous = this.conn;
            this.conn = null;
            if (previous) previous.close();
            this.bindConnection(incoming);
        });

        peer.on('disconnected', () => {
            if (peer === this.peer && !peer.destroyed) peer.reconnect();
        });

        peer.on('error', (err) => {
            if (peer !== this.peer) return;
            this.handlePeerError(err);
        });
    }

    handlePeerError(err) {
        if (this.role === 'host') {
            if (err.type === 'unavailable-id' || err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
                this.setStatus('connecting');
                this.schedule(() => this.restart());
            }
            return;
        }

        if (err.type === 'peer-unavailable') {
            this.setStatus('connecting');
            this.schedule(() => this.connectToHost());
            return;
        }

        if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
            this.setStatus('connecting');
            this.schedule(() => this.restart());
        }
    }

    connectToHost() {
        if (!this.peer || this.peer.destroyed || this.peer.disconnected) {
            this.schedule(() => this.restart());
            return;
        }
        const connection = this.peer.connect(this.hostId, { reliable: true, serialization: 'json' });
        this.bindConnection(connection);
        clearTimeout(this.openTimer);
        this.openTimer = setTimeout(() => {
            if (connection === this.conn && !connection.open) {
                this.conn = null;
                connection.close();
                this.setStatus('connecting');
                this.schedule(() => this.connectToHost());
            }
        }, this.openTimeout);
    }

    bindConnection(connection) {
        this.conn = connection;

        const handleOpen = () => {
            if (connection !== this.conn) return;
            clearTimeout(this.openTimer);
            clearTimeout(this.retryTimer);
            this.attempts = 0;
            this.setStatus('connected');
            if (this.role === 'guest') this.send({ type: 'CLIENT_READY' });
        };

        const handleLost = () => {
            if (connection !== this.conn) return;
            this.conn = null;
            this.setStatus('disconnected');
            if (this.role === 'guest') this.schedule(() => this.connectToHost());
        };

        connection.on('open', handleOpen);
        connection.on('close', handleLost);
        connection.on('error', handleLost);
        connection.on('data', (data) => {
            if (connection !== this.conn) return;
            if (this.onMessage && data && typeof data === 'object') this.onMessage(data);
        });

        if (connection.open) handleOpen();
    }

    isConnected() {
        return Boolean(this.conn && this.conn.open);
    }

    send(data) {
        if (!this.isConnected()) return false;
        this.conn.send(data);
        return true;
    }
}