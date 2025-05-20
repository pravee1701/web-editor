import User from '../models/userModel.js';
import File from '../models/fileModel.js'; // For VFS project lookup
import path from 'path';
import os from 'os';
import * as pty from 'node-pty';

import {
  createDockerContainer,
  LANGUAGE_IMAGES, // Used to map environment to image
  resetContainerTimer,
} from './dockerController.js';

import { syncProjectFromVfsToHost } from './codeExecutionController.js';

const DEFAULT_SHELL_IN_CONTAINER = 'bash';
const BASE_PROJECT_DIR = path.resolve(process.cwd(), 'projects');

const activePtySessions = new Map(); // socket.id -> { ptyProcess, containerId, userId, environment, projectSlug, vfsProjectRootId }

async function prepareContainerForPty(userId, ptySessionId, environment, projectSlugForHostDir, vfsProjectRootId) {
  const language = LANGUAGE_IMAGES[environment.toLowerCase()] ? environment.toLowerCase() : 'shell';
  // Pass projectSlugForHostDir and vfsProjectRootId to createDockerContainer so it can store them
  // in activeContainers map for later sync operations (e.g., on idle timeout).
  const container = await createDockerContainer(userId, ptySessionId, language, projectSlugForHostDir, vfsProjectRootId);
  if (!container || !container.id) {
    throw new Error('Failed to create/ensure Docker container for PTY.');
  }
  let effectiveShell = DEFAULT_SHELL_IN_CONTAINER;
  try { /* ... shell detection logic as in previous example ... */ 
    const checkShellExec = await container.exec({ Cmd: ['sh', '-c', `command -v ${DEFAULT_SHELL_IN_CONTAINER} && echo ${DEFAULT_SHELL_IN_CONTAINER} || echo sh`], AttachStdout: true, Tty:false });
    const stream = await checkShellExec.start({ Detach: false });
    let shellCheckOutput = '';
    await new Promise((resolve) => {
        stream.on('data', (chunk) => { shellCheckOutput += (chunk.length > 8 && chunk[0]===1) ? chunk.slice(8).toString('utf8'): chunk.toString('utf8'); });
        stream.on('end', resolve); stream.on('error', ()=>{console.warn("Shell check stream err"); resolve();});
    });
    shellCheckOutput = shellCheckOutput.trim().split('\n').pop().trim();
    if (shellCheckOutput === DEFAULT_SHELL_IN_CONTAINER || shellCheckOutput === 'sh') effectiveShell = shellCheckOutput;
    else effectiveShell = 'sh';
  } catch (e) { effectiveShell = 'sh'; console.warn("Shell check failed, defaulting to sh", e.message); }
  console.log(`PTY_SETUP: Using shell '${effectiveShell}' in container ${container.id.substring(0,12)}`);
  return { containerId: container.id, effectiveShell };
}

export const setupTerminalSocket = (io) => {
  const terminalNamespace = io.of('/terminal');

  terminalNamespace.on('connection', (socket) => {
    console.log(`PTY_SOCKET: Client connected: ${socket.id}`);

    socket.on('initialize_pty', async (data) => {
      let userId, environment, initialCols, initialRows, clientInitialVfsPath;
      let vfsProjectRootDoc = null;
      let projectSlugForHostDir = '';
      let relativePathWithinProjectForPty = '';
      let sessionData = {}; // Will store all context for activePtySessions

      try {
        userId = data.userId;
        environment = data.environment || 'shell';
        initialCols = parseInt(data.cols, 10) || 80;
        initialRows = parseInt(data.rows, 10) || 24;
        clientInitialVfsPath = data.initialVfsPath ? path.posix.normalize(data.initialVfsPath) : '/';

        if (!userId) throw new Error('User ID is required.');
        // Optional: const user = await User.findById(userId); if (!user) throw new Error(`User ${userId} not found.`);
        
        if (activePtySessions.has(socket.id)) {
            const oldSess = activePtySessions.get(socket.id);
            if(oldSess.ptyProcess) oldSess.ptyProcess.kill();
            activePtySessions.delete(socket.id);
            console.log(`PTY_SOCKET: Cleaned up old session for ${socket.id}`);
        }

        // --- Determine Project Context ---
        if (clientInitialVfsPath === '/') {
            vfsProjectRootDoc = null; // User's VFS root
            projectSlugForHostDir = userId.toString(); // Host folder: projects/<userId>/<userId>
            relativePathWithinProjectForPty = '';      // PTY CWD: /workspace
        } else {
            const pathParts = clientInitialVfsPath.split('/').filter(Boolean);
            if (pathParts.length > 0) {
                const potentialProjectSlug = pathParts[0];
                vfsProjectRootDoc = await File.findOne({ userId, name: potentialProjectSlug, parentId: null, type: 'folder' });
                if (vfsProjectRootDoc) {
                    projectSlugForHostDir = potentialProjectSlug;
                    relativePathWithinProjectForPty = pathParts.slice(1).join('/');
                } else {
                    console.warn(`PTY_SOCKET: VFS Project "${potentialProjectSlug}" not found for user ${userId}. Using user's root VFS.`);
                    vfsProjectRootDoc = null;
                    projectSlugForHostDir = userId.toString();
                    relativePathWithinProjectForPty = clientInitialVfsPath.startsWith('/') ? clientInitialVfsPath.substring(1) : clientInitialVfsPath;
                }
            } else { throw new Error("Invalid clientInitialVfsPath."); }
        }
        const projectRootHostPath = path.resolve(BASE_PROJECT_DIR, userId.toString(), projectSlugForHostDir);
        const vfsProjectRootIdToSync = vfsProjectRootDoc ? vfsProjectRootDoc._id : null;

        sessionData = { userId, environment, projectRootHostPath, vfsProjectRootId: vfsProjectRootIdToSync, projectSlug: projectSlugForHostDir, socketId: socket.id };

        // --- Sync VFS to Host ---
        console.log(`PTY_SOCKET: Syncing VFS (Root ID: ${vfsProjectRootIdToSync}, Slug: ${projectSlugForHostDir}) to Host: ${projectRootHostPath}`);
        await syncProjectFromVfsToHost(userId, vfsProjectRootIdToSync, projectRootHostPath);

        // --- Prepare Container --- Pass projectSlugForHostDir & vfsProjectRootIdToSync
        const { containerId, effectiveShell } = await prepareContainerForPty(userId, socket.id, environment, projectSlugForHostDir, vfsProjectRootIdToSync);
        sessionData.containerId = containerId;

        // --- Determine PTY CWD inside container ---
        const containerCwdForPty = path.posix.join('/workspace', relativePathWithinProjectForPty);
        
        console.log(`PTY_SOCKET: Spawning PTY. Container: ${containerId.substring(0,12)}, Shell: ${effectiveShell}, PTY CWD Target: ${containerCwdForPty}`);

        // --- Spawn PTY ---
        const ptyProcess = pty.spawn('docker', [
          'exec', '-i', '-t', containerId, effectiveShell, '-c',
          ` (cd "${containerCwdForPty}" 2>/dev/null || cd "/workspace" 2>/dev/null || cd "/" 2>/dev/null) && exec ${effectiveShell}`
        ], {
          name: 'xterm-256color', cols: initialCols, rows: initialRows,
          cwd: process.env.HOME, env: { ...process.env, /* TERM: 'xterm-256color' already set by name */ },
        });
        sessionData.ptyProcess = ptyProcess;
        activePtySessions.set(socket.id, sessionData);

        // --- Event Piping & Handling ---
        ptyProcess.onData((data) => socket.emit('pty_output', data));
        ptyProcess.onExit(({ exitCode, signal }) => {
          console.log(`PTY_SOCKET: Exited for ${socket.id}. Code: ${exitCode}, Signal: ${signal}`);
          socket.emit('pty_exit', `Shell session ended.`);
          activePtySessions.delete(socket.id);
        });
        
        resetContainerTimer(userId, socket.id);
        socket.emit('pty_initialized', `Interactive ${effectiveShell} session started.`);

      } catch (err) {
        console.error(`❌ PTY_SOCKET: Init Error for ${socket.id}:`, err);
        socket.emit('pty_error', `Failed to start PTY session: ${err.message}`);
        const currentSession = activePtySessions.get(socket.id);
        if (currentSession && currentSession.ptyProcess) currentSession.ptyProcess.kill();
        activePtySessions.delete(socket.id);
      }
    });

    socket.on('pty_input', (data) => {
      const session = activePtySessions.get(socket.id);
      if (session && session.ptyProcess) {
        session.ptyProcess.write(data);
        if(session.userId && session.socketId) { // socket.id is the terminalId for container key
            resetContainerTimer(session.userId, session.socketId);
        }
      }
    });

    socket.on('pty_resize', (size) => {
      const session = activePtySessions.get(socket.id);
      if (session && session.ptyProcess && size && typeof size.cols === 'number' && typeof size.rows === 'number') {
        try { session.ptyProcess.resize(Math.max(1, size.cols), Math.max(1, size.rows)); }
        catch (e) { console.warn(`PTY_SOCKET: Resize error for ${socket.id}:`, e.message); }
      }
    });

    socket.on('disconnect', (reason) => {
      console.log(`PTY_SOCKET: Client disconnected: ${socket.id}. Reason: ${reason}`);
      const session = activePtySessions.get(socket.id);
      if (session && session.ptyProcess) {
        session.ptyProcess.kill();
      }
      activePtySessions.delete(socket.id);
      // Container is managed by dockerController's idle timer (keyed by userId, socket.id)
    });
  });
};