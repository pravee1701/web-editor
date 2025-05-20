import Docker from 'dockerode';
import path from 'path';
import { promises as fsPromises, existsSync } from 'fs';


const docker = new Docker();
export const activeContainers = new Map(); // Stores: key (`${userId}-${terminalId}`) -> { container, userId, projectSlug, vfsProjectRootId (optional) }
const containerTimers = new Map();
const BASE_PROJECT_DIR = path.resolve(process.cwd(), 'projects');
const CONTAINER_IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes

export const LANGUAGE_IMAGES = {
  javascript: 'node:18-alpine',
  python: 'python:3.11-slim',
  cpp: 'gcc:12-alpine',
  java: 'eclipse-temurin:17-jdk-alpine',
  php: 'php:8.2-alpine',
  ruby: 'ruby:3.2-alpine',
  react: 'node:18-alpine',
  vue: 'node:18-alpine',
  angular: 'node:18-alpine',
  express: 'node:18-alpine',
  shell: 'alpine:latest', // Default for generic shells
  node: 'node:18-alpine', // Alias for javascript if 'node' is passed as env
};

const LANGUAGE_RESOURCES = { // Memory in MB, CPU in cores
  javascript: { memory: 256, cpu: 0.5 },
  python: { memory: 256, cpu: 0.5 },
  cpp: { memory: 512, cpu: 1 },
  java: { memory: 1024, cpu: 2 }, // Java typically needs more
  php: { memory: 256, cpu: 0.5 },
  ruby: { memory: 256, cpu: 0.5 },
  react: { memory: 512, cpu: 1 },
  vue: { memory: 512, cpu: 1 },
  angular: { memory: 512, cpu: 1 },
  express: { memory: 256, cpu: 0.5 },
  shell: { memory: 128, cpu: 0.25 },
  node: { memory: 256, cpu: 0.5 },
  default: { memory: 256, cpu: 0.5 },
};

export const pullDockerImage = async (image) => {
  console.log(`DOCKER: Pulling image: ${image} (this may take a while)...`);
  return new Promise((resolve, reject) => {
    docker.pull(image, (err, stream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, 
        (err, output) => { // onFinished
          if (err) return reject(err);
          console.log(`DOCKER: Image pulled successfully: ${image}`);
          resolve(output);
        },
        (event) => { /* onProgress, optionally log event.status */ }
      );
    });
  });
};

export const imageExists = async (imageName) => {
  try {
    const images = await docker.listImages({ filters: { reference: [imageName] } });
    return images.some(img => img.RepoTags && img.RepoTags.includes(imageName));
  } catch (error) {
    console.error('DOCKER: Error checking if image exists:', error);
    return false;
  }
};

// projectSlug is the name of the folder on host under projects/<userId>/
// vfsProjectRootId is the MongoDB _id of the project's root folder in VFS (can be null for user's VFS root)
export const createDockerContainer = async (userId, terminalId /* socket.id */, language = 'javascript', projectSlugForHost, vfsProjectRootIdForSync = null) => {
  try {
    if (!userId || !terminalId) {
      throw new Error('User ID and Terminal ID are required to create a container');
    }

    const key = `${userId}-${terminalId}`;
    
    // If projectSlugForHost is not provided, default to a directory named after the userId (for user's root workspace)
    const effectiveProjectSlug = projectSlugForHost || userId.toString();
    const projectWorkspaceOnHost = path.resolve(BASE_PROJECT_DIR, userId.toString(), effectiveProjectSlug);

    let existingSessionInfo = activeContainers.get(key);
    if (existingSessionInfo && existingSessionInfo.container) {
      try {
        const inspectInfo = await existingSessionInfo.container.inspect();
        if (inspectInfo.State.Running || inspectInfo.State.Paused) {
          console.log(`DOCKER: Container already exists and is running/paused for session ${key}, project ${effectiveProjectSlug}`);
          resetContainerTimer(userId, terminalId); // Reset timer for this specific session
          return existingSessionInfo.container; // Return existing container object
        } else {
          console.log(`DOCKER: Container for session ${key} exists but not running. Removing and recreating.`);
          await existingSessionInfo.container.remove({ force: true }).catch(err => console.warn(`DOCKER: Minor: Failed to remove existing non-running container ${key}: ${err.message}`));
        }
      } catch (inspectError) {
        console.warn(`DOCKER: Error inspecting existing container for ${key} (may be stale): ${inspectError.message}. Removing and recreating.`);
        if(existingSessionInfo.container) await existingSessionInfo.container.remove({ force: true }).catch(err => console.warn(`DOCKER: Minor: Failed to remove stale container ${key}: ${err.message}`));
      }
    }

    console.log(`DOCKER: Ensuring host workspace for user ${userId}, project ${effectiveProjectSlug}: ${projectWorkspaceOnHost}`);
    if (!existsSync(projectWorkspaceOnHost)) {
      await fsPromises.mkdir(projectWorkspaceOnHost, { recursive: true });
      await fsPromises.chmod(projectWorkspaceOnHost, 0o755);
    } else {
      // Ensure permissions are set even if it exists
      await fsPromises.chmod(projectWorkspaceOnHost, 0o755).catch(err => console.warn(`DOCKER: Warning: Could not chmod existing project workspace ${projectWorkspaceOnHost}: ${err.message}`));
    }

    const normalizedLang = (typeof language === 'string' ? language : 'javascript').toLowerCase();
    const image = LANGUAGE_IMAGES[normalizedLang] || LANGUAGE_IMAGES.shell; // Default to shell if lang not mapped
    const resources = LANGUAGE_RESOURCES[normalizedLang] || LANGUAGE_RESOURCES.default;

    if (!(await imageExists(image))) {
      await pullDockerImage(image);
    }

    console.log(`DOCKER: Creating container for session ${key} (project: ${effectiveProjectSlug}) with image ${image}`);
    const newContainer = await docker.createContainer({
      Image: image,
      Tty: true,
      Cmd: ['/bin/sh', '-c', 'trap exit TERM INT HUP; while true; do sleep 3600 & wait $!; done'], // Robust keep-alive
      HostConfig: {
        Binds: [`${projectWorkspaceOnHost}:/workspace:rw`],
        CapDrop: ['ALL'],
        CapAdd: ['NET_BIND_SERVICE', 'CHOWN', 'FOWNER', 'SETGID', 'SETUID', 'DAC_OVERRIDE'], // DAC_OVERRIDE can help with volume permissions
        SecurityOpt: ['no-new-privileges:true'],
        Memory: resources.memory * 1024 * 1024,
        NanoCpus: Math.floor(resources.cpu * 1e9),
        NetworkMode: 'bridge',
        AutoRemove: false, // We manage removal explicitly
        ReadonlyRootfs: false,
      },
      ExposedPorts: { '3000/tcp': {}, '4200/tcp': {}, '8080/tcp': {} },
      Labels: {
        'user': userId.toString(),
        'terminalSession': terminalId.toString(), // socket.id
        'projectSlug': effectiveProjectSlug,
        'vfsProjectId': vfsProjectRootIdForSync ? vfsProjectRootIdForSync.toString() : 'USER_ROOT',
        'created': new Date().toISOString(),
      }
    });

    await newContainer.start();
    console.log(`DOCKER: Container started for session ${key} (ID: ${newContainer.id.substring(0,12)}) mounting host path ${projectWorkspaceOnHost}`);
    
    activeContainers.set(key, { 
        container: newContainer, 
        userId: userId.toString(), 
        terminalId: terminalId.toString(), // Store terminalId for clarity
        projectSlug: effectiveProjectSlug, 
        vfsProjectRootId: vfsProjectRootIdForSync 
    });
    resetContainerTimer(userId, terminalId);
    return newContainer; // Return the Dockerode container object
  } catch (error) {
    console.error(`DOCKER: Error creating container for user ${userId}, terminal ${terminalId} (lang: ${language}, project: ${projectSlugForHost}):`, error);
    // Clean up if partially added to map
    if (activeContainers.has(`${userId}-${terminalId}`)) {
        activeContainers.delete(`${userId}-${terminalId}`);
    }
    throw new Error(`Failed to create container: ${error.message}`);
  }
};

// This function is for NON-PTY commands. PTY commands are handled by terminalSocketHandler.
export const executeCommandInContainer = async (userId, terminalId, command, options = {}) => {
  const { workingDir = '/workspace', language = 'shell' } = options; // language hint for container creation
  const key = `${userId}-${terminalId}`;
  let sessionInfo = activeContainers.get(key);
  let container;

  if (!sessionInfo || !sessionInfo.container) {
    console.log(`DOCKER_EXEC: No active container for session ${key}, creating one with lang ${language}.`);
    // When creating for exec, we don't know the specific projectSlug or vfsId unless passed in options
    // For now, it will create a container in the user's root host dir projects/<userId>/<userId>
    // This might need refinement if exec needs to target a specific project workspace.
    // For `runScript`, the project context is known and script is written to host first.
    container = await createDockerContainer(userId, terminalId, language, options.projectSlug /* pass if available */, options.vfsProjectId /* pass if available */);
    // Re-fetch sessionInfo if container was just created (though createDockerContainer sets it)
    sessionInfo = activeContainers.get(key); 
    if (!sessionInfo) { // Should not happen if createDockerContainer succeeded
        throw new Error("Failed to get session info after container creation for exec.");
    }
    container = sessionInfo.container;
  } else {
    container = sessionInfo.container;
    try {
        const containerInfo = await container.inspect();
        if (!containerInfo.State.Running) {
            console.warn(`DOCKER_EXEC: Container for session ${key} found but not running. Attempting to start...`);
            await container.start();
            console.log(`DOCKER_EXEC: Container for session ${key} started.`);
        }
    } catch (e) {
        console.error(`DOCKER_EXEC: Error inspecting/starting container for session ${key}. Recreating. Error:`, e);
        container = await createDockerContainer(userId, terminalId, language, options.projectSlug, options.vfsProjectId);
        sessionInfo = activeContainers.get(key);
        if (!sessionInfo) throw new Error("Failed to get session info after container re-creation for exec.");
        container = sessionInfo.container;
    }
  }

  resetContainerTimer(userId, terminalId);

  const execConfig = {
    Cmd: ['/bin/sh', '-c', command],
    AttachStdout: true, AttachStderr: true,
    WorkingDir: workingDir, Tty: false,
  };

  try {
    const execInstance = await container.exec(execConfig);
    const stream = await execInstance.start({ Detach: false });
    let outputData = '', errorData = '';
    const demuxPromise = new Promise((resolve, reject) => {
        container.modem.demuxStream(stream, 
            { write: (data) => { outputData += data.toString('utf8'); } },
            { write: (data) => { errorData += data.toString('utf8'); } }
        );
        stream.on('end', resolve); stream.on('error', reject);
    });
    await demuxPromise;
    return options.includeError !== false ? (outputData + errorData) : outputData;
  } catch (err) { /* ... error handling, including 404 for container gone ... */ 
    console.error(`DOCKER_EXEC: Error executing in ${key} (WD: ${workingDir}): "${command}"`, err);
    if (err.statusCode === 404 || (err.message && err.message.toLowerCase().includes("no such container"))) {
        console.warn(`DOCKER_EXEC: Container ${key} seems to be gone. Removing from active map.`);
        activeContainers.delete(key);
        if (containerTimers.has(key)) { clearTimeout(containerTimers.get(key)); containerTimers.delete(key); }
    }
    throw new Error(`Command execution failed: ${err.message}`);
  }
};

// Renamed the internal function to avoid confusion if called directly
const stopAndRemoveContainerInternal = async (userId, terminalId, performSyncOnStop) => {
  const key = `${userId}-${terminalId}`;
  const sessionInfo = activeContainers.get(key);

  if (!sessionInfo || !sessionInfo.container) return false;
  
  const { container, projectSlug, vfsProjectRootId } = sessionInfo; // Use stored info
  console.log(`DOCKER: Stopping & removing container for session ${key} (Project: ${projectSlug}, ID: ${container.id.substring(0,12)})`);

  try {
    if (performSyncOnStop) {
      try {
        const { syncWorkspaceToVfs } = await import('./codeExecutionController.js');
        const projectRootHostPath = path.resolve(BASE_PROJECT_DIR, userId.toString(), projectSlug);
        
        // vfsProjectRootId should ideally be stored in sessionInfo.
        // If not, we might need to look it up or default to null (user's VFS root).
        let vfsIdToSync = vfsProjectRootId;
        if (vfsIdToSync === undefined || (vfsIdToSync === 'USER_ROOT' && projectSlug === userId.toString())) { // Check label value
            vfsIdToSync = null; // Sync to user's VFS root
        } else if (vfsIdToSync === 'USER_ROOT' && projectSlug !== userId.toString()) {
            // This case means projectSlug is a named VFS project, find its ID
            const FileModel = (await import('../models/fileModel.js')).default;
            const vfsProject = await FileModel.findOne({ userId, name: projectSlug, parentId: null, type: 'folder' });
            vfsIdToSync = vfsProject ? vfsProject._id : null; // Fallback to user root if not found
        }

        console.log(`DOCKER_STOP_SYNC: Syncing host path ${projectRootHostPath} to VFS project ID ${vfsIdToSync}`);
        await syncWorkspaceToVfs(userId, projectRootHostPath, vfsIdToSync);
      } catch (syncErr) {
        console.warn(`DOCKER_STOP_SYNC: Sync before container stop failed for ${key}: ${syncErr.message}`);
      }
    }

    let isRunning = false;
    try {
      const inspectInfo = await container.inspect();
      isRunning = inspectInfo.State.Running;
    } catch (inspectErr) { /* Container might be gone */ }

    if (isRunning) {
      await container.stop({ timeout: 10 }).catch(err => console.warn(`DOCKER: Failed to stop ${key} gracefully: ${err.message}`));
    }
    await container.remove({ force: true });
    console.log(`DOCKER: Container removed for ${key}`);
  } catch (error) {
    console.error(`DOCKER: Error stopping/removing container for ${key}:`, error);
  } finally {
    activeContainers.delete(key);
    if (containerTimers.has(key)) {
      clearTimeout(containerTimers.get(key));
      containerTimers.delete(key);
    }
  }
  return true;
};

// Public function for explicit stop, always tries to sync
export const stopAndRemoveContainer = async (userId, terminalId) => {
    return stopAndRemoveContainerInternal(userId, terminalId, true);
};


export const resetContainerTimer = (userId, terminalId) => {
  const key = `${userId}-${terminalId}`;
  if (containerTimers.has(key)) clearTimeout(containerTimers.get(key));
  
  const timer = setTimeout(async () => {
    const sessionInfo = activeContainers.get(key);
    if (!sessionInfo || !sessionInfo.container) {
      console.log(`DOCKER_IDLE: No active session ${key} found for timeout.`);
      containerTimers.delete(key); // Clean up timer if no session
      return;
    }
    console.log(`DOCKER_IDLE: Container session ${key} (Project: ${sessionInfo.projectSlug}) idle timeout. Syncing and stopping.`);
    
    // Perform sync first
    try {
      const { syncWorkspaceToVfs } = await import('./codeExecutionController.js');
      const projectRootHostPath = path.resolve(BASE_PROJECT_DIR, sessionInfo.userId.toString(), sessionInfo.projectSlug);
      let vfsIdToSync = sessionInfo.vfsProjectRootId;
      if (vfsIdToSync === undefined || (vfsIdToSync === 'USER_ROOT' && sessionInfo.projectSlug === sessionInfo.userId.toString())) {
          vfsIdToSync = null;
      } else if (vfsIdToSync === 'USER_ROOT' && sessionInfo.projectSlug !== sessionInfo.userId.toString()) {
          const FileModel = (await import('../models/fileModel.js')).default;
          const vfsProject = await FileModel.findOne({ userId: sessionInfo.userId, name: sessionInfo.projectSlug, parentId: null, type: 'folder' });
          vfsIdToSync = vfsProject ? vfsProject._id : null;
      }
      console.log(`DOCKER_IDLE_SYNC: Syncing host path ${projectRootHostPath} to VFS project ID ${vfsIdToSync}`);
      await syncWorkspaceToVfs(sessionInfo.userId, projectRootHostPath, vfsIdToSync);
    } catch (syncErr) {
      console.error(`DOCKER_IDLE_SYNC: Error syncing files for idle session ${key}:`, syncErr);
    }
    
    // Then stop (without re-syncing)
    stopAndRemoveContainerInternal(userId, terminalId, false); // false because sync already done
  }, CONTAINER_IDLE_TIMEOUT);
  containerTimers.set(key, timer);
};


export const cleanupContainers = async () => {
  console.log('DOCKER: Cleaning up all managed containers...');
  const keys = Array.from(activeContainers.keys());
  const cleanupPromises = [];

  for (const key of keys) {
    const sessionInfo = activeContainers.get(key);
    if (sessionInfo && sessionInfo.userId && sessionInfo.terminalId) {
        console.log(`DOCKER_CLEANUP: Scheduling cleanup for container session ${key} (Project: ${sessionInfo.projectSlug})`);
        cleanupPromises.push(stopAndRemoveContainerInternal(sessionInfo.userId, sessionInfo.terminalId, true)); // Sync on final shutdown
    } else {
        console.warn(`DOCKER_CLEANUP: Incomplete session info for key ${key}, cannot reliably stop.`);
    }
  }
  const results = await Promise.allSettled(cleanupPromises);
  results.forEach(result => {
    if (result.status === 'rejected') console.error('DOCKER_CLEANUP: Error during batch container cleanup:', result.reason);
  });
  console.log('DOCKER: Container cleanup process finished.');
};