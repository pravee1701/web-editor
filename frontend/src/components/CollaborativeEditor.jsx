import React, { useEffect, useRef, useMemo } from 'react';
import * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import * as Y from 'yjs';
import { SocketIOProvider } from 'y-socket.io'; 
import { MonacoBinding } from 'y-monaco';
import { useSelector } from 'react-redux';
import { Awareness } from 'y-protocols/awareness.js';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:8080';
const YJS_SOCKET_IO_NAMESPACE = undefined; // e.g., '/yjs-collab-sio'

const CollaborativeEditor = ({
    projectContext,
    fileContext,    // { path, name, initialContent }
    language,
    theme = 'vs-dark',
    onContentChange, // Callback to notify parent of Yjs content changes
}) => {
  const editorDomRef = useRef(null);
  const monacoInstanceRef = useRef(null);
  const ydocRef = useRef(null);
  const providerRef = useRef(null);
  const bindingRef = useRef(null);
  // This ref is to ensure we only attempt to log "synced" or handle onContentChange once after initial sync
  const initialSyncProcessedRef = useRef(false);

  const { user: currentUser } = useSelector(state => state.auth);

  const documentRoomName = useMemo(() => {
    if (!projectContext.userId || !projectContext.slug || !fileContext.path) return null;
    const sanitizedFilePath = fileContext.path.replace(/^\//, '').replace(/\//g, '---');
    return `yjs-doc_${projectContext.userId}_${projectContext.slug}_${sanitizedFilePath}`;
  }, [projectContext.userId, projectContext.slug, fileContext.path]);

  useEffect(() => {
    if (!editorDomRef.current || !documentRoomName || !currentUser?._id) {
      console.warn("CollaborativeEditor: Missing dependencies. Cleaning up.", { domRef: !!editorDomRef.current, documentRoomName, userId: !!currentUser?._id });
      console.warn("CollaborativeEditor: Cannot initialize - missing required data", {
        hasEditorRef: !!editorDomRef.current,
        documentRoomName,
        userId: currentUser?._id
      });
      // Cleanup logic
      if (bindingRef.current) { bindingRef.current.destroy(); bindingRef.current = null; }
      if (providerRef.current) { providerRef.current.disconnect(); providerRef.current = null; }
      if (monacoInstanceRef.current) { monacoInstanceRef.current.dispose(); monacoInstanceRef.current = null; }
      if (ydocRef.current) { ydocRef.current = null; } // Y.Doc is managed by provider's destroy
      initialSyncProcessedRef.current = false;
      return;
    }

    // Prevent re-init if already connected to the same room
    if (monacoInstanceRef.current && providerRef.current &&
        providerRef.current.roomName === documentRoomName &&
        providerRef.current.document === ydocRef.current && // Check if provider is using the same ydoc
        providerRef.current.connected) {
      console.log("CollaborativeEditor: Already initialized for document:", documentRoomName);
      if (monacoInstanceRef.current.getModel() && Monaco.editor.getModelLanguage(monacoInstanceRef.current.getModel()) !== language) {
        Monaco.editor.setModelLanguage(monacoInstanceRef.current.getModel(), language);
      }
      return;
    }

    console.log(`CollaborativeEditor: Initializing for document: ${documentRoomName}. Initial prop content: "${fileContext.initialContent ? 'Exists' : 'Empty'}"`);
    initialSyncProcessedRef.current = false;

    // --- Cleanup previous instances if documentRoomName changed ---
    if (bindingRef.current) { bindingRef.current.destroy(); bindingRef.current = null; }
    if (providerRef.current) { providerRef.current.disconnect(); providerRef.current = null; } // Use disconnect for SocketIOProvider
    if (monacoInstanceRef.current) { monacoInstanceRef.current.dispose(); monacoInstanceRef.current = null; }
    // if (ydocRef.current) { ydocRef.current.destroy(); } // Y.Doc doesn't have a destroy method, managed by provider

    // 1. Create Monaco Editor instance - *Initialize with initialContent from props*
    const editor = Monaco.editor.create(editorDomRef.current, {
      value: fileContext.initialContent || "", // Set Monaco's initial value
      language: language,
      theme: theme,
      automaticLayout: true,
      fontSize: 14,
      fontFamily: "'Fira Code', monospace, Menlo, Monaco, 'Courier New'",
      wordWrap: 'on',
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      readOnly: true, // Start as read-only until synced
    });
    monacoInstanceRef.current = editor;

    // 2. Initialize Yjs Doc
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;

    const currentAwareness = new Awareness(ydoc);

    // 3. Setup SocketIOProvider
    const actualServerUrlForSocketIO = YJS_SOCKET_IO_NAMESPACE ? `${SERVER_URL}${YJS_SOCKET_IO_NAMESPACE}` : SERVER_URL;
    console.log(`CollaborativeEditor: Connecting Yjs SocketIOProvider to ${actualServerUrlForSocketIO}, room: ${documentRoomName}`);

    const sioProvider = new SocketIOProvider(
      actualServerUrlForSocketIO,
      documentRoomName,
      ydoc,
      {
          auth: { userId: currentUser?._id }, 
          autoConnect: true,
          awareness: currentAwareness,
      }
  );
    providerRef.current = sioProvider;

    // 4. Get Yjs Text Type
    const yText = ydoc.getText('monaco');

    // 5. Create MonacoBinding
    // The binding will synchronize the initial content.
    // If yText is empty, it will take content from editor.getModel().
    // If yText has content (from server after sync), it will update editor.getModel().
    console.log(`CollaborativeEditor: Creating MonacoBinding. Initial editor content length: ${editor.getValue().length}, YText length: ${yText.length}`);
    
    const monacoBinding = new MonacoBinding(
      yText,
      editor.getModel(),
      new Set([editor]),
      currentAwareness
    );
    bindingRef.current = monacoBinding;


    // 6. Handle `sync` event from provider (after initial connection & sync with server)
    const syncHandler = (isSynced) => {
      if (isSynced && !initialSyncProcessedRef.current) {
        initialSyncProcessedRef.current = true;
        console.log(`CollaborativeEditor: YJS synced for "${documentRoomName}". Editor content should now match Yjs doc.`);
        // At this point, Monaco editor is already reflecting the Yjs state due to the binding.
        // No need to manually insert fileContext.initialContent into yText here.
        // The binding handles the initial state reconciliation.
        if (monacoInstanceRef.current) {
            monacoInstanceRef.current.updateOptions({ readOnly: false }); // Make editor writable
            monacoInstanceRef.current.focus();
            console.log(`CollaborativeEditor: Editor for "${documentRoomName}" is now writable and focused.`);
        }
        if (onContentChange) {
          onContentChange(yText.toString());
        }
      } else if (!isSynced) {
        console.log(`CollaborativeEditor: YJS syncing for "${documentRoomName}"...`);
        if (monacoInstanceRef.current) {
            monacoInstanceRef.current.updateOptions({ readOnly: true }); // Make read-only while not synced
        }
      }
    };
    sioProvider.on('sync', syncHandler);


    // 7. Setup User Awareness
    if (currentUser?._id && currentAwareness) {
        const colors = ['#30bced', '#6eeb83', '#ffbc42', '#ecd444', '#ee6352', '#9ac2c9', '#8acb88', '#dbacac'];
        const userColor = colors[Math.floor(Math.random() * colors.length)];
        currentAwareness.setLocalStateField('user', {
            name: currentUser.username || `User...${currentUser._id.slice(-4)}`,
            color: userColor, colorLight: userColor + 'AA'
        });
    }

    // Optional: Listen to Yjs text changes directly if needed for parent
    let yTextObserver = null;
    if (onContentChange) {
        yTextObserver = () => { onContentChange(yText.toString()); };
        yText.observe(yTextObserver);
    }

    sioProvider.on('status', event => { console.log(`YJS SocketIOProvider Status for ${documentRoomName}: ${event.status}`); });
    sioProvider.on('connect_error', (error) => { console.error(`YJS SocketIOProvider connection error for ${documentRoomName}:`, error);});

    // Cleanup function
    return () => {
      console.log(`CollaborativeEditor: Cleanup triggered for document: ${documentRoomName}`);
      if (yTextObserver) yText.unobserve(yTextObserver); // Unobserve if observer was set
      if (bindingRef.current) { bindingRef.current.destroy(); bindingRef.current = null; }
      if (providerRef.current) { providerRef.current.disconnect(); providerRef.current = null; }
      // ydoc is managed by the provider, destroying provider should handle ydoc unreferencing.
      if (ydocRef.current) { ydocRef.current = null; } 
      if (monacoInstanceRef.current) { monacoInstanceRef.current.dispose(); monacoInstanceRef.current = null; }
      initialSyncProcessedRef.current = false; // Reset for potential re-initialization
    };
  }, [ 
      documentRoomName, 
      currentUser?._id, 
      // fileContext.initialContent, // Now handled by Monaco init value, binding does the rest
      language, 
      theme, 
      onContentChange,
      fileContext.initialContent // Keep initialContent here so if IT changes, we re-init Monaco
    ]);

  // Effect to update Monaco language if the language prop changes
  useEffect(() => {
    if (monacoInstanceRef.current && monacoInstanceRef.current.getModel()) {
      try { Monaco.editor.setModelLanguage(monacoInstanceRef.current.getModel(), language); }
      catch (e) { console.warn("CollaborativeEditor: Could not set model language:", e); }
    }
  }, [language]);

  return (
    <div className="flex flex-col h-full w-full">
      <div ref={editorDomRef} className="flex-grow w-full h-full" />
    </div>
  );
};
export default CollaborativeEditor;