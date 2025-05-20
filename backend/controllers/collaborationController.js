import * as Y from 'yjs';
import { YSocketIO } from 'y-socket.io/dist/server';
import { checkProjectPermission } from "../utils/authUtils.js";

import fs from 'fs/promises';
import { existsSync } from 'fs';
import fse from 'fs-extra';
import path from 'path';
import lodash from 'lodash';
const { debounce } = lodash;

const BASE_PROJECT_DIR = process.env.APP_BASE_PROJECT_DIR || path.resolve(process.cwd(), 'projects');
const SAVE_DEBOUNCE_MS = 2500;


const documentPersistenceHandlers = new Map();

const parseRoomNameToHostPath = (roomName) => {
  if (typeof roomName !== 'string' || !roomName.startsWith('yjs-doc_')) {
    console.warn(`YJS_COLLAB_IO: Invalid roomName format for parsing: ${roomName}`);
    return null;
  }
  const relevantPart = roomName.substring('yjs-doc_'.length);
  const parts = relevantPart.split('_');
  if (parts.length < 3) {
    console.warn(`YJS_COLLAB_IO: Could not parse roomName (not enough parts): "${roomName}" from "${relevantPart}"`);
    return null;
  }
  const userId = parts[0];
  const projectSlug = parts[1];
  const encodedRelativeFilePath = parts.slice(2).join('_');
  const relativeFilePath = encodedRelativeFilePath.replace(/---/g, '/');

  if (!userId || !projectSlug || relativeFilePath === undefined) {
    console.warn(`YJS_COLLAB_IO: Could not parse full details from roomName: "${roomName}"`);
    return null;
  }
  const projectRootOnHost = path.resolve(BASE_PROJECT_DIR, userId, projectSlug);
  const fullHostPath = path.resolve(projectRootOnHost, relativeFilePath.replace(/^\//, ''));

  if (!fullHostPath.startsWith(projectRootOnHost) && fullHostPath !== projectRootOnHost) {
    console.error(`YJS_COLLAB_IO: SECURITY - Path traversal for room "${roomName}". Resolved: "${fullHostPath}", Base: "${projectRootOnHost}"`);
    return null;
  }
  return fullHostPath;
};

// Room-specific authorization - called when a client tries to join a specific room
const checkRoomAuthorization = async (connectingUserId, roomName) => {
  if (!roomName || typeof roomName !== 'string') {
    console.error(`YJS_AUTH: Invalid room name for authorization check: ${roomName}`);
    return false;
  }

  const roomParams = parseRoomNameForAuth(roomName);
  if (!roomParams) {
    console.error(`YJS_AUTH: Could not parse room params from: ${roomName}`);
    return false;
  }

  return await checkProjectPermission(
    connectingUserId,
    roomParams.ownerUserId,
    roomParams.projectSlug,
    'write'
  );
};

export const setupCollaborationSocket = (io) => {
  // Create YSocketIO instance with proper configuration
  const ysocketio = new YSocketIO(io, {
    authenticate: async (handshakeData, roomName, socket) => {
      console.log(`YJS_AUTH: Authentication attempt with socket ID: ${socket?.id}`);
      console.log(`YJS_AUTH: Authenticating connection for room:`, roomName);
      console.log(`YJS_AUTH: Handshake auth data:`, handshakeData.auth);

      const connectingUserId = handshakeData.auth?.userId;
      if (!connectingUserId) {
        console.error(`YJS_AUTH: Missing userId in auth data`);
        throw new Error("Authentication required (userId missing).");
      }

      console.log(`YJS_AUTH: User ${connectingUserId} authenticated for initial connection`);
      return { userId: connectingUserId };
    },

    gcEnabled: true, // Default but explicit
  });

  // Add event listener for document-loaded (when a document is created)
  ysocketio.on('document-loaded', async (docName, ydoc, context) => {
    // Ensure docName is a string
    const roomNameStr = String(docName);

    // docName is a string, ydoc is a new Y.Doc instance created by YSocketIO
    // context is what was returned by the `authenticate` callback
    console.log(`YJS_COLLAB_IO: [onDocumentLoad] for doc: "${roomNameStr}", context:`, context);

    if (!ydoc || typeof ydoc.getText !== 'function') {
      console.error(`YJS_COLLAB_IO: [onDocumentLoad] Received invalid Y.Doc for "${roomNameStr}". Aborting persistence setup.`);
      return ydoc; // Return the (potentially invalid) ydoc as YSocketIO expects a Y.Doc
    }

    const hostFilePath = parseRoomNameToHostPath(roomNameStr);
    if (hostFilePath) {
      try {
        if (existsSync(hostFilePath)) {
          const fileContent = await fs.readFile(hostFilePath, 'utf8');
          const yText = ydoc.getText('monaco'); // Get or create the shared text type
          if (fileContent && yText.toString() !== fileContent) { // Only update if different
            ydoc.transact(() => {
              if (yText.length > 0) yText.delete(0, yText.length);
              yText.insert(0, fileContent);
            }, 'persistence-load'); // Origin to prevent re-saving this load
            console.log(`YJS_COLLAB_IO: [onDocumentLoad] Loaded content for "${roomNameStr}" from ${hostFilePath}`);
          } else if (!fileContent && yText.length === 0) {
            console.log(`YJS_COLLAB_IO: [onDocumentLoad] Host file and YDoc for "${roomNameStr}" are both empty.`);
          } else {
            console.log(`YJS_COLLAB_IO: [onDocumentLoad] YDoc content for "${roomNameStr}" already matches host or was pre-populated.`);
          }
        } else {
          console.log(`YJS_COLLAB_IO: [onDocumentLoad] File ${hostFilePath} for "${roomNameStr}" not found. Creating empty file.`);
          await fse.ensureDir(path.dirname(hostFilePath));
          await fs.writeFile(hostFilePath, '', 'utf8');
          // Y.Doc is already empty, which is correct for a new file.
        }
      } catch (loadError) {
        console.error(`YJS_COLLAB_IO: [onDocumentLoad] Error loading ${hostFilePath} for "${roomNameStr}":`, loadError);
      }
    } else {
      console.warn(`YJS_COLLAB_IO: [onDocumentLoad] No host path for "${roomNameStr}". Document will be purely in-memory.`);
    }

    // Setup debounced save and 'update' listener for this ydoc
    if (!documentPersistenceHandlers.has(roomNameStr)) { // Attach only once
      const actualSaveToFS = async () => {
        const currentHostPath = parseRoomNameToHostPath(roomNameStr);
        if (!currentHostPath) return;
        try {
          if (ydoc && typeof ydoc.getText === 'function') { // Check ydoc again before using
            const content = ydoc.getText('monaco').toString();
            await fse.ensureDir(path.dirname(currentHostPath));
            await fs.writeFile(currentHostPath, content, 'utf8');
            console.log(`YJS_COLLAB_IO: [Debounced Save] Document "${roomNameStr}" saved to ${currentHostPath}`);
          } else {
            console.warn(`YJS_COLLAB_IO: [Debounced Save] YDoc for "${roomNameStr}" became invalid before save.`);
          }
        } catch (error) { console.error(`YJS_COLLAB_IO: [Debounced Save] Error saving "${roomNameStr}":`, error); }
      };
      const debouncer = debounce(actualSaveToFS, SAVE_DEBOUNCE_MS);
      const updateHandler = (update, origin) => {
        if (origin !== 'persistence-load') { // Don't save if the update came from our initial load
          debouncer();
        }
      };
      ydoc.on('update', updateHandler);
      documentPersistenceHandlers.set(roomNameStr, { debouncer, updateHandler, ydoc }); // Store ydoc too for cleanup
    }
    return ydoc; // Crucial: return the ydoc instance
  });



  // Document update event handling (per API contract)
  // In setupCollaborationSocket.js

  // MAKE SURE ydoc.name is set in onDocumentLoad
  ysocketio.on('document-loaded', async (docName, ydoc, context) => {
    const roomNameStr = String(docName); // docName IS a string here

    if (!ydoc || typeof ydoc.getText !== 'function') {
      console.error(`YJS_COLLAB_IO: [onDocumentLoad] Received invalid Y.Doc for "${roomNameStr}". Aborting persistence setup.`);
      return ydoc;
    }

    // Crucially set the ydoc.name if not already set by y-socket.io
    // This helps other event handlers identify the doc if parameters are swapped.
    if (!ydoc.name) {
      ydoc.name = roomNameStr;
      console.log(`YJS_COLLAB_IO: [onDocumentLoad] Explicitly set ydoc.name to "${roomNameStr}"`);
    } else if (ydoc.name !== roomNameStr) {
      // This case should ideally not happen if y-socket.io is consistent or if we always set it.
      console.warn(`YJS_COLLAB_IO: [onDocumentLoad] Mismatch! docName from event: "${roomNameStr}", ydoc.name: "${ydoc.name}". Using event docName.`);
      // Optionally, force ydoc.name to match roomNameStr if there's a discrepancy
      // ydoc.name = roomNameStr;
    }



    const hostFilePath = parseRoomNameToHostPath(roomNameStr);
    // ... (load file content into ydoc if hostFilePath exists) ...

    if (!documentPersistenceHandlers.has(roomNameStr)) {
      const actualSaveToFS = async () => {
        // Use roomNameStr (the key) to get the correct host path
        const currentHostPath = parseRoomNameToHostPath(roomNameStr);
        if (!currentHostPath) {
          console.warn(`YJS_COLLAB_IO: [Debounced Save] No host path for key "${roomNameStr}" during save.`);
          return;
        }
        try {
          // Fetch the YDoc from the persistence handler map; it's the authoritative one for this roomNameStr
          const persistenceEntry = documentPersistenceHandlers.get(roomNameStr);
          if (persistenceEntry && persistenceEntry.ydoc && typeof persistenceEntry.ydoc.getText === 'function') {
            const content = persistenceEntry.ydoc.getText('monaco').toString();
            await fse.ensureDir(path.dirname(currentHostPath));
            await fs.writeFile(currentHostPath, content, 'utf8');
            console.log(`YJS_COLLAB_IO: [Debounced Save] Document "${roomNameStr}" saved to ${currentHostPath}`);
          } else {
            console.warn(`YJS_COLLAB_IO: [Debounced Save] YDoc for "${roomNameStr}" became invalid or not found in handlers before save.`);
          }
        } catch (error) { console.error(`YJS_COLLAB_IO: [Debounced Save] Error saving "${roomNameStr}":`, error); }
      };
      const debouncer = debounce(actualSaveToFS, SAVE_DEBOUNCE_MS);
      const updateHandler = (update, origin, YDOC_INSTANCE_THAT_EMITTED_UPDATE) => { // Yjs 'update' event passes the doc as 3rd param
        // Check if YDOC_INSTANCE_THAT_EMITTED_UPDATE.name matches roomNameStr to be sure
        if (YDOC_INSTANCE_THAT_EMITTED_UPDATE && YDOC_INSTANCE_THAT_EMITTED_UPDATE.name !== roomNameStr) {
          console.warn(`YJS_COLLAB_IO: [ydoc.on('update')] for doc "${YDOC_INSTANCE_THAT_EMITTED_UPDATE.name}" but handler is for "${roomNameStr}". Origin: ${origin}.`);
        } else {
          console.log(`YJS_COLLAB_IO: [ydoc.on('update')] for "${roomNameStr}", origin: ${origin}. Debouncer will be called.`);
        }

        if (origin !== 'persistence-load') {
          debouncer();
        }
      };
      ydoc.on('update', updateHandler);
      documentPersistenceHandlers.set(roomNameStr, { debouncer, updateHandler, ydoc }); // Store the ydoc instance from onDocumentLoad
    }
    return ydoc;
  });


  // Centralized function to get doc name and ydoc from potentially swapped params
  function getNamedYDoc(param1, param2) {
    let yDocInstance = param2;
    let docNameString = param1;

    if (param1 && typeof param1.getText === 'function' &&
      (param2 === undefined || (param2 && typeof param2.getText !== 'function'))) {
      // param1 is YDoc, param2 is something else (or undefined)
      yDocInstance = param1;
      docNameString = yDocInstance.name || 'unnamed-document'; // Relies on ydoc.name being set
      // console.log(`YJS_COLLAB_IO: [getNamedYDoc] Reordered params. Doc name from YDoc.name: "${docNameString}"`);
    }

    // Ensure docNameString is actually a string
    if (typeof docNameString !== 'string') {
      // This might happen if yDocInstance.name was undefined and param1 was an object without getText
      console.warn(`YJS_COLLAB_IO: [getNamedYDoc] docNameString is not a string: ${typeof docNameString}. Falling back to 'unknown-doc' or trying to stringify.`);
      docNameString = String(docNameString) === '[object Object]' ? 'unknown-doc-object' : String(docNameString);
    }

    return { ydoc: yDocInstance, docName: docNameString };
  }


  ysocketio.on('document-update', async (param1, param2, context) => {
    const { ydoc, docName } = getNamedYDoc(param1, param2);

    console.log(`YJS_COLLAB_IO: [onDocumentUpdate] hook called for "${docName}", context:`, context);

    if (!ydoc || typeof ydoc.getText !== 'function') {
      console.error(`YJS_COLLAB_IO: [onDocumentUpdate] Invalid Y.Doc for "${docName}". YDoc resolved as:`, ydoc);
      return;
    }

    const persistence = documentPersistenceHandlers.get(docName);
    if (persistence && persistence.debouncer) {
      if (persistence.ydoc !== ydoc) {
        console.warn(`YJS_COLLAB_IO: [onDocumentUpdate] YDOC INSTANCE MISMATCH for "${docName}". Handler has one, event gave another. This is problematic.`);
        // This scenario is dangerous. The debouncer is tied to persistence.ydoc.
        // Calling persistence.debouncer() will save persistence.ydoc, not the ydoc from this event.
        // This indicates a deeper issue if y-socket.io is managing multiple Y.Doc instances for the same name,
        // or if our onDocumentLoad isn't correctly returning the Y.Doc that y-socket.io continues to use.
        //
        // For now, let's assume the one in persistence handler is the "true" one for saving,
        // but this needs investigation if it occurs.
      }
      persistence.debouncer();
    } else {
      console.warn(`YJS_COLLAB_IO: [onDocumentUpdate] No debouncer for "${docName}". Attempting direct save (using event's ydoc).`);
      const hostFilePath = parseRoomNameToHostPath(docName);
      if (hostFilePath) {
        try {
          const content = ydoc.getText('monaco').toString(); // Use ydoc from this event for direct save
          await fse.ensureDir(path.dirname(hostFilePath));
          await fs.writeFile(hostFilePath, content, 'utf8');
          console.log(`YJS_COLLAB_IO: [onDocumentUpdate - Direct Save] "${docName}" saved.`);
        } catch (err) { console.error(`YJS_COLLAB_IO: [onDocumentUpdate - Direct Save] Error for "${docName}":`, err); }
      }
    }
  });

  ysocketio.on('awareness-update', (param1, param2, param3) => {
    // For awareness, the ydoc is usually the first, then awareness update (Uint8Array), then origin socket ID
    const { ydoc, docName } = getNamedYDoc(param1, param2); // param2 might be the awareness update itself
    let originSocketId = param3;
    let awarenessUpdateData = param2;

    if (ydoc === param1) { // Params were swapped: ydoc, awareness_update, originSocketId
      awarenessUpdateData = param2;
      originSocketId = param3;
    } else { // Params were likely: docName (string), awareness_update, originSocketId
      awarenessUpdateData = param2; // docName is already string
      // ydoc might be undefined here if it wasn't the first param and param2 wasn't a YDoc.
      // This is okay if we only need the docName for logging awareness.
    }

    // The awarenessUpdateData (originally param2 or still param2) is likely the Uint8Array
    // The originSocketId (originally param3) is the socket that sent the update
    console.log(`YJS_COLLAB_IO: Awareness update for document "${docName}" (YDoc valid: ${!!(ydoc && ydoc.getText)}) from origin ${originSocketId || 'unknown'}. Data: ${awarenessUpdateData ? awarenessUpdateData.constructor.name : 'N/A'}`);
  });


  ysocketio.on('document-destroy', (param1) => {
    // Document destroy usually passes the Y.Doc as param1, or its name.
    const { ydoc, docName } = getNamedYDoc(param1, undefined); // Pass undefined for param2

    console.log(`YJS_COLLAB_IO: Document "${docName}" being destroyed. YDoc valid: ${!!(ydoc && ydoc.getText)}`);

    const persistence = documentPersistenceHandlers.get(docName);
    if (persistence) {
      // Use persistence.ydoc for unobserving, as that's the one we attached to.
      if (persistence.ydoc && typeof persistence.ydoc.off === 'function' && persistence.updateHandler) {
        persistence.ydoc.off('update', persistence.updateHandler);
        console.log(`YJS_COLLAB_IO: Unbound 'update' handler for "${docName}".`);
      }
      if (persistence.debouncer && typeof persistence.debouncer.flush === 'function') {
        console.log(`YJS_COLLAB_IO: Flushing final save for "${docName}" on destroy.`);
        persistence.debouncer.flush(); // This will use persistence.ydoc
      }
      documentPersistenceHandlers.delete(docName);
    } else {
      console.warn(`YJS_COLLAB_IO: No persistence handler found for "${docName}" during destroy. Unable to perform final save or cleanup listeners.`);
    }
  });

  ysocketio.on('all-document-connections-closed', (param1) => {
    const { ydoc, docName } = getNamedYDoc(param1, undefined);

    console.log(`YJS_COLLAB_IO: All connections closed for document "${docName}". YDoc valid: ${!!(ydoc && ydoc.getText)}`);

    const persistence = documentPersistenceHandlers.get(docName);
    if (persistence && persistence.debouncer && typeof persistence.debouncer.flush === 'function') {
      console.log(`YJS_COLLAB_IO: Performing final save for "${docName}" as all connections closed.`);
      persistence.debouncer.flush(); // This will use persistence.ydoc
    }
  });



  // Connection events with room-specific authorization
  ysocketio.on('connect', async (socket, roomName, ydoc) => {
    // Ensure roomName is a string
    const roomNameStr = roomName ? String(roomName) : undefined;
    console.log(`YJS_COLLAB_IO: Client ${socket.id} attempting to connect to room ${roomNameStr}`);

    // Get the user context from the authentication step
    const context = socket.data?.yjs?.context;
    const userId = context?.userId;

    if (!userId) {
      console.error(`YJS_COLLAB_IO: No user context for socket ${socket.id} connecting to ${roomNameStr}`);
      // We could disconnect the socket here if needed
      return;
    }

    // Room-specific authorization check
    if (roomNameStr) {
      try {
        const isAuthorized = await checkRoomAuthorization(userId, roomNameStr);
        if (!isAuthorized) {
          console.error(`YJS_COLLAB_IO: User ${userId} NOT authorized for room ${roomNameStr}`);
          // Disconnect the socket from this specific room
          socket.leave(roomNameStr);
          socket.emit('error', { message: "Not authorized for this document" });
          return;
        }
        console.log(`YJS_COLLAB_IO: User ${userId} authorized for room ${roomNameStr}`);
      } catch (error) {
        console.error(`YJS_COLLAB_IO: Error checking room authorization:`, error);
        socket.leave(roomNameStr);
        socket.emit('error', { message: "Error checking document access" });
        return;
      }
    }

    console.log(`YJS_COLLAB_IO: Client ${socket.id} (user ${userId}) connected to room ${roomNameStr}`);
  });

  ysocketio.on('disconnect', (socket, roomName) => {
    // Ensure roomName is a string
    const roomNameStr = roomName ? String(roomName) : undefined;
    console.log(`YJS_COLLAB_IO: Client ${socket.id} disconnected from room ${roomNameStr}`);
  });

  ysocketio.initialize();
  console.log(`Yjs Collaboration (Socket.IO) initialized.`);
};


// --- Placeholder Auth Utils (move to utils/authUtils.js) ---
// You need to implement this properly based on your fileModel.js
const parseRoomNameForAuth = (roomName) => {
  if (typeof roomName !== 'string') {
    console.warn(`YJS_AUTH: Invalid roomName type for auth parsing: ${typeof roomName}`);
    return null;
  }

  if (!roomName.startsWith('yjs-doc_')) {
    console.warn(`YJS_AUTH: Room name does not start with expected prefix: ${roomName}`);
    return null;
  }

  const relevantPart = roomName.substring('yjs-doc_'.length);
  const parts = relevantPart.split('_');

  // More detailed logging for troubleshooting
  if (parts.length < 3) {
    console.warn(`YJS_AUTH: Room name parts insufficient (${parts.length}): ${roomName}`);
    return null;
  }

  const ownerUserId = parts[0];
  const projectSlug = parts[1];

  if (!ownerUserId || !projectSlug) {
    console.warn(`YJS_AUTH: Could not extract user or project: ${roomName}`);
    return null;
  }

  console.log(`YJS_AUTH: Successfully parsed room name: owner=${ownerUserId}, project=${projectSlug}`);
  return { ownerUserId, projectSlug };
};

async function placeholderCheckProjectPermission(loggedInUserId, projectOwnerId, projectSlug, requiredPermission) {
  console.log(`AUTH_CHECK_PLACEHOLDER: User ${loggedInUserId} asking for ${requiredPermission} on project ${projectSlug} of owner ${projectOwnerId}`);
  // This is where you'd query your File model (VFS)
  // For now, allow if loggedInUser is owner, or for testing, allow all.
  if (loggedInUserId === projectOwnerId) return true;


  console.warn("AUTH_CHECK_PLACEHOLDER: Defaulting to true for non-owner. Implement proper VFS permission check!");
  return true; // Placeholder - REMOVE FOR PRODUCTION
}