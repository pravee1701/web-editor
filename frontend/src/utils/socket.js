// socket.js
import { io } from 'socket.io-client';

const BACKEND_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:8080'; // Ensure this matches your backend

// --- For Singleton Sockets (like for /editor or general app events) ---
const singletonSockets = {}; // Cache for singleton instances

const createSingletonSocketInternal = (namespace) => {
  console.log(`Initializing SINGLETON socket for namespace: ${namespace} at ${BACKEND_URL}`);
  const socket = io(`${BACKEND_URL}${namespace}`, {
    withCredentials: true, // If your backend expects cookies/session
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
    // autoConnect: false, // Allow explicit connect if needed by wrapper
    transports: ['websocket', 'polling'],
  });

  const connectionStatus = {
    connected: socket.connected,
    attempting: false,
    // Add more status tracking if needed for the singleton wrapper
  };

  socket.on('connect', () => {
    console.log(`[Singleton:${namespace} - ${socket.id}] Connected.`);
    connectionStatus.connected = true;
  });
  socket.on('disconnect', (reason) => {
    console.warn(`[Singleton:${namespace} - ${socket.id}] Disconnected. Reason: ${reason}`);
    connectionStatus.connected = false;
  });
  socket.on('connect_error', (err) => {
    console.error(`[Singleton:${namespace}] Connect error:`, err.message);
  });
  // Add other generic handlers as in your original getSocket

  // Simple wrapper for the singleton
  const wrappedSocket = {
    rawSocket: socket,
    connect: () => { if (!socket.connected) socket.connect(); },
    disconnect: () => socket.disconnect(),
    emit: (event, data, callback) => {
        if (socket.connected) socket.emit(event, data, callback);
        else console.warn(`[Singleton:${namespace}] Cannot emit "${event}" - not connected.`);
    },
    on: (event, callback) => socket.on(event, callback),
    off: (event, callback) => socket.off(event, callback),
    get id() { return socket.id; },
    get connected() { return socket.connected; },
    // Add getStatus if needed
  };
  
  // Auto-connect the singleton instance
  if(!socket.connected) {
    socket.connect();
  }

  return wrappedSocket;
};

export const getSharedSocket = (namespace = '/') => {
  if (!singletonSockets[namespace]) {
    singletonSockets[namespace] = createSingletonSocketInternal(namespace);
  }
  return singletonSockets[namespace];
};


// --- For Multiple Independent Socket Instances (like for /terminal tabs) ---
export const createNewSocketInstance = (namespace = '/') => {
  console.log(`Creating NEW socket instance for namespace: ${namespace} at ${BACKEND_URL}`);

  const socket = io(`${BACKEND_URL}${namespace}`, {
    withCredentials: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    timeout: 20000,
    autoConnect: false, // Crucial: let the caller (e.g., TerminalInstance) control connection
    transports: ['websocket', 'polling'],
  });

  const connectionStatus = {
    connected: false,
    attempting: false,
    failedPermanently: false,
    instanceId: `pending-${Math.random().toString(36).substr(2, 5)}`
  };
  
  // Minimal internal handlers for logging; consuming component handles primary logic
  socket.on('connect', () => {
    connectionStatus.instanceId = socket.id;
    console.log(`[NewInstance:${namespace} - ${socket.id}] Connected.`);
    connectionStatus.connected = true; connectionStatus.attempting = false;
  });
  socket.on('disconnect', (reason) => {
    console.warn(`[NewInstance:${namespace} - ${socket.id}] Disconnected. Reason: ${reason}`);
    connectionStatus.connected = false;
    // Reconnection handled by socket.io itself based on options
    if (reason === 'io server disconnect' || reason === 'io client disconnect') {
        connectionStatus.failedPermanently = true;
    }
  });
  socket.on('connect_error', (error) => {
    console.error(`[NewInstance:${namespace} - ${socket.id}] Connect error:`, error.message);
    connectionStatus.attempting = true; // socket.io will retry
  });
   // Add other essential logging handlers (reconnect_attempt, reconnect, reconnect_failed, error) as in previous version.


  // Return a wrapper that allows the consuming component to manage its lifecycle
  return {
    rawSocket: socket, // Expose raw socket if direct access is needed
    connect: () => {
      if (!socket.connected && !connectionStatus.attempting) {
        console.log(`[NewInstance:${namespace} - ${connectionStatus.instanceId}] Explicitly connecting...`);
        socket.connect();
        connectionStatus.attempting = true;
      }
    },
    disconnect: () => socket.disconnect(),
    emit: (event, data, callback) => {
      // Ensure connected before emit, or queue if you build that logic
      if (socket.connected) {
        socket.emit(event, data, callback);
      } else {
        console.warn(`[NewInstance:${namespace} - ${connectionStatus.instanceId}] Cannot emit "${event}" - socket not connected.`);
        // Optionally, try to connect if not connected:
        // if (!connectionStatus.attempting) this.connect();
      }
    },
    on: (event, callback) => socket.on(event, callback),
    off: (event, callback) => socket.off(event, callback),
    get id() { return socket.id; },
    get connected() { return socket.connected; }, // Reflects actual socket state
    getStatus: () => ({ ...connectionStatus, connected: socket.connected, id: socket.id }), // Provides more detail
  };
};