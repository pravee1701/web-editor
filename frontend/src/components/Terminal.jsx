import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { SearchAddon } from 'xterm-addon-search'; // You can integrate UI for this later
import 'xterm/css/xterm.css';
import { createNewSocketInstance } from '../utils/socket'; // Ensure this path is correct

// TerminalTab component (assuming this is defined correctly as you had it)
const TerminalTab = ({ id, name, isActive, onSelect, onClose, isConnected }) => {
  return (
    <div
      className={`flex items-center px-4 py-2 border-r border-gray-700 cursor-pointer whitespace-nowrap ${
        isActive ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
      }`}
      onClick={() => onSelect(id)}
    >
      <span className={`mr-2 h-2.5 w-2.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
      <span className="mr-2 text-sm">{name}</span>
      <button
        className="ml-1 text-gray-500 hover:text-white focus:outline-none text-xs"
        onClick={(e) => { e.stopPropagation(); onClose(id); }}
      >
        ✕
      </button>
    </div>
  );
};

class PTYTerminalInstance {
  constructor(id, name, environmentType, onConnectionChangeCallback, userId, initialVfsPath = '/') {
    this.id = id; // Unique ID for this tab instance
    this.name = name;
    this.environmentType = environmentType; // e.g., 'javascript', 'python', 'shell'
    this.userId = userId;
    this.onConnectionChangeCallback = onConnectionChangeCallback;
    this.initialVfsPath = initialVfsPath; // VFS path context for this terminal, e.g., "/MyProject/src"

    this.term = null;
    this.fitAddon = new FitAddon();
    this.searchAddon = new SearchAddon();
    this.socketWrapper = null;
    this.isConnectedToSocket = false;
    this.isPtyInitialized = false; // True after backend confirms PTY is ready
    this._onDataDisposable = null; // For xterm's onData listener
  }

  initialize(containerRef) {
    this.term = new Terminal({
        cursorBlink: true,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        fontSize: 14,
        lineHeight: 1.25,
        theme: { 
            background: '#1e1e1e', foreground: '#dddddd', cursor: '#f8f8f8',
            selectionBackground: '#555555', black: '#000000', red: '#cd3131',
            green: '#0dbc79', yellow: '#e5e510', blue: '#2472c8',
            magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
            brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b',
            brightYellow: '#f5f543', brightBlue: '#3b8ff5', brightMagenta: '#d670d6',
            brightCyan: '#29b8db', brightWhite: '#e5e5e5',
        },
        allowProposedApi: true, // For some addons or future xterm features
        scrollback: 3000,
        convertEol: true, // Important for PTYs sending \r\n
    });

    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(this.searchAddon);
    this.term.loadAddon(new WebLinksAddon(undefined, undefined, true)); // Open links in new tab

    this.term.open(containerRef);
    this.fitAddon.fit();
    // this.term.focus(); // Focus is better handled in TerminalComponent's useEffect after DOM attachment

    // Send raw data from xterm to backend
    if (this._onDataDisposable) this._onDataDisposable.dispose(); 
    this._onDataDisposable = this.term.onData((data) => {
      if (this.socketWrapper && this.isConnectedToSocket && this.isPtyInitialized) {
        this.socketWrapper.emit('pty_input', data);
      } else if (this.socketWrapper && this.isConnectedToSocket && !this.isPtyInitialized) {
        // Optionally buffer input here if desired, or just log
        // console.warn(`PTYInstance [${this.id}]: Input received but PTY not initialized yet. Data:`, data);
      }
    });

    this.socketWrapper = createNewSocketInstance('/terminal');
    this.setupSocketHandlers();
    if (this.socketWrapper && typeof this.socketWrapper.connect === 'function') {
        this.socketWrapper.connect(); // Explicitly connect the socket
    }
    return this.term;
  }

  _updateFullConnectionStatus() {
    const isFullyUp = this.isConnectedToSocket && this.isPtyInitialized;
    if (this.onConnectionChangeCallback) {
      // Check if the callback reference is stable or if this.id could change during callback.
      // It should be fine as `id` is set in constructor.
      this.onConnectionChangeCallback(this.id, isFullyUp);
    }
  }

  setupSocketHandlers() {
    if (!this.socketWrapper || !this.socketWrapper.on) return;

    this.socketWrapper.on('connect', () => {
      this.isConnectedToSocket = true;
      this._updateFullConnectionStatus(); 
      if (this.term && !this.term.isDisposed) this.term.writeln('\r\n\x1b[32mSocket connected. Initializing PTY session...\x1b[0m');
      
      if (this.socketWrapper.emit && this.userId && this.socketWrapper.id) {
        const payload = {
          userId: this.userId,
          environment: this.environmentType,
          cols: this.term ? Math.max(1, this.term.cols) : 80,
          rows: this.term ? Math.max(1, this.term.rows) : 24,
          initialVfsPath: this.initialVfsPath, 
        };
        console.log(`PTYInstance [${this.id}]: Emitting initialize_pty:`, payload);
        this.socketWrapper.emit('initialize_pty', payload);
      }
    });

    this.socketWrapper.on('disconnect', (reason) => {
      this.isConnectedToSocket = false;
      this.isPtyInitialized = false; 
      this._updateFullConnectionStatus();
      if (this.term && !this.term.isDisposed) this.term.writeln(`\r\n\x1b[31mSocket disconnected: ${reason}\x1b[0m`);
    });

    this.socketWrapper.on('pty_output', (data) => {
      if (this.term && !this.term.isDisposed) this.term.write(data);
    });

    this.socketWrapper.on('pty_initialized', (message) => {
        this.isPtyInitialized = true;
        this._updateFullConnectionStatus();
        if (this.term && !this.term.isDisposed) {
            this.term.writeln(`\r\n\x1b[32m${message}\x1b[0m`); // Backend should manage newlines
            this.term.focus();
        }
    });

    this.socketWrapper.on('pty_error', (errorMessage) => {
        this.isPtyInitialized = false; // PTY init failed or errored
        this._updateFullConnectionStatus();
        if (this.term && !this.term.isDisposed) this.term.writeln(`\r\n\x1b[31mPTY Error: ${errorMessage}\x1b[0m`);
    });
    
    this.socketWrapper.on('pty_exit', (message) => {
        this.isPtyInitialized = false; // PTY session ended
        this._updateFullConnectionStatus();
        if (this.term && !this.term.isDisposed) this.term.writeln(`\r\n\x1b[33m${message}\x1b[0m`);
    });
  }

  resize() {
    if (this.term && !this.term.isDisposed && this.fitAddon && typeof this.fitAddon.fit === 'function') {
      this.fitAddon.fit();
      if (this.isConnectedToSocket && this.isPtyInitialized && 
          this.socketWrapper && this.socketWrapper.emit &&
          this.term.cols > 0 && this.term.rows > 0) {
        this.socketWrapper.emit('pty_resize', {
          cols: this.term.cols,
          rows: this.term.rows,
        });
      }
    }
  }

  dispose() {
    console.log(`PTYInstance [${this.id}]: Disposing...`);
    if (this._onDataDisposable && typeof this._onDataDisposable.dispose === 'function') {
        this._onDataDisposable.dispose();
        this._onDataDisposable = null;
    }
    if (this.socketWrapper && typeof this.socketWrapper.disconnect === 'function') {
      this.socketWrapper.disconnect();
      this.socketWrapper = null; // Release reference
    }
    if (this.term && typeof this.term.dispose === 'function' && !this.term.isDisposed) {
      this.term.dispose();
      this.term = null; // Release reference
    }
    this.isPtyInitialized = false;
    this.isConnectedToSocket = false;
    // Call connection change callback one last time to update UI if needed
    if (this.onConnectionChangeCallback) {
        this.onConnectionChangeCallback(this.id, false); 
    }
  }
}

// Main Terminal Component
const TerminalComponent = (props) => {
  const { 
    projectVfsPathForNewTerminals = '/', 
    defaultPtyEnvironmentForNewTerminals = 'shell' // Prop from EditorPage
  } = props;

  const terminalContainerRef = useRef(null);
  const [terminals, setTerminals] = useState({}); // Stores PTYTerminalInstance objects
  const [activeTerminalId, setActiveTerminalId] = useState(null);
  const [terminalIdsOrder, setTerminalIdsOrder] = useState([]);

  const { user } = useSelector((state) => state.auth);
  const currentUserId = user?._id;

  const handleConnectionChange = useCallback((terminalInstanceId, isFullyConnected) => {
    // This callback is to ensure TerminalTab re-renders with correct connection dot.
    // PTYTerminalInstance already updates its internal isConnectedToSocket and isPtyInitialized.
    // We just need to trigger a re-render of TerminalComponent if TerminalTab's prop depends on it.
    // A simpler way might be for TerminalTab to get the instance and check instance.isPtyInitialized itself.
    // For now, this forces a re-render of the parent, which will pass new props to TerminalTab.
    setTerminals(prevTerminals => ({ ...prevTerminals })); // Create new object reference for terminals map
  }, []);

  const addTerminal = useCallback((name = 'Terminal', environmentTypeParam, initialPathFromButton) => {
    if (!currentUserId) {
      console.warn("TerminalComponent: Cannot add terminal - No user logged in.");
      return;
    }
    
    const actualEnvironmentType = environmentTypeParam || defaultPtyEnvironmentForNewTerminals || 'shell';
    const actualInitialPath = initialPathFromButton || projectVfsPathForNewTerminals || '/';
    const id = `pty-term-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

    console.log(`TerminalComponent: Adding new terminal. Name: ${name}, Env: ${actualEnvironmentType}, Path: ${actualInitialPath}`);
    const newTerminal = new PTYTerminalInstance(id, name, actualEnvironmentType, handleConnectionChange, currentUserId, actualInitialPath);
    
    setTerminals(prev => ({ ...prev, [id]: newTerminal }));
    setTerminalIdsOrder(prev => [...prev, id]);
    setActiveTerminalId(id); // This will trigger the useEffect for initializing the new terminal
  }, [currentUserId, handleConnectionChange, projectVfsPathForNewTerminals, defaultPtyEnvironmentForNewTerminals]);

  const closeTerminal = useCallback((idToClose) => {
    const terminalToClose = terminals[idToClose];
    if (terminalToClose && typeof terminalToClose.dispose === 'function') {
      terminalToClose.dispose();
    }
    
    setTerminals(prev => { 
      const newTerminals = { ...prev }; 
      delete newTerminals[idToClose]; 
      return newTerminals; 
    });
    const newTerminalIdsOrder = terminalIdsOrder.filter(id => id !== idToClose);
    setTerminalIdsOrder(newTerminalIdsOrder);
    
    if (idToClose === activeTerminalId) { 
      setActiveTerminalId(newTerminalIdsOrder.length > 0 ? newTerminalIdsOrder[newTerminalIdsOrder.length -1] : null); // Activate last or null
    }
  }, [terminals, activeTerminalId, terminalIdsOrder]);

  // Initialize with a default terminal if user is logged in
  useEffect(() => {
    if (terminalIdsOrder.length === 0 && currentUserId) {
      addTerminal('Interactive Shell', defaultPtyEnvironmentForNewTerminals, projectVfsPathForNewTerminals);
    }
  }, [addTerminal, terminalIdsOrder.length, currentUserId, projectVfsPathForNewTerminals, defaultPtyEnvironmentForNewTerminals]);

  // Effect to handle user logout: clean up terminals
  useEffect(() => {
    if (!currentUserId && Object.keys(terminals).length > 0) {
        console.log("TerminalComponent: User logged out, disposing all terminals.");
        Object.values(terminals).forEach(instance => {
          if (instance && typeof instance.dispose === 'function') instance.dispose();
        });
        setTerminals({}); 
        setTerminalIdsOrder([]); 
        setActiveTerminalId(null);
    }
  }, [currentUserId, terminals]);

  // Handle window resize for the active terminal
  useEffect(() => {
    const handleResize = () => {
      const activeInstance = activeTerminalId ? terminals[activeTerminalId] : null;
      if (activeInstance && typeof activeInstance.resize === 'function') {
        activeInstance.resize();
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [activeTerminalId, terminals]);

  // Effect for initializing the xterm instance when a tab becomes active,
  // or re-attaching its DOM if it already exists.
  useEffect(() => {
    if (!terminalContainerRef.current) {
        console.warn("TerminalComponent: terminalContainerRef.current is not available.");
        return;
    }
    const activeInstance = activeTerminalId ? terminals[activeTerminalId] : null;

    // Clear any previous terminal's DOM from the container
    while (terminalContainerRef.current.firstChild) {
        terminalContainerRef.current.removeChild(terminalContainerRef.current.firstChild);
    }

    if (activeInstance) {
      console.log(`TerminalComponent: Activating terminal ${activeInstance.id}, name: ${activeInstance.name}`);
      let term = activeInstance.term;
      if (!term || (term.isDisposed !== undefined && term.isDisposed)) { // Check if xterm instance needs to be created
          console.log(`TerminalComponent: Initializing xterm for ${activeInstance.id}`);
          term = activeInstance.initialize(terminalContainerRef.current); // Pass the DOM element
      } else {
          // If term already exists and is not disposed, ensure its DOM element is in the container
          if(term.element && term.element.parentNode !== terminalContainerRef.current) {
              console.log(`TerminalComponent: Re-attaching xterm DOM for ${activeInstance.id}`);
              terminalContainerRef.current.appendChild(term.element);
          } else if (!term.element && typeof term.open === 'function') { // Should not happen if dispose clears term ref
              console.warn(`TerminalComponent: xterm element missing for ${activeInstance.id}, trying to re-open.`);
              term.open(terminalContainerRef.current);
          }
          // Call fit for existing terminals too, as container might have resized
          if (typeof activeInstance.resize === 'function') {
              activeInstance.resize();
          }
      }

      // Focus the active terminal
      if (term && typeof term.focus === 'function' && !term.isDisposed) {
        // Use a small timeout to ensure DOM is fully ready, especially after appending
        setTimeout(() => {
            if (term && !term.isDisposed) term.focus();
        }, 0);
      }
    }
  }, [activeTerminalId, terminals]); // Rerun when activeTerminalId or the terminals map changes

  // Final cleanup on component unmount
  useEffect(() => {
    // Capture the current value of terminals for the cleanup function
    const terminalsToDispose = { ...terminals };
    return () => {
      console.log("TerminalComponent unmounting, disposing ALL PTY terminals:", Object.keys(terminalsToDispose));
      Object.values(terminalsToDispose).forEach(instance => {
        if (instance && typeof instance.dispose === 'function') {
          instance.dispose();
        }
      });
    };
  }, []); // Empty dependency array ensures this runs only on mount and unmount

  if (!currentUserId) {
    return (
        <div className="flex items-center justify-center h-full bg-gray-800 text-gray-400 p-4">
            <p>Please log in to use the terminal.</p>
        </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full bg-gray-900 text-white"> {/* Ensure h-full from parent */}
      <div className="p-1 bg-gray-800 border-b border-gray-700 text-xs flex items-center justify-start space-x-2">
            <button className="px-3 py-1 bg-blue-500 hover:bg-blue-600 rounded" onClick={() => addTerminal('Node Shell', 'javascript', projectVfsPathForNewTerminals)} disabled={!currentUserId}>+ JS</button>
            <button className="px-3 py-1 bg-green-500 hover:bg-green-600 rounded" onClick={() => addTerminal('Python Shell', 'python', projectVfsPathForNewTerminals)} disabled={!currentUserId}>+ Python</button>
            <button className="px-3 py-1 bg-gray-500 hover:bg-gray-600 rounded" onClick={() => addTerminal('Generic Shell', 'shell', projectVfsPathForNewTerminals)} disabled={!currentUserId}>+ Shell</button>
      </div>

      <div className="flex items-center bg-gray-800 border-b border-gray-700 overflow-x-auto hide-scrollbar">
        {terminalIdsOrder.map(id => {
            const terminalInstance = terminals[id];
            if (!terminalInstance) {
                console.warn(`TerminalComponent: Instance not found for ID ${id} during tab render.`);
                return null;
            }
            return (
                <TerminalTab
                    key={id}
                    id={id}
                    name={terminalInstance.name}
                    isActive={id === activeTerminalId}
                    isConnected={terminalInstance.isConnectedToSocket && terminalInstance.isPtyInitialized}
                    onSelect={setActiveTerminalId}
                    onClose={closeTerminal} 
                />
            );
        })}
      </div>
      
      <div ref={terminalContainerRef} className="flex-grow bg-[#1e1e1e] overflow-hidden relative" />
      
      <div className="px-3 py-1 bg-gray-800 border-t border-gray-700 text-gray-400 text-xs flex items-center justify-between">
        <span>
            {activeTerminalId && terminals[activeTerminalId]?.name 
                ? terminals[activeTerminalId].name 
                : 'No Active Terminal'} - {activeTerminalId && terminals[activeTerminalId] && (terminals[activeTerminalId].isConnectedToSocket && terminals[activeTerminalId].isPtyInitialized) 
                    ? 'PTY Active' 
                    : 'Offline'}
        </span>
        <span>
            {activeTerminalId && terminals[activeTerminalId]?.environmentType 
                ? `Env: ${terminals[activeTerminalId].environmentType}` 
                : ''}
        </span>
      </div>
    </div>
  );
};

export default TerminalComponent;